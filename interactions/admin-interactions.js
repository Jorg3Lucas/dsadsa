// ==========================================
// 👑 ADMIN INTERACTION HANDLERS
// Guild-aware: admin-reset-menu, admin-kick-menu,
// confirm-resetlogs
// ==========================================

import { getMsg } from "../lang.js";
import { getGuildState } from "../state.js";
import { refreshVisualPanel, resetPanelData, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs } from "../daily-logs.js";
import { freeFloorAndActivateNextGracePeriod, freeAntidemonRoom } from "../claim-core.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleAdminInteraction(interaction) {
  const cid = interaction.customId;
  return (
    cid === "admin-reset-menu" ||
    cid === "admin-kick-menu" ||
    (interaction.isButton() && cid.startsWith("confirm-resetlogs-"))
  );
}

export async function handleAdminInteraction(interaction, guildId, uid) {
  const cid = interaction.customId;

  if (interaction.isStringSelectMenu() && cid === "admin-reset-menu") {
    return handleAdminResetMenu(interaction, guildId);
  }

  if (interaction.isStringSelectMenu() && cid === "admin-kick-menu") {
    return handleAdminKickMenu(interaction, guildId, uid);
  }

  if (interaction.isButton() && cid.startsWith("confirm-resetlogs-")) {
    return handleConfirmResetLogs(interaction, guildId);
  }

  return false;
}

// ==========================================
// 🔄 ADMIN RESET MENU
// ==========================================

async function handleAdminResetMenu(interaction, guildId) {
  if (!interaction.member.permissions.has("ManageMessages")) {
    return await interaction
      .update({
        content: getMsg("system.permissionDeniedAdminDropped"),
        components: [],
        flags: 64,
      })
      .catch(() => {});
  }

  const state = getGuildState(guildId);
  if (!state) return;
  const { db } = state;

  const resetKey = interaction.values[0];

  if ("__all__" === resetKey) {
    let count = 0;
    for (const key in db) {
      if (!db[key] || key.startsWith("_")) continue;
      resetPanelData(guildId, key);
      await refreshVisualPanel(guildId, key);
      count++;
    }
    return await interaction
      .update({
        content: `✅ Reset ${count} panels to defaults.`,
        components: [],
      })
      .catch(() => {});
  }

  if (!db[resetKey])
    return await interaction
      .update({
        content: getMsg("system.resetPanelNotFound", { key: resetKey }),
        components: [],
        flags: 64,
      })
      .catch(() => {});

  resetPanelData(guildId, resetKey);
  await refreshVisualPanel(guildId, resetKey);
  return await interaction
    .update({
      content: getMsg("system.resetPanelSuccess", { key: resetKey }),
      components: [],
    })
    .catch(() => {});
}

// ==========================================
// 👢 ADMIN KICK MENU
// ==========================================

async function handleAdminKickMenu(interaction, guildId, uid) {
  if (!interaction.member.permissions.has("ManageMessages")) {
    return await interaction
      .update({
        content: getMsg("system.permissionDeniedAdminDropped"),
        components: [],
        flags: 64,
      })
      .catch(() => {});
  }

  const state = getGuildState(guildId);
  if (!state) return;
  const { db } = state;

  const [, , roomType, targetUid] = interaction.values[0].split("-");
  const pKey = interaction.values[0].split("-")[1];
  const targetFloor = db[pKey];

  if (targetFloor) {
    let finalUserLabel = getMsg("render.memberLabel");
    if ("floor" === roomType) {
      finalUserLabel = targetFloor.ownerName || getMsg("render.memberLabel");
      pushToDailyLogs(guildId, "CANCEL", finalUserLabel, targetFloor.title, getMsg("logs.adminRemove"));
      notifyUserDM(
        targetUid,
        getMsg("rooms.dmRemovedNotice", {
          title: targetFloor.title,
          reason: getMsg("logs.adminRemove"),
        }),
      );
      freeFloorAndActivateNextGracePeriod(guildId, targetFloor);
    } else {
      finalUserLabel = targetFloor[roomType].ownerName || getMsg("render.memberLabel");
      pushToDailyLogs(guildId, "CANCEL", finalUserLabel, `${targetFloor.title} - Room ${roomType.toUpperCase()}`, getMsg("logs.adminRemove"));
      notifyUserDM(
        targetUid,
        getMsg("rooms.dmRemovedNotice", {
          title: `${targetFloor.title} - Room ${roomType.toUpperCase()}`,
          reason: getMsg("logs.adminRemove"),
        }),
      );
      freeAntidemonRoom(guildId, targetFloor, roomType);
    }
    await refreshVisualPanel(guildId, pKey);
    notifyUserDM(targetUid, getMsg("system.kickDMNotice", { title: targetFloor.title }));
    return await interaction
      .update({
        content: getMsg("system.kickSuccess"),
        components: [],
      })
      .catch(() => {});
  }

  return await interaction
    .update({
      content: getMsg("rooms.antidemonTimeoutCache"),
      components: [],
      flags: 64,
    })
    .catch(() => {});
}

// ==========================================
// 🔄 CONFIRM RESET LOGS
// ==========================================

async function handleConfirmResetLogs(interaction, guildId) {
  if (!interaction.member.permissions.has("ManageMessages")) {
    return await interaction
      .update({
        content: getMsg("system.permissionDeniedAdminDropped"),
        components: [],
        flags: 64,
      })
      .catch(() => {});
  }

  const state = getGuildState(guildId);
  if (!state) return;
  const { dailyLogs, saveDailyLogs } = state;

  const action = interaction.customId.replace("confirm-resetlogs-", "");
  if ("yes" === action) {
    const oldCount = (dailyLogs.queue || []).length;
    dailyLogs.queue = [];
    saveDailyLogs();
    await interaction
      .update({
        content: getMsg("system.resetLogsSuccess", { count: oldCount }),
        components: [],
      })
      .catch(() => {});
  } else {
    await interaction
      .update({
        content: getMsg("system.resetLogsCancel"),
        components: [],
      })
      .catch(() => {});
  }
}
