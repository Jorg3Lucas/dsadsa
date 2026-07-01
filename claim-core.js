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

const SUMMON_PROPS_INTERNAL = ["sp2", "sp4", "sp7"];

// Returns sub-event keys for an event_group panel (excludes system properties)
export function getEventGroupKeys(current) {
    if (!current || "event_group" !== current.type) return [];
    const sysProps = ["type", "title"];
    return Object.keys(current).filter(k => !sysProps.includes(k));
}

// Returns room keys for a summon panel based on its key
export function getSummonRoomKeys(panelKey) {
    // Individual goblin panels (each has its own single room)
    if (panelKey === "11goblin") return ["sp11"];
    if (panelKey === "12goblin") return ["sp12"];
    if (panelKey === "11msgoblin") return ["ms11"];
    if (panelKey === "12msgoblin") return ["ms12"];
    // Combined summon panel uses the default rooms
    return SUMMON_PROPS_INTERNAL;
}

// Rooms for expanded antidemon panels (MS11 and MS12: 1-1, 1-2, 1-3 each with LEFT/MID/RIGHT)
const ANTIDEMON_11_12_ROOMS = [
    { key: "v1l", name: "1-1 LEFT" }, { key: "v1m", name: "1-1 MID" }, { key: "v1r", name: "1-1 RIGHT" },
    { key: "v2l", name: "1-2 LEFT" }, { key: "v2m", name: "1-2 MID" }, { key: "v2r", name: "1-2 RIGHT" },
    { key: "v3l", name: "1-3 LEFT" }, { key: "v3m", name: "1-3 MID" }, { key: "v3r", name: "1-3 RIGHT" }
];
const ANTIDEMON_11_12_KEYS = ANTIDEMON_11_12_ROOMS.map(r => r.key);

// Returns room key array for an antidemon panel based on its key
export function getAntidemonRoomKeys(panelKey) {
    const floor = panelKey?.match(/^(\d+)/)?.[1];
    if (floor === "11" || floor === "12") return ANTIDEMON_11_12_KEYS;
    return ["left", "mid", "right"];
}

// Returns the display name for a room key in a given panel
export function getAntidemonRoomName(panelKey, roomKey) {
    if (roomKey === "left") return "LEFT ROOM";
    if (roomKey === "mid") return "MID ROOM";
    if (roomKey === "right") return "RIGHT ROOM";
    const found = ANTIDEMON_11_12_ROOMS.find(r => r.key === roomKey);
    return found ? found.name : roomKey.toUpperCase();
}

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
            if ("event_group" === current.type) {
                getEventGroupKeys(current).forEach(ev => {
                    if (current[ev] && current[ev].ownerId === linkedUid) {
                        let remaining = getTimeRemainingStr(current[ev].timeWindow);
                        claims.push({ title: `${current.title} - ${current[ev].name}`, type: "event_group", event: ev, remaining });
                    }
                });
            } else if ("antidemon" === current.type) {
                getAntidemonRoomKeys(key).forEach(rm => {
                    if (current[rm] && current[rm].ownerId === linkedUid) {
                        let remaining = getTimeRemainingStr(current[rm].timeWindow);
                        claims.push({ title: `${current.title} - ${getAntidemonRoomName(key, rm)}`, type: "antidemon", room: rm, remaining });
                    }
                });
            } else if ("summon" === current.type) {
                const summonProps = getSummonRoomKeys(key);
                summonProps.forEach(loc => {
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
            if ("event_group" === current.type) {
                if (getEventGroupKeys(current).some(ev => current[ev] && current[ev].nextId === linkedUid)) return !0;
            } else if ("antidemon" === current.type) {
                const roomKeys = getAntidemonRoomKeys(key);
                if (roomKeys.some(rm => current[rm] && current[rm].nextId === linkedUid)) return !0;
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
    let linkedIds = getAllLinkedIds(uid);
    for (let linkedUid of linkedIds) {
        if (punishments[linkedUid]) {
            let rem = punishments[linkedUid] - Date.now();
            if (rem > 0) return getMsg("cooldowns.activeTimeout", {
                minutes: Math.floor(rem / 6e4),
                seconds: Math.floor(rem % 6e4 / 1e3)
            });
            delete punishments[linkedUid];
            saveLocalStorage();
        }
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
