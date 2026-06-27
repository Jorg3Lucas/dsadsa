// ==========================================
// 💾 AUTO-BACKUP SYSTEM
// Automatic backups of all JSON database files
// Runs every 6 hours + optionally before writes
// Keeps last 7 backups per file
// ==========================================

import fs from "fs";
import path from "path";
import { getAllGuildStates } from "./state.js";

const BACKUP_DIR = path.resolve("./backups");
const MAX_BACKUPS = 7;

// Static files to back up
const STATIC_BACKUP_FILES = [
  "./daily-logs.json",
];

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

// ─── Get all backup files (static + per-guild) ───

function getAllBackupFiles() {
  const files = [...STATIC_BACKUP_FILES];

  // Add per-guild data files
  for (const state of getAllGuildStates()) {
    if (state.dbFile) files.push(state.dbFile);
    if (state.dailyLogsFile) files.push(state.dailyLogsFile);
    if (state.punishmentsFile) files.push(state.punishmentsFile);
  }

  return files;
}

// ─── Run a single backup cycle ───────────────

export function runBackup(targetFiles) {
  ensureBackupDir();

  const filesToBackup =
    targetFiles && targetFiles.length > 0 ? targetFiles : getAllBackupFiles();

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

      rotateBackups(baseName);
    } catch (err) {
      console.error(
        `❌ [Auto-Backup] Failed to backup ${filePath}:`,
        err.message,
      );
    }
  }

  if (count > 0) {
    console.log(
      `✅ [Auto-Backup] Backed up ${count} file(s) to ${BACKUP_DIR}`,
    );
  }
  return count;
}

// ─── Rotate old backups ──────────────────────

function rotateBackups(baseName) {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith(baseName + "_") && f.endsWith(".json"))
      .map((f) => ({
        name: f,
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    const toRemove = files.slice(MAX_BACKUPS);
    for (const file of toRemove) {
      fs.unlinkSync(path.join(BACKUP_DIR, file.name));
    }

    if (toRemove.length > 0) {
      console.log(
        `🗑️ [Auto-Backup] Rotated ${toRemove.length} old backup(s) for ${baseName}`,
      );
    }
  } catch (err) {
    console.error(
      `❌ [Auto-Backup] Rotation error for ${baseName}:`,
      err.message,
    );
  }
}

// ─── Start scheduled backups ─────────────────

export function startAutoBackup(intervalHours = 6) {
  if (backupInterval) {
    clearInterval(backupInterval);
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;

  setTimeout(() => {
    console.log(`⏰ [Auto-Backup] Running initial backup...`);
    runBackup();
  }, 60 * 1000);

  backupInterval = setInterval(() => {
    console.log(
      `⏰ [Auto-Backup] Running scheduled backup (every ${intervalHours}h)...`,
    );
    runBackup();
  }, intervalMs);

  console.log(
    `📅 [Auto-Backup] Scheduled: every ${intervalHours} hour(s) — keeping last ${MAX_BACKUPS} backups`,
  );
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

  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      size: fs.statSync(path.join(BACKUP_DIR, f)).size,
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
    }))
    .sort((a, b) => b.time - a.time);

  return files;
}
