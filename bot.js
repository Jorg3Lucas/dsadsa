import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent } from "./state.js";
import { migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, processAutoRecoveryOnBoot, refreshVisualPanel } from "./panel-utils.js";
import { startTickInterval } from "./panel-tick.js";
import { STATUS_AVAILABLE } from "./constants.js";

// ==========================================
// 🚀 INITIALIZATION
// ==========================================

export function initClaimSystem(botClient, database, saveStorageFn, logEventFn, messagesTracker, rankingDatabase) {
    initState({ client: botClient, db: database, rankingDb: rankingDatabase || null, saveLocalStorage: saveStorageFn, logEvent: logEventFn, lastMessages: messagesTracker });

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
                status: STATUS_AVAILABLE,
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            red: {
                name: "🟥 Red",
                status: STATUS_AVAILABLE,
                cooldown: 180,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            right: {
                name: "➡️ Right",
                status: STATUS_AVAILABLE,
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            plant: {
                name: "🌱 Plant",
                status: STATUS_AVAILABLE,
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            ore: {
                name: "⛏️ Ore",
                status: STATUS_AVAILABLE,
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
                status: STATUS_AVAILABLE,
                cooldown: 30,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            boss2: {
                name: "2️⃣ Leader 2",
                status: STATUS_AVAILABLE,
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            boss3: {
                name: "3️⃣ Leader 3",
                status: STATUS_AVAILABLE,
                cooldown: 180,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            plant: {
                name: "🌱 Plant",
                status: STATUS_AVAILABLE,
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: ""
            },
            ore: {
                name: "⛏️ Ore",
                status: STATUS_AVAILABLE,
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
                status: STATUS_AVAILABLE,
                ownerId: null,
                ownerName: null,
                time: "",
                timeWindow: "",
                nextId: null,
                nextName: null,
                formattedTimeNext: "",
                endLimit: null,
                password: ""
            },
            mid: {
                name: "MID ROOM",
                status: STATUS_AVAILABLE,
                ownerId: null,
                ownerName: null,
                time: "",
                timeWindow: "",
                nextId: null,
                nextName: null,
                formattedTimeNext: "",
                endLimit: null,
                password: ""
            },
            right: {
                name: "RIGHT ROOM",
                status: STATUS_AVAILABLE,
                ownerId: null,
                ownerName: null,
                time: "",
                timeWindow: "",
                nextId: null,
                nextName: null,
                formattedTimeNext: "",
                endLimit: null,
                password: ""
            }
        });

        // Extra antidemon panels for MS9 and MS10: 1-1 and 1-2
        if (floor === "9" || floor === "10") {
            const antiRoomTemplate = {
                name: "LEFT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: ""
            };
            const antiMidTemplate = {
                name: "MID ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: ""
            };
            const antiRightTemplate = {
                name: "RIGHT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: ""
            };

            db[`${floor}squareantidemon11`] || (db[`${floor}squareantidemon11`] = {
                type: "antidemon",
                title: `Antidemon ${floor}F 1-1`,
                left: { ...antiRoomTemplate },
                mid: { ...antiMidTemplate },
                right: { ...antiRightTemplate }
            });
            db[`${floor}squareantidemon12`] || (db[`${floor}squareantidemon12`] = {
                type: "antidemon",
                title: `Antidemon ${floor}F 1-2`,
                left: { ...antiRoomTemplate },
                mid: { ...antiMidTemplate },
                right: { ...antiRightTemplate }
            });
        }
    });

    // SP11 / SP12: Red Boss only — separate from SP7-10 pattern
    const spRedTemplate = (floor) => ({
        type: "peak",
        title: `Secret Peak ${floor}F`,
        timeWindow: "", next: null, ownerId: null, ownerName: null,
        red: {
            name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180,
            _freeSince: 0, _lastKilledTimeStr: "",
            schedules: [1, 7, 13, 19]
        }
    });
    if (!db["11peak"]) db["11peak"] = spRedTemplate("11");
    if (!db["12peak"]) db["12peak"] = spRedTemplate("12");

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
                    schedules: isFury ? [0, 3, 6, 9, 12, 15, 18, 21] : [2, 5, 8, 11, 14, 17, 20, 23],
                    ...isFury ? { scheduleMinutes: 30 } : {}
                } : {
                    boss1: {
                        name: "1️⃣ Leader 1",
                        status: STATUS_AVAILABLE,
                        cooldown: 30,
                        _freeSince: 0,
                        _lastKilledTimeStr: ""
                    },
                    boss2: {
                        name: "2️⃣ Leader 2",
                        status: STATUS_AVAILABLE,
                        cooldown: 60,
                        _freeSince: 0,
                        _lastKilledTimeStr: ""
                    },
                    boss3: {
                        name: "3️⃣ Leader 3",
                        status: STATUS_AVAILABLE,
                        cooldown: 180,
                        _freeSince: 0,
                        _lastKilledTimeStr: ""
                    }
                }
            };
        }
    });

    // Antidemon panels for MS11 and MS12: single panel with all 9 rooms (1-1, 1-2, 1-3 × LEFT/MID/RIGHT)
    ["11", "12"].forEach(floor => {
        const key = `${floor}squareantidemon`;
        if (!db[key]) {
            const rooms = {};
            const names = ["1-1", "1-2", "1-3"];
            const sides = [
                { k: "l", n: "LEFT" },
                { k: "m", n: "MID" },
                { k: "r", n: "RIGHT" }
            ];
            names.forEach(ver => {
                sides.forEach(side => {
                    const rk = `v${ver.replace("1-", "")}${side.k}`;
                    rooms[rk] = {
                        name: `${ver} ${side.n}`,
                        status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                        time: "", timeWindow: "", nextId: null, nextName: null,
                        formattedTimeNext: "", endLimit: null, password: ""
                    };
                });
            });
            db[key] = { type: "antidemon", title: `Antidemon ${floor}F`, ...rooms };
        }
    });

    // Initialize SP11/SP12 goblin panels (separate from main summon)
    const goblinTemplate = (floor) => ({
        type: "summon",
        title: `⭐ SP ${floor}F (Goblin)`,
        [`sp${floor}`]: {
            name: `⭐ SP ${floor}F (Goblin)`, status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
            time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null
        }
    });
    if (!db["11goblin"]) db["11goblin"] = goblinTemplate("11");
    if (!db["12goblin"]) db["12goblin"] = goblinTemplate("12");

    // Initialize summon panel (sp11/sp12 removed — moved to separate goblin panels)
    db.summon || (db.summon = {
        type: "summon",
        title: "🌀 Summon Locations",
        sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
        ms11: { name: "👹 MS 11 (Goblin)", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
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
