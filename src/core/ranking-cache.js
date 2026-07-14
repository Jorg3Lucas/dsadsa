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
            return JSON.parse(fs.readFileSync('./ranking_cache.json', 'utf8')).ranking || null;
        }
    } catch (err) { console.error('❌ Error reading cache:', err.message); }
    return null;
}

// ==========================================
// 🔍 FUZZY NICKNAME MATCHING
// ==========================================

/** Normalizes a nickname: lowercases, trims, normalizes unicode, removes non-alphanumeric chars */
export function cleanNickname(s) {
    return s.trim().normalize('NFC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Standard Levenshtein edit distance between two strings */
export function levenshteinDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

/** Checks if a nickname exists *exactly* (after cleaning) in the cache. Returns the key or null. */
export function findNicknameInCache(nickname, cache) {
    const cleaned = cleanNickname(nickname);
    const key = Object.keys(cache).find(k => cleanNickname(k) === cleaned);
    return key || null;
}

/** Finds the closest matching nickname in cache using Levenshtein distance (threshold 0.4). Returns { nickname, worldId, clanName } or null. */
export function findClosestNicknameInCache(displayName, cache) {
    const cleanedInput = cleanNickname(displayName);
    let bestMatch = null;
    let bestScore = 0;

    for (const [nick, clan] of Object.entries(cache)) {
        const cleanedNick = cleanNickname(nick);
        const maxLen = Math.max(cleanedInput.length, cleanedNick.length);
        if (maxLen === 0) continue;
        const distance = levenshteinDistance(cleanedInput, cleanedNick);
        const similarity = 1 - distance / maxLen;
        if (similarity > 0.4 && similarity > bestScore) {
            bestScore = similarity;
            bestMatch = { nickname: nick, clanName: clan };
        }
    }

    return bestMatch;
}
