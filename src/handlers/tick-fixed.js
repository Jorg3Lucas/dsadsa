import { isRoomOpen, calculateNextOpening } from "../core/time-utils.js";
import { getMsg } from "../core/lang.js";
import { notifyUserDM } from "./panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import { freeFloorAndActivateNextGracePeriod } from "./claim-core.js";
import { noop } from "../core/config.js";

// ==========================================
// ⏱️ FIXED PANEL — Auto-release when closed
// ==========================================

/** Handle auto-release for fixed-type panels when the schedule window closes. @param {object} current @param {Date} now @returns {Promise<boolean>} Whether state was updated */
export async function handleFixed(current, now) {
    let updateNeeded = false;

    if ("fixed" === current.type && current.schedules) {
        const minuteOffset = current.scheduleMinutes || 0;
        if (isRoomOpen(current.schedules, minuteOffset)) {
            if ("" === current.timeWindow) updateNeeded = true;
        } else {
            const nextOpen = calculateNextOpening(current.schedules, minuteOffset);
            const fiveMinBefore = new Date(nextOpen.getTime() - 5 * 60 * 1000);
            const insidePreWindow = now >= fiveMinBefore && now < nextOpen;

            if (!insidePreWindow && ("" !== current.timeWindow || current.ownerId)) {
                if (current.ownerName) pushToDailyLogs("CLAIM_END", current.ownerName, current.title, getMsg("logs.autoClose"));
                await notifyUserDM(current.ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: current.title,
                    reason: getMsg("logs.autoClose")
                })).catch(noop);
                freeFloorAndActivateNextGracePeriod(current);
                updateNeeded = true;
            }
        }
    }

    return updateNeeded;
}
