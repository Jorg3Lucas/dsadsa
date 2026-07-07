import { getLocalTime, getFormattedTime12h, parseStringToDate } from "./time-utils.js";
import { db, client, saveLocalStorage, logEvent, lastMessages, dmOptOut } from "./state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { STATUS_AVAILABLE, STATUS_KILLED, STATUS_KILLED_PREFIX } from "./constants.js";

// ==========================================
// 📡 PANEL UPDATE & NOTIFICATIONS
// ==========================================

// ── DM Rate-Limit Queue ───────────────────────────────
// Processes DMs sequentially with a 1.5s gap between messages
// to avoid hitting Discord's rate limits (~5 messages/5s per channel).
// -----------------------------------------------------------------
const dmQueue = [];
let dmQueueProcessing = false;
const DM_INTERVAL_MS = 1500;

/**
 * Process queued DMs one at a time with a delay between each.
 * Automatically starts if not already running.
 */
async function processDMQueue() {
    if (dmQueueProcessing) return;
    dmQueueProcessing = true;

    while (dmQueue.length > 0) {
        const { uid, content } = dmQueue.shift();
        try {
            await (await client.users.fetch(uid)).send({ content });
        } catch (err) {
            if (err.code === 50007) {
                console.log(`⚠️ [DM] Cannot send DM to ${uid}: DMs closed or bot blocked.`);
            } else if (err.code === 10013) {
                console.log(`⚠️ [DM] Cannot send DM to ${uid}: User not found.`);
            } else if (err.code === 429) {
                // Rate-limited — re-queue and wait longer
                console.log(`⏳ [DM] Rate-limited sending to ${uid}, re-queuing.`);
                dmQueue.unshift({ uid, content });
                await new Promise(r => setTimeout(r, 5000));
                continue;
            } else {
                console.log(`⚠️ [DM] Failed to send DM to ${uid}: ${err.message}`);
            }
        }
        // Only wait if more items are queued — avoids unnecessary delay before releasing the processor
        if (dmQueue.length > 0) {
            await new Promise(r => setTimeout(r, DM_INTERVAL_MS));
        }
    }

    dmQueueProcessing = false;
}

export async function refreshVisualPanel(key) {
    const cachedMsg = lastMessages[key];
    if (cachedMsg) {try {
        await cachedMsg.edit({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        })
    } catch (n) {
        // Edit failed (rate limit, msg deleted, permissions lost) — try to recover via panel mapping
        delete lastMessages[key];
        try {
            const mapping = db._panelMapping && db._panelMapping[key];
            if (mapping && mapping.channelId && mapping.messageId) {
                const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
                if (channel) {
                    const newMsg = await channel.send({
                        embeds: [renderEmbed(key)],
                        components: renderButtons(key)
                    });
                    lastMessages[key] = newMsg;
                    db._panelMapping[key] = { channelId: channel.id, messageId: newMsg.id };
                    saveLocalStorage();
                }
            }
        } catch (e) {
            logEvent(`Failed to recover panel ${key}: ${e.message}`);
        }
    }}
}

/**
 * Send a DM via the rate-limited queue.
 * Messages from the same caller are enqueued and sent sequentially
 * with a 1.5s pause between each to avoid Discord rate limits.
 *
 * Skips users who have opted out of DMs via the /dmoptout command.
 */
export async function notifyUserDM(uid, msgContent) {
    if (dmOptOut.has(uid)) {
        return; // User opted out of DMs
    }
    dmQueue.push({ uid, content: msgContent });
    processDMQueue();
}

// ==========================================
// 🔄 RESET PANEL DATA (admin !reset)
// ==========================================

