// ==========================================
// 🔒 MANAGEMENT — Reservations Add
// Add reservation + modal handlers
// Extracted from management-reservations.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i,
    ModalBuilder as m,
    TextInputBuilder as ti,
    TextInputStyle as tis
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { noop } from "../core/config.js";
import { reserveFlowCache } from "../interactions/admin-interactions.js";

/** Show modal to enter a player name for a new reservation. */
export async function handleMgmtReservationsAdd(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const modal = new m()
        .setCustomId("mgmt-reservations-add-modal")
        .setTitle("➕ New Reservation")
        .addComponents(
            new t().addComponents(
                new ti()
                    .setCustomId("target_user")
                    .setLabel("Who is this reservation for?")
                    .setStyle(tis.Short)
                    .setPlaceholder("Enter the player's nickname (e.g. PlayerName)")
                    .setMinLength(2)
                    .setMaxLength(30)
                    .setRequired(true)
            )
        );

    return await interaction.showModal(modal).catch(noop);
}

/** Process the reservation modal: cache user name, show event type selector. */
export async function handleMgmtReservationsAddModal(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.reply({
            content: getMsg("system.permissionDeniedAdminDropped"),
            flags: 64
        }).catch(noop);
    }

    const userName = interaction.fields.getTextInputValue("target_user").trim();
    if (!userName) {
        return await interaction.reply({
            content: "❌ The player name cannot be empty.",
            flags: 64
        }).catch(noop);
    }

    reserveFlowCache[interaction.user.id] = {
        targetUserId: null,
        targetUserName: userName,
        step: "event"
    };

    return await interaction.reply({
        content: `🔒 **New Reservation for ${userName}**\n\nSelect the event type:`,
        components: [
            new t().addComponents(
                new i()
                    .setCustomId("reserve-select-event")
                    .setPlaceholder("Choose event type...")
                    .addOptions([
                        { label: "🔴 Fury", value: "fury", emoji: "🔴", description: "Reserve Fury slots" },
                        { label: "🟣 Frenzy", value: "frenzy", emoji: "🟣", description: "Reserve Frenzy slots" }
                    ])
            ),
            new t().addComponents(
                new n().setCustomId("reserve-cancel").setLabel("Cancel").setStyle(a.Danger)
            )
        ],
        flags: 64
    }).catch(noop);
}
