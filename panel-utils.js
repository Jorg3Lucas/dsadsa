import { EmbedBuilder as e } from "discord.js";
import { getLocalTime, getFormattedTime12h } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { db, client, saveLocalStorage, logEvent, lastMessages } from "./state.js";
import { renderEmbed, renderButtons, getEmbedColor } from "./panel-render.js";

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
        isAnti = key.match(/^(\d+)squareantidemon$/),
        is11or12 = key.match(/^(11|12)square(leaders|fury|frenzy)$/);
    
    if (isPeak) {
        let floor = isPeak[1];
        db[key] = {
            type: "peak",            title: `Secret Peak ${floor}F`, timeWindow: "", next: null, ownerId: null, ownerName: null,
            left: { name: "⬅️ Left", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            red: { name: "🟥 Red", status: "🟢 Available", cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            right: { name: "➡️ Right", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
        };
    } else if (isNormal) {
        let floor = isNormal[1];
        db[key] = {
            type: "normal",            title: `Magic Square ${floor}F`, timeWindow: "", next: null, ownerId: null, ownerName: null,
            boss1: { name: "1️⃣ Leader 1", status: "🟢 Available", cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            boss2: { name: "2️⃣ Leader 2", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            boss3: { name: "3️⃣ Leader 3", status: "🟢 Available", cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
        };
    } else if (isAnti) {
        let floor = isAnti[1];
        db[key] = {
            type: "antidemon",            title: `Antidemon ${floor}F`,
            left: { name: "LEFT ROOM", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            mid: { name: "MID ROOM", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
            right: { name: "RIGHT ROOM", status: "🟢 Available", ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null }
        };
    } else if (is11or12) {
        let num = is11or12[1], type = is11or12[2];
        let isFury = "fury" === type, isFrenzy = "frenzy" === type;
        db[key] = {
            type: isFury || isFrenzy ? "fixed" : "normal",
            title: `11` === num ? `Magic Square 11F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}` : `Magic Square 12F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}`,
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            ...isFury || isFrenzy ? { schedules: isFury ? [5, 11, 17, 23] : [2, 8, 14, 20] } : {
                boss1: { name: "1️⃣ Leader 1", status: "🟢 Available", cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
                boss2: { name: "2️⃣ Leader 2", status: "🟢 Available", cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
                boss3: { name: "3️⃣ Leader 3", status: "🟢 Available", cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" }
            }
        };
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
