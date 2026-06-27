// ==========================================
// 👑 ADMIN TEXT COMMANDS
// Guild-aware: !setlogs, !setbosschannel, !seteventchannel,
// !logs, !resetlogs, !kick, !reset, !testevent
// ==========================================

import {
  EmbedBuilder as e,
  ActionRowBuilder as t,
  ButtonBuilder as n,
  ButtonStyle as a,
  StringSelectMenuBuilder as i,
} from "discord.js";
import { getMsg } from "../lang.js";
import { getGuildState, getDb } from "../state.js";
import { renderEmbed, renderButtons } from "../panel-render.js";
import { refreshVisualPanel, resetPanelData } from "../panel-utils.js";
import { dispatchDailyLogs } from "../daily-logs.js";
import { STATUS_CLAIMED } from "../constants.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export async function handleAdminCommand(msg) {
  const lowerContent = msg.content.toLowerCase().trim();

  if ("!setlogs" === lowerContent) return handleSetLogs(msg);
  if ("!setbosschannel" === lowerContent) return handleSetBossChannel(msg);
  if ("!seteventchannel" === lowerContent) return handleSetEventChannel(msg);
  if ("!testevent" === lowerContent) return handleTestEvent(msg);
  if ("!logs" === lowerContent) return handleLogs(msg);
  if ("!resetlogs" === lowerContent) return handleResetLogs(msg);
  if ("!kick" === lowerContent) return handleKick(msg);
  if ("!reset" === lowerContent) return handleResetMenu(msg);
  if (lowerContent.startsWith("!reset ")) {
    return handleResetSpecific(msg, lowerContent.replace("!reset ", "").trim());
  }

  return false;
}

// ==========================================
// 📋 SET LOGS CHANNEL
// ==========================================

async function handleSetLogs(msg) {
  const guildId = msg.guildId;
  if (!guildId) return false;
  const state = getGuildState(guildId);
  if (!state) return false;

  if (msg.member.permissions.has("ManageGuild")) {
    state.dailyLogs.configChannelId = msg.channel.id;
    state.saveDailyLogs();
    return msg.reply({ content: getMsg("logs.setupSuccess") }).catch(() => {});
  }
  return msg.reply({ content: getMsg("logs.setupError") }).catch(() => {});
}

// ==========================================
// 🎯 SET BOSS CHANNEL
// ==========================================

async function handleSetBossChannel(msg) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;

  if (msg.member.permissions.has("ManageGuild")) {
    state.dailyLogs.bossSpawnChannelId = msg.channel.id;
    state.saveDailyLogs();
    return msg.reply({ content: "✅ Boss spawn notifications will be sent to this channel." }).catch(() => {});
  }
  return msg.reply({ content: "❌ You need the Manage Server permission to configure this." }).catch(() => {});
}

// ==========================================
// 🚨 SET EVENT CHANNEL
// ==========================================

async function handleSetEventChannel(msg) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;

  if (msg.member.permissions.has("ManageGuild")) {
    state.dailyLogs.scheduledEventChannelId = msg.channel.id;
    state.saveDailyLogs();
    return msg.reply({ content: "✅ Event alerts (Red Boss, Leader 3, etc.) will be sent here with @everyone." }).catch(() => {});
  }
  return msg.reply({ content: "❌ You need the Manage Server permission to configure this." }).catch(() => {});
}

// ==========================================
// 🧪 TEST EVENT
// ==========================================

