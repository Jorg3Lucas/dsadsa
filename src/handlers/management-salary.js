// ==========================================
// 💰 MANAGEMENT — Salary Operations
// Extracted from management-menu.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    EmbedBuilder as e,
    ModalBuilder as m,
    TextInputBuilder as ti,
    TextInputStyle as tis
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { getLocalTime } from "../core/time-utils.js";
import { noop } from "../core/config.js";
import { setSalaryChannelId, setSalarySpreadsheetId, getSalaryState } from "./salary-state.js";
import { createOrUpdatePollMessage } from "./salary-lifecycle.js";
import { forceExportToSheets } from "./salary-sheets.js";
import { postSalaryReport } from "./salary-report.js";

// ==========================================
// 💰 SALARY MANAGEMENT
// ==========================================

export async function handleMgmtSalary(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const state = getSalaryState();
    const statusEmoji = state.status === "open" ? "🟢" : state.status === "closed" ? "🔴" : "⚪";
    const weekStr = state.currentWeek || "—";
    const channelStr = state.channelId ? `<#${state.channelId}>` : getMsg("management.salary.channelNotSet");
    const spreadsheetStr = state.spreadsheetId
        ? getMsg("management.salary.sheetSet", { id: state.spreadsheetId.slice(0, 12) })
        : getMsg("management.salary.sheetNotSet");
    const voteCount = Object.keys(state.votes).length;
    const statusLabel = state.status === "open" ? getMsg("management.salary.statusOpen") : state.status === "closed" ? getMsg("management.salary.statusClosed") : getMsg("management.salary.statusIdle");

    // Calculate next event
    const now = getLocalTime();
    const day = now.getDay();
    const currMin = now.getHours() * 60 + now.getMinutes();
    let nextEvent;
    if (day <= 1 && (day < 1 || currMin < 12 * 60 + 30)) {
        nextEvent = getMsg("management.salary.nextOpen");
    } else if (day < 3 || (day === 3 && currMin < 13 * 60)) {
        nextEvent = getMsg("management.salary.nextClose");
    } else if (day === 3 && currMin < 16 * 60) {
        nextEvent = getMsg("management.salary.nextReport");
    } else {
        nextEvent = getMsg("management.salary.nextPoll");
    }

    const embed = new e()
        .setTitle(getMsg("management.salary.title"))
        .setColor(state.status === "open" ? "#57F287" : "#2b2d31")
        .setDescription(getMsg("management.salary.desc", {
            statusEmoji,
            status: statusLabel,
            week: weekStr,
            votes: voteCount,
            channel: channelStr,
            spreadsheet: spreadsheetStr,
            nextEvent
        }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-salary-channel").setEmoji("📢").setLabel(getMsg("management.salary.btnSetChannel")).setStyle(a.Primary),
                new n().setCustomId("mgmt-salary-spreadsheet").setEmoji("📈").setLabel(getMsg("management.salary.btnSetSpreadsheet")).setStyle(a.Primary),
                new n().setCustomId("mgmt-salary-export").setEmoji("📤").setLabel(getMsg("management.salary.btnExport")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-salary-report").setEmoji("📊").setLabel(getMsg("management.salary.btnPostReport")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

export async function handleMgmtSalaryChannel(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.salary.channelPermDenied"),
            components: [], flags: 64
        }).catch(noop);
    }
    setSalaryChannelId(interaction.channelId);
    await createOrUpdatePollMessage(true);
    return await interaction.update({
        content: getMsg("management.salary.channelDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

export async function handleMgmtSalarySpreadsheet(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(noop);
    }

    const state = getSalaryState();
    const notSetLabel = getMsg("management.salary.spreadsheetNotSet");
    const currentId = state.spreadsheetId || notSetLabel;

    const modal = new m()
        .setCustomId("mgmt-salary-spreadsheet-modal")
        .setTitle(getMsg("management.salary.spreadsheetTitle"));

    const input = new ti()
        .setCustomId("spreadsheet_id")
        .setLabel(getMsg("management.salary.spreadsheetLabel"))
        .setStyle(tis.Short)
        .setPlaceholder(getMsg("management.salary.spreadsheetPlaceholder"))
        .setValue(currentId !== notSetLabel ? currentId : "")
        .setRequired(true);

    modal.addComponents(new t().addComponents(input));
    return await interaction.showModal(modal).catch(noop);
}

export async function handleMgmtSalarySpreadsheetSubmit(interaction) {
    const sid = interaction.fields.getTextInputValue("spreadsheet_id").trim();
    if (!sid) {
        return await interaction.reply({
            content: getMsg("management.salary.spreadsheetEmpty"),
            flags: 64
        }).catch(noop);
    }
    setSalarySpreadsheetId(sid);
    return await interaction.reply({
        content: getMsg("management.salary.spreadsheetDone", { id: sid }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

export async function handleMgmtSalaryExport(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const result = await forceExportToSheets();
    return await interaction.update({
        content: result.message,
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

export async function handleMgmtSalaryReport(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    if (!getSalaryState().channelId) {
        return await interaction.update({
            content: getMsg("management.salary.reportNoChannel"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(noop);
    }

    await postSalaryReport();
    return await interaction.update({
        content: getMsg("management.salary.reportDone"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}
