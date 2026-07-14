// ==========================================
// 🏗️ MANAGEMENT — Panel Deploy
// Extracted from management-panels.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db, lastMessages, saveLocalStorage } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { noop } from "../core/config.js";

/** Show the deploy panel menu with available panel configurations. */
export async function handleMgmtPanelsDeploy(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const optionsList = [
        { label: "MS7 - Magic Square 7", description: "Normal floor + Antidemon", value: "ms7" },
        { label: "MS8 - Magic Square 8", description: "Normal floor + Antidemon", value: "ms8" },
        { label: "MS9 - Magic Square 9", description: "Normal floor + Antidemon", value: "ms9" },
        { label: "MS10 - Magic Square 10", description: "Normal floor + Antidemon", value: "ms10" },
        { label: "MS11 - Magic Square 11", description: "Leaders, Events, Antidemon, Goblin", value: "ms11" },
        { label: "MS12 - Magic Square 12", description: "Leaders, Events, Antidemon, Goblin", value: "ms12" },
        { label: "SP7-10 - Secret Peak", description: "All regular Secret Peaks", value: "sp" },
        { label: "SP11 - Secret Peak 11", description: "SP11 + Goblin", value: "sp11" },
        { label: "SP12 - Secret Peak 12", description: "SP12 + Random Event + Goblin", value: "sp12" },
        { label: "Summon", description: "Summon location panel", value: "summon" },
        { label: "ALL", description: "Deploy ALL panels in this channel", value: "all" }
    ];

    return await interaction.update({
        content: "📋 **Select which panel to deploy in this channel:**",
        components: [
            new t().addComponents(
                new i().setCustomId("mgmt-panels-deploy-execute").setPlaceholder("Choose panels to deploy...").addOptions(optionsList.slice(0, 25))
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

/** Execute the panel deploy for the selected configuration — sends embeds and stores message IDs. */
export async function handleMgmtPanelsDeployExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const choice = interaction.values[0];
    const panelKeys = [];

    if (choice === "ms7" || choice === "ms8" || choice === "ms9" || choice === "ms10") {
        panelKeys.push(`${choice}squarenormal`, `${choice}squareantidemon`);
    } else if (choice === "ms11" || choice === "ms12") {
        panelKeys.push(
            `${choice}squareleaders`,
            `${choice}squareevents`,
            `${choice}squareantidemon`,
            `${choice}msgoblin`
        );
    } else if (choice === "sp") {
        for (const f of ["7", "8", "9", "10"]) {
            panelKeys.push(`${f}peak`);
        }
    } else if (choice === "sp11") {
        panelKeys.push("11peak", "11goblin");
    } else if (choice === "sp12") {
        panelKeys.push("12peak", "12randomevent", "12goblin");
    } else if (choice === "summon") {
        panelKeys.push("summon");
    } else if (choice === "all") {
        for (const f of ["7", "8", "9", "10"]) {
            panelKeys.push(`${f}squarenormal`, `${f}squareantidemon`, `${f}peak`);
        }
        for (const f of ["11", "12"]) {
            panelKeys.push(
                `${f}squareleaders`, `${f}squareevents`, `${f}squareantidemon`,
                `${f}msgoblin`, `${f}peak`, `${f}goblin`
            );
        }
        panelKeys.push("12randomevent", "summon");
    }

    if (!db._panelMapping) db._panelMapping = {};
    let deployedCount = 0;

    for (const key of panelKeys) {
        if (db._panelMapping[key] && db._panelMapping[key].channelId === interaction.channelId) {
            try {
                const oldMsg = await interaction.channel.messages.fetch(db._panelMapping[key].messageId).catch(() => null);
                if (oldMsg) await oldMsg.delete().catch(noop);
            } catch (e) {
                // Silently ignore — message may have been deleted already
            }
        }

        const sent = await interaction.channel.send({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        });
        lastMessages[key] = sent;
        db._panelMapping[key] = { channelId: interaction.channelId, messageId: sent.id };
        deployedCount++;
    }

    saveLocalStorage();
    return await interaction.update({
        content: `✅ **Deployed ${deployedCount} panel(s)** in this channel.`,
        components: [
            new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
        ]
    }).catch(noop);
}
