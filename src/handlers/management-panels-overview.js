// ==========================================
// 🏗️ MANAGEMENT — Panel Overview
// Extracted from management-panels.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    EmbedBuilder as e
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db } from "../core/state.js";
import { getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";
import { noop } from "../core/config.js";

/** Show the management panel overview with total panel and active claim counts. */
export async function handleMgmtPanels(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    let totalPanels = 0;
    let activeClaims = 0;

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        totalPanels++;
        const current = db[key];
        if (current.ownerId) activeClaims++;
        if ("event_group" === current.type) {
            const egKeys = getEventGroupKeys(current);
            for (const ev of egKeys) {
                if (current[ev] && current[ev].ownerId) activeClaims++;
            }
        }
        if ("antidemon" === current.type || "summon" === current.type) {
            const props = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
            for (const p of props) {
                if (current[p] && (current[p].status === "🔴 Claimed" || current[p].ownerId)) activeClaims++;
            }
        }
    }

    const embed = new e()
        .setTitle(getMsg("management.panels.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.panels.desc", { total: totalPanels, active: activeClaims }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-panels-reset-menu").setEmoji("🔄").setLabel(getMsg("management.panels.btnReset")).setStyle(a.Danger),
                new n().setCustomId("mgmt-panels-kick-menu").setEmoji("👢").setLabel(getMsg("management.panels.btnKick")).setStyle(a.Primary),
                new n().setCustomId("mgmt-panels-deploy").setEmoji("📋").setLabel("Deploy Panels").setStyle(a.Primary),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}
