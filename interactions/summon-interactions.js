// ==========================================
// 🌀 SUMMON INTERACTION HANDLERS
// Guild-aware: summonslide-, summonticket-, summonnextside-
// ==========================================

import { getMsg, getArray } from "../lang.js";
import { getGuildState, getDb } from "../state.js";
import { refreshVisualPanel, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs } from "../daily-logs.js";
import {
  hasActiveClaim,
  hasActiveQueue,
  checkPunishment,
  freeAntidemonRoom,
  buildActiveClaimMessage,
} from "../claim-core.js";
import {
  ActionRowBuilder as t,
  StringSelectMenuBuilder as i,
} from "discord.js";
import {
  getLocalTime,
  getFormattedTime12h,
  parseStringToDate,
} from "../time-utils.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN } from "../constants.js";

const SUMMON_PROPS = ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"];

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleSummonInteraction(interaction) {
  const cid = interaction.customId;
  return (
    cid.startsWith("summonslide-") ||
    cid.startsWith("summonticket-") ||
    cid.startsWith("summonnextside-")
  );
}

export async function handleSummonInteraction(interaction, guildId, uid, uName) {
  const cid = interaction.customId;

  if (cid.startsWith("summonslide-")) {
    return handleSummonSlide(interaction, guildId, uid);
  }
  if (cid.startsWith("summonticket-")) {
    return handleSummonTicket(interaction, guildId, uid, uName);
  }
  if (cid.startsWith("summonnextside-")) {
    return handleSummonNextSide(interaction, guildId, uid, uName);
  }

  return false;
}

// ==========================================
// 🎯 SUMMON SLIDE — Location Selection
// ==========================================

