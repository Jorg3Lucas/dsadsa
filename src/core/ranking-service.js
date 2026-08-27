// ==========================================
// 🔍 RANKING LOOKUP SERVICE
// ==========================================
// Centralized service for looking up nicknames in the ranking cache
// with automatic fuzzy matching and allied clan verification.

import { WORLD_IDS, MAX_NICKNAME_SUGGESTIONS, resolveServerName } from './ranking-constants.js';
import {
    findAllNicknameMatchesInCache,
    findTopNicknamesInCache,
    getLocalRankingCache,
    cleanNickname,
    levenshteinDistance
} from './ranking-cache.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

// Decoration tolerance for allied-clan comparison.
const ALLIED_CLAN_SIMILARITY = 0.8; // Levenshtein similarity threshold
const ALLIED_CLAN_MIN_LENGTH = 4;   // too-short names only match exactly
const ALLIED_CLAN_PREFIX = 3;       // shared-prefix guard against different clans

// Fuzzy pool width: wide enough that ONE computed list can feed both
// lookupNickname's fuzzy decision and suggestion dropdowns (lookupTopNicknames'
// poolSize when limit is the default) — so an exact-miss lookup doesn't force
// the caller to scan the ranking a second time.
const FUZZY_POOL = MAX_NICKNAME_SUGGESTIONS * 3;

/**
 * Decoration-tolerant fallback for clan-name comparison.
 *
 * MIR4 clan names are usually a base name + decoration (e.g. "GearsofWar シ",
 * "GearsofWarツ", "GearsofWar战争", "ForWìn") and the forum spelling is
 * authoritative. Special characters, katakana, CJK and accents are unavoidable,
 * so after an exact (cleaned) comparison fails we accept a name that is VERY
 * similar (≥ 80% Levenshtein similarity) AND shares its first characters —
 * enough to treat "GearsofWar シ" and "GearsofWar战争" as the same clan family,
 * but not enough to match genuinely different clans (e.g. "ToxicFamily" vs
 * "HellRaisers" ~0% similarity).
 */
function isSimilarClan(a, b) {
    // Very short names are too ambiguous for fuzzy matching — require exact only.
    if (a.length < ALLIED_CLAN_MIN_LENGTH || b.length < ALLIED_CLAN_MIN_LENGTH) return false;
    // A different clan that merely starts similarly (e.g. "ToxicFamilyX" vs
    // "ToxicFamily") still passes here, but this blocks names that diverge early.
    if (a.slice(0, ALLIED_CLAN_PREFIX) !== b.slice(0, ALLIED_CLAN_PREFIX)) return false;
    const longer = a.length > b.length ? a : b;
    const similarity = 1 - (levenshteinDistance(a, b) / longer.length);
    return similarity >= ALLIED_CLAN_SIMILARITY;
}

// Memoize the cleaned form of each world's allied-clan config. The sync engine
// calls isAlliedClanName for every member (2+ lookups each), and cleanNickname
// runs several regex passes — re-cleaning a ~30-clan config per lookup would run
// thousands of regex passes per sync. The cache is keyed on the array reference
// AND its length: the /manage handlers mutate the arrays in place (push/splice),
// and any push/splice changes the length, so a length mismatch forces a rebuild.
// (Element replacement with no length change doesn't occur anywhere, so this
// invalidation rule is safe for every mutation path in this codebase.)
const cleanedAlliedCache = new WeakMap(); // array -> { length, cleaned: string[] }

function getCleanedAlliedClans(worldAlliedClans) {
    if (!worldAlliedClans) return null;
    const cached = cleanedAlliedCache.get(worldAlliedClans);
    if (cached && cached.length === worldAlliedClans.length) return cached.cleaned;
    const cleaned = worldAlliedClans.map(c => cleanNickname(c));
    cleanedAlliedCache.set(worldAlliedClans, { length: worldAlliedClans.length, cleaned });
    return cleaned;
}

/**
 * Check whether a clan name (as shown in the game-forum ranking) is one of the
 * configured allied clans of a world. Exact match first, then the
 * decoration-tolerant fallback (see isSimilarClan).
 */
export function isAlliedClanName(clanName, worldAlliedClans) {
    if (!worldAlliedClans || !clanName) return false;
    const clanClean = cleanNickname(clanName);
    const cleanedAllied = getCleanedAlliedClans(worldAlliedClans);
    return cleanedAllied.some(configClean => {
        if (configClean === clanClean) return true;
        return isSimilarClan(configClean, clanClean);
    });
}

