import { getLocalTime, parseStringToDate, usesScheduleRespawn, redBossSchedules, leader3Schedules } from "../core/time-utils.js";
import { sendBossSpawnAlerts, sendScheduledEventAlerts, resetScheduledEventAlertCache } from "./boss-spawn-scheduler.js";
import { getMsg, reloadLanguage } from "../core/lang.js";
import { db, alertCache, bossSpawnAlertCache, saveLocalStorage } from "../core/state.js";
import { dispatchDailyLogs } from "../core/daily-logs.js";
import { refreshVisualPanel, notifyUserDM } from "./panel-utils.js";
import { getAntidemonRoomKeys, getSummonRoomKeys } from "./claim-core.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_KILLED, STATUS_KILLED_PREFIX } from "../core/constants.js";
import { noop } from "../core/config.js";

// Sub-module handlers
import { handlePeakNormal } from "./tick-peak-normal.js";
import { handleFixed } from "./tick-fixed.js";
import { handleEventGroup } from "./tick-event-group.js";
import { handleAntidemonSummon } from "./tick-antidemon-summon.js";
import { handleFloor } from "./tick-floor.js";

// ==========================================
// ⏱ TICK INTERVAL (15s refresh)
// ==========================================

/** Start the 15-second tick interval that handles daily log dispatch, boss alerts, panel auto-respawn, claim timeouts, and force-refresh. */
export function startTickInterval() {
    setInterval(async () => {
        let updateNeeded = false;
            const now = getLocalTime();
        reloadLanguage();

        // Daily logs dispatch at 18:00 Berlin time
        if (18 === now.getHours() && 0 === now.getMinutes() && !alertCache._dailyDispatched) {
            alertCache._dailyDispatched = true;
            await dispatchDailyLogs(false);
            alertCache.warning5mAfter = {};
            alertCache.spawnAlerted = {};
            Object.keys(bossSpawnAlertCache).forEach(k => delete bossSpawnAlertCache[k]);
            resetScheduledEventAlertCache();
        }
        if (alertCache._dailyDispatched && (now.getHours() !== 18 || now.getMinutes() > 1)) {
            alertCache._dailyDispatched = false;
        }

        // Midnight alert cache cleanup
        if (0 === now.getHours() && 0 === now.getMinutes() && !alertCache._midnightCleaned) {
            alertCache._midnightCleaned = true;
            alertCache.spawnAlerted = {};
        }
        if (alertCache._midnightCleaned && (now.getHours() !== 0 || now.getMinutes() > 1)) {
            alertCache._midnightCleaned = false;
        }

        // Boss spawn alerts (5 min before)
        if (now.getSeconds() < 15) {
            await sendBossSpawnAlerts();
            await sendScheduledEventAlerts();
        }

        // Main panel loop
        for (const key in db) {
            const current = db[key];
            if (!current || key.startsWith("_")) continue;
            let panelUpdate = false;

            // Peak (Red Boss) + Normal (Leader 3) auto-respawn
            if (await handlePeakNormal(current, key, now, redBossSchedules, leader3Schedules)) {
                panelUpdate = true;
                updateNeeded = true;
            }

            // Fixed panel auto-release (freeFloorAndActivateNextGracePeriod called inside tick-fixed.js)
            if (await handleFixed(current, now)) {
                panelUpdate = true;
                updateNeeded = true;
            }

            // Event group handlers (schedule/fixed/summon)
            if (await handleEventGroup(current, key, now)) {
                panelUpdate = true;
                updateNeeded = true;
            }

            // Antidemon / Summon timeout + absence (freeAntidemonRoom called inside tick-antidemon-summon.js)
            if (await handleAntidemonSummon(current, key, now)) {
                panelUpdate = true;
                updateNeeded = true;
            }

            // Floor claim timeout + queue absence (freeFloorAndActivateNextGracePeriod called inside tick-floor.js)
            if (await handleFloor(current, now)) {
                panelUpdate = true;
                updateNeeded = true;
            }

            // Normal boss cooldown (non-event-group, non-antidemon, non-fixed panels)
            if ("event_group" !== current.type && "antidemon" !== current.type && "fixed" !== current.type) {
                for (const prop in current) {
                    if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;

                    if (current[prop].status && current[prop].status.startsWith(STATUS_KILLED)) {
                        if (usesScheduleRespawn(current, prop)) continue;

                        const killedTimeStr = current[prop].status.replace(STATUS_KILLED_PREFIX, "").trim();
                        let killedTime;
                        if (current[prop]._lastKilledAt) {
                            killedTime = new Date(current[prop]._lastKilledAt);
                        } else {
                            killedTime = parseStringToDate(killedTimeStr);
                        }
                        if (killedTime) {
                            const secondsPassed = Math.floor((now.getTime() - killedTime.getTime()) / 1e3);
                            const totalCooldownSeconds = 60 * current[prop].cooldown;

                            if (secondsPassed >= totalCooldownSeconds) {
                                current[prop].status = STATUS_AVAILABLE;
                                current[prop]._freeSince = now.getTime();
                                current[prop]._lastKilledTimeStr = killedTimeStr;
                                delete alertCache.warning5mAfter[`${key}-${prop}`];
                                panelUpdate = true;
                                updateNeeded = true;

                                if (current.ownerId) {
                                    const spawnKeyAlert = `${key}-${prop}-spawn-${now.getHours()}-${now.getMinutes()}`;
                                    if (!alertCache.spawnAlerted[spawnKeyAlert]) {
                                        await notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawn", {
                                            title: current.title,
                                            boss: current[prop].name
                                        })).catch(noop);
                                        alertCache.spawnAlerted[spawnKeyAlert] = true;
                                    }
                                }
                            }
                        }
                    }

                    // DM warning: 5min after respawn, only if respawn happened AFTER claim started
                    if (STATUS_AVAILABLE === current[prop].status && current[prop]._freeSince > 0 && current._claimTimestamp) {
                        if (current[prop]._freeSince > current._claimTimestamp) {
                            const minutesIdle = Math.floor((now.getTime() - current[prop]._freeSince) / 6e4);
                            if (minutesIdle >= 5 && current.ownerId && !alertCache.warning5mAfter[`${key}-${prop}`]) {
                                await notifyUserDM(current.ownerId, getMsg("rooms.dmBossNotMarkedWarning", {
                                    title: current.title,
                                    boss: current[prop].name
                                })).catch(noop);
                                alertCache.warning5mAfter[`${key}-${prop}`] = Date.now();
                            }
                        }
                    }
                }
            }

            // Force refresh for countdown timers
            if (!panelUpdate) {
                if ("event_group" === current.type) {
                    panelUpdate = true;
                } else if ("antidemon" === current.type || "summon" === current.type) {
                    const roomList = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
                    for (const room of roomList) {
                        const rData = current[room];
                        if ((STATUS_CLAIMED === rData.status && rData.timeWindow) || rData.endLimit) {
                            panelUpdate = true;
                            break;
                        }
                    }
                } else if ("fixed" === current.type) {
                    panelUpdate = true;
                } else {
                    for (const prop in current) {
                        if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;
                        if (current[prop].status && current[prop].status.startsWith("🔴 Killed at") && current[prop].cooldown) {
                            panelUpdate = true;
                            break;
                        }
                        if (current[prop]._freeSince > 0) {
                            panelUpdate = true;
                            break;
                        }
                    }
                    if (!panelUpdate && current.ownerId) panelUpdate = true;
                    if (!panelUpdate && current.next) panelUpdate = true;
                }
            }

            if (panelUpdate) await refreshVisualPanel(key);
        }
        if (updateNeeded) saveLocalStorage();
    }, 1.5e4);
}
