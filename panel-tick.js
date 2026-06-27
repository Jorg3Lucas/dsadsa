// ==========================================
// ⏱️ TICK INTERVAL (15s refresh)
// Iterates over ALL guilds, refreshing panels
// and handling expirations per guild.
// ==========================================

import {
  getLocalTime,
  isRoomOpen,
  parseStringToDate,
  usesScheduleRespawn,
  getFormattedTime12h,
  calculateNextOpening,
  redBossSchedules,
  leader3Schedules,
} from "./time-utils.js";
import { getMsg, reloadLanguage } from "./lang.js";
import {
  getAllGuildStates,
  getGuildState,
  getTimezone,
} from "./state.js";
import { pushToDailyLogs, dispatchDailyLogs } from "./daily-logs.js";
import { refreshVisualPanel, notifyUserDM } from "./panel-utils.js";
import {
  freeFloorAndActivateNextGracePeriod,
  freeAntidemonRoom,
} from "./claim-core.js";
import {
  STATUS_AVAILABLE,
  STATUS_CLAIMED,
  STATUS_KILLED,
  STATUS_KILLED_PREFIX,
} from "./constants.js";

// ==========================================
// ⏱️ TICK INTERVAL (15s refresh)
// ==========================================

let tickIntervalStarted = false;

export function startTickInterval() {
  if (tickIntervalStarted) return;
  tickIntervalStarted = true;

  setInterval(async () => {
    reloadLanguage();

    for (const state of getAllGuildStates()) {
      await processGuildTick(state);
    }
  }, 1.5e4); // 15s refresh
}

