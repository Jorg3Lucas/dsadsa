import fs from 'fs';
import { runBackup } from '../auto-backup.js';

// ==========================================
// 💾 RANKING CACHE (Local JSON)
// ==========================================

export function saveRankingCache(data) {
    try {
        // Backup before overwriting
        runBackup(['./ranking_cache.json']);

        const cacheData = { updatedAt: new Date().toISOString(), ranking: data };
        fs.writeFileSync('./ranking_cache.json', JSON.stringify(cacheData, null, 2), 'utf8');
    } catch (err) { console.error('❌ Error saving cache:', err.message); }
}

export function getLocalRankingCache() {
    try {
        if (fs.existsSync('./ranking_cache.json')) {
            const data = JSON.parse(fs.readFileSync('./ranking_cache.json', 'utf8')).ranking;
            if (!data || typeof data !== 'object') return null;
            // Detect old flat format { nickname: clanName } — discard, re-fetch
            const firstVal = Object.values(data)[0];
            if (typeof firstVal === 'string') {
                console.log('⚠️ [Ranking Cache] Old flat format detected. Re-fetching with multi-world format...');
                return null;
            }
            return data;
        }
    } catch (err) { console.error('❌ Error reading cache:', err.message); }
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

    const normalized = nickname.trim().normalize('NFC').toLowerCase();

    for (const [worldId, players] of Object.entries(cache)) {
        const matchKey = Object.keys(players).find(k => k.normalize('NFC').toLowerCase() === normalized);
        if (matchKey) {
            return {
                worldId,
                nickname: matchKey,
                clanName: players[matchKey]
            };
        }
    }
    return null;
}

// ── Fuzzy nickname matching ──
// Strips common formatting characters and finds the closest match in the ranking cache
// Uses Levenshtein distance normalized by string length (threshold: >= 0.6 similarity)

// Clean helper: strips formatting characters for comparison
function cleanNickname(s) {
    return s.trim().normalize('NFC').toLowerCase()
        .replace(/[|\[\](){}#\-–—:;"'`~!@$%^&*_+=<>?/\\,.]/g, '')
        .replace(/\s+/g, '');
}

export { cleanNickname };

export function findClosestNicknameInCache(displayName, cache) {
    if (!cache) return null;

    const clean = cleanNickname;

    const cleanedInput = clean(displayName);
    if (cleanedInput.length < 2) return null;

    let bestMatch = null;
    let bestScore = 0;
    const threshold = 0.55;

    for (const [worldId, players] of Object.entries(cache)) {
        for (const [nickname, clanName] of Object.entries(players)) {
            const cleanedNick = clean(nickname);
            if (cleanedNick.length < 2) continue;

            // Pre-filter: check if they share any common characters
            const inputChars = new Set(cleanedInput);
            const nickChars = new Set(cleanedNick);
            let commonChars = 0;
            for (const c of inputChars) {
                if (nickChars.has(c)) commonChars++;
            }
            const overlapScore = (2 * commonChars) / (inputChars.size + nickChars.size);
            if (overlapScore < 0.3) continue; // Skip if too few common characters

            // Levenshtein distance for similarity
            const distance = levenshteinDistance(cleanedInput, cleanedNick);
            const maxLen = Math.max(cleanedInput.length, cleanedNick.length);
            const similarity = 1 - (distance / maxLen);

            if (similarity > bestScore) {
                bestScore = similarity;
                bestMatch = { worldId, nickname, clanName, score: similarity };
            }
        }
    }

    // Also try matching with just the first/last parts (in case of combined names)
    if (!bestMatch || bestScore < threshold) {
        const parts = cleanedInput.split(/[\s_]+/).filter(p => p.length > 2);
        for (const part of parts) {
            for (const [worldId, players] of Object.entries(cache)) {
                for (const [nickname, clanName] of Object.entries(players)) {
                    const cleanedNick = clean(nickname);
                    if (cleanedNick.length < 2) continue;
                    if (cleanedNick.includes(part) && cleanedNick.length > part.length) {
                        const score = part.length / cleanedNick.length;
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = { worldId, nickname, clanName, score };
                        }
                    }
                }
            }
        }
    }

    return bestMatch && bestScore >= threshold ? bestMatch : null;
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
