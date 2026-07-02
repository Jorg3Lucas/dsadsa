// ==========================================
// 💰 SALARY INTERACTION ROUTER
// Delegates all salary interactions to salary-poll.js
// ==========================================

import {
    handleVoteButton,
    handleSalarySelect,
    handleSalaryConfirm,
    handleSalaryCancel,
    handleSalaryCheckButton,
    handleSalaryCheckRefresh
} from "../salary-poll.js";

// ==========================================
// 🔧 Helper: extract serverId from customId
// CustomId format: {serverId}_salary_{action}[_{userId}]
// e.g. "eu013_salary_vote", "eu021_salary_yellow_123456789"
// ==========================================

function extractServerId(customId) {
    // First segment before the first underscore is the serverId
    const idx = customId.indexOf('_');
    if (idx === -1) return null;
    const potentialServerId = customId.substring(0, idx);
    // Must be lowercase alphanumeric (like eu013, eu021)
    if (/^[a-z][a-z0-9]*$/.test(potentialServerId)) {
        return potentialServerId;
    }
    return null;
}

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleSalaryInteraction(interaction) {
    const cid = interaction.customId;

    // Vote button (format: {serverId}_salary_vote)
    if (interaction.isButton() && cid.endsWith("_salary_vote")) return true;

    // Select menus (format: {serverId}_salary_yellow_{userId} or {serverId}_salary_purple_{userId})
    if (interaction.isStringSelectMenu() && (cid.includes("_salary_yellow_") || cid.includes("_salary_purple_"))) return true;

    // Confirm/Cancel (format: {serverId}_salary_confirm_{userId} or {serverId}_salary_cancel_{userId})
    if (interaction.isButton() && (cid.includes("_salary_confirm_") || cid.includes("_salary_cancel_"))) return true;

    // Check/Refresh (format: {serverId}_salary_check or {serverId}_salary_refresh)
    if (interaction.isButton() && (cid.endsWith("_salary_check") || cid.endsWith("_salary_refresh"))) return true;

    return false;
}

export async function handleSalaryInteraction(interaction) {
    const cid = interaction.customId;
    const serverId = extractServerId(cid);

    if (!serverId) {
        console.error(`❌ [Salary] Could not extract serverId from customId: ${cid}`);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: "❌ Invalid interaction. Please try again.", flags: 64 }).catch(() => {});
            }
        } catch (e) {}
        return false;
    }

    if (interaction.isButton() && cid.endsWith("_salary_vote")) {
        return await handleVoteButton(interaction, serverId);
    }

    if (interaction.isStringSelectMenu() && (cid.includes("_salary_yellow_") || cid.includes("_salary_purple_"))) {
        return await handleSalarySelect(interaction, serverId);
    }

    if (interaction.isButton() && cid.includes("_salary_confirm_")) {
        return await handleSalaryConfirm(interaction, serverId);
    }

    if (interaction.isButton() && cid.includes("_salary_cancel_")) {
        return await handleSalaryCancel(interaction);
    }

    if (interaction.isButton() && cid.endsWith("_salary_check")) {
        return await handleSalaryCheckButton(interaction, serverId);
    }

    if (interaction.isButton() && cid.endsWith("_salary_refresh")) {
        return await handleSalaryCheckRefresh(interaction, serverId);
    }

    return false;
}
