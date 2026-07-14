// ==========================================
// 💰 SALARY INTERACTION ROUTER
// Delegates all salary interactions to salary-poll.js
// ==========================================

import {
    handleVoteButton,
    handleSalarySelect,
    handleSalaryConfirm,
    handleSalaryCancel
} from "../handlers/salary-voting.js";
import {
    handleSalaryCheckButton,
    handleSalaryCheckRefresh
} from "../handlers/salary-report.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

/** Check if an interaction customId matches salary vote/select/confirm/cancel/check/refresh handlers. @param {import('discord.js').Interaction} interaction @returns {boolean} */
export function canHandleSalaryInteraction(interaction) {
    const cid = interaction.customId;

    // Vote button
    if (interaction.isButton() && cid === "salary_vote") return true;

    // Select menus
    if (interaction.isStringSelectMenu() && (cid.startsWith("salary_yellow_") || cid.startsWith("salary_purple_"))) return true;

    // Confirm/Cancel
    if (interaction.isButton() && (cid.startsWith("salary_confirm_") || cid.startsWith("salary_cancel_"))) return true;

    // Check/Refresh
    if (interaction.isButton() && (cid === "salary_check" || cid === "salary_refresh")) return true;

    return false;
}

/** Route a salary interaction to the appropriate handler (vote button, select menu, confirm, cancel, check, refresh). @param {import('discord.js').Interaction} interaction @returns {Promise<boolean>} */
export async function handleSalaryInteraction(interaction) {
    const cid = interaction.customId;

    if (interaction.isButton() && cid === "salary_vote") {
        return await handleVoteButton(interaction);
    }

    if (interaction.isStringSelectMenu() && (cid.startsWith("salary_yellow_") || cid.startsWith("salary_purple_"))) {
        return await handleSalarySelect(interaction);
    }

    if (interaction.isButton() && cid.startsWith("salary_confirm_")) {
        return await handleSalaryConfirm(interaction);
    }

    if (interaction.isButton() && cid.startsWith("salary_cancel_")) {
        return await handleSalaryCancel(interaction);
    }

    if (interaction.isButton() && cid === "salary_check") {
        return await handleSalaryCheckButton(interaction);
    }

    if (interaction.isButton() && cid === "salary_refresh") {
        return await handleSalaryCheckRefresh(interaction);
    }

    return false;
}
