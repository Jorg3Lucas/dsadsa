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
// Per-server ranking DBs are backed up individually via runBackup() on each write
const BACKUP_FILES = [
  "./database.json",
  "./database_ranking.json",
  "./salary-poll-db.json",
  "./daily-logs.json",
  "./punishments.json",
  "./ranking_cache.json"
];

// Dynamically discover and back up per-server ranking DB files
function getPerServerBackupFiles() {
  try {
    const files = fs.readdirSync("./")
      .filter(f => /^database_ranking_[a-zA-Z0-9_-]+\.json$/.test(f))
      .map(f => "./" + f);
    return files;
  } catch (err) {
    return [];
  }
}

let backupInterval = null;

// ─── Ensure backup directory exists ─────────

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log("📁 [Auto-Backup] Created backups directory.");
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
    : [...BACKUP_FILES, ...getPerServerBackupFiles()];

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

  if (count > 0) {
    console.log(`✅ [Auto-Backup] Backed up ${count} file(s) to ${BACKUP_DIR}`);
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

    if (toRemove.length > 0) {
      console.log(`🗑️ [Auto-Backup] Rotated ${toRemove.length} old backup(s) for ${baseName}`);
    }
  } catch (err) {
    console.error(`❌ [Auto-Backup] Rotation error for ${baseName}:`, err.message);
  }
}

// ─── Pre-write backup (quick backup before saving) ───

export function backupBeforeWrite(filePath) {
  ensureBackupDir();

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) return;

  try {
    const baseName = safeFileName(filePath);
    const backupName = `${baseName}_prewrite_${Date.now()}.json`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    fs.copyFileSync(resolvedPath, backupPath);
    rotateBackups(baseName);
  } catch (err) {
    console.error(`❌ [Auto-Backup] Pre-write backup failed for ${filePath}:`, err.message);
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
  setTimeout(() => {
    console.log(`⏰ [Auto-Backup] Running initial backup...`);
    runBackup();
  }, 60 * 1000);

  // Schedule recurring backups
  backupInterval = setInterval(() => {
    console.log(`⏰ [Auto-Backup] Running scheduled backup (every ${intervalHours}h)...`);
    runBackup();
  }, intervalMs);

  console.log(`📅 [Auto-Backup] Scheduled: every ${intervalHours} hour(s) — keeping last ${MAX_BACKUPS} backups`);
}

// ─── Stop scheduled backups ──────────────────

export function stopAutoBackup() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
    console.log("🛑 [Auto-Backup] Stopped.");
  }
}

// ─── List available backups ──────────────────

export function listBackups() {
  ensureBackupDir();

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => ({
      name: f,
      size: fs.statSync(path.join(BACKUP_DIR, f)).size,
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
    }))
    .sort((a, b) => b.time - a.time);

  return files;
}
