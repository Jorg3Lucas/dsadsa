import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent } from "./state.js";
import { migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, migrateMS1112, migrateSPLegacyToUnified, processAutoRecoveryOnBoot, refreshVisualPanel } from "./panel-utils.js";
import { startTickInterval } from "./panel-tick.js";
import { STATUS_AVAILABLE } from "./constants.js";
import { getActiveServerIds } from "./server-config.js";
import { refreshChannelServerMap } from "./claim-resolver.js";

// Helper: prefixed key for a server's panel
function sk(serverId, panelKey) {
    return `${serverId}_${panelKey}`;
}

// ==========================================
// 🚀 INITIALIZATION
// ==========================================

export function initClaimSystem(botClient, database, saveStorageFn, logEventFn, messagesTracker, rankingDatabase) {
    initState({ client: botClient, db: database, rankingDb: rankingDatabase || null, saveLocalStorage: saveStorageFn, logEvent: logEventFn, lastMessages: messagesTracker });

    // Initialize panel data for EACH configured in-game server
    const serverIds = getActiveServerIds();
    if (serverIds.length === 0) {
        console.warn("⚠️ [Bot] No in-game servers configured. Panels will use legacy keys.");
        initPanelsForServer(null); // legacy fallback
    } else {
        refreshChannelServerMap();
        for (const serverId of serverIds) {
            console.log(`📋 [Bot] Initializing claim panels for server: ${serverId}`);
            initPanelsForServer(serverId);
        }
    }

    loadPunishmentsFromDisk();

    migrateBossCooldowns();
    migrateNamesCleanEmojis();
    migrateLastKilledAt();
    migrateMS1112();
    migrateSPLegacyToUnified();

    // Force-refresh all panels
    for (let key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        refreshVisualPanel(key);
    }

    processAutoRecoveryOnBoot().then(() => {
        startTickInterval();
        logEvent("Sub-system initialized and panels auto-refreshed inside global Client.");
    });
}

// ==========================================
// 🔧 INIT PANELS FOR A SINGLE SERVER
// ==========================================

