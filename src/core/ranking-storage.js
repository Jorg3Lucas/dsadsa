// ==========================================
// 💾 RANKING STORAGE
// ==========================================

import fs from 'node:fs';
import { runBackup } from '../auto-backup.js';
import { pendingRegistrations, pendingPilotApprovals, WORLD_IDS } from './ranking-constants.js';

const DB_RANKING_PATH = './database_ranking.json';

export function saveRankingStorage(rankingDb) {
    try {
        try { runBackup(['./database_ranking.json']); } catch (e) {
            console.error('\u26a0\ufe0f [Save] Backup failed (non-fatal):', e.message);
        }

        const dbToSave = { ...rankingDb };
        dbToSave._pendingRegistrations = JSON.parse(JSON.stringify(pendingRegistrations));
        dbToSave._pendingPilotApprovals = JSON.parse(JSON.stringify(pendingPilotApprovals));
        fs.writeFileSync(DB_RANKING_PATH, JSON.stringify(dbToSave, null, 2), 'utf8');

        const pendCount = Object.keys(dbToSave._pendingRegistrations).length;
        const pilotCount = Object.keys(dbToSave._pendingPilotApprovals).length;
        if (pendCount > 0 || pilotCount > 0) {
            console.log(`\ud83d\udcbe [Save] Saved ${pendCount} pending + ${pilotCount} pilot approvals`);
        }
    } catch (error) {
        console.error('\u274c Error saving ranking database:', error);
        if (error.stack) console.error('\ud83d\udccb [Stack]:', error.stack);
    }
}

export function loadLocalStorageRanking() {
    const rankingDb = { users: {} };

    try {
        if (fs.existsSync(DB_RANKING_PATH)) {
            const data = fs.readFileSync(DB_RANKING_PATH, 'utf8');
            const parsed = JSON.parse(data);
            Object.assign(rankingDb, parsed);
            if (!rankingDb.users) rankingDb.users = {};

            if (rankingDb._pendingRegistrations) {
                Object.assign(pendingRegistrations, rankingDb._pendingRegistrations);
                delete rankingDb._pendingRegistrations;
            }
            if (rankingDb._pendingPilotApprovals) {
                Object.assign(pendingPilotApprovals, rankingDb._pendingPilotApprovals);
                delete rankingDb._pendingPilotApprovals;
            }

            // Migration: prune allied clans configured for worlds outside the sync
            // scope (EU11 only). Leftover entries from the main-branch deployment
            // are dead data — they are never consulted since lookups only return
            // worlds present in WORLD_IDS.
            let prunedWorlds = 0;
            if (rankingDb.config?.alliedClans) {
                for (const worldId of Object.keys(rankingDb.config.alliedClans)) {
                    if (!WORLD_IDS[worldId]) {
                        delete rankingDb.config.alliedClans[worldId];
                        prunedWorlds++;
                    }
                }
                if (prunedWorlds > 0) {
                    saveRankingStorage(rankingDb);
                    console.log(`\ud83e\uddf9 Pruned allied clans for ${prunedWorlds} world(s) outside sync scope (EU11 only)`);
                }
            }

            console.log('\u2705 Ranking database loaded successfully.');
            console.log(`\ud83d\udccb Restored ${Object.keys(pendingRegistrations).length} pending registration(s), ${Object.keys(pendingPilotApprovals).length} pending pilot approval(s)`);
        } else {
            saveRankingStorage(rankingDb);
            console.log('\ud83d\udcdd New database_ranking.json file created.');
        }
    } catch (error) {
        console.error('\u274c Error loading ranking database:', error);
    }

    return rankingDb;
}
