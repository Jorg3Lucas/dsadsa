import o from "fs";
import s from "path";
import { runBackup } from "../auto-backup.js";

// ==========================================
// 🏗️ MODULE-LEVEL STATE
// ==========================================

const punishmentsPath = s.resolve("./punishments.json");
export const dailyLogsPath = s.resolve("./daily-logs.json");
const dmOptOutPath = s.resolve("./dm-optout.json");
const earlyClaimUsersPath = s.resolve("./early-claim-users.json");
export const defaultFloors = ["7", "8", "9", "10"];

export let punishments = {};
export let dailyLogs = { configChannelId: null, queue: [], bossSpawnChannelId: null, scheduledEventChannelId: null };
export const alertCache = { warning5mAfter: {}, spawnAlerted: {} };
export const antiDemonSelectionCache = {};
export const summonSelectionCache = {};
export const bossSpawnAlertCache = {};

// ── Early Claim Users (set of user IDs allowed to claim Fury/Frenzy 5 minutes early) ──
export let earlyClaimUsers = new Set();

// ── DM Opt-Out (Set of user IDs that opted out of DMs) ──
export let dmOptOut = new Set();

/** Check if a user is allowed to claim fixed events (Fury/Frenzy) early (5 min pre-window). @param {string} uid @returns {boolean} */
export function isEarlyClaimUser(uid) {
    return earlyClaimUsers.has(uid);
}

export let client, db, rankingDb, saveLocalStorage, logEvent, lastMessages;

export function initState(opts) {
    client = opts.client;
    db = opts.db;
    rankingDb = opts.rankingDb || null;
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
        console.error("❌ Error loading daily-logs.json file:", l.message);
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
        // Backup before overwriting
        runBackup(["./punishments.json"]);

        o.writeFileSync(punishmentsPath, JSON.stringify(punishments, null, 2));
    } catch (e) {
        // Silently ignored — non-critical operation
    }
}

// ── Early Claim Users Persistence ─────────────────────────

function loadEarlyClaimUsersFromDisk() {
    try {
        if (o.existsSync(earlyClaimUsersPath)) {
            const data = JSON.parse(o.readFileSync(earlyClaimUsersPath, "utf8"));
            if (Array.isArray(data)) {
                earlyClaimUsers = new Set(data);
            }
        }
    } catch (err) {
        console.error("❌ Error loading early-claim-users.json:", err.message);
    }
}

export function saveEarlyClaimUsersToDisk() {
    try {
        o.writeFileSync(earlyClaimUsersPath, JSON.stringify([...earlyClaimUsers], null, 2));
    } catch (err) {
        console.error("❌ Error saving early-claim-users.json:", err.message);
    }
}

export function addEarlyClaimUser(uid) {
    earlyClaimUsers.add(uid);
    saveEarlyClaimUsersToDisk();
}

export function removeEarlyClaimUser(uid) {
    earlyClaimUsers.delete(uid);
    saveEarlyClaimUsersToDisk();
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
loadEarlyClaimUsersFromDisk();
loadDmOptOutFromDisk();
