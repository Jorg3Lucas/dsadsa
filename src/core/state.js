import o from "fs";
import s from "path";
import { logger } from "./logger.js";

// ==========================================
// 🏗️ MODULE-LEVEL STATE
// ==========================================

const punishmentsPath = s.resolve("./punishments.json");
export const dailyLogsPath = s.resolve("./daily-logs.json");
const dmOptOutPath = s.resolve("./dm-optout.json");
export const defaultFloors = ["7", "8", "9", "10"];

export let punishments = {};
export let dailyLogs = { configChannelId: null, queue: [], bossSpawnChannelId: null, scheduledEventChannelId: null };
export const alertCache = { warning5mAfter: {}, spawnAlerted: {} };
export const antiDemonSelectionCache = {};
export const summonSelectionCache = {};
export const bossSpawnAlertCache = {};

// ── DM Opt-Out (Set of user IDs that opted out of DMs) ──
export let dmOptOut = new Set();

export let client, db, saveLocalStorage, logEvent, lastMessages;

export function initState(opts) {
    client = opts.client;
    db = opts.db;
    saveLocalStorage = opts.saveLocalStorage;
    logEvent = opts.logEvent;
    lastMessages = opts.lastMessages;
}

function loadDailyLogsFromDisk() {
    try {
        if (o.existsSync(dailyLogsPath)) {
            dailyLogs = JSON.parse(o.readFileSync(dailyLogsPath, "utf8"));
        }
    } catch (l) {
        logger.error('State', 'Error loading daily-logs.json', l);
    }
}

export function loadPunishmentsFromDisk() {
    if (o.existsSync(punishmentsPath)) {
        try {
            punishments = JSON.parse(o.readFileSync(punishmentsPath, "utf8"));
        } catch (s) {
        // Silently ignored — non-critical operation
    }
    }
}

export function savePunishmentsToDisk() {
    try {
        o.writeFileSync(punishmentsPath, JSON.stringify(punishments, null, 2));
    } catch (e) {
        // Silently ignored — non-critical operation
    }
}

// ── DM Opt-Out Persistence ────────────────────────────────

function loadDmOptOutFromDisk() {
    try {
        if (o.existsSync(dmOptOutPath)) {
            const data = JSON.parse(o.readFileSync(dmOptOutPath, "utf8"));
            if (Array.isArray(data)) {
                dmOptOut = new Set(data);
            }
        }
    } catch (err) {
        logger.error('State', 'Error loading dm-optout.json', err);
    }
}

export function saveDmOptOutToDisk() {
    try {
        o.writeFileSync(dmOptOutPath, JSON.stringify([...dmOptOut], null, 2));
    } catch (err) {
        logger.error('State', 'Error saving dm-optout.json', err);
    }
}

// ==========================================
// 🏗️ MODULE-LEVEL STATE (loaded at import time)
// ==========================================

loadDailyLogsFromDisk();
loadDmOptOutFromDisk();
