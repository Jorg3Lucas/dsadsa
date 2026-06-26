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
            return JSON.parse(fs.readFileSync('./ranking_cache.json', 'utf8')).ranking || null;
        }
    } catch (err) { console.error('❌ Error reading cache:', err.message); }
    return null;
}
