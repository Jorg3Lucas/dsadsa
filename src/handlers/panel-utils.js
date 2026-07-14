import { db, client, saveLocalStorage, logEvent, lastMessages } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { noop } from "../core/config.js";
import { STATUS_AVAILABLE } from "../core/constants.js";

// Re-export from sub-modules
export { refreshVisualPanel, notifyUserDM } from "./panel-dm.js";
export {
    migrateNamesCleanEmojis,
    migrateBossCooldowns,
    migratePlantOreCooldown,
    migrateSPLegacyToUnified,
    migrateMS1112,
    migrateAntidemon9e10,
    migrateLastKilledAt
} from "./panel-migrations.js";

// ==========================================
// 🏗️ SHARED PANEL STRUCTURE (used by bot.js init + reset)
// ==========================================

/**
 * Build a default panel structure for the given panel key.
 * This is the single source of truth for ALL panel definitions.
 * Used both for initial creation (initClaimSystem) and reset (resetPanelData).
 * @param {string} key - Panel key (e.g. "7peak", "11squareevents", "summon")
 * @returns {object|null} Default panel object, or null if the key is unrecognized
 */
/** Build default panel structure for a given key. Single source of truth for ALL panel definitions. @param {string} key - Panel key @returns {object|null} Default panel object or null if unrecognized */
export function buildPanelDefaults(key) {
    // ── Peak panels: 7peak-10peak (has plant/ore), 11peak-12peak (no plant/ore, red has schedules) ──
    const peakMatch = key.match(/^(\d+)peak$/);
    if (peakMatch) {
        const floor = peakMatch[1];
        const hasPlantOre = floor !== "11" && floor !== "12";
        const sp11or12 = floor === "11" || floor === "12";
        return {
            type: "peak",
            title: `Secret Peak ${floor}F`,
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            left: { name: "⬅️ Left", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            red: { name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "", ...(sp11or12 ? { schedules: [1, 7, 13, 19] } : {}) },
            right: { name: "➡️ Right", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ...(hasPlantOre ? {
                plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
                ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
            } : {})
        };
    }

    // ── Normal MS panels: 7squarenormal-10squarenormal ──
    const normalMatch = key.match(/^(\d+)squarenormal$/);
    if (normalMatch) {
        const floor = normalMatch[1];
        return {
            type: "normal",
            title: `Magic Square ${floor}F`,
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" }
        };
    }

    // ── Antidemon panels ──
    const antiMatch = key.match(/^(\d+)squareantidemon(\d+)?$/);
    if (antiMatch) {
        const floor = antiMatch[1];
        const version = antiMatch[2] || "";
        const title = version ? `Antidemon ${floor}F ${version.slice(0,1)}-${version.slice(1)}` : `Antidemon ${floor}F`;

        const makeRoom = (name) => ({
            name, status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
            time: "", timeWindow: "", nextId: null, nextName: null,
            formattedTimeNext: "", endLimit: null, password: ""
        });

        // Floors 9-12 use expanded format
        if (["9", "10", "11", "12"].includes(floor)) {
            const rooms = {};
            const is9or10 = floor === "9" || floor === "10";
            const versions = is9or10 ? ["1-1", "1-2"] : ["1-1", "1-2", "1-3"];
            const sides = [
                { k: "l", n: "LEFT" },
                { k: "m", n: "MID" },
                { k: "r", n: "RIGHT" }
            ];
            versions.forEach(ver => {
                sides.forEach(side => {
                    const rk = `v${ver.replace("1-", "")}${side.k}`;
                    rooms[rk] = makeRoom(`${ver} ${side.n}`);
                });
            });
            return { type: "antidemon", title, ...rooms };
        }

        // Floors 7-8 use 3-room format
        return {
            type: "antidemon", title,
            left: makeRoom("LEFT ROOM"),
            mid: makeRoom("MID ROOM"),
            right: makeRoom("RIGHT ROOM")
        };
    }

    // ── MS11/12 Leaders (11squareleaders, 12squareleaders) ──
    const leadersMatch = key.match(/^(11|12)squareleaders$/);
    if (leadersMatch) {
        const num = leadersMatch[1];
        return {
            type: "normal",
            title: `Magic Square ${num}F - Leaders`,
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" }
        };
    }

    // ── MS11/12 Events (11squareevents, 12squareevents) ──
    const eventsMatch = key.match(/^(11|12)squareevents$/);
    if (eventsMatch) {
        const num = eventsMatch[1];
        return {
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

    // ── SP12 Random Event ──
    if (key === "12randomevent") {
        return {
            type: "fixed",
            title: "🎲 Random Event (SP12)",
            status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
            timeWindow: "", _claimTimestamp: null,
            schedules: [3, 9, 15, 21],
            scheduleMinutes: 0
        };
    }

    // ── Goblin panels (summon type, single room) ──
    const goblinMap = {
        "11goblin": { roomKey: "sp11", label: "⭐ SP 11F Goblin" },
        "12goblin": { roomKey: "sp12", label: "⭐ SP 12F Goblin" },
        "11msgoblin": { roomKey: "ms11", label: "👹 MS 11 Goblin" },
        "12msgoblin": { roomKey: "ms12", label: "👹 MS 12 Goblin" }
    };
    if (goblinMap[key]) {
        const { roomKey, label } = goblinMap[key];
        return {
            type: "summon",
            title: label,
            [roomKey]: {
                name: label, status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
                time: "", timeWindow: "", nextId: null, nextName: null,
                formattedTimeNext: "", endLimit: null
            }
        };
    }

    // ── Summon panel (SP2, SP4, SP7) ──
    if (key === "summon") {
        const makeSummonRoom = (label) => ({
            name: label, status: STATUS_AVAILABLE, ownerId: null, ownerName: null,
            time: "", timeWindow: "", nextId: null, nextName: null,
            formattedTimeNext: "", endLimit: null
        });
        return {
            type: "summon",
            title: "🌀 Summon Locations",
            sp2: makeSummonRoom("⭐ SP 2F"),
            sp4: makeSummonRoom("⭐ SP 4F"),
            sp7: makeSummonRoom("⭐ SP 7F")
        };
    }

    return null;
}

// ==========================================
// 🔄 RESET PANEL DATA (admin !reset)
// ==========================================

/** Reset a panel to its default state (admin !reset command). @param {string} key - Panel key */
export function resetPanelData(key) {
    const oldMapping = db._panelMapping ? db._panelMapping[key] : null;
    const defaults = buildPanelDefaults(key);
    if (!defaults) return;

    delete db[key];
    db[key] = defaults;

    // Restore panel mapping if existed
    if (oldMapping) {
        if (!db._panelMapping) db._panelMapping = {};
        db._panelMapping[key] = oldMapping;
    }
    logEvent(`Panel ${key} data reset to defaults.`);
}

// ==========================================
// 🔄 AUTO-RECOVERY ON BOOT
// ==========================================

/** Re-send all panels with fresh embeds on bot startup, recovering from stale message references. */
export async function processAutoRecoveryOnBoot() {
    logEvent("Starting automatic panel recovery and chat cleanup...");
    if (!db._panelMapping) db._panelMapping = {};
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const mapping = db._panelMapping[key];
        if (mapping && mapping.channelId && mapping.messageId) {try {
            const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
            if (!channel) continue;
            try {
                const msg = await channel.messages.fetch(mapping.messageId).catch(() => null);
                if (msg) await msg.delete().catch(noop);
            } catch (i) {
        // Silently ignored — non-critical operation
    }
            const newMsg = await channel.send({
                embeds: [renderEmbed(key)],
                components: renderButtons(key)
            }).catch(() => null);
            if (newMsg) {
                lastMessages[key] = newMsg;
                db._panelMapping[key] = {
                    channelId: channel.id,
                    messageId: newMsg.id
                };
            }
        } catch (s) {
            logEvent(`Failed to restore panel ${key}: ${s.message}`);
            console.error(`[Panel Restore Error] ${key}:`, s);
        }}
    }
    saveLocalStorage();
}
