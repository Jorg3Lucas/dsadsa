// ==========================================
// 🏗️ MULTI-GUILD STATE MANAGER
// Each Discord server (guild) gets its own
// isolated state: db, config, caches, etc.
// ==========================================

import fs from "fs";
import path from "path";
import { runBackup } from "./auto-backup.js";

const DATA_DIR = path.resolve("./data");

// ─── Per-guild state registry ──────────────

const guildStates = {};

// ─── Ensure data directory exists ──────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Path helpers ──────────────────────────

function dbPath(guildId) {
  return path.join(DATA_DIR, `database_${guildId}.json`);
}

function punishmentsPath(guildId) {
  return path.join(DATA_DIR, `punishments_${guildId}.json`);
}

function dailyLogsPath(guildId) {
  return path.join(DATA_DIR, `daily-logs_${guildId}.json`);
}

// ─── Guild state factory ───────────────────

export function initGuildState(guildId, opts = {}) {
  ensureDataDir();

  if (guildStates[guildId]) {
    return guildStates[guildId]; // already initialized
  }

  const defaultFloors = opts.defaultFloors || ["7", "8", "9", "10"];
  const timezone = opts.timezone || "Europe/Berlin";

  // ── Load database ──
  let db = {};
  const lastMessages = {};
  const dbFile = dbPath(guildId);
  try {
    if (fs.existsSync(dbFile)) {
      const raw = fs.readFileSync(dbFile, "utf8");
      const parsed = JSON.parse(raw);
      db = parsed.maps || {};
      if (parsed.panels) {
        for (const panelId in parsed.panels) {
          lastMessages[panelId] = parsed.panels[panelId];
        }
      }
      console.log(`✅ [${guildId}] Claim database loaded.`);
    }
  } catch (e) {
    console.error(`❌ [${guildId}] Error loading claim database:`, e.message);
  }

  // ── Persistence helpers ──
  const saveLocalStorage = () => {
    try {
      runBackup([dbFile]);

      const persistentMessages = {};
      for (const panelId in lastMessages) {
        if (lastMessages[panelId]) {
          persistentMessages[panelId] = {
            channelId: lastMessages[panelId].channelId,
            messageId:
              lastMessages[panelId].id || lastMessages[panelId].messageId,
          };
        }
      }
      fs.writeFileSync(
        dbFile,
        JSON.stringify({ maps: db, panels: persistentMessages }, null, 2),
        "utf8",
      );
    } catch (e) {
      console.error(`❌ [${guildId}] Error saving database:`, e.message);
    }
  };

  const logEvent = (msg) => {
    console.log(`[${guildId}] ${msg}`);
  };

  // ── Assemble state ──
  const state = {
    guildId,
    client: opts.client || null,
    db,
    timezone,
    defaultFloors,
    saveLocalStorage,
    logEvent,
    lastMessages,
    punishments: {},
    dailyLogs: {
      configChannelId: null,
      queue: [],
      bossSpawnChannelId: null,
      scheduledEventChannelId: null,
    },
    alertCache: { warning5mAfter: {}, spawnAlerted: {}, _dailyDispatched: false },
    antiDemonSelectionCache: {},
    summonSelectionCache: {},
    bossSpawnAlertCache: {},

    dbFile,
    punishmentsFile: punishmentsPath(guildId),
    dailyLogsFile: dailyLogsPath(guildId),

    // Inline loaders
    loadPunishmentsFromDisk() {
      if (fs.existsSync(this.punishmentsFile)) {
        try {
          this.punishments = JSON.parse(
            fs.readFileSync(this.punishmentsFile, "utf8"),
          );
        } catch (_) {}
      }
    },
    savePunishmentsToDisk() {
      try {
        runBackup([this.punishmentsFile]);
        fs.writeFileSync(
          this.punishmentsFile,
          JSON.stringify(this.punishments, null, 2),
        );
      } catch (_) {}
    },
    loadDailyLogsFromDisk() {
      try {
        if (fs.existsSync(this.dailyLogsFile)) {
          this.dailyLogs = JSON.parse(
            fs.readFileSync(this.dailyLogsFile, "utf8"),
          );
        }
      } catch (e) {
        console.error(
          `❌ [${guildId}] Error loading daily-logs:`,
          e.message,
        );
      }
    },
    saveDailyLogs() {
      try {
        runBackup([this.dailyLogsFile]);
        fs.writeFileSync(
          this.dailyLogsFile,
          JSON.stringify(this.dailyLogs, null, 2),
        );
      } catch (e) {
        console.error(
          `❌ [${guildId}] Error saving daily-logs:`,
          e.message,
        );
      }
    },
  };

  // Load persisted data
  state.loadPunishmentsFromDisk();
  state.loadDailyLogsFromDisk();

  guildStates[guildId] = state;
  return state;
}

// ─── Accessors ─────────────────────────────

export function getGuildState(guildId) {
  return guildStates[guildId] || null;
}

export function getAllGuildStates() {
  return Object.values(guildStates);
}

export function getClient() {
  const states = Object.values(guildStates);
  return states.length > 0 ? states[0].client : null;
}

export function getDb(guildId) {
  const s = guildStates[guildId];
  return s ? s.db : null;
}

export function getLastMessages(guildId) {
  const s = guildStates[guildId];
  return s ? s.lastMessages : null;
}

export function getDefaultFloors(guildId) {
  const s = guildStates[guildId];
  return s ? s.defaultFloors : ["7", "8", "9", "10"];
}

export function getTimezone(guildId) {
  const s = guildStates[guildId];
  return s ? s.timezone : "Europe/Berlin";
}

export function removeGuildState(guildId) {
  delete guildStates[guildId];
}
