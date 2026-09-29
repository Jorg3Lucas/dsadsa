// ==========================================
// 💾 RANKING STORAGE
// ==========================================

import fs from 'node:fs';
import { runBackup } from '../auto-backup.js';
import { pendingRegistrations, pendingPilotApprovals, WORLD_IDS } from './ranking-constants.js';

const DB_RANKING_PATH = './database_ranking.json';
const DB_RANKING_TMP_PATH = `${DB_RANKING_PATH}.tmp`;

export function saveRankingStorage(rankingDb) {
    try {
        try { runBackup(['./database_ranking.json']); } catch (e) {
            console.error('\u26a0\ufe0f [Save] Backup failed (non-fatal):', e.message);
        }

        const dbToSave = { ...rankingDb };
        dbToSave._pendingRegistrations = JSON.parse(JSON.stringify(pendingRegistrations));
        dbToSave._pendingPilotApprovals = JSON.parse(JSON.stringify(pendingPilotApprovals));
        const json = JSON.stringify(dbToSave, null, 2);

        // Atomic write: serialise to a temp file NEXT TO the database and swap it
        // in with rename, so a crash (or a kill) mid-write can never leave a
        // truncated database_ranking.json — either the previous or the new file
        // is always complete on disk.
        try {
            fs.writeFileSync(DB_RANKING_TMP_PATH, json, 'utf8');
            fs.renameSync(DB_RANKING_TMP_PATH, DB_RANKING_PATH);
        } catch (swapErr) {
            // Some Windows setups refuse the swap while the destination is held
            // open (editor/antivirus). Fall back to a direct write so the save
            // still happens, then drop the leftover temp file.
            console.error('⚠️ [Save] Atomic write failed — falling back to direct write:', swapErr.message);
            fs.writeFileSync(DB_RANKING_PATH, json, 'utf8');
            try { fs.unlinkSync(DB_RANKING_TMP_PATH); } catch (e) { /* nothing left to clean up */ }
        }

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

            // Migration: pre-registrations no longer expire by time (7-day expiry
            // removed). Strip stale expiresAt fields from the current database —
            // validity is now enforced only by the EU11 ranking sync, which removes
            // pre-regs not found in the ranking immediately.
            let prunedPreRegs = 0;
            if (rankingDb.preRegistrations) {
                for (const preReg of Object.values(rankingDb.preRegistrations)) {
                    if (preReg.expiresAt) {
                        delete preReg.expiresAt;
                        prunedPreRegs++;
                    }
                }
                if (prunedPreRegs > 0) {
                    saveRankingStorage(rankingDb);
                    console.log(`\ud83e\uddf9 Pruned expiresAt from ${prunedPreRegs} pre-registration(s) — time-based expiry removed`);
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
