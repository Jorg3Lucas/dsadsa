import { getLocalTime, isRoomOpen, parseStringToDate, usesScheduleRespawn, getFormattedTime12h, calculateNextOpening, redBossSchedules, leader3Schedules } from "./time-utils.js";
import { sendBossSpawnAlerts, sendScheduledEventAlerts, resetScheduledEventAlertCache } from "./boss-spawn-scheduler.js";
import { getMsg, reloadLanguage } from "./lang.js";
import { db, alertCache, bossSpawnAlertCache, saveLocalStorage } from "./state.js";
import { pushToDailyLogs, dispatchDailyLogs } from "./daily-logs.js";
import { refreshVisualPanel, notifyUserDM } from "./panel-utils.js";
import { freeFloorAndActivateNextGracePeriod, freeAntidemonRoom, getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_KILLED, STATUS_KILLED_PREFIX } from "./constants.js";

// ==========================================
// ⏱️ TICK INTERVAL (15s refresh)
// ==========================================

export function startTickInterval() {
    setInterval(async () => {
        let updateNeeded = !1,
            now = getLocalTime();
        reloadLanguage();

        // ── Daily logs dispatch at 18:00 Berlin time (once per day) ──
        if (18 === now.getHours() && 0 === now.getMinutes() && !alertCache._dailyDispatched) {
            alertCache._dailyDispatched = !0;
            await dispatchDailyLogs(!1);
            alertCache.warning5mAfter = {};
            alertCache.spawnAlerted = {};
            Object.keys(bossSpawnAlertCache).forEach(k => delete bossSpawnAlertCache[k]);
            resetScheduledEventAlertCache();
        }
        // Reset the daily dispatch flag once we're past 18:01
        if (alertCache._dailyDispatched && (now.getHours() !== 18 || now.getMinutes() > 1)) {
            alertCache._dailyDispatched = !1;
        }

        // ── Midnight alert cache cleanup: clears spawnAlerted to prevent stale entries from suppressing new-day spawn alerts ──
        // warning5mAfter uses timestamps with a 1-hour stale check, so no midnight cleanup needed (self-cleaning).
        if (0 === now.getHours() && 0 === now.getMinutes() && !alertCache._midnightCleaned) {
            alertCache._midnightCleaned = !0;
            alertCache.spawnAlerted = {};
        }
        // Reset the midnight cleanup flag once we're past 00:01
        if (alertCache._midnightCleaned && (now.getHours() !== 0 || now.getMinutes() > 1)) {
            alertCache._midnightCleaned = !1;
        }

        // ── Boss spawn alerts (5 min before, individual bosses) ──
        if (now.getSeconds() < 15) {
            await sendBossSpawnAlerts();
            await sendScheduledEventAlerts();
        }

        for (const key in db) {
            const current = db[key];
            if (!current || key.startsWith("_")) continue;
            let panelUpdate = !1;

            // Use custom schedules if available (e.g. SP11: [1,7,13,19]), fall back to default
            const peakRedScheds = (current.red && current.red.schedules) || redBossSchedules;
            if ("peak" === current.type && isRoomOpen(peakRedScheds)) {
                // DM warning: 5min after Red Boss auto-respawn, if still not killed/marked
                if (STATUS_AVAILABLE === current.red.status && current.red._freeSince > 0 && current.ownerId) {
                    const minutesIdle = Math.floor((now.getTime() - current.red._freeSince) / 6e4);
                    if (minutesIdle >= 5 && (!alertCache.warning5mAfter[`${key}-red-${now.getHours()}`] || Date.now() - alertCache.warning5mAfter[`${key}-red-${now.getHours()}`] > 36e5)) {
                        await notifyUserDM(current.ownerId, getMsg("rooms.dmBossNotMarkedWarning", {
                            title: current.title,
                            boss: current.red.name
                        })).catch(() => {});
                        alertCache.warning5mAfter[`${key}-red-${now.getHours()}`] = Date.now();
                    }
                }
                if (STATUS_AVAILABLE !== current.red.status && now.getMinutes() === 0) {
                    current.red._lastKilledTimeStr = current.red.status.replace(STATUS_KILLED_PREFIX, "").trim();
                    current.red.status = STATUS_AVAILABLE;
                    current.red._freeSince = now.getTime();
                    // Clear warning cache so the 5-minute warning can re-fire if boss isn't killed during this window
                    delete alertCache.warning5mAfter[`${key}-red-${now.getHours()}`];
                    if (current.ownerId) {
                        await notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                            title: current.title,
                            boss: current.red.name
                        })).catch(() => {});
                    }
                    panelUpdate = !0;
                    updateNeeded = !0;
                }
            }

            if ("normal" === current.type && current.boss3 && isRoomOpen(leader3Schedules)) {
                // DM warning: 5min after Leader 3 auto-respawn, if still not killed/marked
                if (STATUS_AVAILABLE === current.boss3.status && current.boss3._freeSince > 0 && current.ownerId) {
                    const minutesIdle = Math.floor((now.getTime() - current.boss3._freeSince) / 6e4);
                    if (minutesIdle >= 5 && (!alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`] || Date.now() - alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`] > 36e5)) {
                        await notifyUserDM(current.ownerId, getMsg("rooms.dmBossNotMarkedWarning", {
                            title: current.title,
                            boss: current.boss3.name
                        })).catch(() => {});
                        alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`] = Date.now();
                    }
                }
                if (STATUS_AVAILABLE !== current.boss3.status && now.getMinutes() === 0) {
                    current.boss3._lastKilledTimeStr = current.boss3.status.replace(STATUS_KILLED_PREFIX, "").trim();
                    current.boss3.status = STATUS_AVAILABLE;
                    current.boss3._freeSince = now.getTime();
                    // Clear warning cache so the 5-minute warning can re-fire if boss isn't killed during this window
                    delete alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`];
                    if (current.ownerId) {
                        await notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                            title: current.title,
                            boss: current.boss3.name
                        })).catch(() => {});
                    }
                    panelUpdate = !0;
                    updateNeeded = !0;
                }
            }

            if ("fixed" === current.type && current.schedules) {
                const minuteOffset = current.scheduleMinutes || 0;
                if (isRoomOpen(current.schedules, minuteOffset)) {
                    "" === current.timeWindow && (panelUpdate = !0, updateNeeded = !0);
                } else {
                    // Don't release claim during the 5-minute pre-opening window
                    const now = getLocalTime();
                    const nextOpen = calculateNextOpening(current.schedules, minuteOffset);
                    const fiveMinBefore = new Date(nextOpen.getTime() - 5 * 60 * 1000);
                    const insidePreWindow = now >= fiveMinBefore && now < nextOpen;

                    if (!insidePreWindow && ("" !== current.timeWindow || current.ownerId)) {
                        current.ownerName && pushToDailyLogs("CLAIM_END", current.ownerName, current.title, getMsg("logs.autoClose"));
                        await notifyUserDM(current.ownerId, getMsg("rooms.dmRemovedNotice", {
                            title: current.title,
                            reason: getMsg("logs.autoClose")
                        })).catch(() => {});
                        freeFloorAndActivateNextGracePeriod(current);
                        panelUpdate = !0;
                        updateNeeded = !0;
                    }
                }
            }

            if ("event_group" === current.type) {
                // Handle schedule-type events (Red Boss) auto-respawn
                const egEvents = getEventGroupKeys(current);
                for (const ev of egEvents) {
                    const evData = current[ev];
                    if (evData.type === "schedule" && evData.schedules) {
                        if (isRoomOpen(evData.schedules)) {
                            if (evData.status && evData.status.startsWith(STATUS_KILLED) && now.getMinutes() === 0) {
                                evData.status = STATUS_AVAILABLE;
                                panelUpdate = !0;
                                updateNeeded = !0;
                                if (evData.ownerId) {
                                    await notifyUserDM(evData.ownerId, getMsg("rooms.dmImmediateSpawnFixed", {
                                        title: current.title,
                                        boss: evData.name
                                    })).catch(() => {});
                                }
                            }
                        }
                    }
                    
                    // Handle fixed-type events (Fury/Frenzy/Random Event) auto-release
                    if (evData.type === "fixed" && evData.schedules) {
                        const minuteOffset = evData.scheduleMinutes || 0;
                        if (isRoomOpen(evData.schedules, minuteOffset)) {
                            "" === evData.timeWindow && (panelUpdate = !0, updateNeeded = !0);
                        } else {
                            const now = getLocalTime();
                            const nextOpen = calculateNextOpening(evData.schedules, minuteOffset);
                            const fiveMinBefore = new Date(nextOpen.getTime() - 5 * 60 * 1000);
                            const insidePreWindow = now >= fiveMinBefore && now < nextOpen;
                            if (!insidePreWindow && ("" !== evData.timeWindow || evData.ownerId)) {
                                evData.ownerName && pushToDailyLogs("CLAIM_END", evData.ownerName, `${current.title} - ${evData.name}`, getMsg("logs.autoClose"));
                                await notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                                    title: `${current.title} - ${evData.name}`,
                                    reason: getMsg("logs.autoClose")
                                })).catch(() => {});
                                evData.ownerId = null;
                                evData.ownerName = null;
                                evData.timeWindow = "";
                                evData.reservedFor = null;
                                evData.reservedByName = null;
                                evData.reservations = null;
                                if (evData._claimTimestamp) delete evData._claimTimestamp;
                                panelUpdate = !0;
                                updateNeeded = !0;
                            }
                        }
                    }
                    
                    // Handle fixed-type events (Fury/Frenzy) time limit
                    if (evData.type === "fixed" && evData.timeWindow && evData.ownerId) {
                        const limitTime = parseStringToDate(evData.timeWindow.split(" ~ ")[1]);
                        if (limitTime && now >= limitTime) {
                            evData.ownerName && pushToDailyLogs("CLAIM_END", evData.ownerName, `${current.title} - ${evData.name}`, getMsg("logs.timeout"));
                            await notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                                title: `${current.title} - ${evData.name}`,
                                reason: getMsg("logs.timeout")
                            })).catch(() => {});
                            evData.ownerId = null;
                            evData.ownerName = null;
                            evData.timeWindow = "";
                            evData.reservedFor = null;
                            evData.reservedByName = null;
                            evData.reservations = null;
                            if (evData._claimTimestamp) delete evData._claimTimestamp;
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                    
                    // Handle summon-type events (Goblin) time limit
                    if (evData.type === "summon" && evData.timeWindow && evData.ownerId) {
                        const limitTime = parseStringToDate(evData.timeWindow.split(" ~ ")[1]);
                        if (limitTime && now >= limitTime) {
                            evData.ownerName && pushToDailyLogs("CLAIM_END", evData.ownerName, `${current.title} - ${evData.name}`, getMsg("logs.timeout"));
                            await notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                                title: `${current.title} - ${evData.name}`,
                                reason: getMsg("logs.timeout")
                            })).catch(() => {});
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
                                })).catch(() => {});
                            } else {
                                evData.endLimit = null;
                            }
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                    
                    // Handle summon queue endLimit
                    if (evData.type === "summon" && evData.endLimit && evData.nextId) {
                        const absenceLimit = parseStringToDate(evData.endLimit);
                        if (absenceLimit && now >= absenceLimit) {
                            await notifyUserDM(evData.nextId, getMsg("rooms.summonAbsenceDM", {
                                roomKey: evData.name,
                                title: current.title
                            })).catch(() => {});
                            evData.nextName && pushToDailyLogs("CLAIM_END", evData.nextName, `${current.title} - ${evData.name}`, getMsg("logs.absenceQueue"));
                            evData.nextId = null;
                            evData.nextName = null;
                            evData.endLimit = null;
                            evData.formattedTimeNext = "";
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                }
            } else if ("antidemon" !== current.type && "fixed" !== current.type) {
                for (const prop in current) {
                    if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) {

                        if (current[prop].status.startsWith("🔴")) {
                            // Schedule-based bosses (Red Boss, Leader 3) are handled by the dedicated blocks above
                            if (usesScheduleRespawn(current, prop)) continue;
                            
                            // Capture killed time string BEFORE changing status
                            const killedTimeStr = current[prop].status.replace(STATUS_KILLED_PREFIX, "").trim();
                            // Prefer stored millisecond timestamp (timezone-safe), fall back to parsing string
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
                                    // Clear warning cache so it can re-fire on the next respawn cycle
                                    delete alertCache.warning5mAfter[`${key}-${prop}`];
                                    panelUpdate = !0;
                                    updateNeeded = !0;

                                    if (current.ownerId) {
                                        const spawnKeyAlert = `${key}-${prop}-spawn-${now.getHours()}-${now.getMinutes()}`;
                                        if (!alertCache.spawnAlerted[spawnKeyAlert]) {
                                            await notifyUserDM(current.ownerId, getMsg("rooms.dmImmediateSpawn", {
                                                title: current.title,
                                                boss: current[prop].name
                                            })).catch(() => {});
                                            alertCache.spawnAlerted[spawnKeyAlert] = !0;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // DM warning: 5min after boss respawn, only if respawn happened AFTER claim started
                        if (STATUS_AVAILABLE === current[prop].status && current[prop]._freeSince > 0 && current._claimTimestamp) {
                            if (current[prop]._freeSince > current._claimTimestamp) {
                                const minutesIdle = Math.floor((now.getTime() - current[prop]._freeSince) / 6e4);
                                const targetKeyAlert = `${key}-${prop}`;
                                if (minutesIdle >= 5 && current.ownerId && !alertCache.warning5mAfter[targetKeyAlert]) {
                                    await notifyUserDM(current.ownerId, getMsg("rooms.dmBossNotMarkedWarning", {
                                        title: current.title,
                                        boss: current[prop].name
                                    })).catch(() => {});
                                    alertCache.warning5mAfter[targetKeyAlert] = Date.now();
                                }
                            }
                        }
                    }
                }
            }

            if ("event_group" === current.type) {
                const egEvents = getEventGroupKeys(current);
                for (const ev of egEvents) {
                    const evData = current[ev];
                    // Summon-type time limit
                    if (evData.type === "summon" && evData.timeWindow && evData.ownerId) {
                        const limitTime = parseStringToDate(evData.timeWindow.split(" ~ ")[1]);
                        if (limitTime && now >= limitTime) {
                            evData.ownerName && pushToDailyLogs("CLAIM_END", evData.ownerName, `${current.title} - ${evData.name}`, getMsg("logs.timeout"));
                            await notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                                title: `${current.title} - ${evData.name}`,
                                reason: getMsg("logs.timeout")
                            })).catch(() => {});
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
                                })).catch(() => {});
                            } else {
                                evData.endLimit = null;
                            }
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                    // Summon-type queue endLimit
                    if (evData.type === "summon" && evData.endLimit && evData.nextId) {
                        const absenceLimit = parseStringToDate(evData.endLimit);
                        if (absenceLimit && now >= absenceLimit) {
                            await notifyUserDM(evData.nextId, getMsg("rooms.summonAbsenceDM", {
                                roomKey: evData.name,
                                title: current.title
                            })).catch(() => {});
                            evData.nextName && pushToDailyLogs("CLAIM_END", evData.nextName, `${current.title} - ${evData.name}`, getMsg("logs.absenceQueue"));
                            evData.nextId = null;
                            evData.nextName = null;
                            evData.endLimit = null;
                            evData.formattedTimeNext = "";
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                }
            } else if ("antidemon" === current.type || "summon" === current.type) {
                const roomList = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
                for (const room of roomList) {
                    const rData = current[room];
                    if (STATUS_CLAIMED === rData.status && rData.timeWindow) {
                        const limitTime = parseStringToDate(rData.timeWindow.split(" ~ ")[1]);
                        if (limitTime && now >= limitTime) {
                            rData.ownerName && pushToDailyLogs("CLAIM_END", rData.ownerName, `${current.title} - Room ${room.toUpperCase()}`, getMsg("logs.timeout"));
                            await notifyUserDM(rData.ownerId, getMsg("rooms.dmRemovedNotice", {
                                title: `${current.title} - Room ${room.toUpperCase()}`,
                                reason: getMsg("logs.timeout")
                            })).catch(() => {});
                            freeAntidemonRoom(current, room);
                            panelUpdate = !0;
                            updateNeeded = !0;
                        }
                    }
                    if (rData.endLimit && rData.nextId) {
                        const absenceLimit = parseStringToDate(rData.endLimit);
                        if (absenceLimit && now >= absenceLimit) {
                            const displayName = rData.name || room.toUpperCase();
                            const absenceTemplate = current.type === "summon"
                                ? "rooms.summonAbsenceDM"
                                : "rooms.antidemonAbsenceDM";
                            await notifyUserDM(rData.nextId, getMsg(absenceTemplate, {
                                roomKey: displayName,
                                title: current.title
                            })).catch(() => {});
                            rData.nextName && pushToDailyLogs("CLAIM_END", rData.nextName, `${current.title} - ${displayName}`, getMsg("logs.absenceQueue"));
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
                    const limitTime = parseStringToDate(current.timeWindow.split(" ~ ")[1]);
                    if (limitTime && now >= limitTime) {
                        await notifyUserDM(current.ownerId, getMsg("rooms.floorExpiredDM", {
                            title: current.title
                        })).catch(() => {});
                        current.ownerName && pushToDailyLogs("CLAIM_END", current.ownerName, current.title, getMsg("logs.timeout"));
                        freeFloorAndActivateNextGracePeriod(current);
                        panelUpdate = !0;
                        updateNeeded = !0;
                    }
                }
                if (current.next && current.next.endLimit) {
                    const absenceLimit = parseStringToDate(current.next.endLimit);
                    if (absenceLimit && now >= absenceLimit) {
                        await notifyUserDM(current.next.userId, getMsg("rooms.floorAbsenceDM", {
                            title: current.title
                        })).catch(() => {});
                        current.next.userName && pushToDailyLogs("CLAIM_END", current.next.userName, current.title, getMsg("logs.absenceQueue"));
                        const nextInLine = current.next.nextQueue;
                        if (nextInLine) {
                            current.next = nextInLine;
                            const grace = new Date(now.getTime() + 3e5);
                            current.next.endLimit = getFormattedTime12h(grace);
                            await notifyUserDM(current.next.userId, getMsg("rooms.floorTurnArrivedDM", {
                                title: current.title
                            })).catch(() => {});
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
                if ("event_group" === current.type) {
                    panelUpdate = !0; // Countdown timers for schedule/fixed events change each tick
                } else if ("antidemon" === current.type || "summon" === current.type) {
                    const roomList = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
                    for (const room of roomList) {
                        const rData = current[room];
                        if ((STATUS_CLAIMED === rData.status && rData.timeWindow) || rData.endLimit) {
                            panelUpdate = !0;
                            break;
                        }
                    }
                } else if ("fixed" === current.type) {
                    panelUpdate = !0; // Next opening countdown always changes
                } else {
                    // Check for boss respawn countdowns or elapsed time counters
                    for (const prop in current) {
                        if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) {
                            if (current[prop].status.startsWith("🔴 Killed at") && current[prop].cooldown) {
                                panelUpdate = !0;
                                break;
                            }
                            // Keep "🟢 Xm ago" elapsed time counter updated each tick
                            if (current[prop]._freeSince > 0) {
                                panelUpdate = !0;
                                break;
                            }
                        }
                    }
                    // Keep claimed panels fresh (embed timestamp, visible claim state)
                    if (!panelUpdate && current.ownerId) {
                        panelUpdate = !0;
                    }
                    // Also check for queue ETA or endLimit countdown on peak/square floors
                    if (!panelUpdate && current.next) {
                        panelUpdate = !0;
                    }
                }
            }
            if (panelUpdate) await refreshVisualPanel(key);
        }
        if (updateNeeded) saveLocalStorage();
    }, 1.5e4); // 15s refresh for countdown timers
}
