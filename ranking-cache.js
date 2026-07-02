import fs from 'fs';
import path from 'path';
import { runBackup } from './auto-backup.js';

// ==========================================
// 💾 RANKING CACHE (Local JSON)
// ==========================================

const GLOBAL_CACHE_PATH = path.resolve('./ranking_cache.json');

/**
 * Get the cache file path for a specific server.
 * Falls back to global cache if no serverId is provided.
 */
function getCachePath(serverId) {
    if (!serverId) return GLOBAL_CACHE_PATH;
    const safe = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.resolve(`./ranking_cache_${safe}.json`);
}

/**
 * Save ranking cache. If serverId is provided, saves per-server cache.
 * Otherwise saves to the global cache file.
 */
export function saveRankingCache(data, serverId) {
    try {
        const cachePath = getCachePath(serverId);

        // Backup before overwriting
        runBackup([cachePath]);

        const cacheData = { updatedAt: new Date().toISOString(), ranking: data };
        fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf8');
    } catch (err) { console.error('❌ Error saving cache:', err.message); }
}

/**
 * Get ranking cache. If serverId is provided, reads per-server cache.
 * Otherwise reads global cache.
 */
export function getLocalRankingCache(serverId) {
    try {
        const cachePath = getCachePath(serverId);
        if (fs.existsSync(cachePath)) {
            return JSON.parse(fs.readFileSync(cachePath, 'utf8')).ranking || null;
        }
    } catch (err) { console.error('❌ Error reading cache:', err.message); }
    return null;
}