async function processGuildTick(state) {
  const { guildId, db, dailyLogs, alertCache, bossSpawnAlertCache, saveLocalStorage, timezone } = state;
  let updateNeeded = false;
  const now = getLocalTime(timezone);

  // ── Daily logs dispatch at 18:00 (guild's configured timezone) ──
  if (18 === now.getHours() && 0 === now.getMinutes() && !alertCache._dailyDispatched) {
    alertCache._dailyDispatched = true;
    await dispatchDailyLogs(guildId, false);
    alertCache.warning5mAfter = {};
    alertCache.spawnAlerted = {};
    Object.keys(bossSpawnAlertCache).forEach((k) => delete bossSpawnAlertCache[k]);
  }
  if (alertCache._dailyDispatched && (now.getHours() !== 18 || now.getMinutes() > 1)) {
    alertCache._dailyDispatched = false;
  }

  for (const key in db) {
    const current = db[key];
    if (!current || key.startsWith("_")) continue;
    let panelUpdate = false;

    // ── Peak: Red Boss schedule-based respawn ──
    if ("peak" === current.type && isRoomOpen(redBossSchedules, 0, timezone)) {
      if (STATUS_AVAILABLE !== current.red.status && now.getMinutes() === 5 && current.ownerId) {
        if (!alertCache.warning5mAfter[`${key}-red-${now.getHours()}`]) {
          await notifyUserDM(
            current.ownerId,
            getMsg("rooms.dmBossNotMarkedWarning", {
              title: current.title,
              boss: current.red.name,
            }),
          ).catch(() => {});
          alertCache.warning5mAfter[`${key}-red-${now.getHours()}`] = true;
        }
      }
      if (STATUS_AVAILABLE !== current.red.status && now.getMinutes() === 0) {
        current.red._lastKilledTimeStr = current.red.status.replace(STATUS_KILLED_PREFIX, "").trim();
        current.red.status = STATUS_AVAILABLE;
        current.red._freeSince = now.getTime();
        if (current.ownerId) {
          await notifyUserDM(
            current.ownerId,
            getMsg("rooms.dmImmediateSpawnFixed", {
              title: current.title,
              boss: current.red.name,
            }),
          ).catch(() => {});
        }
        panelUpdate = true;
        updateNeeded = true;
      }
    }

    // ── Normal: Leader 3 schedule-based respawn ──
    if ("normal" === current.type && current.boss3 && isRoomOpen(leader3Schedules, 0, timezone)) {
      if (STATUS_AVAILABLE !== current.boss3.status && now.getMinutes() === 5 && current.ownerId) {
        if (!alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`]) {
          await notifyUserDM(
            current.ownerId,
            getMsg("rooms.dmBossNotMarkedWarning", {
              title: current.title,
              boss: current.boss3.name,
            }),
          ).catch(() => {});
          alertCache.warning5mAfter[`${key}-boss3-${now.getHours()}`] = true;
        }
      }
      if (STATUS_AVAILABLE !== current.boss3.status && now.getMinutes() === 0) {
        current.boss3._lastKilledTimeStr = current.boss3.status.replace(STATUS_KILLED_PREFIX, "").trim();
        current.boss3.status = STATUS_AVAILABLE;
        current.boss3._freeSince = now.getTime();
        if (current.ownerId) {
          await notifyUserDM(
            current.ownerId,
            getMsg("rooms.dmImmediateSpawnFixed", {
              title: current.title,
              boss: current.boss3.name,
            }),
          ).catch(() => {});
        }
        panelUpdate = true;
        updateNeeded = true;
      }
    }

    // ── Fixed type (Fury/Frenzy) ──
    if ("fixed" === current.type && current.schedules) {
      const minuteOffset = current.scheduleMinutes || 0;
      if (isRoomOpen(current.schedules, minuteOffset, timezone)) {
        if ("" === current.timeWindow) {
          panelUpdate = true;
          updateNeeded = true;
        }
      } else {
        const nextOpen = calculateNextOpening(current.schedules, minuteOffset, timezone);
        const fiveMinBefore = new Date(nextOpen.getTime() - 5 * 60 * 1000);
        const insidePreWindow = now >= fiveMinBefore && now < nextOpen;

        if (!insidePreWindow && ("" !== current.timeWindow || current.ownerId)) {
          if (current.ownerName) {
            pushToDailyLogs(guildId, "CLAIM_END", current.ownerName, current.title, getMsg("logs.autoClose"));
          }
          await notifyUserDM(
            current.ownerId,
            getMsg("rooms.dmRemovedNotice", {
              title: current.title,
              reason: getMsg("logs.autoClose"),
            }),
          ).catch(() => {});
          freeFloorAndActivateNextGracePeriod(guildId, current);
          panelUpdate = true;
          updateNeeded = true;
        }
      }
    }

    // ── Individual boss cooldowns (non-fixed, non-antidemon, non-summon) ──
    if ("antidemon" !== current.type && "fixed" !== current.type) {
      for (const prop in current) {
        if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;

        if (current[prop].status.startsWith("🔴")) {
          if (usesScheduleRespawn(current, prop)) continue;

          const killedTimeStr = current[prop].status.replace(STATUS_KILLED_PREFIX, "").trim();
          let killedTime;
          if (current[prop]._lastKilledAt) {
            killedTime = new Date(current[prop]._lastKilledAt);
          } else {
            killedTime = parseStringToDate(killedTimeStr, timezone);
          }
          if (killedTime) {
            const secondsPassed = Math.floor((now.getTime() - killedTime.getTime()) / 1e3);
            const totalCooldownSeconds = 60 * current[prop].cooldown;

            if (secondsPassed >= totalCooldownSeconds) {
              current[prop].status = STATUS_AVAILABLE;
              current[prop]._freeSince = now.getTime();
              current[prop]._lastKilledTimeStr = killedTimeStr;
              panelUpdate = true;
              updateNeeded = true;

              if (current.ownerId) {
                const spawnKeyAlert = `${key}-${prop}-spawn-${now.getHours()}-${now.getMinutes()}`;
                if (!alertCache.spawnAlerted[spawnKeyAlert]) {
                  await notifyUserDM(
                    current.ownerId,
                    getMsg("rooms.dmImmediateSpawn", {
                      title: current.title,
                      boss: current[prop].name,
                    }),
                  ).catch(() => {});
                  alertCache.spawnAlerted[spawnKeyAlert] = true;
                }
              }
            }
          }
        }

        // DM warning: 5min after boss respawn
        if (STATUS_AVAILABLE === current[prop].status && current[prop]._freeSince > 0 && current._claimTimestamp) {
          if (current[prop]._freeSince > current._claimTimestamp) {
            const minutesIdle = Math.floor((now.getTime() - current[prop]._freeSince) / 6e4);
            const targetKeyAlert = `${key}-${prop}`;
            if (minutesIdle >= 5 && current.ownerId && !alertCache.warning5mAfter[targetKeyAlert]) {
              await notifyUserDM(
                current.ownerId,
                getMsg("rooms.dmBossNotMarkedWarning", {
                  title: current.title,
                  boss: current[prop].name,
                }),
              ).catch(() => {});
              alertCache.warning5mAfter[targetKeyAlert] = true;
            }
          }
        }
      }
    }

    // ── Antidemon / Summon: room expiration ──
    if ("antidemon" === current.type || "summon" === current.type) {
      const roomList =
        "summon" === current.type
          ? ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"]
          : ["left", "mid", "right"];
      for (const room of roomList) {
        const rData = current[room];
        if (STATUS_CLAIMED === rData.status && rData.timeWindow) {
          const limitTime = parseStringToDate(rData.timeWindow.split(" ~ ")[1], timezone);
          if (limitTime && now >= limitTime) {
            if (rData.ownerName) {
              pushToDailyLogs(guildId, "CLAIM_END", rData.ownerName, `${current.title} - Room ${room.toUpperCase()}`, getMsg("logs.timeout"));
            }
            await notifyUserDM(
              rData.ownerId,
              getMsg("rooms.dmRemovedNotice", {
                title: `${current.title} - Room ${room.toUpperCase()}`,
                reason: getMsg("logs.timeout"),
              }),
            ).catch(() => {});
            freeAntidemonRoom(guildId, current, room);
            panelUpdate = true;
            updateNeeded = true;
          }
        }
        if (rData.endLimit && rData.nextId) {
          const absenceLimit = parseStringToDate(rData.endLimit, timezone);
          if (absenceLimit && now >= absenceLimit) {
            await notifyUserDM(
              rData.nextId,
              getMsg("rooms.antidemonAbsenceDM", {
                roomKey: room.toUpperCase(),
                title: current.title,
              }),
            ).catch(() => {});
            if (rData.nextName) {
              pushToDailyLogs(guildId, "CLAIM_END", rData.nextName, `${current.title} - Room ${room.toUpperCase()}`, getMsg("logs.absenceQueue"));
            }
            rData.nextId = null;
            rData.nextName = null;
            rData.endLimit = null;
            rData.formattedTimeNext = "";
            freeAntidemonRoom(guildId, current, room);
            panelUpdate = true;
            updateNeeded = true;
          }
        }
      }
    } else {
      // ── Non-antidemon/non-summon: floor expiration & queue ──
      if (current.ownerId && current.timeWindow && "fixed" !== current.type) {
        const limitTime = parseStringToDate(current.timeWindow.split(" ~ ")[1], timezone);
        if (limitTime && now >= limitTime) {
          await notifyUserDM(
            current.ownerId,
            getMsg("rooms.floorExpiredDM", { title: current.title }),
          ).catch(() => {});
          if (current.ownerName) {
            pushToDailyLogs(guildId, "CLAIM_END", current.ownerName, current.title, getMsg("logs.timeout"));
          }
          freeFloorAndActivateNextGracePeriod(guildId, current);
          panelUpdate = true;
          updateNeeded = true;
        }
      }
      if (current.next && current.next.endLimit) {
        const absenceLimit = parseStringToDate(current.next.endLimit, timezone);
        if (absenceLimit && now >= absenceLimit) {
          await notifyUserDM(
            current.next.userId,
            getMsg("rooms.floorAbsenceDM", { title: current.title }),
          ).catch(() => {});
          if (current.next.userName) {
            pushToDailyLogs(guildId, "CLAIM_END", current.next.userName, current.title, getMsg("logs.absenceQueue"));
          }
          const nextInLine = current.next.nextQueue;
          if (nextInLine) {
            current.next = nextInLine;
            const grace = new Date(now.getTime() + 3e5);
            current.next.endLimit = getFormattedTime12h(grace);
            await notifyUserDM(
              current.next.userId,
              getMsg("rooms.floorTurnArrivedDM", { title: current.title }),
            ).catch(() => {});
          } else {
            current.next = null;
          }
          panelUpdate = true;
          updateNeeded = true;
        }
      }
    }

    // Force refresh for countdown timers
    if (!panelUpdate) {
      if ("antidemon" === current.type || "summon" === current.type) {
        const roomList =
          "summon" === current.type
            ? ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"]
            : ["left", "mid", "right"];
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
          if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) {
            if (current[prop].status.startsWith("🔴 Killed at") && current[prop].cooldown) {
              panelUpdate = true;
              break;
            }
          }
        }
        if (!panelUpdate && current.next && current.next.endLimit) {
          panelUpdate = true;
        }
      }
    }

    if (panelUpdate) await refreshVisualPanel(guildId, key);
  }

  if (updateNeeded) saveLocalStorage();
}
