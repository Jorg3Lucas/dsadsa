// ==========================================
// 🧠 CLAIM / QUEUE / PUNISHMENT LOGIC
// Guild-aware: all operations scoped to a guild.
// ==========================================

import {
  getLocalTime,
  getFormattedTime12h,
  parseStringToDate,
} from "./time-utils.js";
import { getGuildState, getTimezone } from "./state.js";
import { notifyUserDM } from "./panel-utils.js";
import { getMsg } from "./lang.js";
import {
  STATUS_AVAILABLE,
  STATUS_CLAIMED,
  STATUS_OPEN,
} from "./constants.js";

const SUMMON_PROPS_INTERNAL = ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"];

// ==========================================
// ⏱️ Time helpers (guild-aware)
// ==========================================

function getTimeRemainingStr(timeWindow, timezone) {
  if (!timeWindow) return "";
  const endTime = parseStringToDate(timeWindow.split(" ~ ")[1], timezone);
  if (!endTime) return "";
  const diffMs = endTime.getTime() - getLocalTime(timezone).getTime();
  if (diffMs <= 0) return "⌛ Expired";
  const mins = Math.floor(diffMs / 6e4);
  const secs = Math.floor((diffMs % 6e4) / 1e3);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    mins = mins % 60;
    return `⏱️ ${hrs}h ${mins}m`;
  }
  return `⏱️ ${mins}m ${secs}s`;
}

// ==========================================
// 🔗 Linked ID helpers (simplified, no rankingDb)
// ==========================================

/**
 * Returns all Discord user IDs linked to the same account.
 * Without rankingDb, this simply returns [userId].
 */
export function getAllLinkedIds(userId) {
  return [userId];
}

// ==========================================
// 🧠 Claim / Queue checks
// ==========================================

export function hasActiveClaim(guildId, uid) {
  return getActiveClaimInfo(guildId, uid).length > 0;
}

export function getActiveClaimInfo(guildId, uid) {
  const state = getGuildState(guildId);
  if (!state) return [];
  const { db, timezone } = state;
  const linkedIds = getAllLinkedIds(uid);
  const claims = [];

  for (const linkedUid of linkedIds) {
    for (const key in db) {
      if (!db[key] || key.startsWith("_")) continue;
      const current = db[key];

      if ("antidemon" === current.type) {
        ["left", "mid", "right"].forEach((rm) => {
          if (current[rm].ownerId === linkedUid) {
            const remaining = getTimeRemainingStr(
              current[rm].timeWindow,
              timezone,
            );
            claims.push({
              title: `${current.title} - Room ${rm.toUpperCase()}`,
              type: "antidemon",
              room: rm,
              remaining,
            });
          }
        });
      } else if ("summon" === current.type) {
        SUMMON_PROPS_INTERNAL.forEach((loc) => {
          if (current[loc] && current[loc].ownerId === linkedUid) {
            const remaining = getTimeRemainingStr(
              current[loc].timeWindow,
              timezone,
            );
            claims.push({
              title: `${current.title} - ${current[loc].name}`,
              type: "summon",
              loc,
              remaining,
            });
          }
        });
      } else {
        if (current.ownerId === linkedUid) {
          const remaining = getTimeRemainingStr(
            current.timeWindow,
            timezone,
          );
          claims.push({
            title: current.title,
            type: current.type,
            remaining,
          });
        }
      }
    }
  }
  return claims;
}

export function buildActiveClaimMessage(guildId, uid) {
  const claims = getActiveClaimInfo(guildId, uid);
  if (claims.length === 0) return null;
  const claimList = claims
    .map((c) => {
      let line = `• ${c.title}`;
      if (c.remaining) line += ` — ${c.remaining}`;
      return line;
    })
    .join("\n");
  return `🚫 You already have an active claim at:\n${claimList}\n\nUse the 🚪 Leave button on the respective panel to cancel.`;
}

