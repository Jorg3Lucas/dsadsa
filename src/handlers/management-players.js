// ==========================================
// 👥 MANAGEMENT — Player Operations
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
import { noop } from "../core/config.js";
import { sendTimedConfirm, clearConfirmTimeout } from "./management-helpers.js";

// ==========================================
// 👥 PLAYER MANAGEMENT
// ==========================================

export async function handleMgmtPlayers(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const embed = new e()
        .setTitle(getMsg("management.players.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.players.desc"))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-players-register").setEmoji("📝").setLabel(getMsg("management.players.btnRegister")).setStyle(a.Primary),
                new n().setCustomId("mgmt-players-pilot").setEmoji("👤").setLabel(getMsg("management.players.btnPilot")).setStyle(a.Primary),
                new n().setCustomId("mgmt-players-remove-pilot").setEmoji("🗑️").setLabel(getMsg("management.players.btnRemovePilot")).setStyle(a.Danger),
                new n().setCustomId("mgmt-players-sync").setEmoji("🔄").setLabel(getMsg("management.players.btnForceSync")).setStyle(a.Secondary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

export async function handleMgmtPlayersRegister(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const modal = new m()
        .setCustomId("register_modal")
        .setTitle(getMsg("management.players.registerTitle"));

    const nicknameInput = new ti()
        .setCustomId("character_nickname")
        .setLabel(getMsg("management.players.registerLabel"))
        .setStyle(tis.Short)
        .setPlaceholder(getMsg("management.players.registerPlaceholder"))
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(new t().addComponents(nicknameInput));
    return await interaction.showModal(modal).catch(noop);
}

export async function handleMgmtPlayersSync(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    return sendTimedConfirm(
        interaction,
        getMsg("management.players.syncConfirm"),
        [
            new t().addComponents(
                new n().setCustomId("mgmt-players-sync-confirm").setEmoji("🔄").setLabel(getMsg("management.players.syncYes")).setStyle(a.Danger),
                new n().setCustomId("mgmt-players-sync-cancel").setEmoji("❌").setLabel(getMsg("management.players.syncCancel")).setStyle(a.Secondary)
            )
        ]
    );
}

export async function handleMgmtPlayersSyncConfirm(interaction) {
    clearConfirmTimeout(interaction);
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    await interaction.update({
        content: getMsg("management.players.syncProgress"),
        components: []
    }).catch(noop);

    try {
        const { runDailySynchronization } = await import("../core/ranking-sync-engine.js");
        const { client, rankingDb: rDb } = await import("../core/state.js");
        await runDailySynchronization(client, rDb, () => {}, () => {}, true);
        await interaction.editReply({
            content: getMsg("management.players.syncDone"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
            ]
        }).catch(noop);
    } catch (e) {
        await interaction.editReply({
            content: getMsg("management.players.syncFailed", { error: (e.message || String(e)).slice(0, 1900) }),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
            ]
        }).catch(noop);
    }
}

export async function handleMgmtPlayersPilot(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    return await interaction.update({
        content: getMsg("management.players.pilotInfo"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("🔙").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

export async function handleMgmtPlayersRemovePilot(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    return await interaction.update({
        content: getMsg("management.players.removePilotInfo"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("🔙").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}

export async function handleMgmtPlayersSyncCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: getMsg("management.players.syncCancelled"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(noop);
}
