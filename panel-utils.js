import { getLocalTime, getFormattedTime12h, parseStringToDate } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { db, client, saveLocalStorage, logEvent, lastMessages } from "./state.js";
import { renderEmbed, renderButtons, getEmbedColor } from "./panel-render.js";
import { STATUS_AVAILABLE, STATUS_KILLED, STATUS_KILLED_PREFIX } from "./constants.js";
import { stripPrefix, getActiveServerIds } from "./claim-resolver.js";

// ==========================================
// 📡 PANEL UPDATE & NOTIFICATIONS
// ==========================================

export async function refreshVisualPanel(key) {
    // Fast-path: nothing cached, nothing to update
    const cachedMsg = lastMessages[key];
    const instances = db._panelInstances?.[key];
    if (!cachedMsg && (!instances || instances.length === 0)) return;
    
    // Render once, reuse for all edits
    const embed = renderEmbed(key);
    const buttons = renderButtons(key);
    
    // 1. Update the primary reference (backward compat)
    if (cachedMsg) try {
        await cachedMsg.edit({ embeds: [embed], components: buttons })
    } catch (n) {
        delete lastMessages[key]
    }
    
    // 2. Update ALL panel instances (multi-server support)
    if (instances && instances.length > 0) {
        for (let i = instances.length - 1; i >= 0; i--) {
            const inst = instances[i];
            // Skip if this is the same message as lastMessages[key] (already updated)
            if (cachedMsg && inst.channelId === cachedMsg.channel?.id && inst.messageId === cachedMsg.id) continue;
            
            const channel = await client.channels.fetch(inst.channelId).catch(() => null);
            if (!channel) {
                instances.splice(i, 1);
                continue;
            }
            const msg = await channel.messages.fetch(inst.messageId).catch(() => null);
            if (!msg) {
                instances.splice(i, 1);
                continue;
            }
            try {
                await msg.edit({ embeds: [embed], components: buttons });
            } catch (n) {
                instances.splice(i, 1);
            }
        }
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
    
    // Use base key (strip server prefix) for structure detection
    const baseKey = stripPrefix(key);
    
    // Re-initialize using the same logic as initClaimSystem
    let isPeak = baseKey.match(/^(\d+)peak$/),
        isNormal = baseKey.match(/^(\d+)squarenormal$/),
        isAnti = baseKey.match(/^(\d+)squareantidemon(\d+)?$/),
        is11or12 = baseKey.match(/^(11|12)square(leaders|events)$/);
    
    if (isPeak) {
        let floor = isPeak[1];
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
                plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
                ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
            } : {})
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
    } else if (baseKey === "12randomevent") {
        db[key] = {
            type: "fixed",
            title: "🎲 Random Event (SP12)",
            status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
            timeWindow: "", _claimTimestamp: null,
            schedules: [3, 9, 15, 21],
            scheduleMinutes: 0
        };
    } else if (baseKey === "11goblin") {
        db[key] = { type: "summon", title: "⭐ SP 11F Goblin",
            sp11: { name: "⭐ SP 11F Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if (baseKey === "12goblin") {
        db[key] = { type: "summon", title: "⭐ SP 12F Goblin",
            sp12: { name: "⭐ SP 12F Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if (baseKey === "11msgoblin") {
        db[key] = { type: "summon", title: "👹 MS 11 Goblin",
            ms11: { name: "👹 MS 11 Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if (baseKey === "12msgoblin") {
        db[key] = { type: "summon", title: "👹 MS 12 Goblin",
            ms12: { name: "👹 MS 12 Goblin", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
    } else if ("summon" === baseKey) {
        db[key] = {
            type: "summon",            title: "🌀 Summon Locations",
            sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
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
// 🔄 MIGRATION: Fix goblin panel room keys
// Old format used the label string as room key (e.g. "⭐ SP 11F Goblin"),
// new format uses short keys (sp11, sp12, ms11, ms12).
// ==========================================

export function migrateGoblinRoomKeys() {
    let migrated = 0;
    
    // Mapping: label string → correct room key
    const labelToRoom = {
        "⭐ SP 11F Goblin": "sp11",
        "⭐ SP 12F Goblin": "sp12",
        "👹 MS 11 Goblin": "ms11",
        "👹 MS 12 Goblin": "ms12"
    };
    
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const panel = db[key];
        if (panel.type !== "summon") continue;
        
        // Check if this panel has any old label-keyed room
        for (const [label, correctKey] of Object.entries(labelToRoom)) {
            if (panel[label] && typeof panel[label] === "object") {
                // Found old-style room data — move to correct key
                if (!panel[correctKey]) {
                    panel[correctKey] = panel[label];
                    // Ensure the name property is the label, not the key
                    panel[correctKey].name = label;
                } else {
                    // Correct key already exists, merge owner data if present
                    const oldRoom = panel[label];
                    if (oldRoom.ownerId && !panel[correctKey].ownerId) {
                        Object.assign(panel[correctKey], oldRoom);
                    }
                }
                delete panel[label];
                migrated++;
                logEvent(`Migrated goblin room "${label}" → ${correctKey} in panel "${key}"`);
            }
        }
    }
    
    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`Goblin room key migration complete: ${migrated} room(s) fixed.`);
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
    // Check both bare keys and server-prefixed keys
    const peakPairs = [
        { oldKey: "11", newKey: "11peak" },
        { oldKey: "12", newKey: "12peak" }
    ];
    
    // First, handle bare keys (legacy)
    peakPairs.forEach(({ oldKey, newKey }) => {
        migratePeakPair(oldKey, newKey);
    });
    
    // Then, handle server-prefixed keys
    const serverIds = getActiveServerIds();
    for (const sid of serverIds) {
        peakPairs.forEach(({ oldKey, newKey }) => {
            migratePeakPair(`${sid}_${oldKey}`, `${sid}_${newKey}`);
        });
    }
    
    function migratePeakPair(oldKey, newKey) {
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
    }

    // Phase 3: Clean up any leftover old peak keys that shouldn't be there
    const cleanPeak = (key) => {
        if (db[key] && db[key].type === "peak") {
            // SP11/SP12 only have left/red/right (no plant/ore)
            const p = db[key];
            // Ensure plant/ore are removed if present
            if (p.plant) delete p.plant;
            if (p.ore) delete p.ore;
        }
    };
    ["11peak", "12peak"].forEach(key => {
        cleanPeak(key);
        for (const sid of serverIds) {
            cleanPeak(`${sid}_${key}`);
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
    const serverIds = getActiveServerIds();
    
    // Helper: generate both bare and prefixed key variants
    function* eachKey(baseKey) {
        yield baseKey;
        for (const sid of serverIds) {
            yield `${sid}_${baseKey}`;
        }
    }

    // === 1. Leaders panels (boss1/boss2/boss3) ===
    for (let floor of ["11", "12"]) {
        for (const key of eachKey(`${floor}squareleaders`)) {
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
                logEvent(`Created missing MS${floor} leaders panel: ${key}`);
            }
        }
    }

    // === 2. Event panels (Fury + Frenzy event_group) ===
    for (let floor of ["11", "12"]) {
        for (const key of eachKey(`${floor}squareevents`)) {
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
                logEvent(`Created missing MS${floor} events panel: ${key}`);
            }
        }
    }

    // === 3. Antidemon panels (9-room format for MS11/MS12) ===
    for (let floor of ["11", "12"]) {
        for (const key of eachKey(`${floor}squareantidemon`)) {
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
                logEvent(`Created missing MS${floor} antidemon panel (9 rooms): ${key}`);
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
                logEvent(`Migrated MS${floor} antidemon from 3-room to 9-room format: ${key}`);
            }
            // Else: already 9-room format, no change needed
        }
    }

    // === 4. Backfill type:"fixed" and schedules on existing MS11/MS12 events panels ===
    // Fixes existing DB entries that were created without these properties
    for (let floor of ["11", "12"]) {
        for (const key of eachKey(`${floor}squareevents`)) {
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
    }

    if (migrated > 0) {
        saveLocalStorage();
        logEvent(`MS11/MS12 migration complete: ${migrated} panel(s) created/updated.`);
    }

    // === 5. Clean up old ms11 from the combined summon panel (moved to its own panel) ===
    // Check both bare summon key and prefixed variants
    const checkSummon = (key) => {
        if (db[key] && db[key].ms11) {
            delete db[key].ms11;
            migrated++;
            logEvent(`Removed ms11 from summon panel: ${key}`);
        }
    };
    checkSummon("summon");
    for (const sid of serverIds) {
        checkSummon(`${sid}_summon`);
    }

    // === 6. Fix duplicate summon panel init — if summon was wrongly set as type "fixed" (Random Event), restore it ===
    const fixSummonType = (key) => {
        if (db[key] && db[key].type === "fixed") {
            db[key] = {
                type: "summon",
                title: db[key].title && db[key].title.includes("Summon")
                    ? db[key].title
                    : (stripPrefix(key) === "summon" ? "🌀 Summon Locations" : db[key].title),
                sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
                sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
                sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
            };
            migrated++;
            logEvent(`Fixed ${key}: was wrongly set as Random Event, restored to Summon panel.`);
        }
    };
    fixSummonType("summon");
    for (const sid of serverIds) {
        fixSummonType(`${sid}_summon`);
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
    
    // Collect all unique channel+message pairs to restore
    const restoreQueue = [];
    
    // 1. Legacy _panelMapping entries
    for (let key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const mapping = db._panelMapping[key];
        if (mapping && mapping.channelId && mapping.messageId) {
            restoreQueue.push({ key, ...mapping });
        }
    }
    
    // 2. Multi-server _panelInstances entries (avoid duplicates with _panelMapping)
    for (let key in (db._panelInstances || {})) {
        const instances = db._panelInstances[key];
        if (!instances || !Array.isArray(instances)) continue;
        for (const inst of instances) {
            if (inst && inst.channelId && inst.messageId) {
                // Skip if already in queue from _panelMapping
                const isDuplicate = restoreQueue.some(
                    q => q.key === key && q.channelId === inst.channelId && q.messageId === inst.messageId
                );
                if (!isDuplicate) {
                    restoreQueue.push({ key, ...inst });
                }
            }
        }
    }
    
    // Restore each panel message (delete old, send new)
    for (const entry of restoreQueue) {
        const { key, channelId, messageId } = entry;
        if (!db[key] || key.startsWith("_")) continue;
        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) continue;
            
            // Delete old message
            try {
                const oldMsg = await channel.messages.fetch(messageId).catch(() => null);
                if (oldMsg) await oldMsg.delete().catch(() => {});
            } catch (i) {}
            
            // Send new panel message
            const newMsg = await channel.send({
                embeds: [renderEmbed(key)],
                components: renderButtons(key)
            }).catch(() => null);
            
            if (newMsg) {
                // Update _panelMapping (primary reference)
                if (!db._panelMapping[key] || db._panelMapping[key].channelId === channelId) {
                    db._panelMapping[key] = {
                        channelId: channel.id,
                        messageId: newMsg.id
                    };
                    lastMessages[key] = newMsg;
                }
                
                // Update _panelInstances (multi-server)
                if (db._panelInstances && db._panelInstances[key]) {
                    const idx = db._panelInstances[key].findIndex(
                        i => i.channelId === channelId && i.messageId === messageId
                    );
                    if (idx !== -1) {
                        db._panelInstances[key][idx] = {
                            channelId: channel.id,
                            messageId: newMsg.id
                        };
                    } else {
                        db._panelInstances[key].push({
                            channelId: channel.id,
                            messageId: newMsg.id
                        });
                    }
                }
            }
        } catch (s) {
            logEvent(`Failed to restore panel ${key}: ${s.message}`);
            console.error(`[Panel Restore Error] ${key}:`, s);
        }
    }
    
    saveLocalStorage();
}
