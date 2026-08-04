// ==========================================
// 💾 RANKING STORAGE — Enterprise Edition
// ==========================================
// Features:
// - Atomic writes (write to temp, then rename)
// - Corruption detection and auto-recovery
// - Write locks to prevent race conditions
// - Backup before every save
// - Integrity verification on load
// - Detailed logging for debugging
// ==========================================

import fs from 'node:fs';
import path from 'node:path';
import { runBackup } from '../auto-backup.js';
import { pendingRegistrations, pendingPilotApprovals } from './ranking-constants.js';

const DB_RANKING_PATH = './database_ranking.json';
const DB_TEMP_PATH = './database_ranking.tmp';
const PENDING_PATH = './pending_registrations.json';
const BACKUP_DIR = './backups';

// ==========================================
// 🔒 WRITE LOCK
// ==========================================
let writeLock = false;
let writeQueue = [];

/**
 * Acquire write lock. Returns a promise that resolves when lock is acquired.
 */
function acquireLock() {
    return new Promise((resolve) => {
        const tryAcquire = () => {
            if (!writeLock) {
                writeLock = true;
                resolve();
            } else {
                setTimeout(tryAcquire, 10);
            }
        };
        tryAcquire();
    });
}

/**
 * Release write lock and process queue.
 */
function releaseLock() {
    writeLock = false;
    if (writeQueue.length > 0) {
        const next = writeQueue.shift();
        next();
    }
}// ==========================================
// 💾 PENDING REGISTRATIONS BACKUP
// ==========================================

/**
 * Save pending registrations to separate file (backup).
 */
