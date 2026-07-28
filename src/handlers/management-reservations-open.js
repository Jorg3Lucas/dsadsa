// ==========================================
// 🔒 MANAGEMENT — Reservations Open
// Open event (clear reservations by event type)
// Extracted from management-reservations.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel } from "./panel-utils.js";
import { noop } from "../core/config.js";

/** Show the event type selector for opening (clearing) reservations. */
export async function handleMgmtReservationsOpen(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    return await interaction.update({
        content: "🔓 **Which event do you want to open (clear reservations)?**",
        components: [
            new t().addComponents(
                new i()
                    .setCustomId("mgmt-reservations-open-execute")
                    .setPlaceholder("Choose event to open...")
                    .addOptions([
                        { label: "🔴 Fury", value: "fury", description: "Clear all Fury reservations" },
                        { label: "🟣 Frenzy", value: "frenzy", description: "Clear all Frenzy reservations" },
                        { label: "🔴🟣 Both", value: "both", description: "Clear both Fury and Frenzy reservations" }
                    ])
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

/** Execute opening reservations for the selected event type (Fury/Frenzy/Both). */
export async function handleMgmtReservationsOpenExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const choice = interaction.values[0];
    const eventsToClear = choice === "both" ? ["fury", "frenzy"] : [choice];
    let clearedCount = 0;

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;

        for (const ev of eventsToClear) {
            const evData = current[ev];
            if (!evData || evData.type !== "fixed") continue;
            if (evData.reservedFor || evData.reservations) {
                evData.reservedFor = null;
                evData.reservedByName = null;
                evData.reservations = null;
                clearedCount++;
            }
        }
    }

    if (clearedCount > 0) {
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            await refreshVisualPanel(key);
        }
    }

    const eventLabel = choice === "both" ? "Fury + Frenzy" : choice.charAt(0).toUpperCase() + choice.slice(1);
    saveLocalStorage();

    return await interaction.update({
        content: clearedCount > 0
            ? `✅ **${eventLabel}** — cleared ${clearedCount} reservation(s). Panels refreshed.`
            : `ℹ️ **${eventLabel}** — no reservations found to clear.`,
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel("Back to Reservations").setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}
