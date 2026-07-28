import { isRoomOpen, parseStringToDate, getFormattedTime12h, calculateNextOpening } from "../core/time-utils.js";
import { getMsg } from "../core/lang.js";
import { notifyUserDM } from "./panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import { getEventGroupKeys } from "./claim-core.js";
import { STATUS_AVAILABLE, STATUS_KILLED } from "../core/constants.js";
import { noop } from "../core/config.js";

// ==========================================
// ⏱️ EVENT GROUP — Schedule / Fixed / Summon handlers
// ==========================================

/** Handle event_group panel tick: schedule auto-respawn, fixed auto-release, summon timeouts. @param {object} current @param {string} key @param {Date} now @returns {Promise<boolean>} Whether state was updated */
export async function handleEventGroup(current, key, now) {
    let updateNeeded = false;

    if ("event_group" !== current.type) return updateNeeded;

    const egEvents = getEventGroupKeys(current);
    for (const ev of egEvents) {
        const evData = current[ev];
        if (!evData) continue;

        // ── Schedule-type events (Red Boss) auto-respawn ──
        if (evData.type === "schedule" && evData.schedules) {
            if (isRoomOpen(evData.schedules)) {
                if (evData.status && evData.status.startsWith(STATUS_KILLED) && now.getMinutes() === 0) {
                    evData.status = STATUS_AVAILABLE;
                    updateNeeded = true;
                    if (evData.ownerId) {
                        await notifyUserDM(evData.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                            title: current.title,
                            boss: evData.name
                        })).catch(noop);
                    }
                }
            }
        }

        // ── Fixed-type events (Fury/Frenzy/Random Event) auto-release ──
        if (evData.type === "fixed" && evData.schedules) {
            const minuteOffset = evData.scheduleMinutes || 0;
            if (isRoomOpen(evData.schedules, minuteOffset)) {
                if ("" === evData.timeWindow) updateNeeded = true;
            } else {
                const nextOpen = calculateNextOpening(evData.schedules, minuteOffset);
                const fiveMinBefore = new Date(nextOpen.getTime() - 5 * 60 * 1000);
                const insidePreWindow = now >= fiveMinBefore && now < nextOpen;
                if (!insidePreWindow && ("" !== evData.timeWindow || evData.ownerId)) {
                    if (evData.ownerName) pushToDailyLogs("CLAIM_END", evData.ownerName, `${current.title} - ${evData.name}`, getMsg("logs.autoClose"));
                    await notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                        title: `${current.title} - ${evData.name}`,
                        reason: getMsg("logs.autoClose")
                    })).catch(noop);
                    clearClaim(evData);
                    updateNeeded = true;
                }
            }
        }

        // ── Fixed-type events time limit ──
        if (evData.type === "fixed" && evData.timeWindow && evData.ownerId) {
            const limitTime = parseStringToDate(evData.timeWindow.split(" ~ ")[1]);
            if (limitTime && now >= limitTime) {
                if (evData.ownerName) pushToDailyLogs("CLAIM_END", evData.ownerName, `${current.title} - ${evData.name}`, getMsg("logs.timeout"));
                await notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${current.title} - ${evData.name}`,
                    reason: getMsg("logs.timeout")
                })).catch(noop);
                clearClaim(evData);
                updateNeeded = true;
            }
        }

        // ── Summon-type events time limit ──
        if (evData.type === "summon" && evData.timeWindow && evData.ownerId) {
            const limitTime = parseStringToDate(evData.timeWindow.split(" ~ ")[1]);
            if (limitTime && now >= limitTime) {
                if (evData.ownerName) pushToDailyLogs("CLAIM_END", evData.ownerName, `${current.title} - ${evData.name}`, getMsg("logs.timeout"));
                await notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${current.title} - ${evData.name}`,
                    reason: getMsg("logs.timeout")
                })).catch(noop);
                evData.ownerId = null;
                evData.ownerName = null;
                evData.time = "";
                evData.timeWindow = "";
                if (evData.nextId) {
                    const nid = evData.nextId, nname = evData.nextName;
                    evData.nextId = null;
                    evData.nextName = null;
                    evData.formattedTimeNext = "";
                    evData.ownerId = nid;
                    evData.ownerName = nname;
                    const grace = new Date(now.getTime() + 3e5);
                    evData.timeWindow = `${getFormattedTime12h(now)} ~ ${getFormattedTime12h(grace)}`;
                    notifyUserDM(nid, getMsg("rooms.summonTurnArrivedDM", {
                        roomKey: evData.name,
                        title: current.title
                    })).catch(noop);
                } else {
                    evData.endLimit = null;
                }
                updateNeeded = true;
            }
        }

        // ── Summon queue endLimit ──
        if (evData.type === "summon" && evData.endLimit && evData.nextId) {
            const absenceLimit = parseStringToDate(evData.endLimit);
            if (absenceLimit && now >= absenceLimit) {
                await notifyUserDM(evData.nextId, getMsg("rooms.summonAbsenceDM", {
                    roomKey: evData.name,
                    title: current.title
                })).catch(noop);
                if (evData.nextName) pushToDailyLogs("CLAIM_END", evData.nextName, `${current.title} - ${evData.name}`, getMsg("logs.absenceQueue"));
                evData.nextId = null;
                evData.nextName = null;
                evData.endLimit = null;
                evData.formattedTimeNext = "";
                updateNeeded = true;
            }
        }
    }

    return updateNeeded;
}

function clearClaim(evData) {
    evData.ownerId = null;
    evData.ownerName = null;
    evData.timeWindow = "";
    evData.reservedFor = null;
    evData.reservedByName = null;
    evData.reservations = null;
    if (evData._claimTimestamp) delete evData._claimTimestamp;
}
