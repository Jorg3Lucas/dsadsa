import { getLocalTime, isRoomOpen, parseStringToDate, usesScheduleRespawn, getFormattedTime12h, redBossSchedules, leader3Schedules } from "./time-utils.js";
import { getMsg, reloadLanguage } from "./lang.js";
import { db, alertCache, saveLocalStorage } from "./state.js";
import { pushToDailyLogs, dispatchDailyLogs } from "./daily-logs.js";
import { refreshVisualPanel, notifyUserDM } from "./panel-utils.js";
import { freeFloorAndActivateNextGracePeriod, freeAntidemonRoom } from "./claim-core.js";

// ==========================================
// ⏱️ TICK INTERVAL (15s refresh)
// ==========================================

export function startTickInterval() {
    setInterval(async () => {
        let updateNeeded = !1,
            now = getLocalTime();
        reloadLanguage();

        if (18 === now.getHours() && 0 === now.getMinutes()) {
            await dispatchDailyLogs(!1);
            alertCache.warning5mAfter = {};
            alertCache.spawnAlerted = {};
        }

        for (let key in db) {
            let current = db[key];
            if (!current || key.startsWith("_")) continue;
            let panelUpdate = !1;

            if ("peak" === current.type && isRoomOpen(redBossSchedules)) {
                if ("🟢 Available" !== current.red.status && now.getMinutes() === 0) {
                    current.red._lastKilledTimeStr = current.red.status.replace("🔴 Killed at ", "").trim();
                    current.red.status = "🟢 Available";
                    current.red._freeSince = now.getTime();
                    if (current.ownerId) {
                        notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                            title: current.title,
                            boss: current.red.name
                        }));
                    }
                    panelUpdate = !0;
                    updateNeeded = !0;
                }
            }

            if ("normal" === current.type && current.boss3 && isRoomOpen(leader3Schedules)) {
                if ("🟢 Available" !== current.boss3.status && now.getMinutes() === 0) {
                    current.boss3._lastKilledTimeStr = current.boss3.status.replace("🔴 Killed at ", "").trim();
                    current.boss3.status = "🟢 Available";
                    current.boss3._freeSince = now.getTime();
                    if (current.ownerId) {
                        notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                            title: current.title,
                            boss: current.boss3.name
                        }));
                    }
                    panelUpdate = !0;
                    updateNeeded = !0;
                }
            }

            if ("fixed" === current.type && current.schedules) {
                if (isRoomOpen(current.schedules)) {
                    "" === current.timeWindow && (panelUpdate = !0, updateNeeded = !0);
                } else if ("" !== current.timeWindow || current.ownerId) {
                    current.ownerName && pushToDailyLogs("CLAIM_END", current.ownerName, current.title, getMsg("logs.autoClose"));
                    notifyUserDM(current.ownerId, getMsg("rooms.dmRemovedNotice", {
                        title: current.title,
                        reason: getMsg("logs.autoClose")
                    }));
                    freeFloorAndActivateNextGracePeriod(current);
                    panelUpdate = !0;
                    updateNeeded = !0;
                }
            }                            if ("antidemon" !== current.type && "fixed" !== current.type) {
                for (let prop in current) {
                    if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) {

                        if (current[prop].status.startsWith("🔴")) {
                            // Schedule-based bosses (Red Boss, Leader 3) are handled by the dedicated blocks above
                            if (usesScheduleRespawn(current, prop)) continue;
                            
                            // Capture killed time string BEFORE changing status
                            let killedTimeStr = current[prop].status.replace("🔴 Killed at ", "").trim();
                            // Prefer stored millisecond timestamp (timezone-safe), fall back to parsing string
                            let killedTime;
                            if (current[prop]._lastKilledAt) {
                                killedTime = new Date(current[prop]._lastKilledAt);
                            } else {
                                killedTime = parseStringToDate(killedTimeStr);
                            }
                            if (killedTime) {
                                let secondsPassed = Math.floor((now.getTime() - killedTime.getTime()) / 1e3);
                                let totalCooldownSeconds = 60 * current[prop].cooldown;

                                if (secondsPassed >= totalCooldownSeconds) {
                                    current[prop].status = "🟢 Available";
                                    current[prop]._freeSince = now.getTime();
                                    current[prop]._lastKilledTimeStr = killedTimeStr;
                                    panelUpdate = !0;
                                    updateNeeded = !0;

                                    if (current.ownerId) {
                                        let spawnKeyAlert = `${key}-${prop}-spawn-${now.getHours()}-${now.getMinutes()}`;
                                        if (!alertCache.spawnAlerted[spawnKeyAlert]) {
                                            notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawn", {
                                                title: current.title,
                                                boss: current[prop].name
                                            }));
                                            alertCache.spawnAlerted[spawnKeyAlert] = !0;
                                        }
                                    }
                                }
                            }
                        }
                        

                    }
                }
            }

            if ("antidemon" === current.type || "summon" === current.type) {
                const roomList = "summon" === current.type ? ["sp2", "sp4", "sp7", "ms11", "sp11"] : ["left", "mid", "right"];
                for (let room of roomList) {
                    let rData = current[room];
                    if ("🔴 Claimed" === rData.status && rData.timeWindow) {
                        let limitTime = parseStringToDate(rData.timeWindow.split(" ~ ")[1]);
                        if (limitTime && now >= limitTime) {
                            rData.ownerName && pushToDailyLogs("CLAIM_END", rData.ownerName, `${current.title} - Room ${room.toUpperCase()}`, getMsg("logs.timeout"));
                            notifyUserDM(rData.ownerId, getMsg("rooms.dmRemovedNotice", {
                                title: `${current.title} - Room ${room.toUpperCase()}`,
                                reason: getMsg("logs.timeout")
                            }));
                            freeAntidemonRoom(current, room);
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                    if (rData.endLimit && rData.nextId) {
                        let absenceLimit = parseStringToDate(rData.endLimit);
                        if (absenceLimit && now >= absenceLimit) {
                            notifyUserDM(rData.nextId, getMsg("rooms.antidemonAbsenceDM", {
                                roomKey: room.toUpperCase(),
                                title: current.title
                            }));
                            rData.nextName && pushToDailyLogs("CLAIM_END", rData.nextName, `${current.title} - Room ${room.toUpperCase()}`, getMsg("logs.absenceQueue"));
                            rData.nextId = null;
                            rData.nextName = null;
                            rData.endLimit = null;
                            rData.formattedTimeNext = "";
                            freeAntidemonRoom(current, room);
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                }
            } else {
                if (current.ownerId && current.timeWindow && "fixed" !== current.type) {
                    let limitTime = parseStringToDate(current.timeWindow.split(" ~ ")[1]);
                    if (limitTime && now >= limitTime) {
                        notifyUserDM(current.ownerId, getMsg("rooms.floorExpiredDM", {
                            title: current.title
                        }));
                        current.ownerName && pushToDailyLogs("CLAIM_END", current.ownerName, current.title, getMsg("logs.timeout"));
                        freeFloorAndActivateNextGracePeriod(current);
                        panelUpdate = !0;
                        updateNeeded = !0;
                    }
                }
                if (current.next && current.next.endLimit) {
                    let absenceLimit = parseStringToDate(current.next.endLimit);
                    if (absenceLimit && now >= absenceLimit) {
                        notifyUserDM(current.next.userId, getMsg("rooms.floorAbsenceDM", {
                            title: current.title
                        }));
                        current.next.userName && pushToDailyLogs("CLAIM_END", current.next.userName, current.title, getMsg("logs.absenceQueue"));
                        let nextInLine = current.next.nextQueue;
                        if (nextInLine) {
                            current.next = nextInLine;
                            let grace = new Date(now.getTime() + 3e5);
                            current.next.endLimit = getFormattedTime12h(grace);
                            notifyUserDM(current.next.userId, getMsg("rooms.floorTurnArrivedDM", {
                                title: current.title
                            }));
                        } else {
                            current.next = null;
                        }
                        panelUpdate = !0;
                        updateNeeded = !0;
                    }
                }
            }
            // Force refresh for countdown timers
            if (!panelUpdate) {
                if ("antidemon" === current.type || "summon" === current.type) {
                    const roomList = "summon" === current.type ? ["sp2", "sp4", "sp7", "ms11", "sp11"] : ["left", "mid", "right"];
                    for (let room of roomList) {
                        let rData = current[room];
                        if (("🔴 Claimed" === rData.status && rData.timeWindow) || rData.endLimit) {
                            panelUpdate = !0;
                            break;
                        }
                    }
                } else if ("fixed" === current.type) {
                    panelUpdate = !0; // Next opening countdown always changes
                } else {
                    // Check for boss respawn countdowns
                    for (let prop in current) {
                        if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) {
                            if (current[prop].status.startsWith("🔴 Killed at") && current[prop].cooldown) {
                                panelUpdate = !0;
                                break;
                            }
                        }
                    }
                    // Also check for endLimit countdown on peak/square floors
                    if (!panelUpdate && current.next && current.next.endLimit) {
                        panelUpdate = !0;
                    }
                }
            }
            if (panelUpdate) await refreshVisualPanel(key);
        }
        if (updateNeeded) saveLocalStorage();
    }, 1.5e4); // 15s refresh for countdown timers
}