async function handleTestEvent(msg) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;

  if (!msg.member.permissions.has("ManageMessages")) {
    return msg.reply({ content: "❌ You need the Manage Messages permission to use this." }).catch(() => {});
  }
  if (!state.dailyLogs.scheduledEventChannelId) {
    return msg.reply({ content: "❌ No event channel configured. Use `!seteventchannel` first." }).catch(() => {});
  }
  const targetChannel = msg.guild.channels.cache.get(state.dailyLogs.scheduledEventChannelId);
  if (!targetChannel) {
    return msg.reply({ content: "❌ Configured channel not found. Re-configure with `!seteventchannel`." }).catch(() => {});
  }

  const testEmbed = new e()
    .setTitle("🚨 Event Alert! 🚨")
    .setColor("#ff6600")
    .setDescription(
      `🔔 **TEST NOTIFICATION** 🔔\n\n` +
      `This is a test alert to verify the event system is working correctly.\n\n` +
      `The following events would be announced here:\n` +
      `• **Red Boss (Secret Peak)**\n` +
      `• **Leader 3 (Magic Square)**\n` +
      `• **Purgatory**\n` +
      `• **World Boss Labyrinth**\n` +
      `• **World Boss Valley**\n` +
      `• **Mirage World Boss**\n` +
      `• **Golden Sphere (W1 Roaring Flame)**\n` +
      `• **Golden Sphere (W2 Nine Dragon)**\n` +
      `• **Red Boss (SP11 + SP12)** — 01:00, 07:00 AM/PM\n` +
      `• **Random Event (SP12)** — 03:00, 09:00 AM/PM\n` +
      `• **Krukan (Schackling Abbadon)** — Mon 23:00\n` +
      `• **Valley War** — Wed 22:00\n` +
      `• **Hellbar (7F Purgatory)** — Wed 23:00\n` +
      `• **Altar Defense + Living Wraiths Event** — Thu 22:00\n` +
      `• **Mirage Living Wraiths** — Thu 23:00\n` +
      `• **Heist** — Fri 22:00\n` +
      `• **Utukan (Crimson Abbadon)** — Fri 23:00\n\n` +
      `⏰ Notifications are sent 10 minutes before each spawn.\n\n` +
      `Get ready and **don't forget to do the mission!** 💪`,
    )
    .setTimestamp();

  try {
    await targetChannel.send({ content: "@everyone", embeds: [testEmbed] });
    return msg.reply({ content: `✅ Test event alert sent to ${targetChannel}.` }).catch(() => {});
  } catch (err) {
    return msg.reply({ content: `❌ Failed to send test alert: ${err.message}` }).catch(() => {});
  }
}

// ==========================================
// 📄 LOGS DISPATCH
// ==========================================

async function handleLogs(msg) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;

  if (!msg.member.permissions.has("ManageMessages")) {
    return msg.reply({ content: getMsg("logs.modRequired") }).catch(() => {});
  }
  if (!state.dailyLogs.configChannelId) {
    return msg.reply({ content: getMsg("logs.noChannel") }).catch(() => {});
  }
  if (!await dispatchDailyLogs(guildId, true)) {
    return msg.reply({ content: getMsg("logs.dispatchError") }).catch(() => {});
  }
  if (msg.channel.id !== state.dailyLogs.configChannelId) {
    return msg.reply({ content: getMsg("logs.dispatchSuccess") }).catch(() => {});
  }
  try { await msg.delete(); } catch (_) {}
}

// ==========================================
// 🔄 RESET LOGS
// ==========================================

async function handleResetLogs(msg) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;

  if (!msg.member.permissions.has("ManageMessages")) {
    return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {});
  }
  const oldCount = (state.dailyLogs.queue || []).length;
  await msg.reply({
    content: getMsg("system.resetLogsConfirm", { count: oldCount }),
    components: [
      new t().addComponents(
        new n().setCustomId("confirm-resetlogs-yes").setLabel("✅ Yes, clear logs").setStyle(a.Success),
        new n().setCustomId("confirm-resetlogs-no").setLabel("❌ No, cancel").setStyle(a.Danger),
      ),
    ],
  }).catch(() => {});
  try { await msg.delete(); } catch (_) {}
}

// ==========================================
// 👢 KICK MENU
// ==========================================

