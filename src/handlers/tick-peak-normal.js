import { isRoomOpen } from "../core/time-utils.js";
import { getMsg } from "../core/lang.js";
import { alertCache } from "../core/state.js";
import { notifyUserDM } from "./panel-utils.js";
import { STATUS_AVAILABLE, STATUS_KILLED_PREFIX } from "../core/constants.js";
import { noop } from "../core/config.js";

// ==========================================
// ⏱️ PEAK / NORMAL — Schedule-based auto-respawn
// ==========================================

/** Handle schedule-based auto-respawn for Red Boss (peak) and Leader 3 (normal) panels. @param {object} current - Panel data @param {string} key @param {Date} now @param {number[]} redBossSchedules @param {number[]} leader3Schedules @returns {Promise<boolean>} Whether state was updated */
export async function handlePeakNormal(current, key, now, redBossSchedules, leader3Schedules) {
    let updateNeeded = false;

    // ── PEAK: Red Boss auto-respawn ──
    if ("peak" === current.type) {
        const peakRedScheds = (current.red && current.red.schedules) || redBossSchedules;
        if (isRoomOpen(peakRedScheds)) {
            // DM warning: 5min after Red Boss auto-respawn, if still not killed/marked
            if (STATUS_AVAILABLE === current.red.status && current.red._freeSince > 0 && current.ownerId) {
                const minutesIdle = Math.floor((now.getTime() - current.red._freeSince) / 6e4);
                if (minutesIdle >= 5 && (!alertCache.warning5mAfter[`${key}-red-${now.getHours()}`] || Date.now() - alertCache.warning5mAfter[`${key}-red-${now.getHours()}`] > 36e5)) {
                    await notifyUserDM(current.ownerId, getMsg("rooms.dmBossNotMarkedWarning", {
                        title: current.title,
                        boss: current.red.name
                    })).catch(noop);
                    alertCache.warning5mAfter[`${key}-red-${now.getHours()}`] = Date.now();
                }
            }
            if (STATUS_AVAILABLE !== current.red.status && now.getMinutes() === 0) {
                current.red._lastKilledTimeStr = current.red.status.replace(STATUS_KILLED_PREFIX, "").trim();
                current.red.status = STATUS_AVAILABLE;
                current.red._freeSince = now.getTime();
                delete alertCache.warning5mAfter[`${key}-red-${now.getHours()}`];
                if (current.ownerId) {
                    await notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                        title: current.title,
                        boss: current.red.name
                    })).catch(noop);
                }
                updateNeeded = true;
            }
        }
    }

    // ── NORMAL: Leader 3 auto-respawn ──
    if ("normal" === current.type && current.boss3 && isRoomOpen(leader3Schedules)) {
        // DM warning: 5min after Leader 3 auto-respawn, if still not killed/marked
        if (STATUS_AVAILABLE === current.boss3.status && current.boss3._freeSince > 0 && current.ownerId) {
            const minutesIdle = Math.floor((now.getTime() - current.boss3._freeSince) / 6e4);
            if (minutesIdle >= 5 && (!alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`] || Date.now() - alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`] > 36e5)) {
                await notifyUserDM(current.ownerId, getMsg("rooms.dmBossNotMarkedWarning", {
                    title: current.title,
                    boss: current.boss3.name
                })).catch(noop);
                alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`] = Date.now();
            }
        }
        if (STATUS_AVAILABLE !== current.boss3.status && now.getMinutes() === 0) {
            current.boss3._lastKilledTimeStr = current.boss3.status.replace(STATUS_KILLED_PREFIX, "").trim();
            current.boss3.status = STATUS_AVAILABLE;
            current.boss3._freeSince = now.getTime();
            delete alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`];
            if (current.ownerId) {
                await notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                    title: current.title,
                    boss: current.boss3.name
                })).catch(noop);
            }
            updateNeeded = true;
        }
    }

    return updateNeeded;
}
