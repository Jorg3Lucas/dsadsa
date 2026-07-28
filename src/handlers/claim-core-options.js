// ==========================================
// 🧠 CLAIM CORE — Option Builders
// Anti-claim and anti-queue option builders
// Extracted from claim-core.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { STATUS_CLAIMED } from "../core/constants.js";
import { getAntidemonRoomKeys, getAntidemonRoomName } from "./claim-core-rooms.js";

export function buildAntiClaimOptions(targetObj, uid, panelKey) {
    const opts = [];
    const roomKeys = getAntidemonRoomKeys(panelKey);
    
    // Check which rooms the user has priority reservation on
    const hasPriority = (room) => targetObj[room] && targetObj[room].nextId === uid && targetObj[room].status !== STATUS_CLAIMED;
    
    // Rooms 7-10: use combo options (left, mid, right, mid-left, mid-right)
    if (roomKeys.length === 3) {
        if (hasPriority("left") && hasPriority("mid")) {
            opts.push({ label: "🔵⬅️ MID + LEFT", description: getMsg("rooms.antidemonRoomMidLeft"), value: "mid-left", emoji: "🔵" });
        } else if (hasPriority("mid") && hasPriority("right")) {
            opts.push({ label: "🔵➡️ MID + RIGHT", description: getMsg("rooms.antidemonRoomMidRight"), value: "mid-right", emoji: "🔵" });
        } else if (hasPriority("left") || hasPriority("mid") || hasPriority("right")) {
            if (hasPriority("left")) opts.push({ label: "⬅️ LEFT ROOM", description: getMsg("rooms.antidemonRoomLeft"), value: "left", emoji: "⬅️" });
            if (hasPriority("mid")) opts.push({ label: "🔵 MID ROOM", description: getMsg("rooms.antidemonRoomMid"), value: "mid", emoji: "🔵" });
            if (hasPriority("right")) opts.push({ label: "➡️ RIGHT ROOM", description: getMsg("rooms.antidemonRoomRight"), value: "right", emoji: "➡️" });
        } else {
            const freeRooms = roomKeys.filter(rm => targetObj[rm].status !== STATUS_CLAIMED && !targetObj[rm].nextId);
            if (freeRooms.includes("left")) opts.push({ label: "⬅️ LEFT ROOM", description: getMsg("rooms.antidemonRoomLeft"), value: "left", emoji: "⬅️" });
            if (freeRooms.includes("mid")) opts.push({ label: "🔵 MID ROOM", description: getMsg("rooms.antidemonRoomMid"), value: "mid", emoji: "🔵" });
            if (freeRooms.includes("right")) opts.push({ label: "➡️ RIGHT ROOM", description: getMsg("rooms.antidemonRoomRight"), value: "right", emoji: "➡️" });
            if (freeRooms.includes("left") && freeRooms.includes("mid")) {
                opts.push({ label: "🔵⬅️ MID + LEFT", description: getMsg("rooms.antidemonRoomMidLeft"), value: "mid-left", emoji: "🔵" });
            }
            if (freeRooms.includes("mid") && freeRooms.includes("right")) {
                opts.push({ label: "🔵➡️ MID + RIGHT", description: getMsg("rooms.antidemonRoomMidRight"), value: "mid-right", emoji: "🔵" });
            }
        }
    } else {
        // Rooms 11-12 (9 rooms): individual + same-version combos
        const available = roomKeys.filter(rm => {
            if (hasPriority(rm)) return true;
            return targetObj[rm] && targetObj[rm].status !== STATUS_CLAIMED && !targetObj[rm].nextId;
        });
        
        // Add individual rooms (always shown)
        available.forEach(rm => {
            const emojiVal = hasPriority(rm) ? "🔵" : "👹";
            opts.push({
                label: getAntidemonRoomName(panelKey, rm),
                value: rm,
                emoji: emojiVal
            });
        });
        
        // Add same-version combos (mid+left, mid+right per version)
        const versions = ["v1", "v2", "v3"];
        for (const ver of versions) {
            const l = `${ver}l`, m = `${ver}m`, r = `${ver}r`;
            // Priority combos
            if (hasPriority(l) && hasPriority(m)) {
                opts.push({ label: `🔵 ${getAntidemonRoomName(panelKey, l)} + ${getAntidemonRoomName(panelKey, m)}`, value: `${l}+${m}`, emoji: "🔵" });
            } else if (hasPriority(m) && hasPriority(r)) {
                opts.push({ label: `🔵 ${getAntidemonRoomName(panelKey, m)} + ${getAntidemonRoomName(panelKey, r)}`, value: `${m}+${r}`, emoji: "🔵" });
            } else {
                // Free combos
                if (available.includes(l) && available.includes(m)) {
                    opts.push({ label: `${getAntidemonRoomName(panelKey, l)} + ${getAntidemonRoomName(panelKey, m)}`, value: `${l}+${m}`, emoji: "👹" });
                }
                if (available.includes(m) && available.includes(r)) {
                    opts.push({ label: `${getAntidemonRoomName(panelKey, m)} + ${getAntidemonRoomName(panelKey, r)}`, value: `${m}+${r}`, emoji: "👹" });
                }
            }
        }
    }
    return opts;
}

