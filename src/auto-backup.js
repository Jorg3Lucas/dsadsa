// ==========================================
// 💾 AUTO-BACKUP SYSTEM — Enhanced Edition
// ==========================================
// Features:
// - Backups every 30 minutes (was 6 hours)
// - Pre-save backup (before every database write)
// - Integrity verification on backup
// - Backup rotation with configurable retention
// - Maximum backup count limit
// - Detailed logging
// ==========================================

import fs from 'node:fs';
import path from 'node:path';

const BACKUP_DIR = path.resolve('./backups');
const BACKUP_RETENTION_MS = 72 * 60 * 60 * 1000; // 72 hours (was 48)
const MAX_BACKUPS = 50; // Maximum number of backups to keep

// All JSON files that should be backed up
const BACKUP_FILES = [
    './database_ranking.json'
];

let backupInterval = null;
let backupCount = 0;

// ==========================================
// 🛠️ HELPERS
// ==========================================

/**
 * Ensure backup directory exists.
 */
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        console.log('📁 [Backup] Created backup directory');
    }
}

/**
 * Sanitize filename.
 */
function safeFileName(filePath) {
    return path.basename(filePath).replace(/\.json$/, '');
}

/**
 * Verify JSON file integrity.
 *
 * Two backup schemas are supported:
 *  - Database:  { users: { id: {...} }, config: {...} }
 *  - Cache:     { updatedAt: "...", ranking: { worldId: { player: clan } } }
 * The old check only understood the database schema, so every ranking_cache
 * backup was written and then deleted as "invalid" (no `users` key).
 */
function verifyBackupIntegrity(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);

        // Database backup: valid if it has registered users
        if (parsed.users && Object.keys(parsed.users).length > 0) {
            return { valid: true, userCount: Object.keys(parsed.users).length };
        }

        // Ranking-cache backup: valid if it has at least one world with players
        if (parsed.ranking && typeof parsed.ranking === 'object' && Object.keys(parsed.ranking).length > 0) {
            let playerCount = 0;
            for (const world of Object.values(parsed.ranking)) {
                if (world && typeof world === 'object') {
                    playerCount += Object.keys(world).length;
                }
            }
            if (playerCount > 0) {
                return {
                    valid: true,
                    userCount: playerCount,
                    note: `${playerCount} players / ${Object.keys(parsed.ranking).length} worlds`
                };
            }
        }

        return { valid: false, reason: 'No users/ranking data in backup' };
    } catch (e) {
        return { valid: false, reason: e.message };
    }
}

// ==========================================
// 🔄 BACKUP FUNCTIONS
// ==========================================

/**
 * Run a single backup cycle.
 * @param {string[]} targetFiles - Specific files to backup (optional)
 * @param {string} reason - Reason for backup (for logging)
 * @returns {number} Number of files backed up
 */
export function runBackup(targetFiles, reason = 'scheduled') {
    ensureBackupDir();

    const filesToBackup = targetFiles && targetFiles.length > 0
        ? targetFiles
        : BACKUP_FILES;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let count = 0;

    for (const filePath of filesToBackup) {
        const resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
            console.warn(`⚠️ [Backup] File not found: ${filePath}`);
            continue;
        }

        try {
            // Verify source file before backup
            const sourceData = fs.readFileSync(resolvedPath, 'utf8');
            JSON.parse(sourceData); // Verify valid JSON
            
            const baseName = safeFileName(filePath);
            const backupName = `${baseName}_${timestamp}.json`;
            const backupPath = path.join(BACKUP_DIR, backupName);

            // Write backup
            fs.writeFileSync(backupPath, sourceData, 'utf8');
            
            // Verify backup integrity
            const integrity = verifyBackupIntegrity(backupPath);
            if (integrity.valid) {
                count++;
                backupCount++;
                console.log(`✅ [Backup] ${backupName} (${integrity.note || `${integrity.userCount} users`}) [${reason}]`);
            } else {
                // Remove invalid backup
                fs.unlinkSync(backupPath);
                console.error(`❌ [Backup] ${backupName} failed integrity check: ${integrity.reason}`);
            }

            // Rotate old backups
            rotateBackups(baseName);
        } catch (err) {
            console.error(`❌ [Backup] Failed to backup ${filePath}:`, err.message);
        }
    }

    return count;
}

/**
 * Rotate old backups (remove older than retention period).
 */
function rotateBackups(baseName) {
    try {
        const cutoff = Date.now() - BACKUP_RETENTION_MS;
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith(baseName + '_') && f.endsWith('.json'));

        let removed = 0;
        
        // First: remove by age
        for (const file of files) {
            const filePath = path.join(BACKUP_DIR, file);
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(filePath);
                removed++;
            }
        }

        // Second: remove by count (keep only MAX_BACKUPS)
        const remaining = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith(baseName + '_') && f.endsWith('.json'))
            .sort()
            .reverse();
        
        if (remaining.length > MAX_BACKUPS) {
            const toRemove = remaining.slice(MAX_BACKUPS);
            for (const file of toRemove) {
                fs.unlinkSync(path.join(BACKUP_DIR, file));
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`🗑️ [Backup] Rotated ${removed} old backup(s)`);
        }
    } catch (err) {
        console.error('❌ [Backup] Rotation error:', err.message);
    }
}

/**
 * Start scheduled backups.
 * @param {number} intervalMinutes - Backup interval in minutes (default: 30)
 */
export function startAutoBackup(intervalMinutes = 30) {
    // Clear any existing interval
    if (backupInterval) {
        clearInterval(backupInterval);
    }

    const intervalMs = intervalMinutes * 60 * 1000;

    // Run first backup after 30 seconds (give bot time to load data)
    setTimeout(() => {
        console.log('⏰ [Backup] Running initial backup...');
        runBackup(null, 'startup');
    }, 30 * 1000);

    // Schedule recurring backups
    backupInterval = setInterval(() => {
        runBackup(null, 'scheduled');
    }, intervalMs);

    console.log(`⏰ [Backup] Auto-backup scheduled every ${intervalMinutes} minutes`);
}

/**
 * Stop scheduled backups.
 */
export function stopAutoBackup() {
    if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
        console.log('⏰ [Backup] Auto-backup stopped');
    }
}

/**
 * Get backup statistics.
 */
export function getBackupStats() {
    ensureBackupDir();
    
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('database_ranking_') && f.endsWith('.json'));
    
    let totalSize = 0;
    let latestBackup = null;
    let latestTime = 0;
    
    for (const file of files) {
        const filePath = path.join(BACKUP_DIR, file);
        const stat = fs.statSync(filePath);
        totalSize += stat.size;
        
        if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            latestBackup = file;
        }
    }
    
    return {
        count: files.length,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        latestBackup,
        latestBackupTime: latestTime ? new Date(latestTime).toISOString() : null,
        backupCount // backups made this session
    };
}
