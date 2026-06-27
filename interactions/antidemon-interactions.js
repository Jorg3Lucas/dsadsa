// ==========================================
// 👹 ANTIDEMON INTERACTION HANDLERS
// Guild-aware: antislide-, antiticket-, antinextside-
// ==========================================

import { getMsg, getArray } from "../lang.js";
import { getGuildState, getDb } from "../state.js";
import { refreshVisualPanel, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs } from "../daily-logs.js";
import {
  hasActiveClaim,
  hasActiveQueue,
  checkPunishment,
  applyFiveMinCooldown,
  freeAntidemonRoom,
  buildActiveClaimMessage,
} from "../claim-core.js";
import {
  ActionRowBuilder as t,
  StringSelectMenuBuilder as i,
  ButtonBuilder as n,
  ButtonStyle as a,
} from "discord.js";
import {
  getLocalTime,
  getFormattedTime12h,
  parseStringToDate,
} from "../time-utils.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN } from "../constants.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleAntidemonInteraction(interaction) {
  const cid = interaction.customId;
  return (
    cid.startsWith("antislide-") ||
    cid.startsWith("antiticket-") ||
    cid.startsWith("antinextside-")
  );
}

export async function handleAntidemonInteraction(interaction, guildId, uid, uName) {
  const cid = interaction.customId;

  if (cid.startsWith("antislide-")) {
    return handleAntiSlide(interaction, guildId, uid);
  }
  if (cid.startsWith("antiticket-")) {
    return handleAntiTicket(interaction, guildId, uid, uName);
  }
  if (cid.startsWith("antinextside-")) {
    return handleAntiNextSide(interaction, guildId, uid, uName);
  }

  return false;
}

// ==========================================
// 🎯 ANTIDEMON SLIDE — Room Selection
// ==========================================