function savePendingBackup() {
    try {
        const pendingData = {
            pendingRegistrations: JSON.parse(JSON.stringify(pendingRegistrations)),
            pendingPilotApprovals: JSON.parse(JSON.stringify(pendingPilotApprovals)),
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(PENDING_PATH, JSON.stringify(pendingData, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️ [Storage] Failed to save pending backup:', e.message);
    }
}

/**
 * Load pending registrations from backup file.
 */
function loadPendingBackup() {
    try {
        if (fs.existsSync(PENDING_PATH)) {
            const data = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
            if (data.pendingRegistrations) {
                Object.assign(pendingRegistrations, data.pendingRegistrations);
                console.log(`📋 [Storage] Restored ${Object.keys(data.pendingRegistrations).length} pending registrations from backup`);
            }
            if (data.pendingPilotApprovals) {
                Object.assign(pendingPilotApprovals, data.pendingPilotApprovals);
                console.log(`📋 [Storage] Restored ${Object.keys(data.pendingPilotApprovals).length} pending pilot approvals from backup`);
            }
            return true;
        }
    } catch (e) {
        console.error('⚠️ [Storage] Failed to load pending backup:', e.message);
    }
    return false;
}

// ==========================================
// 📊 STATE TRACKING
// ==========================================
let databaseLoaded = false;
let databaseLoadTime = null;
let lastSaveTime = null;
let lastSaveUserCount = 0;
let saveCount = 0;

/**
 * Get storage statistics for monitoring.
 */
export function getStorageStats() {
    return {
        databaseLoaded,
        databaseLoadTime: databaseLoadTime ? new Date(databaseLoadTime).toISOString() : null,
        lastSaveTime: lastSaveTime ? new Date(lastSaveTime).toISOString() : null,
        lastSaveUserCount,
        saveCount,
        writeLockActive: writeLock
    };
}

/**
 * Check if the database was successfully loaded from disk.
 */
export function isDatabaseLoaded() {
    return databaseLoaded;
}

/**
 * Check if we have real user data in memory.
 */
export function hasUsers(db) {
    return db && db.users && Object.keys(db.users).length > 0;
}

// ==========================================
// 💾 SAVE FUNCTION (with atomic write)
// ==========================================

/**
 * Save ranking database to disk with atomic write.
 * Atomic write: write to temp file first, then rename (prevents corruption on crash).
 */
export async function saveRankingStorage(rankingDb) {
    await acquireLock();
    
    try {
        // SAFETY: Don't save if database hasn't been loaded yet and has no users
        if (!databaseLoaded && !hasUsers(rankingDb)) {
            console.error('⚠️ [Storage] BLOCKED: Database not loaded and no users — refusing to save empty data!');
            console.error('💡 [Storage] This prevents accidental data loss. Load the database first.');
            return false;
        }

        // SAFETY: Don't save if we would decrease user count significantly (data loss detection)
        const currentUserCount = Object.keys(rankingDb.users || {}).length;
        if (databaseLoaded && lastSaveUserCount > 0 && currentUserCount < lastSaveUserCount * 0.5) {
            console.error(`⚠️ [Storage] DATA LOSS DETECTED! Users dropped from ${lastSaveUserCount} to ${currentUserCount}`);
            console.error('⚠️ [Storage] Refusing to save. Run /restorebackup to recover.');
            return false;
        }

        // Create backup before save
        try {
            runBackup(['./database_ranking.json']);
        } catch (e) {
            console.error('⚠️ [Storage] Pre-save backup failed (non-fatal):', e.message);
        }

        // Prepare data to save
        const dbToSave = { ...rankingDb };
        dbToSave._metadata = {
            savedAt: new Date().toISOString(),
            userCount: currentUserCount,
            version: '2.0'
        };
        dbToSave._pendingRegistrations = JSON.parse(JSON.stringify(pendingRegistrations));
        dbToSave._pendingPilotApprovals = JSON.parse(JSON.stringify(pendingPilotApprovals));

        const jsonStr = JSON.stringify(dbToSave, null, 2);

        // Verify JSON is valid before writing
        try {
            JSON.parse(jsonStr);
        } catch (e) {
            console.error('❌ [Storage] CRITICAL: Generated invalid JSON!', e.message);
            return false;
        }

        // Atomic write: write to temp file, then rename
        try {
            fs.writeFileSync(DB_TEMP_PATH, jsonStr, 'utf8');
            fs.renameSync(DB_TEMP_PATH, DB_RANKING_PATH);
        } catch (e) {
            // Fallback: direct write if rename fails
            console.error('⚠️ [Storage] Atomic write failed, falling back to direct write:', e.message);
            try {
                fs.writeFileSync(DB_RANKING_PATH, jsonStr, 'utf8');
            } catch (e2) {
                console.error('❌ [Storage] CRITICAL: Direct write also failed!', e2.message);
                return false;
            }
        }

        // Update stats
        lastSaveTime = Date.now();
        lastSaveUserCount = currentUserCount;
        saveCount++;

        // Also save pending to separate backup file
        savePendingBackup();

        const pendCount = Object.keys(dbToSave._pendingRegistrations).length;
        const pilotCount = Object.keys(dbToSave._pendingPilotApprovals).length;
        console.log(`💾 [Storage] Saved: ${currentUserCount} users, ${pendCount} pending, ${pilotCount} pilots (save #${saveCount})`);

        return true;
    } catch (error) {
        console.error('❌ [Storage] Unexpected error during save:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
        return false;
    } finally {
        releaseLock();
    }
}

// Synchronous wrapper for backward compatibility
export function saveRankingStorageSync(rankingDb) {
    // For critical saves (shutdown), use sync version
    if (!databaseLoaded && !hasUsers(rankingDb)) {
        console.error('⚠️ [Storage] BLOCKED: Refusing to save empty data on shutdown!');
        return false;
    }

    try {
        // Create backup
        try { runBackup(['./database_ranking.json']); } catch (e) {}

        const dbToSave = { ...rankingDb };
        dbToSave._metadata = {
            savedAt: new Date().toISOString(),
            userCount: Object.keys(rankingDb.users || {}).length,
            version: '2.0'
        };
        dbToSave._pendingRegistrations = JSON.parse(JSON.stringify(pendingRegistrations));
        dbToSave._pendingPilotApprovals = JSON.parse(JSON.stringify(pendingPilotApprovals));

        fs.writeFileSync(DB_RANKING_PATH, JSON.stringify(dbToSave, null, 2), 'utf8');
        
        // Also save pending to separate backup file
        savePendingBackup();
        
        lastSaveTime = Date.now();
        lastSaveUserCount = Object.keys(rankingDb.users || {}).length;
        saveCount++;
        
        return true;
    } catch (error) {
        console.error('❌ [Storage] Sync save failed:', error);
        return false;
    }
}

// ==========================================
// 📖 LOAD FUNCTION (with integrity check)
// ==========================================

/**
 * Verify database integrity.
 */
function verifyIntegrity(data) {
    const issues = [];
    
    if (!data || typeof data !== 'object') {
        issues.push('Data is not an object');
        return { valid: false, issues };
    }
    
    if (!data.users || typeof data.users !== 'object') {
        issues.push('Missing or invalid users object');
    }
    
    // Check for corrupted user entries
    if (data.users) {
        for (const [id, user] of Object.entries(data.users)) {
            if (!user || typeof user !== 'object') {
                issues.push(`User ${id} is not an object`);
            } else if (!user.nickname && !user.tempUntil) {
                issues.push(`User ${id} has no nickname or tempUntil`);
            }
        }
    }
    
    return { valid: issues.length === 0, issues };
}

/**
 * Find the most recent valid backup.
 */
function findBestBackup() {
    if (!fs.existsSync(BACKUP_DIR)) return null;
    
    const backups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('database_ranking_') && f.endsWith('.json'))
        .sort()
        .reverse();
    
    for (const backup of backups) {
        try {
            const backupPath = path.join(BACKUP_DIR, backup);
            const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
            
            // Skip backups that are also empty
            if (data.users && Object.keys(data.users).length > 0) {
                console.log(`📦 Found valid backup: ${backup} (${Object.keys(data.users).length} users)`);
                return { file: backup, data };
            }
        } catch (e) {
            console.warn(`⚠️ Backup ${backup} is corrupted, skipping...`);
        }
    }
    
    return null;
}

/**
 * Load ranking database from disk with integrity checks and auto-recovery.
 */
export function loadLocalStorageRanking() {
    const rankingDb = { users: {} };
    
    console.log('📂 [Storage] Loading database...');
    console.log(`📂 [Storage] Path: ${path.resolve(DB_RANKING_PATH)}`);

    try {
        // Check if file exists
        if (!fs.existsSync(DB_RANKING_PATH)) {
            console.log('📝 [Storage] No database file found.');
            
            // Try to recover from backup
            const backup = findBestBackup();
            if (backup) {
                console.log(`🔄 [Storage] Recovering from backup: ${backup.file}`);
                Object.assign(rankingDb, backup.data);
                if (!rankingDb.users) rankingDb.users = {};
                
                // Save recovered data
                fs.writeFileSync(DB_RANKING_PATH, JSON.stringify(rankingDb, null, 2), 'utf8');
                console.log(`✅ [Storage] Recovered ${Object.keys(rankingDb.users).length} users from backup`);
                
                databaseLoaded = true;
                databaseLoadTime = Date.now();
                return rankingDb;
            }
            
            console.log('⚠️ [Storage] No backups found. Starting with empty database.');
            console.log('💡 [Storage] Users will need to register again.');
            return rankingDb;
        }

        // Read file
        const data = fs.readFileSync(DB_RANKING_PATH, 'utf8');
        
        // Check for empty file
        if (!data || data.trim().length === 0) {
            console.error('❌ [Storage] Database file is empty!');
            return handleEmptyDatabase(rankingDb);
        }
        
        // Parse JSON
        let parsed;
        try {
            parsed = JSON.parse(data);
        } catch (e) {
            console.error(`❌ [Storage] JSON parse error: ${e.message}`);
            return handleCorruptedDatabase(rankingDb, data);
        }
        
        // Verify integrity
        const integrity = verifyIntegrity(parsed);
        if (!integrity.valid) {
            console.error('❌ [Storage] Integrity check failed:', integrity.issues);
            return handleCorruptedDatabase(rankingDb, data);
        }
        
        // Check if users exist
        if (!parsed.users || Object.keys(parsed.users).length === 0) {
            console.warn('⚠️ [Storage] Database has no users!');
            return handleEmptyDatabase(rankingDb);
        }
        
        // Normal load
        Object.assign(rankingDb, parsed);
        if (!rankingDb.users) rankingDb.users = {};

        // Restore pending data
        if (rankingDb._pendingRegistrations) {
            Object.assign(pendingRegistrations, rankingDb._pendingRegistrations);
            delete rankingDb._pendingRegistrations;
        }
        if (rankingDb._pendingPilotApprovals) {
            Object.assign(pendingPilotApprovals, rankingDb._pendingPilotApprovals);
            delete rankingDb._pendingPilotApprovals;
        }

        databaseLoaded = true;
        databaseLoadTime = Date.now();
        lastSaveUserCount = Object.keys(rankingDb.users).length;
        
        // Also try to restore pending from backup if not in main file
        if (Object.keys(pendingRegistrations).length === 0 && Object.keys(pendingPilotApprovals).length === 0) {
            loadPendingBackup();
        }
        
        console.log('✅ [Storage] Database loaded successfully.');
        console.log(`📊 [Storage] Users: ${Object.keys(rankingDb.users).length}`);
        console.log(`📊 [Storage] Pending: ${Object.keys(pendingRegistrations).length} registrations, ${Object.keys(pendingPilotApprovals).length} pilots`);
        
        return rankingDb;
        
    } catch (error) {
        console.error('❌ [Storage] Critical error during load:', error);
        return rankingDb;
    }
}

/**
 * Handle empty database file.
 */
function handleEmptyDatabase(rankingDb) {
    console.log('🔍 [Storage] Attempting auto-recovery from backup...');
    
    const backup = findBestBackup();
    if (backup) {
        console.log(`🔄 [Storage] Recovering from backup: ${backup.file}`);
        Object.assign(rankingDb, backup.data);
        if (!rankingDb.users) rankingDb.users = {};
        
        // Save recovered data
        fs.writeFileSync(DB_RANKING_PATH, JSON.stringify(rankingDb, null, 2), 'utf8');
        console.log(`✅ [Storage] Recovered ${Object.keys(rankingDb.users).length} users from backup`);
        
        databaseLoaded = true;
        databaseLoadTime = Date.now();
        return rankingDb;
    }
    
    console.error('❌ [Storage] No usable backup found!');
    console.error('💡 [Storage] Run /restorebackup or /scanrebuild to recover data.');
    return rankingDb;
}

/**
 * Handle corrupted database file.
 */
function handleCorruptedDatabase(rankingDb, corruptedData) {
    console.log('🔧 [Storage] Attempting auto-recovery from corruption...');
    
    // Save corrupted file with .corrupted extension
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(`./database_ranking_CORRUPTED_${timestamp}.json`, corruptedData);
        console.log(`💾 [Storage] Saved corrupted file for analysis`);
    } catch (e) {}
    
    const backup = findBestBackup();
    if (backup) {
        console.log(`🔄 [Storage] Recovering from backup: ${backup.file}`);
        Object.assign(rankingDb, backup.data);
        if (!rankingDb.users) rankingDb.users = {};
        
        // Save recovered data
        fs.writeFileSync(DB_RANKING_PATH, JSON.stringify(rankingDb, null, 2), 'utf8');
        console.log(`✅ [Storage] Recovered ${Object.keys(rankingDb.users).length} users from backup`);
        
        databaseLoaded = true;
        databaseLoadTime = Date.now();
        return rankingDb;
    }
    
    console.error('❌ [Storage] No usable backup found!');
    return rankingDb;
}
