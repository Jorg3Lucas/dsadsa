// ==========================================
// 🧠 CLAIM CORE — Utilities
// Linked IDs, active claims, queues, punishments
// Extracted from claim-core.js
// ==========================================

import { getLocalTime, parseStringToDate } from "../core/time-utils.js";
import { db, rankingDb, punishments, saveLocalStorage, savePunishmentsToDisk } from "../core/state.js";
import { getMsg } from "../core/lang.js";
import { getEventGroupKeys, getAntidemonRoomKeys, getSummonRoomKeys, getAntidemonRoomName } from "./claim-core-rooms.js";

// Returns all Discord user IDs linked to the same in-game account (owner + all pilots)
export function getAllLinkedIds(userId) {
    const linkedIds = new Set([userId]);
    const usersData = rankingDb && rankingDb.users ? rankingDb.users : null;
    // If user has pilots, add them
    if (usersData && usersData[userId] && usersData[userId].pilotIds) {
        usersData[userId].pilotIds.forEach(id => linkedIds.add(id));
    }
    // If user is a pilot of someone, add owner and their other pilots
    if (usersData) {
        for (const uid in usersData) {
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

/**
 * Returns a human-readable remaining time string from a "HH:MM ~ HH:MM" timeWindow.
 * Returns empty string if unavailable or already expired.
 */
function getTimeRemainingStr(timeWindow) {
    if (!timeWindow) return "";
    const endTime = parseStringToDate(timeWindow.split(" ~ ")[1]);
    if (!endTime) return "";
    const diffMs = endTime.getTime() - getLocalTime().getTime();
    if (diffMs <= 0) return "⌛ Expired";
    let mins = Math.floor(diffMs / 6e4);
    const secs = Math.floor((diffMs % 6e4) / 1e3);
    if (mins >= 60) {
        const hrs = Math.floor(mins / 60);
        mins = mins % 60;
        return `⏱️ ${hrs}h ${mins}m`;
    }
    return `⏱️ ${mins}m ${secs}s`;
}

export function getActiveClaimInfo(uid) {
    const linkedIds = getAllLinkedIds(uid);
    const claims = [];
    for (const linkedUid of linkedIds) {
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            const current = db[key];
            if ("event_group" === current.type) {
                getEventGroupKeys(current).forEach(ev => {
                    if (current[ev] && current[ev].ownerId === linkedUid) {
                        const remaining = getTimeRemainingStr(current[ev].timeWindow);
                        claims.push({ title: `${current.title} - ${current[ev].name}`, type: "event_group", event: ev, remaining });
                    }
                });
            } else if ("antidemon" === current.type) {
                getAntidemonRoomKeys(key).forEach(rm => {
                    if (current[rm] && current[rm].ownerId === linkedUid) {
                        const remaining = getTimeRemainingStr(current[rm].timeWindow);
                        claims.push({ title: `${current.title} - ${getAntidemonRoomName(key, rm)}`, type: "antidemon", room: rm, remaining });
                    }
                });
            } else if ("summon" === current.type) {
                getSummonRoomKeys(key).forEach(loc => {
                    if (current[loc] && current[loc].ownerId === linkedUid) {
                        const remaining = getTimeRemainingStr(current[loc].timeWindow);
                        claims.push({ title: `${current.title} - ${current[loc].name}`, type: "summon", loc, remaining });
                    }
                });
            } else {
                if (current.ownerId === linkedUid) {
                    const remaining = getTimeRemainingStr(current.timeWindow);
                    claims.push({ title: current.title, type: current.type, remaining });
                }
            }
        }
    }
    return claims;
}

export function buildActiveClaimMessage(uid) {
    const claims = getActiveClaimInfo(uid);
    if (claims.length === 0) return null;
    const claimList = claims.map(c => {
        let line = `• ${c.title}`;
        if (c.remaining) line += ` — ${c.remaining}`;
        return line;
    }).join("\n");
    return `🚫 You already have an active claim at:\n${claimList}\n\nUse the 🚪 Leave button on the respective panel to cancel.`;
}

export function hasActiveQueue(uid) {
    const linkedIds = getAllLinkedIds(uid);
    for (const linkedUid of linkedIds) {
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            const current = db[key];
            if ("event_group" === current.type) {
                if (getEventGroupKeys(current).some(ev => current[ev] && current[ev].nextId === linkedUid)) return true;
            } else if ("antidemon" === current.type) {
                const roomKeys = getAntidemonRoomKeys(key);
                if (roomKeys.some(rm => current[rm] && current[rm].nextId === linkedUid)) return true;
            } else {
                let pointer = current.next;
                while (pointer) {
                    if (pointer.userId === linkedUid) return true;
                    pointer = pointer.nextQueue;
                }
            }
        }
    }
    return false;
}

export function checkPunishment(uid) {
    const linkedIds = getAllLinkedIds(uid);
    for (const linkedUid of linkedIds) {
        if (punishments[linkedUid]) {
            const rem = punishments[linkedUid] - Date.now();
            if (rem > 0) {return getMsg("cooldowns.activeTimeout", {
                minutes: Math.floor(rem / 6e4),
                seconds: Math.floor(rem % 6e4 / 1e3)
            });}
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
