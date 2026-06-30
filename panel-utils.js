import { getLocalTime, getFormattedTime12h, parseStringToDate } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { db, client, saveLocalStorage, logEvent, lastMessages } from "./state.js";
import { renderEmbed, renderButtons, getEmbedColor } from "./panel-render.js";
import { STATUS_AVAILABLE, STATUS_KILLED, STATUS_KILLED_PREFIX } from "./constants.js";

// ==========================================
// 📡 PANEL UPDATE & NOTIFICATIONS
// ==========================================

export async function refreshVisualPanel(key) {
    let cachedMsg = lastMessages[key];
    if (cachedMsg) try {
        await cachedMsg.edit({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        })
    } catch (n) {
        delete lastMessages[key]
    }
}

export async function notifyUserDM(uid, msgContent) {
    try {
        await (await client.users.fetch(uid)).send({
            content: msgContent
        })
    } catch (n) {}
}

// ==========================================
// 🔄 RESET PANEL DATA (admin !reset)
// ==========================================

export function resetPanelData(key) {
    let oldMapping = db._panelMapping ? db._panelMapping[key] : null;
    delete db[key];
    
    // Re-initialize using the same logic as initClaimSystem
    let isPeak = key.match(/^(\d+)peak$/),
        isNormal = key.match(/^(\d+)squarenormal$/),
        isAnti = key.match(/^(\d+)squareantidemon(\d+)?$/),
        is11or12 = key.match(/^(11|12)square(leaders|fury|frenzy|events)$/);
    
    if (isPeak) {
        let floor = isPeak[1];
        db[key] = {
            type: "peak",            title: `Secret Peak ${floor}F`, timeWindow: "", next: null, ownerId: null, ownerName: null,
            left: { name: "⬅️ Left", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            red: { name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            right: { name: "➡️ Right", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
        };
    } else if (isNormal) {
        let floor = isNormal[1];
        db[key] = {
            type: "normal",            title: `Magic Square ${floor}F`, timeWindow: "", next: null, ownerId: null, ownerName: null,
            boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
        };
    } else if (isAnti) {
        let floor = isAnti[1];
        let version = isAnti[2] || "";
        let title = version ? `Antidemon ${floor}F ${version.slice(0,1)}-${version.slice(1)}` : `Antidemon ${floor}F`;
        
        // MS11 and MS12: expanded panel with 9 rooms (1-1, 1-2, 1-3 × LEFT/MID/RIGHT)
        if (floor === "11" || floor === "12") {
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
            db[key] = { type: "antidemon", title: title, ...rooms };
        } else {
            db[key] = {
                type: "antidemon",            title: title,
                left: { name: "LEFT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" },
                mid: { name: "MID ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" },
                right: { name: "RIGHT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" }
            };
        }
    } else if ("summon" === key) {
        db[key] = {
            type: "summon",            title: "🌀 Summon Locations",
            sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            ms11: { name: "👹 MS 11 (Goblin)", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
        };
    } else if (key === "11" || key === "12") {
        // Unified SP event_group (Red Boss + Goblin + Random Event for SP12)
        const floor = key;
        db[key] = {
            type: "event_group",
            title: `Secret Peak ${floor}F`,
            red: {
                name: "🟥 Red Boss", type: "schedule",
                status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                timeWindow: "", _claimTimestamp: null,
                schedules: [1, 7, 13, 19]
            },
            goblin: {
                name: "⭐ Goblin", type: "summon",
                status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                time: "", timeWindow: "", nextId: null, nextName: null,
                formattedTimeNext: "", endLimit: null
            },
            ...(key === "12" ? {
                randomevent: {
                    name: "🎲 Random Event", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    schedules: [3, 9, 15, 21]
                }
            } : {})
        };
    } else if (key === "11peak" || key === "12peak") {
        const floor = key === "11peak" ? "11" : "12";
        db[key] = {
            type: "peak",
            title: `Secret Peak ${floor}F`,
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            red: {
                name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180,
                _freeSince: 0, _lastKilledTimeStr: "",
                schedules: [1, 7, 13, 19]
            }
        };
    } else if (key === "11goblin" || key === "12goblin") {
        const floor = key === "11goblin" ? "11" : "12";
        const rm = `sp${floor}`;
        db[key] = {
            type: "summon",
            title: `⭐ SP ${floor}F (Goblin)`,
            [rm]: {
                name: `⭐ SP ${floor}F (Goblin)`, status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null
            }
        };
    } else if (is11or12) {
        let num = is11or12[1], type = is11or12[2];
        const isLeaders = "leaders" === type;
        const isEvents = "events" === type;
        if (isLeaders) {
            db[key] = {
                type: "normal",
                title: `11` === num ? "Magic Square 11F - Leaders" : "Magic Square 12F - Leaders",
                timeWindow: "", next: null, ownerId: null, ownerName: null,
                boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
                boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
                boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" }
            };
        } else if (isEvents) {
            db[key] = {
                type: "event_group",
                title: `Magic Square ${num}F - Events`,
                fury: {
                    name: "🔴 Fury", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    schedules: [0, 3, 6, 9, 12, 15, 18, 21],
                    scheduleMinutes: 30
                },
                frenzy: {
                    name: "🟣 Frenzy", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    schedules: [2, 5, 8, 11, 14, 17, 20, 23]
                }
            };
        }
    }
    
    // Restore panel mapping if existed
    if (oldMapping) {
        db._panelMapping || (db._panelMapping = {});
        db._panelMapping[key] = oldMapping;
    }
    logEvent(`Panel ${key} data reset to defaults.`);
}

// ==========================================
// 🔄 MIGRATION: Clean emoji prefixes from existing boss/room names
// ==========================================

export function migrateNamesCleanEmojis() {
    let migrated = 0;
    const emojiReplacements = [
        { from: "Left Boss", to: "⬅️ Left" },
        { from: "Red Boss", to: "🟥 Red" },
        { from: "Right Boss", to: "➡️ Right" },
        { from: "Golden Plant", to: "🌱 Plant" },
        { from: "Golden Ore", to: "⛏️ Ore" },
        { from: "Leader 1", to: "1️⃣ Leader 1" },
        { from: "Leader 2", to: "2️⃣ Leader 2" },
        { from: "Leader 3", to: "3️⃣ Leader 3" },
        { from: "⬅️ LEFT ROOM", to: "LEFT ROOM" },
        { from: "🔵 MID ROOM", to: "MID ROOM" },
        { from: "➡️ RIGHT ROOM", to: "RIGHT ROOM" },
        { from: "🏔️ Secret Peak ", to: "Secret Peak " },
        { from: "🔮 Magic Square ", to: "Magic Square " },
        { from: "👹 Antidemon ", to: "Antidemon " },
        { from: "👑 Magic Square ", to: "Magic Square " }
    ];
    for (let key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        let current = db[key];
        let changed = !1;
        // Clean panel title
        for (let r of emojiReplacements) {
            if (current.title && current.title.includes(r.from)) {
                current.title = current.title.replace(r.from, r.to);
                changed = !0;
            }
        }
        // Clean boss/room names
        for (let prop in current) {
            if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop) && current[prop] && current[prop].name) {
                for (let r of emojiReplacements) {
                    if (current[prop].name === r.from) {
                        current[prop].name = r.to;
                        changed = !0;
                    }
                }
            }
        }
        if (changed) migrated++;
    }
    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`Cleaned emoji prefixes from ${migrated} existing panel entries.`);
    }
}

