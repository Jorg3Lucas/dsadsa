import fs from 'node:fs';
import { runBackup } from '../auto-backup.js';

// ==========================================
// 💾 RANKING CACHE (Local JSON)
// ==========================================

const CACHE_PATH = './ranking_cache.json';

// In-memory cache to avoid reading from disk on every call. After a scrape,
// saveRankingCache() stores the SAME object reference that was written to disk,
// so the next getLocalRankingCache() returns it without re-reading or re-parsing
// the ~76k-player file — and the precomputed cleaned-name index (WeakMap keyed
// on the cache object) stays valid instead of being rebuilt from scratch.
let cachedRankingData = null;
let cacheLastModified = 0;
// updatedAt of the cached object (ISO string) — tracked so stats commands can
// report freshness without re-reading the ~76k-player file from disk.
let cacheUpdatedAt = null;

export function saveRankingCache(data) {
    try {
        // Backup before overwriting
        runBackup([CACHE_PATH]);

        const updatedAt = new Date().toISOString();
        const cacheData = { updatedAt, ranking: data };
        // Compact JSON (no pretty-print): the cache holds ~76k players, and pretty
        // printing roughly doubles the file size, slowing both the write above and
        // every cold read/parse below.
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheData), 'utf8');

        // Share the in-memory cache by reference: the object just written IS the
        // latest ranking data, so serve it directly. Stat the file for the exact
        // mtime so the fast path in getLocalRankingCache() matches.
        //
        // ⚠️ The cleaned-name index (WeakMap) is keyed on this object reference.
        // Callers must pass a FRESH object and never mutate it in place after
        // saving, or lookups would silently serve a stale index.
        cachedRankingData = data;
        cacheUpdatedAt = updatedAt;
        cacheLastModified = fs.statSync(CACHE_PATH).mtimeMs;
    } catch (err) { console.error('❌ Error saving cache:', err.message); }
}

/**
 * The `updatedAt` timestamp of the in-memory ranking cache (ISO string, from
 * the last save or file load), or null when no cache is loaded. Lets stats
 * commands report cache freshness without re-reading the ~76k-player file.
 */
export function getRankingCacheUpdatedAt() {
    return cacheUpdatedAt;
}

export function getLocalRankingCache() {
    try {
        // statSync throws ENOENT when the file is missing — no separate existsSync
        // syscall needed. Only re-read when the file changed since last read.
        const stat = fs.statSync(CACHE_PATH);
        if (cachedRankingData && stat.mtimeMs === cacheLastModified) {
            return cachedRankingData;
        }
        const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        const data = parsed.ranking;
        if (!data || typeof data !== 'object') {
            cachedRankingData = null;
            cacheUpdatedAt = null;
            return null;
        }
        // Detect old flat format { nickname: clanName } — discard, re-fetch
        const firstVal = Object.values(data)[0];
        if (typeof firstVal === 'string') {
            console.log('⚠️ [Ranking Cache] Old flat format detected. Re-fetching with multi-world format...');
            cachedRankingData = null;
            cacheUpdatedAt = null;
            return null;
        }
        // Update cache
        cachedRankingData = data;
        cacheUpdatedAt = parsed.updatedAt || null;
        cacheLastModified = stat.mtimeMs;
        return data;
    } catch (err) {
        // Missing file is a normal cold-start condition — stay silent
        if (err.code !== 'ENOENT') console.error('❌ Error reading cache:', err.message);
    }
    cachedRankingData = null;
    cacheUpdatedAt = null;
    return null;
}

// Find which world a nickname belongs to across all worlds
// Returns { worldId: "611", clanName: "GearsofWar シ" } or null
// If cache is provided (pre-loaded from getLocalRankingCache()), uses it instead of reading from disk
export function findNicknameInCache(nickname, cache) {
    if (!cache) {
        cache = getLocalRankingCache();
    }
    if (!cache) return null;

    // First hit in cache order (same behavior as before) — same-world variants
    // that clean to the same name are ambiguous here, so role decisions must use
    // findAllNicknameMatchesInCache + the allied-clan preference instead.
    const matches = findAllNicknameMatchesInCache(nickname, cache);
    return matches.length > 0 ? matches[0] : null;
}

