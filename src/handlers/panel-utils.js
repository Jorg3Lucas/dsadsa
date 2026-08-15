import { db, client, saveLocalStorage, logEvent, lastMessages } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { STATUS_AVAILABLE } from "../core/constants.js";
import { logger } from "../core/logger.js";
import { clearChannelCompletely } from "../core/channel-cleanup.js";

// Re-export from sub-modules
export { refreshVisualPanel, notifyUserDM } from "./panel-dm.js";
export {
    migrateNamesCleanEmojis,
    migrateBossCooldowns,
    migratePlantOreCooldown,
    removeMS1112Panels,
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
 * @param {string} key - Panel key (e.g. "7peak", "7squarenormal", "summon")
 * @returns {object|null} Default panel object, or null if the key is unrecognized
 */
/** Build default panel structure for a given key. Single source of truth for ALL panel definitions. @param {string} key - Panel key @returns {object|null} Default panel object or null if unrecognized */
export function buildPanelDefaults(key) {
    // ── Peak panels (7peak-10peak, with plant/ore) ──
    const peakMatch = key.match(/^(\d+)peak$/);
    if (peakMatch) {
        const floor = peakMatch[1];
        return {
            type: "peak",
            title: `Secret Peak ${floor}F`,
            timeWindow: "", next: null, ownerId: null, ownerName: null,
            left: { name: "⬅️ Left", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            red: { name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
            right: { name: "➡️ Right", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" }
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

        // Floors 9-10 use expanded format (versions 1-1, 1-2)
        if (["9", "10"].includes(floor)) {
            const rooms = {};
            const versions = ["1-1", "1-2"];
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

/**
 * Re-send all panels with fresh embeds on bot startup, recovering from stale
 * message references. Before posting, each channel that previously held panels
 * is COMPLETELY cleared (all messages deleted), so no stale panels, duplicates
 * or leftover chatter remain.
 */
export async function processAutoRecoveryOnBoot() {
    logEvent("Starting automatic panel recovery and chat cleanup...");
    if (!db._panelMapping) db._panelMapping = {};

    // ── 1. Collect every channel that currently holds panels ──
    const channelIds = new Set();
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const mapping = db._panelMapping[key];
        if (mapping && mapping.channelId) channelIds.add(mapping.channelId);
    }

    // ── 2. Completely clear each of those channels before re-posting ──
    for (const channelId of channelIds) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) continue;
        await clearChannelCompletely(channel, logEvent);
    }

    // ── 3. Post fresh panels and register them for the tick refresh ──
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const mapping = db._panelMapping[key];
        if (mapping && mapping.channelId && mapping.messageId) {
            try {
                const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
                if (!channel) continue;
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
                logger.error('Panel', `Failed to restore panel ${key}`, s);
                logEvent(`Failed to restore panel ${key}: ${s.message}`);
            }
        }
    }
    saveLocalStorage();
}
