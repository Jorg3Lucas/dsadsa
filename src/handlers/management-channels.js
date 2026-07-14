// ==========================================
// 📢 MANAGEMENT — Channel, Logs, Tickets, Update
// Extracted from management-menu.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    EmbedBuilder as e
} from "discord.js";
import { execSync, exec } from "child_process";
import { getMsg } from "../core/lang.js";
import { dailyLogs } from "../core/state.js";
import { dispatchDailyLogs, saveDailyLogs } from "../core/daily-logs.js";
import { noop } from "../core/config.js";
import { sendTimedConfirm, clearConfirmTimeout } from "./management-helpers.js";
import { setupTicketPanel } from "./ticket-system.js";

// ==========================================
// 📢 CHANNEL CONFIGURATION
// ==========================================

export async function handleMgmtChannels(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const logsStatus = dailyLogs.configChannelId ? getMsg("management.channels.configYes") : getMsg("management.channels.configNo");
    const bossStatus = dailyLogs.bossSpawnChannelId ? getMsg("management.channels.configYes") : getMsg("management.channels.configNo");
    const eventStatus = dailyLogs.scheduledEventChannelId ? getMsg("management.channels.configYes") : getMsg("management.channels.configNo");

    const embed = new e()
        .setTitle(getMsg("management.channels.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.channels.desc", { logsStatus, bossStatus, eventStatus }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-channels-logs").setEmoji("📜").setLabel(getMsg("management.channels.btnSetLogs")).setStyle(a.Primary),
                new n().setCustomId("mgmt-channels-boss").setEmoji("🚨").setLabel(getMsg("management.channels.btnSetBoss")).setStyle(a.Primary),
                new n().setCustomId("mgmt-channels-events").setEmoji("📅").setLabel(getMsg("management.channels.btnSetEvents")).setStyle(a.Primary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

export async function handleMgmtChannelsLogs(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(noop);
    }
    dailyLogs.configChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: getMsg("management.channels.logsDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel(getMsg("management.btnBackChannels")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

export async function handleMgmtChannelsBoss(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(noop);
    }
    dailyLogs.bossSpawnChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: getMsg("management.channels.bossDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel(getMsg("management.btnBackChannels")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

export async function handleMgmtChannelsEvents(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(noop);
    }
    dailyLogs.scheduledEventChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: getMsg("management.channels.eventsDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel(getMsg("management.btnBackChannels")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 📋 DAILY LOGS
// ==========================================

export async function handleMgmtLogs(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const logCount = (dailyLogs.queue || []).length;
    const isConfigured = dailyLogs.configChannelId
        ? `<#${dailyLogs.configChannelId}>`
        : getMsg("management.logs.notConfigured");

    const embed = new e()
        .setTitle(getMsg("management.logs.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.logs.desc", { channel: isConfigured, count: logCount }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-logs-dispatch").setEmoji("📤").setLabel(getMsg("management.logs.btnDispatch")).setStyle(a.Success),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

export async function handleMgmtLogsDispatch(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    if (!dailyLogs.configChannelId) {
        return await interaction.update({
            content: getMsg("logs.noChannel"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(noop);
    }

    if (!await dispatchDailyLogs(true)) {
        return await interaction.update({
            content: getMsg("logs.dispatchError"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(noop);
    }

    return await interaction.update({
        content: getMsg("logs.dispatchSuccess"),
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 🎫 TICKETS
// ==========================================

export async function handleMgmtTickets(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    await setupTicketPanel(interaction.channel);
    return await interaction.update({
        content: getMsg("management.tickets.done"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 🔄 BOT UPDATE
// ==========================================

export async function handleMgmtUpdate(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    return sendTimedConfirm(
        interaction,
        getMsg("management.update.confirm"),
        [
            new t().addComponents(
                new n().setCustomId("mgmt-update-confirm").setEmoji("🔄").setLabel(getMsg("management.update.btnConfirm")).setStyle(a.Danger),
                new n().setCustomId("mgmt-update-cancel").setEmoji("❌").setLabel(getMsg("management.update.btnCancel")).setStyle(a.Secondary)
            )
        ]
    );
}

export async function handleMgmtUpdateConfirm(interaction) {
    clearConfirmTimeout(interaction);
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    await interaction.update({
        content: getMsg("management.update.progress"),
        components: []
    }).catch(noop);

    try {
        execSync("git pull --rebase", { encoding: "utf8", cwd: process.cwd() });
        execSync("npm install", { encoding: "utf8", cwd: process.cwd(), stdio: "pipe" });
        exec("pm2 restart bot", () => process.exit());
    } catch (e) {
        await interaction.followUp({
            content: getMsg("management.update.failed", { error: (e.message || e).slice(0, 1900) }),
            flags: 64
        }).catch(noop);
    }
}

export async function handleMgmtUpdateCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: getMsg("management.update.cancelled"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBackMenu")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}