// ── Cleaned-name index (performance) ──
// The ranking cache can hold ~76k players across all worlds. Exact lookups scan
// every entry, which is wasteful when the sync engine looks up hundreds of
// registered users against the SAME cache object. This WeakMap memoizes an
// index per cache object (built lazily, once), turning every subsequent
// exact lookup into an O(1) map hit AND letting fuzzy searches skip the vast
// majority of entries (they used to re-clean + Levenshtein every single name
// on every call). A fresh cache object (new scrape / new parse of the file)
// gets its own fresh index automatically.
//
// Index shape:
//   { exact: Map<cleaned, [{worldId, nickname, clanName}]>,  // O(1) exact hits
//     entries: [{worldId, nickname, clanName, cleaned}],      // fuzzy scan pool
//     bigram: Map<bigram, [entry, ...]> }                     // fuzzy prefilter }
const cleanedNameIndex = new WeakMap();

// Bigrams of a cleaned string (single char when length is 1).
function getBigrams(s) {
    const grams = new Set();
    if (s.length < 2) {
        if (s) grams.add(s);
        return grams;
    }
    for (let i = 0; i < s.length - 1; i++) grams.add(s.slice(i, i + 2));
    return grams;
}

function getCleanedNameIndex(cache) {
    let index = cleanedNameIndex.get(cache);
    if (!index) {
        const exact = new Map();
        const entries = [];
        const bigram = new Map();
        for (const [worldId, players] of Object.entries(cache)) {
            for (const [nickname, clanName] of Object.entries(players)) {
                const cleaned = cleanNickname(nickname);
                if (!cleaned) continue; // skip degenerate keys (e.g. all-decoration names)
                // Plain object for exact hits (callers assert on these fields)
                let list = exact.get(cleaned);
                if (!list) {
                    list = [];
                    exact.set(cleaned, list);
                }
                list.push({ worldId, nickname, clanName });
                // Enriched entry for fuzzy searches
                const entry = { worldId, nickname, clanName, cleaned };
                entries.push(entry);
                for (const g of getBigrams(cleaned)) {
                    let bl = bigram.get(g);
                    if (!bl) {
                        bl = [];
                        bigram.set(g, bl);
                    }
                    bl.push(entry);
                }
            }
        }
        index = { exact, entries, bigram };
        cleanedNameIndex.set(cache, index);
    }
    return index;
}

// Candidate pool for fuzzy searches: entries sharing at least MIN_SHARED
// bigrams with the cleaned input. True near-matches share most bigrams, while
// a single common bigram (e.g. "ar") can appear in tens of thousands of
// unrelated entries — counting shared bigrams prunes those without losing
// genuine matches. Falls back to the full pool when the prefilter prunes
// everything, so the result set is never smaller than the previous full-scan
// behavior. Very short queries (few bigrams) fall back to a 1-bigram match so
// short similar names are not missed.
function gatherFuzzyCandidates(index, cleanedInput) {
    const grams = getBigrams(cleanedInput);
    const minShared = grams.size < 3 ? 1 : 2;

    const counts = new Map();
    for (const g of grams) {
        const list = index.bigram.get(g);
        if (!list) continue;
        for (const e of list) {
            counts.set(e, (counts.get(e) || 0) + 1);
        }
    }

    const candidates = [];
    for (const [e, c] of counts) {
        if (c >= minShared) candidates.push(e);
    }
    if (candidates.length === 0) return index.entries;
    return candidates;
}

// Character-overlap prefilter + Levenshtein similarity (same scoring as before).
// Returns null when the entry is too dissimilar to bother scoring.
function scoreFuzzyCandidate(cleanedInput, inputChars, entry) {
    const cleanedNick = entry.cleaned;
    if (cleanedNick.length < 2) return null;

    const nickChars = new Set(cleanedNick);
    let commonChars = 0;
    for (const c of inputChars) {
        if (nickChars.has(c)) commonChars++;
    }
    const overlapScore = (2 * commonChars) / (inputChars.size + nickChars.size);
    if (overlapScore < 0.3) return null; // too few common characters

    const distance = levenshteinDistance(cleanedInput, cleanedNick);
    const maxLen = Math.max(cleanedInput.length, cleanedNick.length);
    return 1 - (distance / maxLen);
}

// Collect all entries in a pool that score >= threshold (Levenshtein path).
function scorePool(cleanedInput, inputChars, pool, threshold) {
    const matches = [];
    for (const entry of pool) {
        const similarity = scoreFuzzyCandidate(cleanedInput, inputChars, entry);
        if (similarity !== null && similarity >= threshold) {
            matches.push({ worldId: entry.worldId, nickname: entry.nickname, clanName: entry.clanName, score: similarity });
        }
    }
    return matches;
}