// ==========================================
// 🔄 MIGRATION: Backfill cooldown on existing boss entries
// ==========================================

export function migrateBossCooldowns() {
    let migrated = 0;
    for (let key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        let current = db[key];
        
        if ("peak" === current.type && current.red) {
            if (!current.red.cooldown) {
                current.red.cooldown = 180;
                if (!current.red._freeSince) current.red._freeSince = 0;
                if (!current.red._lastKilledTimeStr) current.red._lastKilledTimeStr = "";
                migrated++;
            }
        }
        
        if ("normal" === current.type && current.boss3) {
            if (!current.boss3.cooldown) {
                current.boss3.cooldown = 180;
                if (!current.boss3._freeSince) current.boss3._freeSince = 0;
                if (!current.boss3._lastKilledTimeStr) current.boss3._lastKilledTimeStr = "";
                migrated++;
            }
        }
    }
    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`Migrated cooldown property for ${migrated} existing boss entries.`);
    }
}

// ==========================================
// 🔄 MIGRATION: Backfill _lastKilledAt timestamp for existing entries
// ==========================================

// ==========================================
// 🔄 MIGRATION: Ensure MS11/MS12 panels exist with correct structure
// (Creates missing panels, converts old 3-room antidemon to 9-room format)
// ==========================================

export function migrateMS1112() {
    let migrated = 0;

    // === 1. Leaders panels (boss1/boss2/boss3) ===
    for (let floor of ["11", "12"]) {
        const key = `${floor}squareleaders`;
        if (!db[key]) {
            db[key] = {
                type: "normal",
                title: `Magic Square ${floor}F - Leaders`,
                timeWindow: "", next: null, ownerId: null, ownerName: null,
                boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
                boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
                boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" }
            };
            migrated++;
            logEvent(`Created missing MS${floor} leaders panel.`);
        }
    }

    // === 2. Event panels (Fury + Frenzy event_group) ===
    for (let floor of ["11", "12"]) {
        const key = `${floor}squareevents`;
        if (!db[key]) {
            db[key] = {
                type: "event_group",
                title: `Magic Square ${floor}F - Events`,
                fury: {
                    name: "🔴 Fury", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    schedules: [0, 3, 6, 9, 12, 15, 18, 21],
                    scheduleMinutes: 30
                },
                frenzy: {
                    name: "🟣 Frenzy", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    schedules: [2, 5, 8, 11, 14, 17, 20, 23]
                }
            };
            migrated++;
            logEvent(`Created missing MS${floor} events panel.`);
        }
    }

    // === 3. Antidemon panels (9-room format for MS11/MS12) ===
    for (let floor of ["11", "12"]) {
        const key = `${floor}squareantidemon`;
        const existing = db[key];

        if (!existing) {
            // Panel doesn't exist — create fresh
            const rooms = {};
            const versions = ["1-1", "1-2", "1-3"];
            const sides = [
                { k: "l", n: "LEFT" },
                { k: "m", n: "MID" },
                { k: "r", n: "RIGHT" }
            ];
            versions.forEach(ver => {
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
            migrated++;
            logEvent(`Created missing MS${floor} antidemon panel (9 rooms).`);
        } else if (existing.left && typeof existing.left === "object" && existing.left.name) {
            // Old format (left/mid/right) — convert to 9-room format preserving claims
            const oldRooms = { left: existing.left, mid: existing.mid, right: existing.right };

            const rooms = {};
            const versions = ["1-1", "1-2", "1-3"];
            const sides = [
                { k: "l", n: "LEFT" },
                { k: "m", n: "MID" },
                { k: "r", n: "RIGHT" }
            ];

            // Only populate version 1-1 (v1l/v1m/v1r) with old claims to avoid duplication.
            // Versions 1-2 and 1-3 get fresh empty rooms.
            versions.forEach((ver, vi) => {
                sides.forEach(side => {
                    const rk = `v${ver.replace("1-", "")}${side.k}`;
                    const name = `${ver} ${side.n}`;
                    if (vi === 0) {
                        // Version 1-1 only: preserve old claim data
                        const oldRoom = oldRooms[side.k === "l" ? "left" : side.k === "m" ? "mid" : "right"];
                        if (oldRoom && oldRoom.ownerId) {
                            rooms[rk] = {
                                name,
                                status: oldRoom.status || STATUS_AVAILABLE,
                                ownerId: oldRoom.ownerId,
                                ownerName: oldRoom.ownerName,
                                time: oldRoom.time || "",
                                timeWindow: oldRoom.timeWindow || "",
                                nextId: oldRoom.nextId || null,
                                nextName: oldRoom.nextName || null,
                                formattedTimeNext: oldRoom.formattedTimeNext || "",
                                endLimit: oldRoom.endLimit || null,
                                password: oldRoom.password || ""
                            };
                            return;
                        }
                    }
                    rooms[rk] = {
                        name,
                        status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                        time: "", timeWindow: "", nextId: null, nextName: null,
                        formattedTimeNext: "", endLimit: null, password: ""
                    };
                });
            });

            db[key] = { type: "antidemon", title: existing.title || `Antidemon ${floor}F`, ...rooms };
            migrated++;
            logEvent(`Migrated MS${floor} antidemon from 3-room to 9-room format, preserving claims.`);
        }
        // Else: already 9-room format, no change needed
    }

    // === 4. Clean up old legacy panels (11squarefury, 11squarefrenzy, etc.) if they exist ===
    // These are now replaced by 11squareevents / 12squareevents (event_group type)
    // We don't delete them to avoid data loss — just log they exist
    for (let key of ["11squarefury", "11squarefrenzy", "12squarefury", "12squarefrenzy"]) {
        if (db[key]) {
            logEvent(`Legacy panel ${key} found (now replaced by ${key.replace(/fury|frenzy/, "events")}). No data deleted.`);
        }
    }

    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`MS11/MS12 migration complete: ${migrated} panel(s) created/updated.`);
    }
}

