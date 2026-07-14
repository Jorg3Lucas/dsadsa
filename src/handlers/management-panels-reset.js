// ==========================================
// 🏗️ MANAGEMENT — Panel Reset
// Extracted from management-panels.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db } from "../core/state.js";
import { refreshVisualPanel, resetPanelData } from "./panel-utils.js";
import { noop } from "../core/config.js";

/** Show the panel reset menu with a select of available panels. */
export async function handleMgmtPanelsResetMenu(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const optionsList = [];
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        const cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
        optionsList.push({ label: `${cleanedTitle}`, description: `Key: ${key}`, value: key });
    }
    if (optionsList.length === 0) {
        return await interaction.update({
            content: getMsg("system.resetNoPanels"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(noop);
    }
    if (optionsList.length > 1) {
        optionsList.unshift({ label: getMsg("management.panels.resetAll"), description: getMsg("management.panels.resetAllDesc"), value: "__all__" });
    }

    return await interaction.update({
        content: getMsg("system.resetMenuTitle"),
        components: [
            new t().addComponents(
                new i().setCustomId("mgmt-panels-reset-execute").setPlaceholder("Choose a panel...").addOptions(optionsList.slice(0, 25))
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

/** Execute the panel reset for the selected panel key (or __all__). */
export async function handleMgmtPanelsResetExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const resetKey = interaction.values[0];

    if ("__all__" === resetKey) {
        let count = 0;
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            resetPanelData(key);
            await refreshVisualPanel(key);
            count++;
        }
        return await interaction.update({
            content: getMsg("management.panels.resetDone", { count }),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ]
        }).catch(noop);
    }

    if (!db[resetKey]) {
        return await interaction.update({
            content: getMsg("system.resetPanelNotFound", { key: resetKey }),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(noop);
    }

    resetPanelData(resetKey);
    await refreshVisualPanel(resetKey);
    return await interaction.update({
        content: getMsg("system.resetPanelSuccess", { key: resetKey }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
        ]
    }).catch(noop);
}
