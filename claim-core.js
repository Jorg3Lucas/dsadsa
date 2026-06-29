import { getLocalTime, getFormattedTime12h, parseStringToDate } from "./time-utils.js";
import { db, rankingDb, punishments, saveLocalStorage, savePunishmentsToDisk, logEvent } from "./state.js";
import { notifyUserDM } from "./panel-utils.js";
import { getMsg } from "./lang.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN } from "./constants.js";

// ==========================================
// 🧠 CLAIM / QUEUE / PUNISHMENT LOGIC
// ==========================================

// Returns all Discord user IDs linked to the same in-game account (owner + all pilots)
export function getAllLinkedIds(userId) {
    let linkedIds = new Set([userId]);
    let usersData = rankingDb && rankingDb.users ? rankingDb.users : null;
    // If user has pilots, add them
    if (usersData && usersData[userId] && usersData[userId].pilotIds) {
        usersData[userId].pilotIds.forEach(id => linkedIds.add(id));
    }
    // If user is a pilot of someone, add owner and their other pilots
    if (usersData) {
        for (let uid in usersData) {
            if (usersData[uid].pilotIds && usersData[uid].pilotIds.includes(userId)) {
                linkedIds.add(uid);
                usersData[uid].pilotIds.forEach(id => linkedIds.add(id));
            }
        }
    }
    return [...linkedIds];
}

export function hasActiveClaim(uid) {
    return getActiveClaimInfo(uid).length > 0;
}

const SUMMON_PROPS_INTERNAL = ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"];

/**
 * Returns a human-readable remaining time string from a "HH:MM ~ HH:MM" timeWindow.
 * Returns empty string if unavailable or already expired.
 */
function getTimeRemainingStr(timeWindow) {
    if (!timeWindow) return "";
    let endTime = parseStringToDate(timeWindow.split(" ~ ")[1]);
    if (!endTime) return "";
    let diffMs = endTime.getTime() - getLocalTime().getTime();
    if (diffMs <= 0) return "⌛ Expired";
    let mins = Math.floor(diffMs / 6e4);
    let secs = Math.floor((diffMs % 6e4) / 1e3);
    if (mins >= 60) {
        let hrs = Math.floor(mins / 60);
        mins = mins % 60;
        return `⏱️ ${hrs}h ${mins}m`;
    }
    return `⏱️ ${mins}m ${secs}s`;
}

export function getActiveClaimInfo(uid) {
    let linkedIds = getAllLinkedIds(uid);
    let claims = [];
    for (let linkedUid of linkedIds) {
        for (let key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            let current = db[key];
            if ("antidemon" === current.type) {
                ["left", "mid", "right"].forEach(rm => {
                    if (current[rm].ownerId === linkedUid) {
                        let remaining = getTimeRemainingStr(current[rm].timeWindow);
                        claims.push({ title: `${current.title} - Room ${rm.toUpperCase()}`, type: "antidemon", room: rm, remaining });
                    }
                });
            } else if ("summon" === current.type) {
                SUMMON_PROPS_INTERNAL.forEach(loc => {
                    if (current[loc] && current[loc].ownerId === linkedUid) {
                        let remaining = getTimeRemainingStr(current[loc].timeWindow);
                        claims.push({ title: `${current.title} - ${current[loc].name}`, type: "summon", loc, remaining });
                    }
                });
            } else {
                if (current.ownerId === linkedUid) {
                    let remaining = getTimeRemainingStr(current.timeWindow);
                    claims.push({ title: current.title, type: current.type, remaining });
                }
            }
        }
    }
    return claims;
}

export function buildActiveClaimMessage(uid) {
    let claims = getActiveClaimInfo(uid);
    if (claims.length === 0) return null;
    let claimList = claims.map(c => {
        let line = `• ${c.title}`;
        if (c.remaining) line += ` — ${c.remaining}`;
        return line;
    }).join("\n");
    return `🚫 You already have an active claim at:\n${claimList}\n\nUse the 🚪 Leave button on the respective panel to cancel.`;
}

export function hasActiveQueue(uid) {
    let linkedIds = getAllLinkedIds(uid);
    for (let linkedUid of linkedIds) {
        for (let key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            let current = db[key];
            if ("antidemon" === current.type) {
                if (current.left.nextId === linkedUid || current.mid.nextId === linkedUid || current.right.nextId === linkedUid) return !0;
            } else {
                let pointer = current.next;
                while (pointer) {
                    if (pointer.userId === linkedUid) return !0;
                    pointer = pointer.nextQueue;
                }
            }
        }
    }
    return !1;
}

export function checkPunishment(uid) {
    if (punishments[uid]) {
        let rem = punishments[uid] - Date.now();
        if (rem > 0) return getMsg("cooldowns.activeTimeout", {
            minutes: Math.floor(rem / 6e4),
            seconds: Math.floor(rem % 6e4 / 1e3)
        });
        delete punishments[uid];
        saveLocalStorage();
    }
    return null;
}

export function applyFiveMinCooldown(uid) {
    punishments[uid] = Date.now() + 3e5;
    savePunishmentsToDisk();
}

export function removeUserFromQueue(floorObj, uid) {
    if (!floorObj.next) return !1;
    if (floorObj.next.userId === uid) {
        return floorObj.next = floorObj.next.nextQueue || null, !0;
    }
    let curr = floorObj.next;
    for (; curr.nextQueue;) {
        if (curr.nextQueue.userId === uid) return curr.nextQueue = curr.nextQueue.nextQueue, !0;
        curr = curr.nextQueue;
    }
    return !1;
}