export function buildAntiQueueOptions(targetObj, panelKey) {
    const opts = [];
    const roomKeys = getAntidemonRoomKeys(panelKey);
    
    if (roomKeys.length === 3) {
        if (targetObj.left.status === STATUS_CLAIMED && !targetObj.left.nextId) {
            opts.push({ label: "⬅️ LEFT ROOM", description: getMsg("rooms.antidemonQueueLeft"), value: "left", emoji: "⬅️" });
        }
        if (targetObj.mid.status === STATUS_CLAIMED && !targetObj.mid.nextId) {
            opts.push({ label: "🔵 MID ROOM", description: getMsg("rooms.antidemonQueueMid"), value: "mid", emoji: "🔵" });
        }
        if (targetObj.right.status === STATUS_CLAIMED && !targetObj.right.nextId) {
            opts.push({ label: "➡️ RIGHT ROOM", description: getMsg("rooms.antidemonQueueRight"), value: "right", emoji: "➡️" });
        }
        if (targetObj.left.status === STATUS_CLAIMED && targetObj.mid.status === STATUS_CLAIMED &&
            !targetObj.left.nextId && !targetObj.mid.nextId &&
            (!targetObj.mid.ownerId || targetObj.mid.ownerId === targetObj.left.ownerId)) {
            opts.push({ label: "🔵⬅️ MID + LEFT", description: getMsg("rooms.antidemonQueueMidLeft"), value: "mid-left", emoji: "🔵" });
        }
        if (targetObj.mid.status === STATUS_CLAIMED && targetObj.right.status === STATUS_CLAIMED &&
            !targetObj.mid.nextId && !targetObj.right.nextId &&
            (!targetObj.mid.ownerId || targetObj.mid.ownerId === targetObj.right.ownerId)) {
            opts.push({ label: "🔵➡️ MID + RIGHT", description: getMsg("rooms.antidemonQueueMidRight"), value: "mid-right", emoji: "🔵" });
        }
    } else {
        // Rooms 11-12: individual + same-version combo queue options
        const versions = ["v1", "v2", "v3"];
        for (const ver of versions) {
            const l = `${ver}l`, m = `${ver}m`, r = `${ver}r`;
            
            // Individual rooms (always shown if claimed and no queue)
            if (targetObj[l] && targetObj[l].status === STATUS_CLAIMED && !targetObj[l].nextId) {
                opts.push({ label: getAntidemonRoomName(panelKey, l), value: l, emoji: "👹" });
            }
            if (targetObj[m] && targetObj[m].status === STATUS_CLAIMED && !targetObj[m].nextId) {
                opts.push({ label: getAntidemonRoomName(panelKey, m), value: m, emoji: "👹" });
            }
            if (targetObj[r] && targetObj[r].status === STATUS_CLAIMED && !targetObj[r].nextId) {
                opts.push({ label: getAntidemonRoomName(panelKey, r), value: r, emoji: "👹" });
            }
            
            // Combos (only if same owner)
            if (targetObj[l] && targetObj[l].status === STATUS_CLAIMED && !targetObj[l].nextId &&
                targetObj[m] && targetObj[m].status === STATUS_CLAIMED && !targetObj[m].nextId &&
                (!targetObj[m].ownerId || targetObj[m].ownerId === targetObj[l].ownerId)) {
                opts.push({ label: `${getAntidemonRoomName(panelKey, l)} + ${getAntidemonRoomName(panelKey, m)}`, value: `${l}+${m}`, emoji: "👹" });
            }
            if (targetObj[m] && targetObj[m].status === STATUS_CLAIMED && !targetObj[m].nextId &&
                targetObj[r] && targetObj[r].status === STATUS_CLAIMED && !targetObj[r].nextId &&
                (!targetObj[m].ownerId || targetObj[m].ownerId === targetObj[r].ownerId)) {
                opts.push({ label: `${getAntidemonRoomName(panelKey, m)} + ${getAntidemonRoomName(panelKey, r)}`, value: `${m}+${r}`, emoji: "👹" });
            }
        }
    }
    return opts;
}