export function hasActiveQueue(guildId, uid) {
  const state = getGuildState(guildId);
  if (!state) return false;
  const { db } = state;
  const linkedIds = getAllLinkedIds(uid);

  for (const linkedUid of linkedIds) {
    for (const key in db) {
      if (!db[key] || key.startsWith("_")) continue;
      const current = db[key];
      if ("antidemon" === current.type) {
        if (
          current.left.nextId === linkedUid ||
          current.mid.nextId === linkedUid ||
          current.right.nextId === linkedUid
        )
          return true;
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

// ==========================================
// ⚖️ Punishments
// ==========================================

export function checkPunishment(guildId, uid) {
  const state = getGuildState(guildId);
  if (!state) return null;
  const { punishments } = state;
  if (punishments[uid]) {
    const rem = punishments[uid] - Date.now();
    if (rem > 0) {
      return getMsg("cooldowns.activeTimeout", {
        minutes: Math.floor(rem / 6e4),
        seconds: Math.floor((rem % 6e4) / 1e3),
      });
    }
    delete punishments[uid];
    state.saveLocalStorage();
  }
  return null;
}

export function applyFiveMinCooldown(guildId, uid) {
  const state = getGuildState(guildId);
  if (!state) return;
  state.punishments[uid] = Date.now() + 3e5;
  state.savePunishmentsToDisk();
}

// ==========================================
// 📋 Queue management
// ==========================================

export function removeUserFromQueue(floorObj, uid) {
  if (!floorObj.next) return false;
  if (floorObj.next.userId === uid) {
    floorObj.next = floorObj.next.nextQueue || null;
    return true;
  }
  let curr = floorObj.next;
  for (; curr.nextQueue; ) {
    if (curr.nextQueue.userId === uid) {
      curr.nextQueue = curr.nextQueue.nextQueue;
      return true;
    }
    curr = curr.nextQueue;
  }
  return false;
}

// ==========================================
// 🆓 Floor / Room release
// ==========================================

export function freeFloorAndActivateNextGracePeriod(guildId, floorObj) {
  const state = getGuildState(guildId);
  if (!state) return;
  const { logEvent, saveLocalStorage, timezone } = state;

  logEvent(`${floorObj.title} completely released/closed.`);
  floorObj.ownerId = null;
  floorObj.ownerName = null;
  floorObj.timeWindow = "";
  if (floorObj._claimTimestamp) delete floorObj._claimTimestamp;

  if (floorObj.next) {
    const grace = new Date(getLocalTime(timezone).getTime() + 3e5);
    floorObj.next.endLimit = getFormattedTime12h(grace);
    notifyUserDM(
      floorObj.next.userId,
      getMsg("rooms.floorTurnArrivedDM", { title: floorObj.title }),
    );
  }
  saveLocalStorage();
}

export function freeAntidemonRoom(guildId, floorObj, roomKey) {
  const state = getGuildState(guildId);
  if (!state) return;
  const { saveLocalStorage, timezone } = state;

  const target = floorObj[roomKey];
  target.status = STATUS_AVAILABLE;
  target.ownerId = null;
  target.ownerName = null;
  target.time = "";
  target.timeWindow = "";

  if (target.nextId) {
    const nid = target.nextId;
    const nname = target.nextName;
    target.nextId = null;
    target.nextName = null;
    target.formattedTimeNext = "";
    target.status = STATUS_OPEN;
    target.nextId = nid;
    target.nextName = nname;
    const grace = new Date(getLocalTime(timezone).getTime() + 3e5);
    target.endLimit = getFormattedTime12h(grace);
    notifyUserDM(
      nid,
      getMsg("rooms.antidemonTurnArrivedDM", {
        roomKey: roomKey.toUpperCase(),
        title: floorObj.title,
      }),
    );
  } else {
    target.endLimit = null;
  }
  saveLocalStorage();
}

// ==========================================
// 🎯 Menu builders (anti / summon)
// ==========================================

export function buildAntiClaimOptions(targetObj, uid) {
  const opts = [];

  const hasPriority = (room) =>
    targetObj[room].nextId === uid && targetObj[room].status !== STATUS_CLAIMED;

  if (hasPriority("left") && hasPriority("mid")) {
    opts.push({
      label: "🔵⬅️ MID + LEFT",
      description: getMsg("rooms.antidemonRoomMidLeft"),
      value: "mid-left",
      emoji: "🔵",
    });
  } else if (hasPriority("mid") && hasPriority("right")) {
    opts.push({
      label: "🔵➡️ MID + RIGHT",
      description: getMsg("rooms.antidemonRoomMidRight"),
      value: "mid-right",
      emoji: "🔵",
    });
  } else if (hasPriority("left") || hasPriority("mid") || hasPriority("right")) {
    if (hasPriority("left"))
      opts.push({
        label: "⬅️ LEFT ROOM",
        description: getMsg("rooms.antidemonRoomLeft"),
        value: "left",
        emoji: "⬅️",
      });
    if (hasPriority("mid"))
      opts.push({
        label: "🔵 MID ROOM",
        description: getMsg("rooms.antidemonRoomMid"),
        value: "mid",
        emoji: "🔵",
      });
    if (hasPriority("right"))
      opts.push({
        label: "➡️ RIGHT ROOM",
        description: getMsg("rooms.antidemonRoomRight"),
        value: "right",
        emoji: "➡️",
      });
  } else {
    const freeRooms = ["left", "mid", "right"].filter(
      (rm) =>
        targetObj[rm].status !== STATUS_CLAIMED && !targetObj[rm].nextId,
    );
    if (freeRooms.includes("left"))
      opts.push({
        label: "⬅️ LEFT ROOM",
        description: getMsg("rooms.antidemonRoomLeft"),
        value: "left",
        emoji: "⬅️",
      });
    if (freeRooms.includes("mid"))
      opts.push({
        label: "🔵 MID ROOM",
        description: getMsg("rooms.antidemonRoomMid"),
        value: "mid",
        emoji: "🔵",
      });
    if (freeRooms.includes("right"))
      opts.push({
        label: "➡️ RIGHT ROOM",
        description: getMsg("rooms.antidemonRoomRight"),
        value: "right",
        emoji: "➡️",
      });
    if (freeRooms.includes("left") && freeRooms.includes("mid")) {
      opts.push({
        label: "🔵⬅️ MID + LEFT",
        description: getMsg("rooms.antidemonRoomMidLeft"),
        value: "mid-left",
        emoji: "🔵",
      });
    }
    if (freeRooms.includes("mid") && freeRooms.includes("right")) {
      opts.push({
        label: "🔵➡️ MID + RIGHT",
        description: getMsg("rooms.antidemonRoomMidRight"),
        value: "mid-right",
        emoji: "🔵",
      });
    }
  }
  return opts;
}

export function buildAntiQueueOptions(targetObj) {
  const opts = [];
  if (targetObj.left.status === STATUS_CLAIMED && !targetObj.left.nextId) {
    opts.push({
      label: "⬅️ LEFT ROOM",
      description: getMsg("rooms.antidemonQueueLeft"),
      value: "left",
      emoji: "⬅️",
    });
  }
  if (targetObj.mid.status === STATUS_CLAIMED && !targetObj.mid.nextId) {
    opts.push({
      label: "🔵 MID ROOM",
      description: getMsg("rooms.antidemonQueueMid"),
      value: "mid",
      emoji: "🔵",
    });
  }
  if (targetObj.right.status === STATUS_CLAIMED && !targetObj.right.nextId) {
    opts.push({
      label: "➡️ RIGHT ROOM",
      description: getMsg("rooms.antidemonQueueRight"),
      value: "right",
      emoji: "➡️",
    });
  }
  if (
    targetObj.left.status === STATUS_CLAIMED &&
    targetObj.mid.status === STATUS_CLAIMED &&
    !targetObj.left.nextId &&
    !targetObj.mid.nextId &&
    (!targetObj.mid.ownerId ||
      targetObj.mid.ownerId === targetObj.left.ownerId)
  ) {
    opts.push({
      label: "🔵⬅️ MID + LEFT",
      description: getMsg("rooms.antidemonQueueMidLeft"),
      value: "mid-left",
      emoji: "🔵",
    });
  }
  if (
    targetObj.mid.status === STATUS_CLAIMED &&
    targetObj.right.status === STATUS_CLAIMED &&
    !targetObj.mid.nextId &&
    !targetObj.right.nextId &&
    (!targetObj.mid.ownerId ||
      targetObj.mid.ownerId === targetObj.right.ownerId)
  ) {
    opts.push({
      label: "🔵➡️ MID + RIGHT",
      description: getMsg("rooms.antidemonQueueMidRight"),
      value: "mid-right",
      emoji: "🔵",
    });
  }
  return opts;
}
