// ==========================================
// 🛠️ MANAGEMENT PANEL — Main Router
// /manage command + dispatch + re-exports
// Sub-modules: panels, reservations, players,
//              salary, channels/logs/tickets/update
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    EmbedBuilder as e
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { noop } from "../core/config.js";

// Sub-module imports
import {
    handleMgmtPanels,
    handleMgmtPanelsResetMenu,
    handleMgmtPanelsKickMenu,
    handleMgmtPanelsResetExecute,
    handleMgmtPanelsKickExecute,
    handleMgmtPanelsDeploy,
    handleMgmtPanelsDeployExecute
} from "./management-panels.js";

import {
    handleMgmtReservations,
    handleMgmtReservationsClear,
    handleMgmtReservationsClearExecute,
    handleMgmtReservationsClearCancel,
    handleMgmtReservationsAdd,
    handleMgmtReservationsAddModal,
    handleMgmtReservationsOpen,
    handleMgmtReservationsOpenExecute
} from "./management-reservations.js";

import {
    handleMgmtPlayers,
    handleMgmtPlayersRegister,
    handleMgmtPlayersPilot,
    handleMgmtPlayersRemovePilot,
    handleMgmtPlayersSync,
    handleMgmtPlayersSyncConfirm,
    handleMgmtPlayersSyncCancel
} from "./management-players.js";

import {
    handleMgmtSalary,
    handleMgmtSalaryChannel,
    handleMgmtSalarySpreadsheet,
    handleMgmtSalarySpreadsheetSubmit,
    handleMgmtSalaryExport,
    handleMgmtSalaryReport
} from "./management-salary.js";

import {
    handleMgmtChannels,
    handleMgmtChannelsLogs,
    handleMgmtChannelsBoss,
    handleMgmtChannelsEvents,
    handleMgmtLogs,
    handleMgmtLogsDispatch,
    handleMgmtTickets,
    handleMgmtUpdate,
    handleMgmtUpdateConfirm,
    handleMgmtUpdateCancel
} from "./management-channels.js";

// ==========================================
// 🎯 SLASH COMMAND — /manage
// ==========================================

export async function handleMgmtSlash(interaction) {
    try {
        const hasPerm = interaction.member?.permissions?.has("ManageMessages");
        if (!hasPerm) {
            return await interaction.reply({
                content: getMsg("system.permissionDeniedAdminDropped"),
                flags: 64
            });
        }

        const embed = new e()
            .setTitle(getMsg("management.title"))
            .setColor("#2b2d31")
            .setDescription(getMsg("management.mainDesc"))
            .setTimestamp();

        return await interaction.reply({
            embeds: [embed],
            components: [
                new t().addComponents(
                    new n().setCustomId("mgmt-panels").setEmoji("🏗️").setLabel(getMsg("management.btnPanels")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnReservations")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-channels").setEmoji("📢").setLabel(getMsg("management.btnChannels")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnPlayers")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-logs").setEmoji("📋").setLabel(getMsg("management.btnLogs")).setStyle(a.Secondary)
                ),
                new t().addComponents(
                    new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnSalary")).setStyle(a.Secondary),
                    new n().setCustomId("mgmt-tickets").setEmoji("🎫").setLabel(getMsg("management.btnTickets")).setStyle(a.Secondary),
                    new n().setCustomId("mgmt-update").setEmoji("🔄").setLabel(getMsg("management.btnUpdate")).setStyle(a.Danger)
                )
            ],
            flags: 64
        });
    } catch (err) {
        console.error("❌ [handleMgmtSlash] CRASH:", err);
        if (err.stack) console.error("📋 [Stack]:", err.stack);
        try {
            const errContent = getMsg("management.errorBody", { error: (err.message || String(err)).slice(0, 1500) });
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errContent, flags: 64 });
            } else {
                await interaction.followUp({ content: errContent, flags: 64 });
            }
        } catch (e) {
            // Silently ignored — non-critical operation
        }
    }
}

// ==========================================
// 🏠 MAIN MENU
// ==========================================