function initPanelsForServer(serverId) {
    const p = (k) => serverId ? sk(serverId, k) : k; // prefix helper
    const fmtTitle = (t) => serverId ? `${t} [${serverId.toUpperCase()}]` : t;

    defaultFloors.forEach(floor => {
        // ── Secret Peak ──
        const peakKey = p(`${floor}peak`);
        db[peakKey] || (db[peakKey] = {
            type: "peak",
            title: fmtTitle(`Secret Peak ${floor}F`),
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            left: { name: "⬅️ Left", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            red: { name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            right: { name: "➡️ Right", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
        });

        // ── Magic Square Normal ──
        const normalKey = p(`${floor}squarenormal`);
        db[normalKey] || (db[normalKey] = {
            type: "normal",
            title: fmtTitle(`Magic Square ${floor}F`),
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
        });

        // ── Antidemon ──
        const antiKey = p(`${floor}squareantidemon`);
        db[antiKey] || (db[antiKey] = {
            type: "antidemon",
            title: fmtTitle(`Antidemon ${floor}F`),
            left: { name: "LEFT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" },
            mid: { name: "MID ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" },
            right: { name: "RIGHT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" }
        });

        // Extra antidemon for MS9/MS10: 1-1 and 1-2
        if (floor === "9" || floor === "10") {
            const tpl = () => ({
                left: { name: "LEFT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" },
                mid: { name: "MID ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" },
                right: { name: "RIGHT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" }
            });
            db[p(`${floor}squareantidemon11`)] || (db[p(`${floor}squareantidemon11`)] = { type: "antidemon", title: fmtTitle(`Antidemon ${floor}F 1-1`), ...tpl() });
            db[p(`${floor}squareantidemon12`)] || (db[p(`${floor}squareantidemon12`)] = { type: "antidemon", title: fmtTitle(`Antidemon ${floor}F 1-2`), ...tpl() });
        }
    });

    // ── SP11 / SP12 ──
    ["11", "12"].forEach(floor => {
        const key = p(`${floor}peak`);
        if (!db[key] || !db[key].type) {
            db[key] = {
                type: "peak",
                title: fmtTitle(`Secret Peak ${floor}F`),
                timeWindow: "", next: null, ownerId: null, ownerName: null,
                left: { name: "⬅️ Left", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
                red: { name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "", schedules: [1, 7, 13, 19] },
                right: { name: "➡️ Right", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
            };
        }
    });

    // ── MS11 / MS12 Leaders ──
    ["11squareleaders", "12squareleaders"].forEach(k => {
        const key = p(k);
        if (!db[key]) {
            db[key] = {
                type: "normal",
                title: fmtTitle(k.includes("11") ? "Magic Square 11F - Leaders" : "Magic Square 12F - Leaders"),
                timeWindow: "", next: null, ownerId: null, ownerName: null,
                boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
                boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
                boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" }
            };
        }
    });

    // ── MS11 / MS12 Events ──
    ["11", "12"].forEach(floor => {
        const key = p(`${floor}squareevents`);
        if (!db[key]) {
            db[key] = {
                type: "event_group",
                title: fmtTitle(`Magic Square ${floor}F - Events`),
                fury: { name: "🔴 Fury", type: "fixed", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, timeWindow: "", _claimTimestamp: null, schedules: [0, 3, 6, 9, 12, 15, 18, 21], scheduleMinutes: 30 },
                frenzy: { name: "🟣 Frenzy", type: "fixed", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, timeWindow: "", _claimTimestamp: null, schedules: [2, 5, 8, 11, 14, 17, 20, 23] }
            };
        }
    });

    // ── MS11 / MS12 Antidemon (9 rooms) ──
    ["11", "12"].forEach(floor => {
        const key = p(`${floor}squareantidemon`);
        if (!db[key]) {
            const rooms = {};
            const versions = ["1-1", "1-2", "1-3"];
            const sides = [{ k: "l", n: "LEFT" }, { k: "m", n: "MID" }, { k: "r", n: "RIGHT" }];
            versions.forEach(ver => {
                sides.forEach(side => {
                    const rk = `v${ver.replace("1-", "")}${side.k}`;
                    rooms[rk] = { name: `${ver} ${side.n}`, status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" };
                });
            });
            db[key] = { type: "antidemon", title: fmtTitle(`Antidemon ${floor}F`), ...rooms };
        }
    });

    // ── SP12 Random Event ──
    db[p("12randomevent")] || (db[p("12randomevent")] = {
        type: "fixed",
        title: fmtTitle("🎲 Random Event (SP12)"),
        status: STATUS_AVAILABLE, ownerId: null, ownerName: null, timeWindow: "", _claimTimestamp: null,
        schedules: [3, 9, 15, 21], scheduleMinutes: 0
    });

    // ── Individual Goblin Panels ──
    const goblinTpl = (label) => ({ type: "summon", title: fmtTitle(label), [label]: { name: label, status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } });
    db[p("11goblin")] || (db[p("11goblin")] = goblinTpl("⭐ SP 11F Goblin"));
    db[p("12goblin")] || (db[p("12goblin")] = goblinTpl("⭐ SP 12F Goblin"));
    db[p("11msgoblin")] || (db[p("11msgoblin")] = goblinTpl("👹 MS 11 Goblin"));
    db[p("12msgoblin")] || (db[p("12msgoblin")] = goblinTpl("👹 MS 12 Goblin"));

    // ── Combined Summon Panel ──
    const summonRooms = {
        sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
    };
    if (serverId) {
        db[p("summon")] || (db[p("summon")] = { type: "summon", title: fmtTitle("🌀 Summon Locations"), ...JSON.parse(JSON.stringify(summonRooms)) });
    } else {
        // Legacy
        db.summon || (db.summon = { type: "summon", title: "🌀 Summon Locations", ...JSON.parse(JSON.stringify(summonRooms)) });
    }
}

// ==========================================
// 🔄 RE-EXPORTS
// ==========================================

export { handleClaimMessages, handleClaimInteractions } from "./claim-handlers.js";