async function handleKick(msg) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;
  const { db } = state;

  if (!msg.member.permissions.has("ManageMessages")) {
    return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {});
  }

  const optionsList = [];
  for (const key in db) {
    const current = db[key];
    if (!current || key.startsWith("_")) continue;
    const cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");

    if ("antidemon" === current.type) {
      for (const room of ["left", "mid", "right"]) {
        if (STATUS_CLAIMED === current[room].status && current[room].ownerId) {
          optionsList.push({
            label: `${cleanedTitle} - ${room.toUpperCase()} Room`,
            description: `${getMsg("system.kickCurrentLabel")} ${current[room].ownerName}`,
            value: `kick-${key}-${room}-${current[room].ownerId}`,
          });
        }
      }
    } else if ("summon" === current.type) {
      const summonProps = ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"];
      for (const loc of summonProps) {
        if (STATUS_CLAIMED === current[loc].status && current[loc].ownerId) {
          optionsList.push({
            label: `${cleanedTitle} - ${current[loc].name}`,
            description: `${getMsg("system.kickCurrentLabel")} ${current[loc].ownerName}`,
            value: `kick-${key}-${loc}-${current[loc].ownerId}`,
          });
        }
      }
    } else {
      if (current.ownerId) {
        optionsList.push({
          label: `${cleanedTitle}`,
          description: `${getMsg("system.kickCurrentLabel")} ${current.ownerName}`,
          value: `kick-${key}-floor-${current.ownerId}`,
        });
      }
    }
  }

  if (0 === optionsList.length) {
    return msg.reply({ content: getMsg("system.kickNoClaims") }).catch(() => {});
  }

  await msg.reply({
    content: getMsg("system.kickPanelTitle"),
    components: [
      new t().addComponents(
        new i().setCustomId("admin-kick-menu").setPlaceholder(getMsg("system.kickPanelPlaceholder")).addOptions(optionsList.slice(0, 25)),
      ),
    ],
  });
  try { await msg.delete(); } catch (_) {}
}

// ==========================================
// 🔄 RESET MENU
// ==========================================

async function handleResetMenu(msg) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;
  const { db } = state;

  if (!msg.member.permissions.has("ManageMessages")) {
    return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {});
  }

  const optionsList = [];
  for (const key in db) {
    if (!db[key] || key.startsWith("_")) continue;
    const cleanedTitle = db[key].title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
    optionsList.push({ label: `${cleanedTitle}`, description: `Key: ${key}`, value: key });
  }

  if (0 === optionsList.length) {
    return msg.reply({ content: getMsg("system.resetNoPanels") }).catch(() => {});
  }
  if (optionsList.length > 1) {
    optionsList.unshift({ label: "🔄 Reset ALL Panels", description: "Reset all panels to defaults", value: "__all__" });
  }

  await msg.reply({
    content: getMsg("system.resetMenuTitle"),
    components: [
      new t().addComponents(
        new i().setCustomId("admin-reset-menu").setPlaceholder(getMsg("system.resetMenuPlaceholder")).addOptions(optionsList.slice(0, 25)),
      ),
    ],
  });
  try { await msg.delete(); } catch (_) {}
}

// ==========================================
// 🔄 RESET SPECIFIC PANEL
// ==========================================

async function handleResetSpecific(msg, resetKey) {
  const guildId = msg.guildId;
  const state = getGuildState(guildId);
  if (!state) return false;
  const { db } = state;

  if (!msg.member.permissions.has("ManageMessages")) {
    return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {});
  }

  if ("all" === resetKey) {
    let count = 0;
    for (const key in db) {
      if (!db[key] || key.startsWith("_")) continue;
      resetPanelData(guildId, key);
      await refreshVisualPanel(guildId, key);
      count++;
    }
    return msg.reply({ content: `✅ Reset ${count} panels to defaults.` }).catch(() => {});
  }

  if (!db[resetKey]) {
    return msg.reply({ content: getMsg("system.resetPanelNotFound", { key: resetKey }) }).catch(() => {});
  }
  resetPanelData(guildId, resetKey);
  await refreshVisualPanel(guildId, resetKey);
  return msg.reply({ content: getMsg("system.resetPanelSuccess", { key: resetKey }) }).catch(() => {});
}
