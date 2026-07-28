// ==========================================
// 🎨 EMBED — Core: Embed Color & Utilities
// Extracted from render-embed.js
// ==========================================

import { isRoomOpen } from "../core/time-utils.js";
import { COLOR_OCCUPIED, COLOR_HAS_QUEUE, COLOR_OPEN, COLOR_DEFAULT } from "../core/constants.js";
import { getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";

/** Determine the embed color based on panel state (occupied, queued, open). @param {object|null} current @param {string} key @returns {number} */
export function getEmbedColor(current, key) {
    if (!current) return COLOR_DEFAULT;
    if (current.ownerId) return COLOR_OCCUPIED;
    if (current.next) return COLOR_HAS_QUEUE;
    if ("event_group" === current.type) {
        const events = getEventGroupKeys(current);
        const anyClaimed = events.some(e => current[e] && current[e].ownerId);
        if (anyClaimed) return COLOR_OCCUPIED;
        const anyQueued = events.some(e => current[e] && current[e].nextId);
        if (anyQueued) return COLOR_HAS_QUEUE;
    }
    if ("antidemon" === current.type || "summon" === current.type) {
        const props = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
        const hasClaimed = props.some(p => current[p] && current[p].status.startsWith("🔴"));
        if (hasClaimed) return COLOR_OCCUPIED;
        const hasQueue = props.some(p => current[p] && current[p].nextId);
        if (hasQueue) return COLOR_HAS_QUEUE;
    }
    if ("fixed" === current.type) {
        return isRoomOpen(current.schedules, current.scheduleMinutes || 0) ? COLOR_OPEN : COLOR_DEFAULT;
    }
    return COLOR_DEFAULT;
}
