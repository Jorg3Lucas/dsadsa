// ==========================================
// 🔄 PANEL MIGRATION FUNCTIONS
// Extracted from panel-utils.js
// ==========================================

import { db, saveLocalStorage, logEvent, lastMessages } from "../core/state.js";
import { getLocalTime, getFormattedTime12h, parseStringToDate } from "../core/time-utils.js";
import { STATUS_AVAILABLE, STATUS_KILLED, STATUS_KILLED_PREFIX } from "../core/constants.js";

// ── Clean emoji prefixes from existing boss/room names ──
/** Clean emoji prefixes from existing boss/room names in all panels. */
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
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        let changed = false;
        for (const r of emojiReplacements) {
            if (current.title && current.title.includes(r.from)) {
                current.title = current.title.replace(r.from, r.to);
                changed = true;
            }
        }
        for (const prop in current) {
            if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop) && current[prop] && current[prop].name) {
                for (const r of emojiReplacements) {
                    if (current[prop].name === r.from) {
                        current[prop].name = r.to;
                        changed = true;
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

// ── Backfill cooldown on existing boss entries ──
/** Backfill cooldown property on Red Boss (peak) and Leader 3 (normal) entries. */
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

// ── Update plant/ore cooldown from 60→30 on MS panels ──
/** Reduce plant/ore cooldown from 60 to 30 on Magic Square panels. */
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

// ── Convert SP11/SP12 from old event_group format to peak format ──
/** Convert SP11/SP12 from event_group format to unified peak format. */
export function migrateSPLegacyToUnified() {
    let migrated = 0;

    [ { oldKey: "11", newKey: "11peak" }, { oldKey: "12", newKey: "12peak" } ].forEach(({ oldKey, newKey }) => {
        const oldPanel = db[oldKey];
        const newPanel = db[newKey];
        if (!oldPanel || oldPanel.type === "peak") return;
        if (!newPanel || newPanel.type !== "peak") return;
        let changed = false;
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
        if (changed) { migrated++; logEvent(`Migrated Red Boss data from ${oldKey} → ${newKey}.`); }
        delete db[oldKey];
        delete lastMessages[oldKey];
        if (db._panelMapping) delete db._panelMapping[oldKey];
        logEvent(`Removed old event_group panel ${oldKey} from DB.`);
    });

    ["11peak", "12peak"].forEach(key => {
        if (db[key] && db[key].type === "peak") {
            const p = db[key];
            if (p.plant) delete p.plant;
            if (p.ore) delete p.ore;
        }
    });

    if (migrated > 0) { saveLocalStorage(); logEvent(`SP peak migration complete: ${migrated} panel(s) converted.`); }
}

// ── Ensure MS11/MS12 panels exist with correct structure ──
/** Ensure MS11/MS12 panels (leaders, events, antidemon) exist with correct structure. */
export function migrateMS1112() {
    let migrated = 0;

    for (const floor of ["11", "12"]) {
        const key = `${floor}squareleaders`;
        if (!db[key]) {
            db[key] = { type: "normal", title: `Magic Square ${floor}F - Leaders`, timeWindow: "", next: null, ownerId: null, ownerName: null, boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" }, boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }, boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" } };
            migrated++;
            logEvent(`Created missing MS${floor} leaders panel.`);
        }
    }

    for (const floor of ["11", "12"]) {
        const key = `${floor}squareevents`;
        if (!db[key]) {
            db[key] = { type: "event_group", title: `Magic Square ${floor}F - Events`, fury: { name: "🔴 Fury", type: "fixed", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, timeWindow: "", _claimTimestamp: null, reservedFor: null, reservedByName: null, reservations: null, schedules: [0, 3, 6, 9, 12, 15, 18, 21], scheduleMinutes: 30 }, frenzy: { name: "🟣 Frenzy", type: "fixed", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, timeWindow: "", _claimTimestamp: null, reservedFor: null, reservedByName: null, reservations: null, schedules: [2, 5, 8, 11, 14, 17, 20, 23] } };
            migrated++;
            logEvent(`Created missing MS${floor} events panel.`);
        }
    }

    // Antidemon panels (9-room format for MS11/MS12)
    for (const floor of ["11", "12"]) {
        const key = `${floor}squareantidemon`;
        const existing = db[key];
        if (!existing) {
            const rooms = {};
            const versions = ["1-1", "1-2", "1-3"];
            const sides = [{ k: "l", n: "LEFT" }, { k: "m", n: "MID" }, { k: "r", n: "RIGHT" }];
            versions.forEach(ver => { sides.forEach(side => { const rk = `v${ver.replace("1-", "")}${side.k}`; rooms[rk] = { name: `${ver} ${side.n}`, status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" }; }); });
            db[key] = { type: "antidemon", title: `Antidemon ${floor}F`, ...rooms };
            migrated++;
            logEvent(`Created missing MS${floor} antidemon panel (9 rooms).`);
        } else if (existing.left && typeof existing.left === "object" && existing.left.name) {
            const oldRooms = { left: existing.left, mid: existing.mid, right: existing.right };
            const rooms = {};
            const versions = ["1-1", "1-2", "1-3"];
            const sides = [{ k: "l", n: "LEFT" }, { k: "m", n: "MID" }, { k: "r", n: "RIGHT" }];
            versions.forEach((ver, vi) => {
                sides.forEach(side => {
                    const rk = `v${ver.replace("1-", "")}${side.k}`;
                    const name = `${ver} ${side.n}`;
                    if (vi === 0) {
                        const oldRoom = oldRooms[side.k === "l" ? "left" : side.k === "m" ? "mid" : "right"];
                        if (oldRoom && oldRoom.ownerId) { rooms[rk] = { name, status: oldRoom.status || STATUS_AVAILABLE, ownerId: oldRoom.ownerId, ownerName: oldRoom.ownerName, time: oldRoom.time || "", timeWindow: oldRoom.timeWindow || "", nextId: oldRoom.nextId || null, nextName: oldRoom.nextName || null, formattedTimeNext: oldRoom.formattedTimeNext || "", endLimit: oldRoom.endLimit || null, password: oldRoom.password || "" }; return; }
                    }
                    rooms[rk] = { name, status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" };
                });
            });
            db[key] = { type: "antidemon", title: existing.title || `Antidemon ${floor}F`, ...rooms };
            migrated++;
            logEvent(`Migrated MS${floor} antidemon from 3-room to 9-room format, preserving claims.`);
        }
    }

    // Backfill type/schedules on existing events panels
    for (const floor of ["11", "12"]) {
        const key = `${floor}squareevents`;
        const panel = db[key];
        if (panel && panel.type === "event_group") {
            let changed = false;
            for (const ev of ["fury", "frenzy"]) {
                const sub = panel[ev];
                if (sub) {
                    if (!sub.type) { sub.type = "fixed"; changed = true; }
                    if (!sub.schedules) { sub.schedules = ev === "fury" ? [0, 3, 6, 9, 12, 15, 18, 21] : [2, 5, 8, 11, 14, 17, 20, 23]; if (ev === "fury" && !sub.scheduleMinutes) sub.scheduleMinutes = 30; changed = true; }
                    if (sub.ownerId && !sub.ownerName && sub.status === STATUS_AVAILABLE) { sub.ownerId = null; changed = true; }
                    if (sub.ownerId === "") { sub.ownerId = null; changed = true; }
                }
            }
            if (changed) { migrated++; logEvent(`Backfilled type/schedules on ${key} sub-events.`); }
        }
    }

    // Clean up old ms11 from combined summon panel
    if (db.summon && db.summon.ms11) { delete db.summon.ms11; migrated++; logEvent("Removed ms11 from combined summon panel."); }
    if (db.summon && db.summon.type === "fixed") {
        db.summon = { type: "summon", title: "🌀 Summon Locations", sp2: { name: "⭐ SP 2F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }, sp4: { name: "⭐ SP 4F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }, sp7: { name: "⭐ SP 7F", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null } };
        migrated++;
        logEvent("Fixed db.summon: was wrongly set as Random Event, restored to Summon panel.");
    }

    if (migrated > 0) { saveLocalStorage(); logEvent(`MS11/MS12 migration complete: ${migrated} panel(s) created/updated.`); }
}

// ── Convert MS9/MS10 antidemon from 3-panel to single 6-room format ──
/** Convert MS9/MS10 antidemon from 3-room to 6-room format. */
export function migrateAntidemon9e10() {
    let migrated = 0;

    ["9", "10"].forEach(floor => {
        const key = `${floor}squareantidemon`;
        const existing = db[key];
        if (!existing) return;
        if (existing.v1l) {
            const v3Keys = ["v3l", "v3m", "v3r"];
            let cleaned = false;
            v3Keys.forEach(k => { if (existing[k] !== undefined) { delete existing[k]; cleaned = true; } });
            if (cleaned) { migrated++; logEvent(`Cleaned up v3 rooms from MS${floor} antidemon (9/10 don't have 1-3).`); }
            return;
        }
        if (!existing.left || typeof existing.left !== "object") return;

        const oldRooms = { left: existing.left, mid: existing.mid, right: existing.right };
        const rooms = {};
        const versions = ["1-1", "1-2"];
        const sides = [{ k: "l", n: "LEFT" }, { k: "m", n: "MID" }, { k: "r", n: "RIGHT" }];
        versions.forEach((ver, vi) => {
            sides.forEach(side => {
                const rk = `v${ver.replace("1-", "")}${side.k}`;
                if (vi === 0) {
                    const oldRoom = oldRooms[side.k === "l" ? "left" : side.k === "m" ? "mid" : "right"];
                    if (oldRoom && oldRoom.ownerId) { rooms[rk] = { name: `${ver} ${side.n}`, status: oldRoom.status || STATUS_AVAILABLE, ownerId: oldRoom.ownerId, ownerName: oldRoom.ownerName, time: oldRoom.time || "", timeWindow: oldRoom.timeWindow || "", nextId: oldRoom.nextId || null, nextName: oldRoom.nextName || null, formattedTimeNext: oldRoom.formattedTimeNext || "", endLimit: oldRoom.endLimit || null, password: oldRoom.password || "" }; return; }
                }
                rooms[rk] = { name: `${ver} ${side.n}`, status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null, password: "" };
            });
        });
        db[key] = { type: existing.type || "antidemon", title: existing.title || `Antidemon ${floor}F`, ...rooms };
        migrated++;
        logEvent(`Migrated MS${floor} antidemon from 3-room to 6-room format (v1, v2), preserving v1-1 claims.`);
    });

    ["9", "10"].forEach(floor => {
        const mainKey = `${floor}squareantidemon`;
        const mainPanel = db[mainKey];
        if (!mainPanel) return;

        const oldKey = `${floor}squareantidemon11`;
        const oldPanel = db[oldKey];
        if (oldPanel) {
            const sides = [{ oldSide: "left", k: "l" }, { oldSide: "mid", k: "m" }, { oldSide: "right", k: "r" }];
            sides.forEach(({ oldSide, k }) => {
                const rk = `v2${k}`;
                const oldRoom = oldPanel[oldSide];
                if (oldRoom && oldRoom.ownerId && mainPanel[rk] && !mainPanel[rk].ownerId) {
                    mainPanel[rk] = { name: `1-2 ${oldSide.toUpperCase()}`, status: oldRoom.status || STATUS_AVAILABLE, ownerId: oldRoom.ownerId, ownerName: oldRoom.ownerName, time: oldRoom.time || "", timeWindow: oldRoom.timeWindow || "", nextId: oldRoom.nextId || null, nextName: oldRoom.nextName || null, formattedTimeNext: oldRoom.formattedTimeNext || "", endLimit: oldRoom.endLimit || null, password: oldRoom.password || "" };
                    migrated++;
                    logEvent(`Migrated claim from ${oldKey}.${oldSide} to ${mainKey}.${rk}.`);
                }
            });
            delete db[oldKey];
            delete lastMessages[oldKey];
            if (db._panelMapping) delete db._panelMapping[oldKey];
            logEvent(`Removed old antidemon panel ${oldKey} from DB.`);
        }

        const oldKey12 = `${floor}squareantidemon12`;
        if (db[oldKey12]) { delete db[oldKey12]; delete lastMessages[oldKey12]; if (db._panelMapping) delete db._panelMapping[oldKey12]; logEvent(`Removed stale antidemon panel ${oldKey12} from DB (no 1-3 on floor ${floor}).`); }
    });

    if (migrated > 0) { saveLocalStorage(); logEvent(`MS9/MS10 antidemon migration complete: ${migrated} entries updated.`); }
}

// ── Backfill _lastKilledAt timestamp for existing entries ──
/** Backfill _lastKilledAt millisecond timestamps for existing boss entries. */
export function migrateLastKilledAt() {
    let migrated = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        for (const prop in current) {
            if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;
            const bossData = current[prop];
            if (!bossData || typeof bossData !== "object") continue;
            if (bossData.status && bossData.status.startsWith(STATUS_KILLED) && !bossData._lastKilledAt) {
                const killedTimeStr = bossData.status.replace(STATUS_KILLED_PREFIX, "").trim();
                const killedDate = parseStringToDate(killedTimeStr);
                if (killedDate && !isNaN(killedDate.getTime())) { bossData._lastKilledAt = killedDate.getTime(); migrated++; }
            }
            if (bossData.status === STATUS_AVAILABLE && !bossData._lastKilledAt && bossData._lastKilledTimeStr) {
                const killedDate = parseStringToDate(bossData._lastKilledTimeStr);
                if (killedDate && !isNaN(killedDate.getTime())) { const diffMs = getLocalTime().getTime() - killedDate.getTime(); if (diffMs > 0) { bossData._lastKilledAt = killedDate.getTime(); migrated++; } }
            }
            if (bossData._lastKilledAt && !bossData._lastKilledTimeStr) { bossData._lastKilledTimeStr = getFormattedTime12h(new Date(bossData._lastKilledAt)); migrated++; }
        }
    }
    if (migrated > 0) { saveLocalStorage(); logEvent(`Migrated _lastKilledAt timestamp for ${migrated} existing boss entries.`); }
}
