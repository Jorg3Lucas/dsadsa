import { getLocalTime, getFormattedTime12h } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { db, punishments, punishmentsPath, saveLocalStorage, logEvent } from "./state.js";
import { notifyUserDM } from "./panel-utils.js";
import o from "fs";

// ==========================================
// 🧠 CLAIM / QUEUE / PUNISHMENT LOGIC
// ==========================================

// Returns the user ID as a single-element array (pilot linking removed)
export function getAllLinkedIds(userId) {
    return [userId];
}

export function hasActiveClaim(uid) {
    let linkedIds = getAllLinkedIds(uid);
    for (let linkedUid of linkedIds) {
        for (let key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            if ("antidemon" === db[key].type) {
                if (db[key].left.ownerId === linkedUid || db[key].mid.ownerId === linkedUid || db[key].right.ownerId === linkedUid) return !0;
            } else if (db[key].ownerId === linkedUid) return !0;
        }
    }
    return !1;
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
    try {
        o.writeFileSync(punishmentsPath, JSON.stringify(punishments, null, 2))
    } catch (e) {}
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
    target.status = "🟢 Available";
    target.ownerId = null;
    target.ownerName = null;
    target.time = "";
    target.timeWindow = "";
    if (target.nextId) {
        let nid = target.nextId,
            nname = target.nextName;
        target.nextId = null;
        target.nextName = null;
        target.formattedTimeNext = "";
        target.status = `🟢 Open`;
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

export function buildAntiClaimOptions(targetObj) {
    const opts = [];
    if (targetObj.left.status !== "🔴 Claimed") {
        opts.push({ label: "⬅️ LEFT ROOM", description: getMsg("rooms.antidemonRoomLeft"), value: "left", emoji: "⬅️" });
    }
    if (targetObj.mid.status !== "🔴 Claimed") {
        opts.push({ label: "🔵 MID ROOM", description: getMsg("rooms.antidemonRoomMid"), value: "mid", emoji: "🔵" });
    }
    if (targetObj.right.status !== "🔴 Claimed") {
        opts.push({ label: "➡️ RIGHT ROOM", description: getMsg("rooms.antidemonRoomRight"), value: "right", emoji: "➡️" });
    }
    if (targetObj.left.status !== "🔴 Claimed" && targetObj.mid.status !== "🔴 Claimed") {
        opts.push({ label: "🔵⬅️ MID + LEFT", description: getMsg("rooms.antidemonRoomMidLeft"), value: "mid-left", emoji: "🔵" });
    }
    if (targetObj.mid.status !== "🔴 Claimed" && targetObj.right.status !== "🔴 Claimed") {
        opts.push({ label: "🔵➡️ MID + RIGHT", description: getMsg("rooms.antidemonRoomMidRight"), value: "mid-right", emoji: "🔵" });
    }
    return opts;
}

export function buildAntiQueueOptions(targetObj) {
    const opts = [];
    // Only show queue options for rooms that are currently occupied (claimed)
    if (targetObj.left.status === "🔴 Claimed" && !targetObj.left.nextId) {
        opts.push({ label: "⬅️ LEFT ROOM", description: getMsg("rooms.antidemonQueueLeft"), value: "left", emoji: "⬅️" });
    }
    if (targetObj.mid.status === "🔴 Claimed" && !targetObj.mid.nextId) {
        opts.push({ label: "🔵 MID ROOM", description: getMsg("rooms.antidemonQueueMid"), value: "mid", emoji: "🔵" });
    }
    if (targetObj.right.status === "🔴 Claimed" && !targetObj.right.nextId) {
        opts.push({ label: "➡️ RIGHT ROOM", description: getMsg("rooms.antidemonQueueRight"), value: "right", emoji: "➡️" });
    }
    // MID+LEFT: only if both are claimed, no queue, and same owner
    if (targetObj.left.status === "🔴 Claimed" && targetObj.mid.status === "🔴 Claimed" &&
        !targetObj.left.nextId && !targetObj.mid.nextId &&
        (!targetObj.mid.ownerId || targetObj.mid.ownerId === targetObj.left.ownerId)) {
        opts.push({ label: "🔵⬅️ MID + LEFT", description: getMsg("rooms.antidemonQueueMidLeft"), value: "mid-left", emoji: "🔵" });
    }
    // MID+RIGHT: only if both are claimed, no queue, and same owner
    if (targetObj.mid.status === "🔴 Claimed" && targetObj.right.status === "🔴 Claimed" &&
        !targetObj.mid.nextId && !targetObj.right.nextId &&
        (!targetObj.mid.ownerId || targetObj.mid.ownerId === targetObj.right.ownerId)) {
        opts.push({ label: "🔵➡️ MID + RIGHT", description: getMsg("rooms.antidemonQueueMidRight"), value: "mid-right", emoji: "🔵" });
    }
    return opts;
}
