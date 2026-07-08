import fs from 'fs';
import { runBackup } from './auto-backup.js';

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
