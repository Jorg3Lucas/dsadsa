// ==========================================
// 🧭 CLAIM HANDLERS — ROUTER
// Routes text commands and interactions to
// specialized sub-modules
// ==========================================

import { handleAdminCommand } from "./commands/admin-commands.js";
import { handlePanelCommand } from "./commands/panel-commands.js";
import { handleSalaryCommand } from "./commands/salary-commands.js";
import { canHandleAdminInteraction, handleAdminInteraction } from "./interactions/admin-interactions.js";
import { canHandleTicketInteraction, handleTicketInteraction } from "./ticket-system.js";
import { canHandleAntidemonInteraction, handleAntidemonInteraction } from "./interactions/antidemon-interactions.js";
import { canHandleSummonInteraction, handleSummonInteraction } from "./interactions/summon-interactions.js";
import { canHandleFloorInteraction, handleFloorInteraction } from "./interactions/floor-interactions.js";
import { canHandleSalaryInteraction, handleSalaryInteraction } from "./interactions/salary-interactions.js";

// ==========================================
// 💬 TEXT COMMAND ROUTER
// ==========================================

export async function handleClaimMessages(msg) {
    if (msg.author.bot) return;

    // Try admin commands first
    if (await handleAdminCommand(msg)) return;

    // Try panel commands
    if (await handlePanelCommand(msg)) return;

    // Try salary commands
    if (await handleSalaryCommand(msg)) return;
}

// ==========================================
// 🖱️ INTERACTION ROUTER
// ==========================================

export async function handleClaimInteractions(interaction) {
    let uid = interaction.user.id;
    let uName = interaction.member ? interaction.member.displayName : interaction.user.username;

    // 1. Admin interactions (reset menu, kick menu, reset logs)
    if (canHandleAdminInteraction(interaction)) {
        return await handleAdminInteraction(interaction, uid);
    }

    // 2. Antidemon interactions (slide, ticket, queue)
    if (canHandleAntidemonInteraction(interaction)) {
        return await handleAntidemonInteraction(interaction, uid, uName);
    }

    // 3. Summon interactions (slide, ticket, queue)
    if (canHandleSummonInteraction(interaction)) {
        return await handleSummonInteraction(interaction, uid, uName);
    }

    // 4. Salary interactions (vote, select, confirm, check)
    if (canHandleSalaryInteraction(interaction)) {
        return await handleSalaryInteraction(interaction);
    }

    // 5. Ticket interactions (open, close, confirm, cancel)
    if (canHandleTicketInteraction(interaction)) {
        return await handleTicketInteraction(interaction);
    }

    // 6. Floor interactions (buttons: death, claim, cancel, next)
    if (canHandleFloorInteraction(interaction)) {
        return await handleFloorInteraction(interaction, uid, uName);
    }
}
