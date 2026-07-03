import o from "fs";
import s from "path";
// ==========================================
// 🏗️ MODULE-LEVEL STATE
// ==========================================

export const punishmentsPath = s.resolve("./punishments.json");
export const dailyLogsPath = s.resolve("./daily-logs.json");
export const defaultFloors = ["7", "8", "9", "10"];

export let punishments = {};
export let dailyLogs = { configChannelId: null, queue: [], bossSpawnChannelId: null, scheduledEventChannelId: null };
export let alertCache = { warning5mAfter: {}, spawnAlerted: {} };
export let antiDemonSelectionCache = {};
export let summonSelectionCache = {};
export let bossSpawnAlertCache = {};


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
        o.writeFileSync(punishmentsPath, JSON.stringify(punishments, null, 2));
    } catch (e) {}
}

// ==========================================
// 🏗️ MODULE-LEVEL STATE (loaded at import time)
// ==========================================

loadDailyLogsFromDisk();