async function handleMgmtMain(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const embed = new e()
        .setTitle(getMsg("management.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.mainDescCompact"))
        .setTimestamp();
    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🏗️").setLabel(getMsg("management.btnPanels")).setStyle(a.Primary),
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnReservations")).setStyle(a.Primary),
                new n().setCustomId("mgmt-channels").setEmoji("📢").setLabel(getMsg("management.btnChannels")).setStyle(a.Primary),
                new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnPlayers")).setStyle(a.Primary),
                new n().setCustomId("mgmt-logs").setEmoji("📋").setLabel(getMsg("management.btnLogs")).setStyle(a.Secondary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnSalary")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-tickets").setEmoji("🎫").setLabel(getMsg("management.btnTickets")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-update").setEmoji("🔄").setLabel(getMsg("management.btnUpdate")).setStyle(a.Danger)
            )
        ]
    }).catch(noop);
}

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export async function handleManagementInteraction(interaction, _uid, _extra) {
    const cid = interaction.customId;

    if (cid === "mgmt-main") return handleMgmtMain(interaction);

    // Panels
    if (cid === "mgmt-panels") return handleMgmtPanels(interaction);
    if (cid === "mgmt-panels-reset-menu") return handleMgmtPanelsResetMenu(interaction);
    if (cid === "mgmt-panels-kick-menu") return handleMgmtPanelsKickMenu(interaction);
    if (cid === "mgmt-panels-reset-execute") return handleMgmtPanelsResetExecute(interaction);
    if (cid === "mgmt-panels-kick-execute") return handleMgmtPanelsKickExecute(interaction);
    if (cid === "mgmt-panels-deploy") return handleMgmtPanelsDeploy(interaction);
    if (cid === "mgmt-panels-deploy-execute") return handleMgmtPanelsDeployExecute(interaction);

    // Reservations
    if (cid === "mgmt-reservations") return handleMgmtReservations(interaction);
    if (cid === "mgmt-reservations-clear") return handleMgmtReservationsClear(interaction);
    if (cid === "mgmt-reservations-clear-confirm") return handleMgmtReservationsClearExecute(interaction);
    if (cid === "mgmt-reservations-clear-cancel") return handleMgmtReservationsClearCancel(interaction);
    if (cid === "mgmt-reservations-add") return handleMgmtReservationsAdd(interaction);
    if (cid === "mgmt-reservations-add-modal") return handleMgmtReservationsAddModal(interaction);
    if (cid === "mgmt-reservations-open") return handleMgmtReservationsOpen(interaction);
    if (cid === "mgmt-reservations-open-execute") return handleMgmtReservationsOpenExecute(interaction);

    // Channels
    if (cid === "mgmt-channels") return handleMgmtChannels(interaction);
    if (cid === "mgmt-channels-logs") return handleMgmtChannelsLogs(interaction);
    if (cid === "mgmt-channels-boss") return handleMgmtChannelsBoss(interaction);
    if (cid === "mgmt-channels-events") return handleMgmtChannelsEvents(interaction);

    // Update
    if (cid === "mgmt-update") return handleMgmtUpdate(interaction);
    if (cid === "mgmt-update-confirm") return handleMgmtUpdateConfirm(interaction);
    if (cid === "mgmt-update-cancel") return handleMgmtUpdateCancel(interaction);

    // Tickets
    if (cid === "mgmt-tickets") return handleMgmtTickets(interaction);

    // Logs
    if (cid === "mgmt-logs") return handleMgmtLogs(interaction);
    if (cid === "mgmt-logs-dispatch") return handleMgmtLogsDispatch(interaction);

    // Salary
    if (cid === "mgmt-salary") return handleMgmtSalary(interaction);
    if (cid === "mgmt-salary-channel") return handleMgmtSalaryChannel(interaction);
    if (cid === "mgmt-salary-spreadsheet") return handleMgmtSalarySpreadsheet(interaction);
    if (cid === "mgmt-salary-spreadsheet-modal") return handleMgmtSalarySpreadsheetSubmit(interaction);
    if (cid === "mgmt-salary-export") return handleMgmtSalaryExport(interaction);
    if (cid === "mgmt-salary-report") return handleMgmtSalaryReport(interaction);

    // Players
    if (cid === "mgmt-players") return handleMgmtPlayers(interaction);
    if (cid === "mgmt-players-register") return handleMgmtPlayersRegister(interaction);
    if (cid === "mgmt-players-sync") return handleMgmtPlayersSync(interaction);
    if (cid === "mgmt-players-sync-confirm") return handleMgmtPlayersSyncConfirm(interaction);
    if (cid === "mgmt-players-pilot") return handleMgmtPlayersPilot(interaction);
    if (cid === "mgmt-players-remove-pilot") return handleMgmtPlayersRemovePilot(interaction);
    if (cid === "mgmt-players-sync-cancel") return handleMgmtPlayersSyncCancel(interaction);

    return false;
}

// Re-export sub-module exports that need to be accessible externally
export { handleMgmtReservationsAddModal } from "./management-reservations.js";