export function freeFloorAndActivateNextGracePeriod(floorObj) {
    logEvent(`${floorObj.title} completely released/closed.`);
    floorObj.ownerId = null;
    floorObj.ownerName = null;
    floorObj.timeWindow = "";
    if (floorObj._claimTimestamp) delete floorObj._claimTimestamp;

    if (floorObj.next) {
        let grace = new Date(getLocalTime().getTime() + 3e5);
        floorObj.next.endLimit = getFormattedTime12h(grace);
        notifyUserDM(floorObj.next.userId, getMsg("rooms.floorTurnArrivedDM", {
            title: floorObj.title
        }));
    }
    saveLocalStorage();
}

export function freeAntidemonRoom(floorObj, roomKey) {
    let target = floorObj[roomKey];
    target.status = STATUS_AVAILABLE;
    target.ownerId = null;
    target.ownerName = null;
    target.time = "";
    target.timeWindow = "";
    target.password = "";
    if (target.nextId) {
        let nid = target.nextId,
            nname = target.nextName;
        target.nextId = null;
        target.nextName = null;
        target.formattedTimeNext = "";
        target.status = STATUS_OPEN;
        target.nextId = nid;
        target.nextName = nname;
        let grace = new Date(getLocalTime().getTime() + 3e5);
        target.endLimit = getFormattedTime12h(grace);
        notifyUserDM(nid, getMsg("rooms.antidemonTurnArrivedDM", {
            roomKey: roomKey.toUpperCase(),
            title: floorObj.title
        }));
    } else {
        target.endLimit = null;
    }
    saveLocalStorage();
}

export function buildAntiClaimOptions(targetObj, uid) {
    const opts = [];
    
    // Check which rooms the user has priority reservation on
    const hasPriority = (room) => targetObj[room].nextId === uid && targetObj[room].status !== STATUS_CLAIMED;
    
    if (hasPriority("left") && hasPriority("mid")) {
        // User was in queue for MID + LEFT (double room)
        opts.push({ label: "🔵⬅️ MID + LEFT", description: getMsg("rooms.antidemonRoomMidLeft"), value: "mid-left", emoji: "🔵" });
    } else if (hasPriority("mid") && hasPriority("right")) {
        // User was in queue for MID + RIGHT (double room)
        opts.push({ label: "🔵➡️ MID + RIGHT", description: getMsg("rooms.antidemonRoomMidRight"), value: "mid-right", emoji: "🔵" });
    } else if (hasPriority("left") || hasPriority("mid") || hasPriority("right")) {
        // User was in queue for a single room
        if (hasPriority("left")) opts.push({ label: "⬅️ LEFT ROOM", description: getMsg("rooms.antidemonRoomLeft"), value: "left", emoji: "⬅️" });
        if (hasPriority("mid")) opts.push({ label: "🔵 MID ROOM", description: getMsg("rooms.antidemonRoomMid"), value: "mid", emoji: "🔵" });
        if (hasPriority("right")) opts.push({ label: "➡️ RIGHT ROOM", description: getMsg("rooms.antidemonRoomRight"), value: "right", emoji: "➡️" });
    } else {
        // No priority — show all freely available rooms
        const freeRooms = ["left", "mid", "right"].filter(rm => targetObj[rm].status !== STATUS_CLAIMED && !targetObj[rm].nextId);
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
    return opts;
}

export function buildAntiQueueOptions(targetObj) {
    const opts = [];
    // Only show queue options for rooms that are currently occupied (claimed)
    if (targetObj.left.status === STATUS_CLAIMED && !targetObj.left.nextId) {
        opts.push({ label: "⬅️ LEFT ROOM", description: getMsg("rooms.antidemonQueueLeft"), value: "left", emoji: "⬅️" });
    }
    if (targetObj.mid.status === STATUS_CLAIMED && !targetObj.mid.nextId) {
        opts.push({ label: "🔵 MID ROOM", description: getMsg("rooms.antidemonQueueMid"), value: "mid", emoji: "🔵" });
    }
    if (targetObj.right.status === STATUS_CLAIMED && !targetObj.right.nextId) {
        opts.push({ label: "➡️ RIGHT ROOM", description: getMsg("rooms.antidemonQueueRight"), value: "right", emoji: "➡️" });
    }
    // MID+LEFT: only if both are claimed, no queue, and same owner
    if (targetObj.left.status === STATUS_CLAIMED && targetObj.mid.status === STATUS_CLAIMED &&
        !targetObj.left.nextId && !targetObj.mid.nextId &&
        (!targetObj.mid.ownerId || targetObj.mid.ownerId === targetObj.left.ownerId)) {
        opts.push({ label: "🔵⬅️ MID + LEFT", description: getMsg("rooms.antidemonQueueMidLeft"), value: "mid-left", emoji: "🔵" });
    }
    // MID+RIGHT: only if both are claimed, no queue, and same owner
    if (targetObj.mid.status === STATUS_CLAIMED && targetObj.right.status === STATUS_CLAIMED &&
        !targetObj.mid.nextId && !targetObj.right.nextId &&
        (!targetObj.mid.ownerId || targetObj.mid.ownerId === targetObj.right.ownerId)) {
        opts.push({ label: "🔵➡️ MID + RIGHT", description: getMsg("rooms.antidemonQueueMidRight"), value: "mid-right", emoji: "🔵" });
    }
    return opts;
}