export function migrateLastKilledAt() {
    let migrated = 0;
    for (let key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        let current = db[key];
        for (let prop in current) {
            if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;
            let bossData = current[prop];
            if (!bossData || typeof bossData !== "object") continue;
            // If boss is currently killed but has no _lastKilledAt, set it by parsing the status string
            if (bossData.status && bossData.status.startsWith(STATUS_KILLED) && !bossData._lastKilledAt) {
                let killedTimeStr = bossData.status.replace(STATUS_KILLED_PREFIX, "").trim();
                let killedDate = parseStringToDate(killedTimeStr);
                if (killedDate && !isNaN(killedDate.getTime())) {
                    bossData._lastKilledAt = killedDate.getTime();
                    migrated++;
                }
            }
            // Also handle entries already "🟢 Available" that have _lastKilledTimeStr but no _lastKilledAt
            if (bossData.status === STATUS_AVAILABLE && !bossData._lastKilledAt && bossData._lastKilledTimeStr) {
                let killedDate = parseStringToDate(bossData._lastKilledTimeStr);
                if (killedDate && !isNaN(killedDate.getTime())) {
                    let diffMs = getLocalTime().getTime() - killedDate.getTime();
                    // Only set if the time is in the past (valid old killed time)
                    if (diffMs > 0) {
                        bossData._lastKilledAt = killedDate.getTime();
                        migrated++;
                    }
                }
            }
            // Also sync _lastKilledAt into _lastKilledTimeStr if the latter is empty (for "X ago" display)
            if (bossData._lastKilledAt && !bossData._lastKilledTimeStr) {
                bossData._lastKilledTimeStr = getFormattedTime12h(new Date(bossData._lastKilledAt));
                migrated++;
            }
        }
    }
    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`Migrated _lastKilledAt timestamp for ${migrated} existing boss entries.`);
    }
}

// ==========================================
// 🔄 AUTO-RECOVERY ON BOOT
// ==========================================

export async function processAutoRecoveryOnBoot() {
    logEvent("Starting automatic panel recovery and chat cleanup...");
    db._panelMapping || (db._panelMapping = {});
    for (let key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        let mapping = db._panelMapping[key];
        if (mapping && mapping.channelId && mapping.messageId) try {
            let channel = await client.channels.fetch(mapping.channelId).catch(() => null);
            if (!channel) continue;
            try {
                let msg = await channel.messages.fetch(mapping.messageId).catch(() => null);
                msg && await msg.delete().catch(() => {});
            } catch (i) {}
            let newMsg = await channel.send({
                embeds: [renderEmbed(key)],
                components: renderButtons(key)
            }).catch(() => null);
            newMsg && (lastMessages[key] = newMsg, db._panelMapping[key] = {
                channelId: channel.id,
                messageId: newMsg.id
            });
        } catch (s) {
            logEvent(`Failed to restore panel ${key}: ${s.message}`);
            console.error(`[Panel Restore Error] ${key}:`, s);
        }
    }
    saveLocalStorage();
}
