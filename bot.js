import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent } from "./state.js";
import { migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, processAutoRecoveryOnBoot, refreshVisualPanel } from "./panel-utils.js";
import { startTickInterval } from "./panel-tick.js";

// ==========================================
// 🚀 INITIALIZATION
// ==========================================

export function initClaimSystem(botClient, database, saveStorageFn, logEventFn, messagesTracker) {
    initState({ client: botClient, db: database, saveLocalStorage: saveStorageFn, logEvent: logEventFn, lastMessages: messagesTracker });

    defaultFloors.forEach(floor => {
        db[`${floor}peak`] || (db[`${floor}peak`] = {
            type: "peak",
            title: `Secret Peak ${floor}F`,
            timeWindow: "",
            next: null,
            ownerId: null,
            ownerName: null,
            left: {
                name: "⬅️ Left",
                status: "🟢 Available",
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            red: {
                name: "🟥 Red",
                status: "🟢 Available",
                cooldown: 180,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            right: {
                name: "➡️ Right",
                status: "🟢 Available",
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            plant: {
                name: "🌱 Plant",
                status: "🟢 Available",
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            ore: {
                name: "⛏️ Ore",
                status: "🟢 Available",
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            }
        });
        db[`${floor}squarenormal`] || (db[`${floor}squarenormal`] = {
            type: "normal",
            title: `Magic Square ${floor}F`,
            timeWindow: "",
            next: null,
            ownerId: null,
            ownerName: null,
            boss1: {
                name: "1️⃣ Leader 1",
                status: "🟢 Available",
                cooldown: 30,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            boss2: {
                name: "2️⃣ Leader 2",
                status: "🟢 Available",
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            boss3: {
                name: "3️⃣ Leader 3",
                status: "🟢 Available",
                cooldown: 180,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            plant: {
                name: "🌱 Plant",
                status: "🟢 Available",
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            ore: {
                name: "⛏️ Ore",
                status: "🟢 Available",
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            }
        });
        db[`${floor}squareantidemon`] || (db[`${floor}squareantidemon`] = {
            type: "antidemon",
            title: `Antidemon ${floor}F`,
            left: {
                name: "LEFT ROOM",
                status: "🟢 Available",
                ownerId: null,
                ownerName: null,
                time: "",
                timeWindow: "",
                nextId: null,
                nextName: null,
                formattedTimeNext: "",
                endLimit: null
            },
            mid: {
                name: "MID ROOM",
                status: "🟢 Available",
                ownerId: null,
                ownerName: null,
                time: "",
                timeWindow: "",
                nextId: null,
                nextName: null,
                formattedTimeNext: "",
                endLimit: null
            },
            right: {
                name: "RIGHT ROOM",
                status: "🟢 Available",
                ownerId: null,
                ownerName: null,
                time: "",
                timeWindow: "",
                nextId: null,
                nextName: null,
                formattedTimeNext: "",
                endLimit: null
            }
        });
    });

    ["11squareleaders", "11squarefury", "11squarefrenzy", "12squareleaders", "12squarefury", "12squarefrenzy"].forEach(key => {
        if (!db[key]) {
            let isFury = key.includes("fury"),
                isFrenzy = key.includes("frenzy");
            db[key] = {
                type: isFury || isFrenzy ? "fixed" : "normal",
                title: key.includes("11") ? `Magic Square 11F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}` : `Magic Square 12F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}`,
                timeWindow: "",
                next: null,
                ownerId: null,
                ownerName: null,
                ...isFury || isFrenzy ? {
                    schedules: isFury ? [5, 11, 17, 23] : [2, 8, 14, 20]
                } : {
                    boss1: {
                        name: "1️⃣ Leader 1",
                        status: "🟢 Available",
                        cooldown: 30,
                        _freeSince: 0,
                        _lastKilledTimeStr: ""
                    },
                    boss2: {
                        name: "2️⃣ Leader 2",
                        status: "🟢 Available",
                        cooldown: 60,
                        _freeSince: 0,
                        _lastKilledTimeStr: ""
                    },
                    boss3: {
                        name: "3️⃣ Leader 3",
                        status: "🟢 Available",
                        cooldown: 180,
                        _freeSince: 0,
                        _lastKilledTimeStr: ""
                    }
                }
            };
        }
    });

    // Initialize summon panel
    db.summon || (db.summon = {
        type: "summon",
        title: "🌀 Summon Locations",
        sp2: { name: "⭐ SP 2F", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        sp4: { name: "⭐ SP 4F", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        sp7: { name: "⭐ SP 7F", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        ms11: { name: "👹 MS 11 (Goblin)", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        sp11: { name: "⭐ SP 11F (Goblin)", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
    });

    loadPunishmentsFromDisk();

    migrateBossCooldowns();
    migrateNamesCleanEmojis();
    migrateLastKilledAt();

    // Force-refresh all panels to fix any incorrect respawn timers on existing displays
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
// 🔄 RE-EXPORTS (for index.js compatibility)
// ==========================================

export { handleClaimMessages, handleClaimInteractions } from "./claim-handlers.js";
