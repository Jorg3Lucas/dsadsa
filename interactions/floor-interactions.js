// ==========================================
// 🏗️ FLOOR INTERACTION HANDLERS
// Guild-aware: Death mark, Claim, Cancel, Next queue
// ==========================================

import { getMsg } from "../lang.js";
import { getGuildState, getDb } from "../state.js";
import { refreshVisualPanel, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs } from "../daily-logs.js";
import {
  hasActiveClaim,
  hasActiveQueue,
  checkPunishment,
  applyFiveMinCooldown,
  removeUserFromQueue,
  freeFloorAndActivateNextGracePeriod,
  freeAntidemonRoom,
  buildAntiClaimOptions,
  buildAntiQueueOptions,
  buildActiveClaimMessage,
} from "../claim-core.js";
import {
  EmbedBuilder as e,
  ActionRowBuilder as t,
  ButtonBuilder as n,
  ButtonStyle as a,
  StringSelectMenuBuilder as i,
} from "discord.js";
import {
  getLocalTime,
  getFormattedTime12h,
  parseStringToDate,
  calculateNextOpening,
  isRoomOpen,
} from "../time-utils.js";
import {
  STATUS_AVAILABLE,
  STATUS_CLAIMED,
  STATUS_OPEN,
  STATUS_KILLED,
  STATUS_KILLED_PREFIX,
} from "../constants.js";

const SUMMON_PROPS = ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"];

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleFloorInteraction(interaction) {
  const cid = interaction.customId;
  if (!interaction.isButton()) return false;
  const parts = cid.split("-");
  const actionPrefix = parts[0];
  if ("death" === actionPrefix) return true;
  if ("floor" === actionPrefix) return true;
  return false;
}

export async function handleFloorInteraction(interaction, guildId, uid, uName) {
  if (!interaction.isButton()) return false;

  const [actionPrefix, panelKey, specificProp] = interaction.customId.split("-");
  const db = getDb(guildId);
  const targetObj = db ? db[panelKey] : null;
  if (!targetObj) return false;

  // ── DEATH MARK ──
  if ("death" === actionPrefix) {
    return handleDeathMark(interaction, guildId, uid, uName, targetObj, panelKey, specificProp);
  }

  // ── SUMMON ──
  if ("summon" === targetObj.type) {
    if ("claim" === specificProp) return handleSummonClaim(interaction, guildId, uid, uName, targetObj, panelKey);
    if ("next" === specificProp) return handleSummonNext(interaction, guildId, uid, uName, targetObj, panelKey);
    if ("cancel" === specificProp) return handleSummonCancel(interaction, guildId, uid, uName, targetObj, panelKey);
  }

  // ── ANTIDEMON ──
  if ("antidemon" === targetObj.type) {
    if ("claim" === specificProp) return handleAntiClaim(interaction, guildId, uid, uName, targetObj, panelKey);
    if ("next" === specificProp) return handleAntiNext(interaction, guildId, uid, uName, targetObj, panelKey);
    if ("cancel" === specificProp) return handleAntiCancel(interaction, guildId, uid, uName, targetObj, panelKey);
  }

  // ── CANCEL (floor-level) ──
  if ("cancel" === specificProp) {
    return handleFloorCancel(interaction, guildId, uid, uName, targetObj, panelKey);
  }

  // ── CLAIM (floor-level) ──
  if ("claim" === specificProp) {
    if ("fixed" === targetObj.type) return handleFixedClaim(interaction, guildId, uid, uName, targetObj, panelKey);
    return handleGeneralClaim(interaction, guildId, uid, uName, targetObj, panelKey);
  }

  // ── NEXT QUEUE ──
  if ("next" === specificProp) {
    return handleGeneralNext(interaction, guildId, uid, uName, targetObj, panelKey);
  }

  return false;
}

// ==========================================
// 💀 DEATH MARK
// ==========================================

async function handleDeathMark(interaction, guildId, uid, uName, targetObj, panelKey, specificProp) {
  if (targetObj[specificProp].status.startsWith(STATUS_KILLED)) {
    return await interaction.reply({ content: getMsg("rooms.deathTimerRunning"), flags: 64 }).catch(() => {});
  }
  if (targetObj.ownerId !== uid) {
    return await interaction.reply({
      content: getMsg("system.accessDenied", { ownerName: targetObj.ownerName || getMsg("render.unknownUser") }),
      flags: 64,
    }).catch(() => {});
  }

  const state = getGuildState(guildId);
  const timezone = state ? state.timezone : "Europe/Berlin";

  const currTimeStr = getFormattedTime12h(getLocalTime(timezone));
  const nowTs = getLocalTime(timezone).getTime();

  targetObj[specificProp].status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
  targetObj[specificProp]._lastKilledAt = nowTs;
  pushToDailyLogs(guildId, "DEATH_MARK", uName, `${targetObj.title} - ${targetObj[specificProp].name}`, `Killed at ${currTimeStr}`);
  if (state) state.saveLocalStorage();
  await refreshVisualPanel(guildId, panelKey);
  return await interaction.reply({ content: getMsg("rooms.deathLogged"), flags: 64 }).catch(() => {});
}