export function resetPanelData(key) {
    const oldMapping = db._panelMapping ? db._panelMapping[key] : null;
    delete db[key];
    
    // Re-initialize using the same logic as initClaimSystem
    const isPeak = key.match(/^(\d+)peak$/),
        isNormal = key.match(/^(\d+)squarenormal$/),
        isAnti = key.match(/^(\d+)squareantidemon(\d+)?$/),
        is11or12 = key.match(/^(11|12)square(leaders|events)$/);
    
    if (isPeak) {
        const floor = isPeak[1];
        // SP11 and SP12 don't have Plant/Ore
        const hasPlantOre = floor !== "11" && floor !== "12";
        // SP11/SP12 Red Boss uses custom schedules (1, 7, 13, 19) instead of global (every 3h)
        const sp11or12 = floor === "11" || floor === "12";
        db[key] = {
            type: "peak",            title: `Secret Peak ${floor}F`, timeWindow: "", next: null, ownerId: null, ownerName: null,
            left: { name: "⬅️ Left", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            red: { name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "", ...(sp11or12 ? { schedules: [1, 7, 13, 19] } : {}) },
            right: { name: "➡️ Right", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ...(hasPlantOre ? {
                plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
                ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" }
            } : {})
        };
    } else if (isNormal) {
        const floor = isNormal[1];
        db[key] = {
            type: "normal",            title: `Magic Square ${floor}F`, timeWindow: "", next: null, ownerId: null, ownerName: null,
            boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
        };
    } else if (isAnti) {
        const floor = isAnti[1];
        const version = isAnti[2] || "";
        const title = version ? `Antidemon ${floor}F ${version.slice(0,1)}-${version.slice(1)}` : `Antidemon ${floor}F`;
        
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
    } else if (key === "12randomevent") {
        db[key] = {
            type: "fixed",
            title: "🎲 Random Event (SP12)",
            status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
            timeWindow: "", _claimTimestamp: null,
            schedules: [3, 9, 15, 21],
            scheduleMinutes: 0
        };
    } else if (key === "11goblin") {
        db[key] = { type: "summon", title: "⭐ SP 11F Goblin",
            sp11: { name: "⭐ SP 11F Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if (key === "12goblin") {
        db[key] = { type: "summon", title: "⭐ SP 12F Goblin",
            sp12: { name: "⭐ SP 12F Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if (key === "11msgoblin") {
        db[key] = { type: "summon", title: "👹 MS 11 Goblin",
            ms11: { name: "👹 MS 11 Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if (key === "12msgoblin") {
        db[key] = { type: "summon", title: "👹 MS 12 Goblin",
            ms12: { name: "👹 MS 12 Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if ("summon" === key) {
        db[key] = {
            type: "summon",            title: "🌀 Summon Locations",
            sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
        };
    } else if (is11or12) {
        const num = is11or12[1], type = is11or12[2];
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
                    reservedFor: null, reservedByName: null, reservations: null,
                    schedules: [0, 3, 6, 9, 12, 15, 18, 21],
                    scheduleMinutes: 30
                },
                frenzy: {
                    name: "🟣 Frenzy", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    reservedFor: null, reservedByName: null, reservations: null,
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
    let migrated = 0; // eslint-disable-line no-useless-assignment // eslint-disable-line no-useless-assignment
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
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        let changed = !1;
        // Clean panel title
        for (const r of emojiReplacements) {
            if (current.title && current.title.includes(r.from)) {
                current.title = current.title.replace(r.from, r.to);
                changed = !0;
            }
        }
        // Clean boss/room names
        for (const prop in current) {
            if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop) && current[prop] && current[prop].name) {
                for (const r of emojiReplacements) {
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
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        
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
// 🔄 MIGRATION: Update plant/ore cooldown from 60→30 on MS (normal) panels
// ==========================================

export function migratePlantOreCooldown() {
    let migrated = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("normal" !== current.type) continue;

        ["plant", "ore"].forEach(prop => {
            if (current[prop] && current[prop].cooldown === 60) {
                current[prop].cooldown = 30;
                migrated++;
            }
        });
    }
    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`Migrated plant/ore cooldown from 60→30 for ${migrated} entries on MS panels.`);
    }
}

// ==========================================
// 🔄 MIGRATION: Backfill _lastKilledAt timestamp for existing entries
// ==========================================

// ==========================================
// 🔄 MIGRATION: Convert SP11/SP12 from old event_group format to peak format
// Old DB may have "11"/"12" as event_group type (Red Boss + Goblin + Random Event).
// New format uses "11peak"/"12peak" as peak type (like SP7-SP10) with left/red/right/plant/ore.
// ==========================================

export function migrateSPLegacyToUnified() {
    let migrated = 0;

    // Phase 1 (removed): Legacy goblin panels (11goblin/12goblin) are now valid individual panels, keep them.

    // Phase 2: Migrate old unified event_group "11"/"12" → "11peak"/"12peak" peak type
    [
        { oldKey: "11", newKey: "11peak" },
        { oldKey: "12", newKey: "12peak" }
    ].forEach(({ oldKey, newKey }) => {
        const oldPanel = db[oldKey];
        const newPanel = db[newKey];

        // Skip if old panel doesn't exist or is already a peak type
        if (!oldPanel || oldPanel.type === "peak") return;
        // Skip if new peak panel doesn't exist (shouldn't happen after init)
        if (!newPanel || newPanel.type !== "peak") return;

        let changed = false;

        // Migrate Red Boss kill status from old.red to new.red
        const oldRed = oldPanel.red;
        const newRed = newPanel.red;
        if (oldRed && newRed) {
            if (oldRed.status && oldRed.status.startsWith(STATUS_KILLED)) {
                newRed.status = oldRed.status;
                if (oldRed._lastKilledAt) newRed._lastKilledAt = oldRed._lastKilledAt;
                if (oldRed._freeSince) newRed._freeSince = oldRed._freeSince;
                if (oldRed._lastKilledTimeStr) newRed._lastKilledTimeStr = oldRed._lastKilledTimeStr;
                changed = true;
            }
        }

        if (changed) {
            migrated++;
            logEvent(`Migrated Red Boss data from ${oldKey} → ${newKey}.`);
        }

        // Remove old panel
        delete db[oldKey];
        delete lastMessages[oldKey];
        if (db._panelMapping) delete db._panelMapping[oldKey];
        logEvent(`Removed old event_group panel ${oldKey} from DB.`);
    });

    // Phase 3: Clean up any leftover old peak keys that shouldn't be there
    ["11peak", "12peak"].forEach(key => {
        if (db[key] && db[key].type === "peak") {
            // SP11/SP12 only have left/red/right (no plant/ore)
            // Ensure plant/ore are removed if present
            const p = db[key];
            if (p.plant) delete p.plant;
            if (p.ore) delete p.ore;
        }
    });

    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`SP peak migration complete: ${migrated} panel(s) converted.`);
    }
}

// ==========================================
// 🔄 MIGRATION: Ensure MS11/MS12 panels exist with correct structure
// (Creates missing panels, converts old 3-room antidemon to 9-room format)
// ==========================================

export function migrateMS1112() {
    let migrated = 0;

    // === 1. Leaders panels (boss1/boss2/boss3) ===
    for (const floor of ["11", "12"]) {
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
    for (const floor of ["11", "12"]) {
        const key = `${floor}squareevents`;
        if (!db[key]) {
            db[key] = {
                type: "event_group",
                title: `Magic Square ${floor}F - Events`,
                fury: {
                    name: "🔴 Fury", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    reservedFor: null, reservedByName: null, reservations: null,
                    schedules: [0, 3, 6, 9, 12, 15, 18, 21],
                    scheduleMinutes: 30
                },
                frenzy: {
                    name: "🟣 Frenzy", type: "fixed",
                    status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                    timeWindow: "", _claimTimestamp: null,
                    reservedFor: null, reservedByName: null, reservations: null,
                    schedules: [2, 5, 8, 11, 14, 17, 20, 23]
                }
            };
            migrated++;
            logEvent(`Created missing MS${floor} events panel.`);
        }
    }

    // === 3. Antidemon panels (9-room format for MS11/MS12) ===
    for (const floor of ["11", "12"]) {
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

    // === 4. Backfill type:"fixed" and schedules on existing MS11/MS12 events panels ===
    // Fixes existing DB entries that were created without these properties
    for (const floor of ["11", "12"]) {
        const key = `${floor}squareevents`;
        const panel = db[key];
        if (panel && panel.type === "event_group") {
            let changed = false;
            for (const ev of ["fury", "frenzy"]) {
                const sub = panel[ev];
                if (sub) {
                    if (!sub.type) {
                        sub.type = "fixed";
                        changed = true;
                    }
                    if (!sub.schedules) {
                        sub.schedules = ev === "fury"
                            ? [0, 3, 6, 9, 12, 15, 18, 21]
                            : [2, 5, 8, 11, 14, 17, 20, 23];
                        if (ev === "fury" && !sub.scheduleMinutes) sub.scheduleMinutes = 30;
                        changed = true;
                    }
                    // Clean up any stale ownerId that might cause false "already taken"
                    if (sub.ownerId && !sub.ownerName && sub.status === STATUS_AVAILABLE) {
                        sub.ownerId = null;
                        changed = true;
                    }
                    if (sub.ownerId === "") {
                        sub.ownerId = null;
                        changed = true;
                    }
                }
            }
            if (changed) {
                migrated++;
                logEvent(`Backfilled type/schedules on ${key} sub-events.`);
            }
        }
    }

    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`MS11/MS12 migration complete: ${migrated} panel(s) created/updated.`);
    }

    // === 5. Clean up old ms11 from the combined summon panel (moved to its own panel) ===
    if (db.summon && db.summon.ms11) {
        delete db.summon.ms11;
        migrated++;
        logEvent(`Removed ms11 from combined summon panel (now in its own panel).`);
    }
    // === 6. Fix duplicate summon panel init — if db.summon was wrongly set as type "fixed" (Random Event), restore it ===
    if (db.summon && db.summon.type === "fixed") {
        // This was a bug from a previous code version that initialized db.summon as Random Event
        db.summon = {
            type: "summon",
            title: "🌀 Summon Locations",
            sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
        };
        migrated++;
        logEvent(`Fixed db.summon: was wrongly set as Random Event, restored to Summon panel.`);
    }
}

export function migrateLastKilledAt() {
    let migrated = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        for (const prop in current) {
            if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;
            const bossData = current[prop];
            if (!bossData || typeof bossData !== "object") continue;
            // If boss is currently killed but has no _lastKilledAt, set it by parsing the status string
            if (bossData.status && bossData.status.startsWith(STATUS_KILLED) && !bossData._lastKilledAt) {
                const killedTimeStr = bossData.status.replace(STATUS_KILLED_PREFIX, "").trim();
                const killedDate = parseStringToDate(killedTimeStr);
                if (killedDate && !isNaN(killedDate.getTime())) {
                    bossData._lastKilledAt = killedDate.getTime();
                    migrated++;
                }
            }
            // Also handle entries already "🟢 Available" that have _lastKilledTimeStr but no _lastKilledAt
            if (bossData.status === STATUS_AVAILABLE && !bossData._lastKilledAt && bossData._lastKilledTimeStr) {
                const killedDate = parseStringToDate(bossData._lastKilledTimeStr);
                if (killedDate && !isNaN(killedDate.getTime())) {
                    const diffMs = getLocalTime().getTime() - killedDate.getTime();
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
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const mapping = db._panelMapping[key];
        if (mapping && mapping.channelId && mapping.messageId) {try {
            const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
            if (!channel) continue;
            try {
                const msg = await channel.messages.fetch(mapping.messageId).catch(() => null);
                msg && await msg.delete().catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            } catch (i) {
        // Silently ignored — non-critical operation
    }
            const newMsg = await channel.send({
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
        }}
    }
    saveLocalStorage();
}
