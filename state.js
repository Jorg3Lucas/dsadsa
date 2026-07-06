import o from "fs";
import s from "path";
import { runBackup } from "./auto-backup.js";

// ==========================================
// 🏗️ MODULE-LEVEL STATE
// ==========================================

export const punishmentsPath = s.resolve("./punishments.json");
export const dailyLogsPath = s.resolve("./daily-logs.json");
export const dmOptOutPath = s.resolve("./dm-optout.json");
export const defaultFloors = ["7", "8", "9", "10"];

export let punishments = {};
export let dailyLogs = { configChannelId: null, queue: [], bossSpawnChannelId: null, scheduledEventChannelId: null };
export let alertCache = { warning5mAfter: {}, spawnAlerted: {} };
export let antiDemonSelectionCache = {};
export let summonSelectionCache = {};
export let bossSpawnAlertCache = {};

// ── DM Opt-Out (Set of user IDs that opted out of DMs) ──
export let dmOptOut = new Set();

export let client, db, rankingDb, saveLocalStorage, logEvent, lastMessages;

export function initState(opts) {
    client = opts.client;
    db = opts.db;
    rankingDb = opts.rankingDb || null;
    saveLocalStorage = opts.saveLocalStorage;
    logEvent = opts.logEvent;
    lastMessages = opts.lastMessages;
}

export function loadDailyLogsFromDisk() {
    try {
        if (o.existsSync(dailyLogsPath)) {
            dailyLogs = JSON.parse(o.readFileSync(dailyLogsPath, "utf8"));
        }
    } catch (l) {
        console.error("❌ Error loading daily-logs.json file:", l.message);
    }
}

export function loadPunishmentsFromDisk() {
    if (o.existsSync(punishmentsPath)) {
        try {
            punishments = JSON.parse(o.readFileSync(punishmentsPath, "utf8"));
        } catch (s) {}
    }
}

export function savePunishmentsToDisk() {
    try {
        // Backup before overwriting
        runBackup(["./punishments.json"]);

        o.writeFileSync(punishmentsPath, JSON.stringify(punishments, null, 2));
    } catch (e) {}
}

// ── DM Opt-Out Persistence ────────────────────────────────

export function loadDmOptOutFromDisk() {
    try {
        if (o.existsSync(dmOptOutPath)) {
            const data = JSON.parse(o.readFileSync(dmOptOutPath, "utf8"));
            if (Array.isArray(data)) {
                dmOptOut = new Set(data);
            }
        }
    } catch (err) {
        console.error("❌ Error loading dm-optout.json:", err.message);
    }
}

export function saveDmOptOutToDisk() {
    try {
        o.writeFileSync(dmOptOutPath, JSON.stringify([...dmOptOut], null, 2));
    } catch (err) {
        console.error("❌ Error saving dm-optout.json:", err.message);
    }
}

// ==========================================
// 🏗️ MODULE-LEVEL STATE (loaded at import time)
// ==========================================

loadDailyLogsFromDisk();
loadDmOptOutFromDisk();
