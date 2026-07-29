import o from "fs";
import s from "path";
import { runBackup } from "../auto-backup.js";
import { logger } from "./logger.js";

// ==========================================
// 🏗️ MODULE-LEVEL STATE
// ==========================================

const punishmentsPath = s.resolve("./punishments.json");
export const dailyLogsPath = s.resolve("./daily-logs.json");
const dmOptOutPath = s.resolve("./dm-optout.json");
const earlyClaimUsersPath = s.resolve("./early-claim-users.json");
export const defaultFloors = ["7", "8", "9", "10"];

/**
 * All standard panel keys used by every world's claim database.
 * Single source of truth — imported by claim-db-manager.js, bot.js, and panel-utils.js.
 */
export function getAllPanelKeys() {
    const keys = [];
    defaultFloors.forEach(floor => {
        keys.push(`${floor}peak`);
        keys.push(`${floor}squarenormal`);
        if (floor !== "9" && floor !== "10") {
            keys.push(`${floor}squareantidemon`);
        }
    });
    ["9", "10", "11", "12"].forEach(floor => keys.push(`${floor}squareantidemon`));
    ["11", "12"].forEach(floor => {
        keys.push(`${floor}peak`);
        keys.push(`${floor}squareleaders`);
        keys.push(`${floor}squareevents`);
    });
    keys.push("12randomevent");
    keys.push("11goblin", "12goblin", "11msgoblin", "12msgoblin");
    keys.push("summon");
    return [...new Set(keys)];
}

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

// ==========================================
// 🌍 PER-WORLD CLAIM DATABASES
// ==========================================

/** Holds claim data per world: { EU011: { 7peak: {...}, ... }, EU012: {...} } */
export const worldDbs = {};

/** The currently active world for claim operations. */
export let currentWorld = null;

/**
 * Set the active world. All reads/writes to `db` will route to this world's data.
 * @param {string|null} world - e.g. "EU011" or null to clear
 */
export function setCurrentWorld(world) {
    currentWorld = world;
}

/**
 * Save the current world's claim database to disk.
 * Called automatically by the many handlers that call saveLocalStorage().
 */
function saveCurrentWorldDb() {
    if (!currentWorld || !worldDbs[currentWorld]) return;
    const filePath = s.resolve(`./database_${currentWorld}.json`);
    try {
        runBackup([`./database_${currentWorld}.json`]);

        // Collect persistent message references from lastMessages
        const persistentMessages = {};
        for (const panelKey of Object.keys(worldDbs[currentWorld])) {
            const msgRef = lastMessages?.[panelKey];
            if (msgRef) {
                persistentMessages[panelKey] = {
                    channelId: msgRef.channelId,
                    messageId: msgRef.id || msgRef.messageId
                };
            }
        }

        const toSave = {
            ...worldDbs[currentWorld],
            _panels: persistentMessages,
            _updatedAt: new Date().toISOString()
        };

        o.writeFileSync(filePath, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (err) {
        logger.error('State', `Error saving claim database for ${currentWorld}`, err);
    }
}

// ==========================================
// 🔄 PROXY-BASED DB ROUTER
// ==========================================
// The `db` export is used by ~27 files. Instead of changing all of them,
// we use a Proxy that transparently reads/writes the current world's data.
// When currentWorld is null, the Proxy returns undefined for all reads.
// ==========================================

function createDbProxy() {
    const handler = {
        get(_, prop) {
            if (!currentWorld) return undefined;
            const worldData = worldDbs[currentWorld];
            if (!worldData) return undefined;

            // Handle special cases like _panelMapping
            if (prop === '_panelMapping') {
                // _panelMapping is stored per-world but accessed globally
                if (!worldData._panelMapping) worldData._panelMapping = {};
                return worldData._panelMapping;
            }

            const value = worldData[prop];

            // If the value is an object (and not null), wrap it in a sub-proxy
            // so nested reads/writes also work transparently
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                return new Proxy(value, {
                    get(target, subProp) {
                        return target[subProp];
                    },
                    set(target, subProp, subValue) {
                        target[subProp] = subValue;
                        return true;
                    },
                    deleteProperty(target, subProp) {
                        return delete target[subProp];
                    },
                    ownKeys(target) {
                        return Reflect.ownKeys(target);
                    },
                    getOwnPropertyDescriptor(target, subProp) {
                        return Object.getOwnPropertyDescriptor(target, subProp);
                    }
                });
            }

            return value;
        },

        set(_, prop, value) {
            if (!currentWorld) throw new Error('Cannot write to db: no currentWorld set');
            if (!worldDbs[currentWorld]) worldDbs[currentWorld] = {};
            worldDbs[currentWorld][prop] = value;
            return true;
        },

        deleteProperty(_, prop) {
            if (!currentWorld) return false;
            if (!worldDbs[currentWorld]) return false;
            return delete worldDbs[currentWorld][prop];
        },

        has(_, prop) {
            if (!currentWorld) return false;
            return prop in (worldDbs[currentWorld] || {});
        },

        ownKeys() {
            if (!currentWorld) return [];
            return Object.keys(worldDbs[currentWorld] || {});
        },

        getOwnPropertyDescriptor(_, prop) {
            if (!currentWorld) return undefined;
            const worldData = worldDbs[currentWorld];
            if (!worldData) return undefined;
            if (prop in worldData) {
                return { configurable: true, enumerable: true };
            }
            return undefined;
        }
    };

    return new Proxy({}, handler);
}

// ── The single shared db proxy ──
export const db = createDbProxy();

// ==========================================
// 🏗️ MODULE-LEVEL STATE (loaded at import time)
// ==========================================

export let client, rankingDb, logEvent, lastMessages;

export function initState(opts) {
    client = opts.client;
    rankingDb = opts.rankingDb || null;

    // If db is provided directly (backward compat), store it as world data
    if (opts.db && opts.db !== db) {
        // Used only during initial boot before per-world setup
        // The raw db is stored in a temporary key
        if (!worldDbs._boot) worldDbs._boot = opts.db;
    }

    logEvent = opts.logEvent || (() => {});
    lastMessages = opts.lastMessages || {};
}

/**
 * Save the current world's claim database (called by panel handlers).
 * This replaces the old single-file saveClaimStorage.
 */
export function saveLocalStorage() {
    saveCurrentWorldDb();
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
        logger.error('State', 'Error loading early-claim-users.json', err);
    }
}

export function saveEarlyClaimUsersToDisk() {
    try {
        o.writeFileSync(earlyClaimUsersPath, JSON.stringify([...earlyClaimUsers], null, 2));
    } catch (err) {
        logger.error('State', 'Error saving early-claim-users.json', err);
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
loadEarlyClaimUsersFromDisk();
loadDmOptOutFromDisk();