async function handleAntiSlide(interaction, guildId, uid) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

  const pKey = interaction.customId.replace("antislide-", "");
  const db = getDb(guildId);
  const targetFloor = db ? db[pKey] : null;
  if (!targetFloor) return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});

  const configSelected = interaction.values[0];

  if (hasActiveClaim(guildId, uid)) {
    return await interaction.update({ content: buildActiveClaimMessage(guildId, uid), components: [], flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) {
    const hasPriority = ["left", "mid", "right"].some((rm) => targetFloor[rm].nextId === uid);
    if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
  }

  const state = getGuildState(guildId);
  if (state) state.antiDemonSelectionCache[uid] = { panelId: pKey, roomConfig: configSelected };

  return await interaction.update({
    content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
    components: [
      new t().addComponents(
        new i()
          .setCustomId(`antiticket-${pKey}`)
          .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
          .addOptions(getArray("tickets").map((e) => ({ label: e.label, value: e.value, emoji: "🎫" }))),
      ),
    ],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// 🎟️ ANTIDEMON TICKET — Time Selection
// ==========================================

async function handleAntiTicket(interaction, guildId, uid, uName) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

  const pKey = interaction.customId.replace("antiticket-", "");
  const db = getDb(guildId);
  const targetFloor = db ? db[pKey] : null;
  const state = getGuildState(guildId);
  if (!targetFloor || !state) return;

  const cacheObj = state.antiDemonSelectionCache[uid];
  if (!cacheObj || cacheObj.panelId !== pKey) {
    return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
  }

  if (hasActiveClaim(guildId, uid)) {
    return await interaction.update({ content: buildActiveClaimMessage(guildId, uid), components: [], flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) {
    const hasPriority = ["left", "mid", "right"].some((rm) => targetFloor[rm].nextId === uid);
    if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
  }

  const { timezone } = state;
  const configSelected = cacheObj.roomConfig;
  const calcMinutes = 30 * parseInt(interaction.values[0]);
  const startTime = getLocalTime(timezone);
  const endTime = new Date(startTime.getTime() + 6e4 * calcMinutes);
  const rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;
  let roomsToClaim = [];

  if ("mid-left" === configSelected) roomsToClaim = ["left", "mid"];
  else if ("mid-right" === configSelected) roomsToClaim = ["mid", "right"];
  else roomsToClaim = [configSelected];

  // Check priority reservation for each room
  for (const roomKey of roomsToClaim) {
    if (targetFloor[roomKey].nextId && targetFloor[roomKey].nextId !== uid) {
      let timeRemainingStr = "";
      if (targetFloor[roomKey].endLimit) {
        const limitTime = parseStringToDate(targetFloor[roomKey].endLimit, timezone);
        if (limitTime) {
          const diffMins = Math.ceil((limitTime.getTime() - getLocalTime(timezone).getTime()) / 6e4);
          if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
        }
      }
      if (timeRemainingStr) {
        delete state.antiDemonSelectionCache[uid];
        return await interaction.update({
          content: getMsg("cooldowns.floorReservedNotice", { userName: targetFloor[roomKey].nextName, timeRemaining: timeRemainingStr }),
          components: [],
          flags: 64,
        }).catch(() => {});
      }
      targetFloor[roomKey].nextId = null;
      targetFloor[roomKey].nextName = null;
      targetFloor[roomKey].endLimit = null;
      targetFloor[roomKey].formattedTimeNext = "";
      if (STATUS_OPEN === targetFloor[roomKey].status) targetFloor[roomKey].status = STATUS_AVAILABLE;
    }
  }

  // Race condition guard
  for (const roomKey of roomsToClaim) {
    if (targetFloor[roomKey].ownerId) {
      delete state.antiDemonSelectionCache[uid];
      return await interaction.update({
        content: getMsg("rooms.slotAlreadyClaimed", { room: roomKey.toUpperCase(), ownerName: targetFloor[roomKey].ownerName || getMsg("render.unknownUser") }),
        components: [],
        flags: 64,
      }).catch(() => {});
    }
  }

  const applyClaim = (roomKey) => {
    if (targetFloor[roomKey].nextId === uid) {
      targetFloor[roomKey].nextId = null;
      targetFloor[roomKey].nextName = null;
      targetFloor[roomKey].endLimit = null;
    }
    targetFloor[roomKey].status = STATUS_CLAIMED;
    targetFloor[roomKey].ownerId = uid;
    targetFloor[roomKey].ownerName = uName;
    targetFloor[roomKey].time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
    targetFloor[roomKey].timeWindow = rangeStr;
  };

  roomsToClaim.forEach((roomKey) => applyClaim(roomKey));
  pushToDailyLogs(guildId, "CLAIM_START", uName, `${targetFloor.title} - Config: ${configSelected.toUpperCase()}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);
  notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} (${configSelected.toUpperCase()})`, window: rangeStr }));

  delete state.antiDemonSelectionCache[uid];
  state.saveLocalStorage();
  await refreshVisualPanel(guildId, pKey);
  return await interaction.update({
    content: getMsg("rooms.antidemonClaimSuccessEphemeral"),
    components: [],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// ⏭️ ANTIDEMON NEXT / QUEUE
// ==========================================

async function handleAntiNextSide(interaction, guildId, uid, uName) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

  const pKey = interaction.customId.replace("antinextside-", "");
  const db = getDb(guildId);
  const targetFloor = db ? db[pKey] : null;
  const state = getGuildState(guildId);
  if (!targetFloor || !state) return;

  if (hasActiveClaim(guildId, uid)) {
    return await interaction.update({ content: buildActiveClaimMessage(guildId, uid), components: [], flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});

  const { timezone } = state;

  const tryJoinQueue = (roomKey) => {
    if (targetFloor[roomKey].nextId) return false;
    if (targetFloor[roomKey].status !== STATUS_CLAIMED) return false;
    let baseTime = getLocalTime(timezone);
    if (targetFloor[roomKey].timeWindow) {
      const calcLimit = parseStringToDate(targetFloor[roomKey].timeWindow.split(" ~ ")[1], timezone);
      if (calcLimit) baseTime = calcLimit;
    }
    targetFloor[roomKey].nextId = uid;
    targetFloor[roomKey].nextName = uName;
    targetFloor[roomKey].formattedTimeNext = getFormattedTime12h(baseTime);
    targetFloor[roomKey].endLimit = null;
    return true;
  };

  const choice = interaction.values[0];
  const joinedRooms = [];

  if ("mid-left" === choice) {
    if (tryJoinQueue("left")) joinedRooms.push("LEFT");
    if (tryJoinQueue("mid")) joinedRooms.push("MID");
  } else if ("mid-right" === choice) {
    if (tryJoinQueue("mid")) joinedRooms.push("MID");
    if (tryJoinQueue("right")) joinedRooms.push("RIGHT");
  } else if (tryJoinQueue(choice)) {
    joinedRooms.push(choice.toUpperCase());
  }

  if (joinedRooms.length > 0) {
    const roomsLabel = joinedRooms.join(" + ");
    pushToDailyLogs(guildId, "QUEUE_JOIN", uName, `${targetFloor.title} - Room ${roomsLabel}`, getMsg("render.joinedAsNext"));
    notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: `${targetFloor.title} - Room ${roomsLabel}` }));
    state.saveLocalStorage();
    await refreshVisualPanel(guildId, pKey);
    return await interaction.update({
      content: getMsg("rooms.antidemonQueueSuccessEphemeral"),
      components: [],
      flags: 64,
    }).catch(() => {});
  }

  return await interaction.update({
    content: getMsg("rooms.antidemonQueueLocked"),
    components: [],
    flags: 64,
  }).catch(() => {});
}
