// ==========================================
// 🔒 MANAGEMENT — Reservations Core
// Panel overview + Clear reservations
// Extracted from management-reservations.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    EmbedBuilder as e
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel } from "./panel-utils.js";
import { noop } from "../core/config.js";
import { sendTimedConfirm, clearConfirmTimeout } from "./management-helpers.js";

/** Show the reservation management panel with Fury/Frenzy reservation status. */
export async function handleMgmtReservations(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const furyReservations = [];
    const frenzyReservations = [];

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;

        const floor = key.includes("11") ? "MS11" : "MS12";

        for (const ev of ["fury", "frenzy"]) {
            const evData = current[ev];
            if (!evData || evData.type !== "fixed") continue;

            if (evData.reservedFor || evData.reservations) {
                const targetList = ev === "fury" ? furyReservations : frenzyReservations;
                let desc = `**${floor}** — `;

                if (evData.reservedFor) {
                    desc += `All hours → ${evData.reservedByName || evData.reservedFor}`;
                } else if (evData.reservations) {
                    if (evData.reservations._all) {
                        desc += `All hours → ${evData.reservations._all.userName}`;
                    } else {
                        const slots = Object.entries(evData.reservations)
                            .filter(([h]) => !h.startsWith("_"))
                            .sort(([a], [b]) => parseInt(a) - parseInt(b))
                            .map(([h, u]) => `${h}:00→${u.userName}`)
                            .join(", ");
                        desc += slots || "None";
                    }
                }
                targetList.push(desc);
            }
        }
    }

    const noRes = getMsg("management.reservations.noRes");
    const embed = new e()
        .setTitle(getMsg("management.reservations.title"))
        .setColor("#2b2d31")
        .setDescription(
            `**🔴 Fury Reservations**\n${furyReservations.length > 0 ? furyReservations.map(r => `• ${r}`).join("\n") : noRes}\n\n` +
            `**🟣 Frenzy Reservations**\n${frenzyReservations.length > 0 ? frenzyReservations.map(r => `• ${r}`).join("\n") : noRes}\n\n` +
            `Use the buttons below to manage reservations.`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations-add").setEmoji("➕").setLabel("Reserve").setStyle(a.Success),
                new n().setCustomId("mgmt-reservations-open").setEmoji("🔓").setLabel("Open Event").setStyle(a.Primary),
                new n().setCustomId("mgmt-reservations-clear").setEmoji("🗑️").setLabel(getMsg("management.reservations.btnClearAll")).setStyle(a.Danger),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

/** Show confirmation prompt before clearing all reservations. */
export async function handleMgmtReservationsClear(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    let totalCount = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        if ("event_group" !== db[key].type) continue;
        for (const ev of ["fury", "frenzy"]) {
            const evData = db[key][ev];
            if (evData && evData.type === "fixed" && (evData.reservedFor || evData.reservations)) {
                totalCount++;
            }
        }
    }

    if (totalCount === 0) {
        return await interaction.update({
            content: getMsg("management.reservations.clearNone"),
            components: [
                new t().addComponents(
                    new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnBackReservations")).setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(noop);
    }

    return sendTimedConfirm(interaction,
        getMsg("management.reservations.clearConfirm", { count: totalCount }),
        [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations-clear-confirm").setEmoji("✅").setLabel(getMsg("management.reservations.clearYes")).setStyle(a.Danger),
                new n().setCustomId("mgmt-reservations-clear-cancel").setEmoji("❌").setLabel(getMsg("management.reservations.clearCancel")).setStyle(a.Secondary)
            )
        ]
    );
}

/** Execute clearing all Fury+Frenzy reservations. */
export async function handleMgmtReservationsClearExecute(interaction) {
    clearConfirmTimeout(interaction);
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    let clearedCount = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;

        for (const ev of ["fury", "frenzy"]) {
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
        saveLocalStorage();
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            await refreshVisualPanel(key);
        }
    }

    return await interaction.update({
        content: getMsg("management.reservations.clearDone", { count: clearedCount }),
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnBackReservations")).setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(noop);
}

/** Cancel the clear-all-reservations operation. */
export async function handleMgmtReservationsClearCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: getMsg("management.reservations.clearCancelled"),
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnBackReservations")).setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(noop);
}
