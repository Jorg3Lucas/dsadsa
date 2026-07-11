// ==========================================
// 💾 AUTO-BACKUP SYSTEM
// Automatic backups of all JSON database files
// Runs every 6 hours + optionally before writes
// Keeps last 7 backups per file
// ==========================================

import fs from "fs";
import path from "path";

const BACKUP_DIR = path.resolve("./backups");
const MAX_BACKUPS = 7; // keep last 7 backups per file

// All JSON files that should be backed up
const BACKUP_FILES = [
  "./database_ranking.json",
  "./ranking_cache.json"
];

let backupInterval = null;

// ─── Ensure backup directory exists ─────────

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// ─── Sanitize filename ──────────────────────

function safeFileName(filePath) {
  return path.basename(filePath).replace(/\.json$/, "");
}

// ─── Run a single backup cycle ───────────────

export function runBackup(targetFiles) {
  ensureBackupDir();

  const filesToBackup = targetFiles && targetFiles.length > 0
    ? targetFiles
    : BACKUP_FILES;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let count = 0;

  for (const filePath of filesToBackup) {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) continue;

    try {
      const baseName = safeFileName(filePath);
      const backupName = `${baseName}_${timestamp}.json`;
      const backupPath = path.join(BACKUP_DIR, backupName);

      fs.copyFileSync(resolvedPath, backupPath);
      count++;

      // Rotate old backups for this file
      rotateBackups(baseName);
    } catch (err) {
      console.error(`❌ [Auto-Backup] Failed to backup ${filePath}:`, err.message);
    }
  }

  return count;
}

// ─── Rotate old backups (keep only last N) ───

function rotateBackups(baseName) {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith(baseName + "_") && f.endsWith(".json"))
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time); // newest first

    // Remove excess backups
    const toRemove = files.slice(MAX_BACKUPS);
    for (const file of toRemove) {
      fs.unlinkSync(path.join(BACKUP_DIR, file.name));
    }

  } catch (err) {
    console.error(`❌ [Auto-Backup] Rotation error for ${baseName}:`, err.message);
  }
}

// ─── Start scheduled backups ─────────────────

export function startAutoBackup(intervalHours = 6) {
  // Clear any existing interval
  if (backupInterval) {
    clearInterval(backupInterval);
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Run first backup after 1 minute (give bot time to initialize)
  setTimeout(() => runBackup(), 60 * 1000);

  // Schedule recurring backups
  backupInterval = setInterval(() => runBackup(), intervalMs);
}
