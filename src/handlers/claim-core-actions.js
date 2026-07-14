// ==========================================
// 🧠 CLAIM CORE — Actions
// Free floor, free antidemon room, remove from queue
// Extracted from claim-core.js
// ==========================================

import { getLocalTime, getFormattedTime12h } from "../core/time-utils.js";
import { saveLocalStorage, logEvent } from "../core/state.js";
import { notifyUserDM } from "./panel-utils.js";
import { getMsg } from "../core/lang.js";
import { STATUS_AVAILABLE, STATUS_OPEN } from "../core/constants.js";

export function removeUserFromQueue(floorObj, uid) {
    if (!floorObj.next) return false;
    if (floorObj.next.userId === uid) {
        return floorObj.next = floorObj.next.nextQueue || null, true;
    }
    let curr = floorObj.next;
    for (; curr.nextQueue;) {
        if (curr.nextQueue.userId === uid) return curr.nextQueue = curr.nextQueue.nextQueue, true;
        curr = curr.nextQueue;
    }
    return false;
}

export function freeFloorAndActivateNextGracePeriod(floorObj) {
    logEvent(`${floorObj.title} completely released/closed.`);
    floorObj.ownerId = null;
    floorObj.ownerName = null;
    floorObj.timeWindow = "";
    if (floorObj._claimTimestamp) delete floorObj._claimTimestamp;

    if (floorObj.next) {
        const grace = new Date(getLocalTime().getTime() + 3e5);
        floorObj.next.endLimit = getFormattedTime12h(grace);
        notifyUserDM(floorObj.next.userId, getMsg("rooms.floorTurnArrivedDM", {
            title: floorObj.title
        }));
    }
    saveLocalStorage();
}

export function freeAntidemonRoom(floorObj, roomKey) {
    const target = floorObj[roomKey];
    target.status = STATUS_AVAILABLE;
    target.ownerId = null;
    target.ownerName = null;
    target.time = "";
    target.timeWindow = "";
    target.password = "";
    if (target.nextId) {
        const nid = target.nextId,
            nname = target.nextName;
        target.nextId = null;
        target.nextName = null;
        target.formattedTimeNext = "";
        target.status = STATUS_OPEN;
        target.nextId = nid;
        target.nextName = nname;
        const grace = new Date(getLocalTime().getTime() + 3e5);
        target.endLimit = getFormattedTime12h(grace);
        // Use display name from room data if available, fall back to uppercase key
        const displayName = target.name || roomKey.toUpperCase();
        // Choose correct template based on panel type
        const turnTemplate = floorObj.type === "summon"
            ? "rooms.summonTurnArrivedDM"
            : "rooms.antidemonTurnArrivedDM";
        notifyUserDM(nid, getMsg(turnTemplate, {
            roomKey: displayName,
            title: floorObj.title
        }));
    } else {
        target.endLimit = null;
    }
    saveLocalStorage();
}