// Find ALL ranking entries whose name matches (cleaned) the given nickname,
// across every world AND every variant within a world. MIR4 names are unique
// per server but the same name can exist on several worlds, and the forum can
// hold variants that clean to the same key — e.g. "Dinizメ" and "Diniz メ"
// (whitespace is stripped), where one is in an allied clan and the other is a
// DIFFERENT player (even in the same world). Returning every hit lets callers
// prefer the allied one instead of blindly taking the first.
// Returns an array of { worldId, nickname, clanName }, in cache order.
export function findAllNicknameMatchesInCache(nickname, cache) {
    if (!cache) {
        cache = getLocalRankingCache();
    }
    if (!cache) return [];

    const cleaned = cleanNickname(nickname);
    return getCleanedNameIndex(cache).exact.get(cleaned) || [];
}

// ── Fuzzy nickname matching ──
// Strips common formatting characters and finds the closest match in the ranking cache
// Uses Levenshtein distance normalized by string length (threshold: >= 0.6 similarity)

// Clean helper: strips formatting characters for comparison
function cleanNickname(s) {
    return s.trim().normalize('NFKC').toLowerCase()
        // Strip visible decorative/formatting characters (punctuation, symbols used as decoration)
        .replace(/[|\[\](){}#\-–—:;"'`~!@$%^&*_+=<>?/\\,•·●○.,«»‹›★☆♡♥▪▫・҉§¶†‡※◆◇■□▲△▼▽♠♣♥♦✧✦🎵]/g, '')
        // Strip circled/enclosed alphanumerics (Ⓤ Ⓐ Ⓡ etc. — common in MIR4 names)
        .replace(/[\u2460-\u24FF]/g, '')
        // Strip geometric shapes (⬛ ◄ ► ▶ etc.)
        .replace(/[\u25A0-\u25FF]/g, '')
        // Strip miscellaneous symbols (★ ☆ ♠ ♣ ♡ ♥ ♦ etc.)
        .replace(/[\u2600-\u26FF]/g, '')
        // Strip dingbats (✂ ✈ ✉ etc.)
        .replace(/[\u2700-\u27BF]/g, '')
        // Strip misc symbols and arrows (⬛ ◀ ▶ etc.)
        .replace(/[\u2B00-\u2BFF]/g, '')
        // Strip enclosing marks (combining circles around characters)
        .replace(/[\u20DD-\u20E3]/g, '')
        // Strip variation selectors (emoji/text style toggles)
        .replace(/[\uFE00-\uFE0F]/g, '')
        // Strip all invisible Unicode format chars (zero-width spaces, BOM, joiners, soft hyphen, etc.)
        .replace(/\p{Cf}+/gu, '')
        // Strip all whitespace
        .replace(/\s+/g, '');
}

export { cleanNickname };

export function findClosestNicknameInCache(displayName, cache) {
    if (!cache) return null;

    const cleanedInput = cleanNickname(displayName);
    if (cleanedInput.length < 2) return null;

    const index = getCleanedNameIndex(cache);
    const inputChars = new Set(cleanedInput);
    const candidates = gatherFuzzyCandidates(index, cleanedInput);
    const threshold = 0.55;

    // Fast path: score only bigram-related candidates. If nothing passes the
    // threshold, fall back to the full pool so genuinely similar names that
    // happen to share few bigrams are never missed (old full-scan recall).
    const pool = candidates;
    let bestMatch = null;
    let bestScore = 0;

    for (const entry of pool) {
        const similarity = scoreFuzzyCandidate(cleanedInput, inputChars, entry);
        if (similarity !== null && similarity > bestScore) {
            bestScore = similarity;
            bestMatch = { worldId: entry.worldId, nickname: entry.nickname, clanName: entry.clanName, score: similarity };
        }
    }

    if ((!bestMatch || bestScore < threshold) && candidates !== index.entries) {
        for (const entry of index.entries) {
            const similarity = scoreFuzzyCandidate(cleanedInput, inputChars, entry);
            if (similarity !== null && similarity > bestScore) {
                bestScore = similarity;
                bestMatch = { worldId: entry.worldId, nickname: entry.nickname, clanName: entry.clanName, score: similarity };
            }
        }
    }

    // Also try matching with just the first/last parts (in case of combined names)
    if (!bestMatch || bestScore < threshold) {
        const parts = cleanedInput.split(/[\s_]+/).filter(p => p.length > 2);
        // Parts-pass pool: the candidates already contain every entry that holds
        // a part substring (a part ≥3 chars shares ≥2 bigrams with the query),
        // so scoring candidates here is complete; full pool only as a safety net.
        const partsPool = candidates !== index.entries && bestScore >= threshold ? candidates : index.entries;
        for (const part of parts) {
            for (const entry of partsPool) {
                const cleanedNick = entry.cleaned;
                if (cleanedNick.length < 2) continue;
                if (cleanedNick.includes(part) && cleanedNick.length > part.length) {
                    const score = part.length / cleanedNick.length;
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = { worldId: entry.worldId, nickname: entry.nickname, clanName: entry.clanName, score };
                    }
                }
            }
        }
    }

    return bestMatch && bestScore >= threshold ? bestMatch : null;
}

// ── Top N fuzzy matches ──
// Returns up to `limit` closest matches above threshold, sorted by score (best first).
export function findTopNicknamesInCache(displayName, cache, limit = 3) {
    if (!cache) return [];

    const cleanedInput = cleanNickname(displayName);
    if (cleanedInput.length < 2) return [];

    const index = getCleanedNameIndex(cache);
    const inputChars = new Set(cleanedInput);
    const candidates = gatherFuzzyCandidates(index, cleanedInput);
    const threshold = 0.55;

    // Fast path: score only bigram-related candidates; fall back to the full
    // pool when nothing passes so unusual names are never missed (old recall).
    let matches = scorePool(cleanedInput, inputChars, candidates, threshold);
    if (matches.length === 0 && candidates !== index.entries) {
        matches = scorePool(cleanedInput, inputChars, index.entries, threshold);
    }

    // Also try matching with just the first/last parts
    const parts = cleanedInput.split(/[\s_]+/).filter(p => p.length > 2);
    const partsPool = candidates !== index.entries && matches.length > 0 ? candidates : index.entries;
    for (const part of parts) {
        for (const entry of partsPool) {
            const cleanedNick = entry.cleaned;
            if (cleanedNick.length < 2) continue;
            if (cleanedNick.includes(part) && cleanedNick.length > part.length) {
                const score = part.length / cleanedNick.length;
                if (score >= threshold) {
                    // Avoid duplicates
                    if (!matches.some(m => m.nickname === entry.nickname && m.worldId === entry.worldId)) {
                        matches.push({ worldId: entry.worldId, nickname: entry.nickname, clanName: entry.clanName, score });
                    }
                }
            }
        }
    }

    // Sort by score descending and return top N
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
}

// ── Get unique clan names from a specific world in the ranking cache ──
export function getClanNamesInWorld(worldId, cache) {
    if (!cache) return [];
    const worldData = cache[worldId];
    if (!worldData) return [];

    const clanSet = new Set();
    for (const clanName of Object.values(worldData)) {
        clanSet.add(clanName);
    }
    return Array.from(clanSet);
}

// ── Find top N fuzzy clan name matches for a given world ──
// Returns up to `limit` clan names from `worldId` that are closest matches to `typedClan`,
// using the same Levenshtein distance scoring as nickname matching.
export function findTopClanSuggestions(typedClan, worldId, cache, limit = 3) {
    const clanNames = getClanNamesInWorld(worldId, cache);
    if (clanNames.length === 0) return [];

    const clean = cleanNickname;
    const cleanedInput = clean(typedClan);
    if (cleanedInput.length < 2) return [];

    const threshold = 0.55;
    const matches = [];

    for (const clanName of clanNames) {
        const cleanedClan = clean(clanName);
        if (cleanedClan.length < 2) continue;

        // Pre-filter: check if they share any common characters
        const inputChars = new Set(cleanedInput);
        const clanChars = new Set(cleanedClan);
        let commonChars = 0;
        for (const c of inputChars) {
            if (clanChars.has(c)) commonChars++;
        }
        const overlapScore = (2 * commonChars) / (inputChars.size + clanChars.size);
        if (overlapScore < 0.3) continue;

        const distance = levenshteinDistance(cleanedInput, cleanedClan);
        const maxLen = Math.max(cleanedInput.length, cleanedClan.length);
        const similarity = 1 - (distance / maxLen);

        if (similarity >= threshold) {
            matches.push({ clanName, score: similarity });
        }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
}

export function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b[i - 1] === a[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}