// ==========================================
// 🌀 SUMMON CLAIM
// ==========================================

async function handleSummonClaim(interaction, guildId, uid, uName, targetObj, panelKey) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
  if (hasActiveClaim(guildId, uid)) {
    return await interaction.reply({ content: buildActiveClaimMessage(guildId, uid), flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) {
    const hasPriority = SUMMON_PROPS.some((loc) => targetObj[loc].nextId === uid);
    if (!hasPriority) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
  }

  const priorityLocs = SUMMON_PROPS.filter((loc) => targetObj[loc].nextId === uid && targetObj[loc].status !== STATUS_CLAIMED);
  const freeLocs = SUMMON_PROPS.filter((loc) => targetObj[loc].status !== STATUS_CLAIMED && !targetObj[loc].nextId);
  const showLocs = priorityLocs.length > 0 ? priorityLocs : freeLocs;

  const locOptions = showLocs.map((loc) => ({ label: targetObj[loc].name, value: loc, emoji: "🌀" }));
  if (locOptions.length === 0) {
    return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(() => {});
  }
  return await interaction.reply({
    content: `🌀 **${getMsg("rooms.summonMenuSelectClaim")}**`,
    components: [
      new t().addComponents(
        new i().setCustomId(`summonslide-${panelKey}`).setPlaceholder(getMsg("rooms.summonSelectPlaceholder")).addOptions(locOptions),
      ),
    ],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// ⏭️ SUMMON NEXT QUEUE
// ==========================================

async function handleSummonNext(interaction, guildId, uid, uName, targetObj, panelKey) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
  if (hasActiveClaim(guildId, uid)) {
    return await interaction.reply({ content: buildActiveClaimMessage(guildId, uid), flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});

  const queueOpts = SUMMON_PROPS.filter((loc) => targetObj[loc].status === STATUS_CLAIMED && !targetObj[loc].nextId)
    .map((loc) => ({ label: targetObj[loc].name, value: loc, emoji: "🌀" }));

  if (queueOpts.length === 0) return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(() => {});
  return await interaction.reply({
    content: `🌀 **${getMsg("rooms.summonMenuSelectNext")}**`,
    components: [
      new t().addComponents(
        new i().setCustomId(`summonnextside-${panelKey}`).setPlaceholder(getMsg("rooms.summonSelectPlaceholder")).addOptions(queueOpts),
      ),
    ],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// 🌀 SUMMON CANCEL
// ==========================================

async function handleSummonCancel(interaction, guildId, uid, uName, targetObj, panelKey) {
  const isMod = interaction.member.permissions.has("ManageMessages");
  const isOwner = SUMMON_PROPS.some((p) => targetObj[p].ownerId === uid);
  const isInQueue = SUMMON_PROPS.some((p) => targetObj[p].nextId === uid);

  if (isOwner || isInQueue || isMod) {
    let penalized = false;
    let anyAction = false;

    SUMMON_PROPS.forEach((loc) => {
      if (targetObj[loc].ownerId === uid) {
        anyAction = true;
        pushToDailyLogs(guildId, "CANCEL", targetObj[loc].ownerName || uName, `${targetObj.title} - ${targetObj[loc].name}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
        notifyUserDM(targetObj[loc].ownerId, getMsg("rooms.dmRemovedNotice", { title: `${targetObj.title} - ${targetObj[loc].name}`, reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel") }));
        freeAntidemonRoom(guildId, targetObj, loc);
        if (!isMod && !penalized) { applyFiveMinCooldown(guildId, uid); penalized = true; }
      }
      if (targetObj[loc].nextId === uid) {
        anyAction = true;
        pushToDailyLogs(guildId, "CANCEL", targetObj[loc].nextName || uName, `${targetObj.title} - ${targetObj[loc].name} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
        notifyUserDM(targetObj[loc].nextId, getMsg("rooms.dmRemovedNotice", { title: `${targetObj.title} - ${targetObj[loc].name} (Queue)`, reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel") }));
        targetObj[loc].nextId = null;
        targetObj[loc].nextName = null;
        targetObj[loc].endLimit = null;
        targetObj[loc].formattedTimeNext = "";
        if (STATUS_OPEN === targetObj[loc].status) targetObj[loc].status = STATUS_AVAILABLE;
      }
    });

    const state = getGuildState(guildId);
    if (state) state.saveLocalStorage();
    await refreshVisualPanel(guildId, panelKey);
    return await interaction.reply({
      content: anyAction ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback")) : getMsg("rooms.noActiveClaimsFeedback"),
      flags: 64,
    }).catch(() => {});
  }
  return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(() => {});
}

// ==========================================
// 👹 ANTIDEMON CLAIM
// ==========================================

async function handleAntiClaim(interaction, guildId, uid, uName, targetObj, panelKey) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
  if (hasActiveClaim(guildId, uid)) {
    return await interaction.reply({ content: buildActiveClaimMessage(guildId, uid), flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) {
    const hasPriority = ["left", "mid", "right"].some((rm) => targetObj[rm].nextId === uid);
    if (!hasPriority) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
  }
  return await interaction.reply({
    content: `👹 **${getMsg("rooms.antidemonMenuSelectClaim")}**`,
    components: [
      new t().addComponents(
        new i().setCustomId(`antislide-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiClaimOptions(targetObj, uid)),
      ),
    ],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// ⏭️ ANTIDEMON NEXT QUEUE
// ==========================================

async function handleAntiNext(interaction, guildId, uid, uName, targetObj, panelKey) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
  if (hasActiveClaim(guildId, uid)) {
    return await interaction.reply({ content: buildActiveClaimMessage(guildId, uid), flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
  return await interaction.reply({
    content: `⚔️ **${getMsg("rooms.antidemonMenuSelectNext")}**`,
    components: [
      new t().addComponents(
        new i().setCustomId(`antinextside-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiQueueOptions(targetObj)),
      ),
    ],
    flags: 64,
  }).catch(() => {});
}

// ==========================================
// 👹 ANTIDEMON CANCEL
// ==========================================

async function handleAntiCancel(interaction, guildId, uid, uName, targetObj, panelKey) {
  const isMod = interaction.member.permissions.has("ManageMessages");
  const isOwner = targetObj.left.ownerId === uid || targetObj.mid.ownerId === uid || targetObj.right.ownerId === uid;
  const isInQueue = targetObj.left.nextId === uid || targetObj.mid.nextId === uid || targetObj.right.nextId === uid;

  if (isOwner || isInQueue || isMod) {
    let penalized = false;
    let anyAction = false;

    ["left", "mid", "right"].forEach((rm) => {
      if (targetObj[rm].ownerId === uid) {
        anyAction = true;
        pushToDailyLogs(guildId, "CANCEL", targetObj[rm].ownerName || uName, `${targetObj.title} - Room ${rm.toUpperCase()}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
        notifyUserDM(targetObj[rm].ownerId, getMsg("rooms.dmRemovedNotice", { title: `${targetObj.title} - Room ${rm.toUpperCase()}`, reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel") }));
        freeAntidemonRoom(guildId, targetObj, rm);
        if (!isMod && !penalized) { applyFiveMinCooldown(guildId, uid); penalized = true; }
      }
      if (targetObj[rm].nextId === uid) {
        anyAction = true;
        pushToDailyLogs(guildId, "CANCEL", targetObj[rm].nextName || uName, `${targetObj.title} - Room ${rm.toUpperCase()} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
        notifyUserDM(targetObj[rm].nextId, getMsg("rooms.dmRemovedNotice", { title: `${targetObj.title} - Room ${rm.toUpperCase()} (Queue)`, reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel") }));
        targetObj[rm].nextId = null;
        targetObj[rm].nextName = null;
        targetObj[rm].endLimit = null;
        targetObj[rm].formattedTimeNext = "";
        if (STATUS_OPEN === targetObj[rm].status) targetObj[rm].status = STATUS_AVAILABLE;
      }
    });

    const state = getGuildState(guildId);
    if (state) state.saveLocalStorage();
    await refreshVisualPanel(guildId, panelKey);
    return await interaction.reply({
      content: anyAction ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback")) : getMsg("rooms.noActiveClaimsFeedback"),
      flags: 64,
    }).catch(() => {});
  }
  return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(() => {});
}

// ==========================================
// ❌ FLOOR-LEVEL CANCEL
// ==========================================

async function handleFloorCancel(interaction, guildId, uid, uName, targetObj, panelKey) {
  const isMod = interaction.member.permissions.has("ManageMessages");
  const isOwner = targetObj.ownerId === uid;

  let inQueue = false;
  let pointer = targetObj.next;
  for (; pointer; ) {
    if (pointer.userId === uid) { inQueue = true; break; }
    pointer = pointer.nextQueue;
  }

  if (isOwner) {
    pushToDailyLogs(guildId, "CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.voluntaryLeave"));
    notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.voluntaryLeave") }));
    freeFloorAndActivateNextGracePeriod(guildId, targetObj);
    if (!isMod) applyFiveMinCooldown(guildId, uid);
    await refreshVisualPanel(guildId, panelKey);
    return await interaction.reply({ content: getMsg("cooldowns.canceledClaimFeedback"), flags: 64 }).catch(() => {});
  }

  if (isMod && targetObj.ownerId) {
    pushToDailyLogs(guildId, "CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.staffCancel"));
    notifyUserDM(targetObj.ownerId, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.staffCancel") }));
    freeFloorAndActivateNextGracePeriod(guildId, targetObj);
    await refreshVisualPanel(guildId, panelKey);
    return await interaction.reply({ content: getMsg("rooms.floorReleasedSuccess"), flags: 64 }).catch(() => {});
  }

  if (inQueue) {
    pushToDailyLogs(guildId, "CANCEL", uName, targetObj.title, getMsg("logs.queueLeave"));
    notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.queueLeave") }));
    removeUserFromQueue(targetObj, uid);
    const state = getGuildState(guildId);
    if (state) state.saveLocalStorage();
    await refreshVisualPanel(guildId, panelKey);
    return await interaction.reply({ content: getMsg("rooms.removedFromQueueFeedback"), flags: 64 }).catch(() => {});
  }

  return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(() => {});
}

// ==========================================
// 🔥 FIXED TYPE CLAIM (Fury/Frenzy)
// ==========================================

async function handleFixedClaim(interaction, guildId, uid, uName, targetObj, panelKey) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
  if (hasActiveClaim(guildId, uid)) {
    return await interaction.reply({ content: buildActiveClaimMessage(guildId, uid), flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});

  const state = getGuildState(guildId);
  const timezone = state ? state.timezone : "Europe/Berlin";
  const now = getLocalTime(timezone);
  const minuteOffset = targetObj.scheduleMinutes || 0;
  let eventStart;

  if (isRoomOpen(targetObj.schedules, minuteOffset, timezone)) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let foundHour = null;
    for (const h of targetObj.schedules) {
      const startMin = h * 60 + minuteOffset;
      const endMin = startMin + 60;
      if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
    }
    if (foundHour !== null) {
      eventStart = new Date(now.getTime());
      eventStart.setHours(foundHour, minuteOffset, 0, 0);
    } else {
      eventStart = calculateNextOpening(targetObj.schedules, minuteOffset, timezone);
    }
  } else {
    eventStart = calculateNextOpening(targetObj.schedules, minuteOffset, timezone);
    const fiveMinBefore = new Date(eventStart.getTime() - 5 * 60 * 1000);
    if (now < fiveMinBefore) {
      const diffMins = Math.ceil((eventStart.getTime() - now.getTime()) / 6e4);
      return await interaction.reply({ content: getMsg("rooms.eventOpensIn", { minutes: diffMins }), flags: 64 }).catch(() => {});
    }
  }

  if (targetObj.ownerId) {
    return await interaction.reply({
      content: getMsg("system.accessDenied", { ownerName: targetObj.ownerName || getMsg("render.unknownUser") }),
      flags: 64,
    }).catch(() => {});
  }

  const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
  const windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;

  targetObj.ownerId = uid;
  targetObj.ownerName = uName;
  targetObj.timeWindow = windowStr;
  targetObj._claimTimestamp = now.getTime();

  pushToDailyLogs(guildId, "CLAIM_START", uName, targetObj.title, `${getMsg("render.windowPrefix")}: ${targetObj.timeWindow}`);
  notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: targetObj.title, window: windowStr }));

  if (state) state.saveLocalStorage();
  await refreshVisualPanel(guildId, panelKey);
  return await interaction.reply({ content: getMsg("rooms.eventClaimedFixed", { title: targetObj.title }), flags: 64 }).catch(() => {});
}

// ==========================================
// 📋 GENERAL CLAIM (normal/peak)
// ==========================================

async function handleGeneralClaim(interaction, guildId, uid, uName, targetObj, panelKey) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
  if (hasActiveClaim(guildId, uid)) {
    return await interaction.reply({ content: buildActiveClaimMessage(guildId, uid), flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});

  const state = getGuildState(guildId);
  const timezone = state ? state.timezone : "Europe/Berlin";
  const now = getLocalTime(timezone);

  if (targetObj.next && targetObj.next.userId !== uid) {
    let timeRemainingStr = "";
    if (targetObj.next.endLimit) {
      const limitTime = parseStringToDate(targetObj.next.endLimit, timezone);
      if (limitTime) {
        const diffMins = Math.ceil((limitTime.getTime() - now.getTime()) / 6e4);
        if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
      }
    }
    return await interaction.reply({
      content: getMsg("cooldowns.floorReservedNotice", { userName: targetObj.next.userName, timeRemaining: timeRemainingStr }),
      flags: 64,
    }).catch(() => {});
  }

  if (targetObj.ownerId) {
    return await interaction.reply({
      content: getMsg("system.accessDenied", { ownerName: targetObj.ownerName || getMsg("render.unknownUser") }),
      flags: 64,
    }).catch(() => {});
  }

  const start = now;
  const end = new Date(start.getTime() + 18e5);
  const windowStr = `${getFormattedTime12h(start)} ~ ${getFormattedTime12h(end)}`;

  targetObj.ownerId = uid;
  targetObj.ownerName = uName;
  targetObj.timeWindow = windowStr;
  targetObj._claimTimestamp = start.getTime();

  pushToDailyLogs(guildId, "CLAIM_START", uName, targetObj.title, `${getMsg("render.windowPrefix")}: ${targetObj.timeWindow}`);
  notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: targetObj.title, window: windowStr }));

  if (targetObj.next && targetObj.next.userId === uid) {
    targetObj.next = targetObj.next.nextQueue || null;
  }

  if (state) state.saveLocalStorage();
  await refreshVisualPanel(guildId, panelKey);
  return await interaction.reply({ content: getMsg("rooms.floorClaimSuccess"), flags: 64 }).catch(() => {});
}

// ==========================================
// ⏭️ GENERAL NEXT QUEUE
// ==========================================

async function handleGeneralNext(interaction, guildId, uid, uName, targetObj, panelKey) {
  let pStr = checkPunishment(guildId, uid);
  if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
  if ("peak" === targetObj.type) return await interaction.reply({ content: getMsg("rooms.alreadyOwner"), flags: 64 }).catch(() => {});
  if (hasActiveClaim(guildId, uid)) {
    return await interaction.reply({ content: buildActiveClaimMessage(guildId, uid), flags: 64 }).catch(() => {});
  }
  if (hasActiveQueue(guildId, uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
  if (targetObj.ownerId === uid) return await interaction.reply({ content: getMsg("rooms.alreadyOwner"), flags: 64 }).catch(() => {});

  const state = getGuildState(guildId);
  const timezone = state ? state.timezone : "Europe/Berlin";

  let pointer = targetObj.next;
  let inQueue = false;
  for (; pointer; ) {
    if (pointer.userId === uid) { inQueue = true; break; }
    pointer = pointer.nextQueue;
  }
  if (inQueue) return await interaction.reply({ content: getMsg("rooms.alreadyInQueue"), flags: 64 }).catch(() => {});

  const nowTime = getLocalTime(timezone);
  let expectedTime = nowTime;
  if (targetObj.timeWindow) {
    const endOfClaim = parseStringToDate(targetObj.timeWindow.split(" ~ ")[1], timezone);
    if (endOfClaim) expectedTime = endOfClaim;
  }

  const node = {
    userId: uid,
    userName: uName,
    formattedTime: getFormattedTime12h(expectedTime),
    endLimit: null,
    nextQueue: null,
  };

  if (targetObj.next) {
    let lastNode = targetObj.next;
    for (; lastNode.nextQueue; ) lastNode = lastNode.nextQueue;
    lastNode.nextQueue = node;
  } else {
    targetObj.next = node;
  }

  pushToDailyLogs(guildId, "QUEUE_JOIN", uName, targetObj.title, getMsg("render.joinedNextLine"));
  notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: targetObj.title }));

  if (state) state.saveLocalStorage();
  await refreshVisualPanel(guildId, panelKey);
  return await interaction.reply({ content: getMsg("rooms.queueJoinedSuccess"), flags: 64 }).catch(() => {});
}