function checkAlliedClan(cacheHit, db) {
    return isAlliedClanName(cacheHit.clanName, db.config?.alliedClans?.[cacheHit.worldId]);
}

/**
 * Among several candidate matches (same/similar nickname on different worlds),
 * prefer the one inside an allied clan. The same MIR4 character name can exist
 * on multiple servers, so without this preference a member could be resolved to
 * a non-allied clone on another world (e.g. an EU player matched to someone on
 * NA022) and wrongly lose their member role. Falls back to the first candidate
 * (best score / cache order) when no allied hit exists.
 *
 * Returns { match, inAlliedClan } so callers can reuse the allied-clan check
 * that drove the preference instead of running isAlliedClanName a second time
 * in buildResult (a redundant clan scan on every lookup).
 */
function pickPreferredMatch(matches, db) {
    if (!matches || matches.length === 0) return null;
    const allied = matches.find(m => checkAlliedClan(m, db));
    const match = allied || matches[0];
    return { match, inAlliedClan: !!allied };
}

function buildResult(cacheHit, db, extraFields = {}, inAlliedClan) {
    const serverName = resolveServerName(WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`);
    return {
        found: true,
        worldId: cacheHit.worldId,
        nickname: cacheHit.nickname,
        clanName: cacheHit.clanName,
        serverName,
        // inAlliedClan comes precomputed from pickPreferredMatch (same value as
        // checkAlliedClan(cacheHit, db)); the fallback keeps old callers safe.
        inAlliedClan: inAlliedClan !== undefined ? inAlliedClan : checkAlliedClan(cacheHit, db),
        ...extraFields
    };
}

const FORUM_RANK_URL = 'https://forum.mir4global.com/rank?ranktype=1&classtype=&searchname=';
const FORUM_REQUEST_TIMEOUT_MS = 15000;

/**
 * Search the MIR4 forum ranking directly by name.
 * Used as a fallback when the name is not in the local cache
 * (e.g. player is outside the top 1000 scraped per world).
 * Returns an array of { nickname, clanName, worldId } or [].
 */
async function searchRankingForum(nickname) {
    try {
        const url = FORUM_RANK_URL + encodeURIComponent(nickname);
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: FORUM_REQUEST_TIMEOUT_MS
        });
        const $ = cheerio.load(data);
        const results = [];
        const searchLower = nickname.toLowerCase();

        $('table tbody tr').each((_, el) => {
            const cells = $(el).find('td');
            if (cells.length < 4) return;
            const nick = cells.eq(1).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
            if (nick.toLowerCase() !== searchLower) return;

            // Search results have 5 columns: Rank, Character, Server(empty), Clan, Power
            // Normal ranking has 4 columns: Rank, Character, Clan, Power
            // Detect by checking if cell 2 is empty (search) or has content (normal)
            let clan, serverText;
            if (cells.length === 5) {
                // Search result format
                serverText = cells.eq(2).text().replace(/[\n\t\r]/g, '').trim();
                clan = cells.eq(3).text().replace(/[\n\t\r]/g, '').trim();
            } else {
                // Normal format — cell 2 is clan
                clan = cells.eq(2).text().replace(/[\n\t\r]/g, '').trim();
                serverText = '';
            }
            if (!clan || clan === '-' || clan === '—') clan = 'No Clan';

            // Try to find worldId by matching clan against allied clans config
            // Since we don't know the server from search, we search all worlds
            results.push({ nickname: nick, clanName: clan, worldId: null });
        });

        return results;
    } catch (err) {
        console.error(`⚠️ [Ranking] Forum search failed for "${nickname}": ${err.message}`);
        return [];
    }
}

/**
 * Find which worldId a player belongs to by checking the ranking cache
 * for the clan name. Falls back to scanning all worlds if needed.
 */
function findWorldForClan(clanName, cache) {
    if (!cache) return null;
    for (const [worldId, players] of Object.entries(cache)) {
        for (const [, playerClan] of Object.entries(players)) {
            if (playerClan === clanName) return worldId;
        }
    }
    return null;
}

export function lookupNickname(nickname, db, cache) {
    if (!cache) {
        cache = getLocalRankingCache();
    }
    if (!cache) return { found: false };

    // 1. Exact matches — prefer an allied-clan hit when the same name exists on several servers.
    const exactMatches = findAllNicknameMatchesInCache(nickname, cache);
    if (exactMatches.length > 0) {
        const preferred = pickPreferredMatch(exactMatches, db);
        return buildResult(preferred.match, db, { exactMatch: true, fuzzySuggestion: null }, preferred.inAlliedClan);
    }

    // 2. Fuzzy match — among the closest candidates, prefer an allied-clan hit.
    const fuzzyCandidates = findTopNicknamesInCache(nickname, cache, FUZZY_POOL);
    if (fuzzyCandidates.length > 0) {
        const preferred = pickPreferredMatch(fuzzyCandidates, db);
        const chosen = preferred.match;
        if (chosen.nickname.toLowerCase() !== nickname.toLowerCase()) {
            return buildResult(chosen, db, {
                exactMatch: false,
                fuzzySuggestion: chosen.nickname,
                fuzzyCandidates
            }, preferred.inAlliedClan);
        }
    }

    // 3. Forum search fallback — name might be outside the scraped top-N range.
    //    This is async but lookupNickname is called synchronously in some paths,
    //    so we expose a separate async version for callers that can await it.
    return { found: false, fuzzyCandidates };
}

/**
 * Async version of lookupNickname that falls back to a live forum search
 * when the name is not in the local cache. Use this in slash-command handlers
 * (which run async) instead of the sync lookupNickname.
 */
export async function lookupNicknameWithSearch(nickname, db, cache) {
    // Try the local cache first (sync, fast)
    const localResult = lookupNickname(nickname, db, cache);
    if (localResult.found) return localResult;

    // Cache miss — try the forum search
    const forumResults = await searchRankingForum(nickname);
    if (forumResults.length === 0) return { found: false };

    // Use the first match
    const match = forumResults[0];
    // Try to determine worldId from the cache by clan name
    if (!match.worldId && match.clanName) {
        match.worldId = findWorldForClan(match.clanName, cache);
    }

    const serverName = match.worldId
        ? (WORLD_IDS[match.worldId] || `World ${match.worldId}`)
        : 'Unknown';
    const inAlliedClan = match.worldId
        ? isAlliedClanName(match.clanName, db.config?.alliedClans?.[match.worldId])
        : false;

    return {
        found: true,
        nickname: match.nickname,
        clanName: match.clanName,
        serverName,
        worldId: match.worldId,
        inAlliedClan,
        exactMatch: true,
        fuzzySuggestion: null,
        fromForumSearch: true
    };
}

// ── Top N fuzzy matches (for suggestion dropdowns) ──
// Returns up to `limit` candidates, each with full info + score.
// Allied-clan candidates are ranked FIRST (before raw similarity), because
// the alliance's own characters are the most likely match for the typed name —
// e.g. "Dinizメ" (allied) must float above "Diniz メ" (a different player,
// gold-seller clan) even when the latter scores higher by string similarity.
export function lookupTopNicknames(nickname, db, cache, limit = MAX_NICKNAME_SUGGESTIONS, precomputedTopMatches = null) {
    if (!cache) {
        cache = getLocalRankingCache();
    }
    if (!cache) return [];

    // Fetch a wider pool BEFORE ranking by allied status, so an allied candidate
    // that scores slightly lower than non-allied homonyms is not sliced off first.
    // findTopNicknamesInCache computes all candidates before slicing, so a larger
    // pool costs nothing extra (only the slice differs).
    //
    // When the caller already ran the fuzzy scan (lookupNickname returns it as
    // `fuzzyCandidates`, computed at FUZZY_POOL = 3×MAX width), reuse that list
    // instead of re-scanning — the exact-miss path would otherwise scan the
    // ranking twice per call. precomputedTopMatches must come from that source
    // to guarantee the pool is at least poolSize wide.
    const poolSize = Math.max(MAX_NICKNAME_SUGGESTIONS * 3, limit * 3);
    const topMatches = precomputedTopMatches || findTopNicknamesInCache(nickname, cache, poolSize);

    const enriched = topMatches.map(match => {
        const serverName = resolveServerName(WORLD_IDS[match.worldId] || `World ${match.worldId}`);
        const inAlliedClan = isAlliedClanName(match.clanName, db.config?.alliedClans?.[match.worldId]);
        return {
            worldId: match.worldId,
            nickname: match.nickname,
            clanName: match.clanName,
            serverName,
            inAlliedClan,
            score: match.score
        };
    });

    enriched.sort((a, b) => (b.inAlliedClan - a.inAlliedClan) || (b.score - a.score));

    return enriched.slice(0, limit);
}
