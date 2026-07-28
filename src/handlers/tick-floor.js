import { parseStringToDate, getFormattedTime12h } from "../core/time-utils.js";
import { getMsg } from "../core/lang.js";
import { notifyUserDM } from "./panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import { freeFloorAndActivateNextGracePeriod } from "./claim-core.js";
import { noop } from "../core/config.js";

// ==========================================
// ⏱️ FLOOR — Default claim timeout + Queue absence
// ==========================================

/** Handle claim timeout and queue absence for regular floor panels. @param {object} current @param {Date} now @returns {Promise<boolean>} Whether state was updated */
export async function handleFloor(current, now) {
    let updateNeeded = false;

    // Skip panel types that have their own dedicated tick handlers
    if ("event_group" === current.type || "antidemon" === current.type || "summon" === current.type) return updateNeeded;

    // ── Claim timeout ──
    if (current.ownerId && current.timeWindow && "fixed" !== current.type) {
        const limitTime = parseStringToDate(current.timeWindow.split(" ~ ")[1]);
        if (limitTime && now >= limitTime) {
            await notifyUserDM(current.ownerId, getMsg("rooms.floorExpiredDM", {
                title: current.title
            })).catch(noop);
            if (current.ownerName) pushToDailyLogs("CLAIM_END", current.ownerName, current.title, getMsg("logs.timeout"));
            freeFloorAndActivateNextGracePeriod(current);
            updateNeeded = true;
        }
    }

    // ── Queue absence endLimit ──
    if (current.next && current.next.endLimit) {
        const absenceLimit = parseStringToDate(current.next.endLimit);
        if (absenceLimit && now >= absenceLimit) {
            await notifyUserDM(current.next.userId, getMsg("rooms.floorAbsenceDM", {
                title: current.title
            })).catch(noop);
            if (current.next.userName) pushToDailyLogs("CLAIM_END", current.next.userName, current.title, getMsg("logs.absenceQueue"));
            const nextInLine = current.next.nextQueue;
            if (nextInLine) {
                current.next = nextInLine;
                const grace = new Date(now.getTime() + 3e5);
                current.next.endLimit = getFormattedTime12h(grace);
                await notifyUserDM(current.next.userId, getMsg("rooms.floorTurnArrivedDM", {
                    title: current.title
                })).catch(noop);
            } else {
                current.next = null;
            }
            updateNeeded = true;
        }
    }

    return updateNeeded;
}