async function handleSummonSlide(interaction, guildId, uid) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

  const pKey = interaction.customId.replace("summonslide-", "");
  const db = getDb(guildId);
  const targetFloor = db ? db[pKey] : null;
  const state = getGuildState(guildId);
  if (!targetFloor || !state) return;

  const selectedLoc = interaction.values[0];

  if (hasActiveClaim(guildId, uid)) {
    return await interaction.update({ content: buildActiveClaimMessage(guildId, uid), components: [], flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) {
    const hasPriority = SUMMON_PROPS.some((loc) => targetFloor[loc].nextId === uid);
    if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
  }

  state.summonSelectionCache[uid] = { panelId: pKey, selectedLoc };

  return await interaction.update({
    content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
    components: [
      new t().addComponents(
        new i()
          .setCustomId(`summonticket-${pKey}`)
          .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
          .addOptions(getArray("tickets").map((e) => ({ label: e.label, value: e.value, emoji: "🎫" }))),
      ),
    ],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// 🎟️ SUMMON TICKET — Time Selection
// ==========================================

async function handleSummonTicket(interaction, guildId, uid, uName) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

  const pKey = interaction.customId.replace("summonticket-", "");
  const db = getDb(guildId);
  const targetFloor = db ? db[pKey] : null;
  const state = getGuildState(guildId);
  if (!targetFloor || !state) return;

  const cacheObj = state.summonSelectionCache[uid];
  if (!cacheObj || cacheObj.panelId !== pKey) {
    return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
  }

  if (hasActiveClaim(guildId, uid)) {
    return await interaction.update({ content: buildActiveClaimMessage(guildId, uid), components: [], flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) {
    const hasPriority = SUMMON_PROPS.some((loc) => targetFloor[loc].nextId === uid);
    if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
  }

  const { timezone } = state;
  const selectedLoc = cacheObj.selectedLoc;
  const calcMinutes = 30 * parseInt(interaction.values[0]);
  const startTime = getLocalTime(timezone);
  const endTime = new Date(startTime.getTime() + 6e4 * calcMinutes);
  const rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;

  // Check priority reservation
  if (targetFloor[selectedLoc].nextId && targetFloor[selectedLoc].nextId !== uid) {
    let timeRemainingStr = "";
    if (targetFloor[selectedLoc].endLimit) {
      const limitTime = parseStringToDate(targetFloor[selectedLoc].endLimit, timezone);
      if (limitTime) {
        const diffMins = Math.ceil((limitTime.getTime() - getLocalTime(timezone).getTime()) / 6e4);
        if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
      }
    }
    if (timeRemainingStr) {
      delete state.summonSelectionCache[uid];
      return await interaction.update({
        content: getMsg("cooldowns.floorReservedNotice", { userName: targetFloor[selectedLoc].nextName, timeRemaining: timeRemainingStr }),
        components: [],
        flags: 64,
      }).catch(() => {});
    }
    targetFloor[selectedLoc].nextId = null;
    targetFloor[selectedLoc].nextName = null;
    targetFloor[selectedLoc].endLimit = null;
    targetFloor[selectedLoc].formattedTimeNext = "";
    if (STATUS_OPEN === targetFloor[selectedLoc].status) targetFloor[selectedLoc].status = STATUS_AVAILABLE;
  }

  // Race condition guard
  if (targetFloor[selectedLoc].ownerId) {
    delete state.summonSelectionCache[uid];
    return await interaction.update({
      content: getMsg("rooms.slotAlreadyClaimed", { room: targetFloor[selectedLoc].name, ownerName: targetFloor[selectedLoc].ownerName || getMsg("render.unknownUser") }),
      components: [],
      flags: 64,
    }).catch(() => {});
  }

  if (targetFloor[selectedLoc].nextId === uid) {
    targetFloor[selectedLoc].nextId = null;
    targetFloor[selectedLoc].nextName = null;
    targetFloor[selectedLoc].endLimit = null;
    targetFloor[selectedLoc].formattedTimeNext = "";
  }

  targetFloor[selectedLoc].status = STATUS_CLAIMED;
  targetFloor[selectedLoc].ownerId = uid;
  targetFloor[selectedLoc].ownerName = uName;
  targetFloor[selectedLoc].time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
  targetFloor[selectedLoc].timeWindow = rangeStr;

  pushToDailyLogs(guildId, "CLAIM_START", uName, `${targetFloor.title} - ${targetFloor[selectedLoc].name}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);
  notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} (${targetFloor[selectedLoc].name})`, window: rangeStr }));

  delete state.summonSelectionCache[uid];
  state.saveLocalStorage();
  await refreshVisualPanel(guildId, pKey);
  return await interaction.update({
    content: getMsg("rooms.summonClaimSuccessEphemeral"),
    components: [],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// ⏭️ SUMMON NEXT / QUEUE
// ==========================================

async function handleSummonNextSide(interaction, guildId, uid, uName) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

  const pKey = interaction.customId.replace("summonnextside-", "");
  const db = getDb(guildId);
  const targetFloor = db ? db[pKey] : null;
  const state = getGuildState(guildId);
  if (!targetFloor || !state) return;

  if (hasActiveClaim(guildId, uid)) {
    return await interaction.update({ content: buildActiveClaimMessage(guildId, uid), components: [], flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});

  const { timezone } = state;
  const selectedLoc = interaction.values[0];

  if (targetFloor[selectedLoc].nextId) {
    return await interaction.update({ content: getMsg("rooms.antidemonQueueLocked"), components: [], flags: 64 }).catch(() => {});
  }
  if (targetFloor[selectedLoc].status !== STATUS_CLAIMED) {
    return await interaction.update({ content: getMsg("rooms.antidemonQueueLocked"), components: [], flags: 64 }).catch(() => {});
  }

  let baseTime = getLocalTime(timezone);
  if (targetFloor[selectedLoc].timeWindow) {
    const calcLimit = parseStringToDate(targetFloor[selectedLoc].timeWindow.split(" ~ ")[1], timezone);
    if (calcLimit) baseTime = calcLimit;
  }

  targetFloor[selectedLoc].nextId = uid;
  targetFloor[selectedLoc].nextName = uName;
  targetFloor[selectedLoc].formattedTimeNext = getFormattedTime12h(baseTime);
  targetFloor[selectedLoc].endLimit = null;

  pushToDailyLogs(guildId, "QUEUE_JOIN", uName, `${targetFloor.title} - ${targetFloor[selectedLoc].name}`, getMsg("render.joinedAsNext"));
  notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: `${targetFloor.title} - ${targetFloor[selectedLoc].name}` }));

  state.saveLocalStorage();
  await refreshVisualPanel(guildId, pKey);
  return await interaction.update({
    content: getMsg("rooms.summonQueueSuccessEphemeral"),
    components: [],
    flags: 64,
  }).catch(() => {});
}
