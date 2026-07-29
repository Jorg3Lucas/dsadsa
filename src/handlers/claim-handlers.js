// ==========================================
// 🧭 CLAIM HANDLERS — ROUTER
// Routes text commands and interactions to
// specialized sub-modules
// ==========================================

import { canHandleAdminInteraction, handleAdminInteraction } from "../interactions/admin-interactions.js";
import { canHandleTicketInteraction, handleTicketInteraction } from "./ticket-system.js";
import { canHandleAntidemonInteraction, handleAntidemonInteraction, canHandleAntidemonModal, handleAntidemonModal } from "../interactions/antidemon-interactions.js";
import { canHandleSummonInteraction, handleSummonInteraction } from "../interactions/summon-interactions.js";
import { canHandleFloorInteraction, handleFloorInteraction } from "../interactions/floor-interactions.js";
import { dmOptOut, saveDmOptOutToDisk, rankingDb, setCurrentWorld, worldDbs } from "../core/state.js";
import { canHandleSalaryInteraction, handleSalaryInteraction } from "../interactions/salary-interactions.js";
import { initWorldClaimDb } from "../core/claim-db-manager.js";


// ==========================================
// 🖱️ INTERACTION ROUTER
// ==========================================

export async function handleClaimInteractions(interaction) {
    const uid = interaction.user.id;
    const uName = interaction.member ? interaction.member.displayName : interaction.user.username;

    // ── Determine which world's claim database to use ──
    // Look at the channel's parent category to find the world's Claims category
    setWorldFromInteraction(interaction);

    try {
        // 0. DM Opt-Out button (🔕 on all panels) — no registration required
        if (interaction.isButton() && interaction.customId === 'dmoptout') {
            return await handleDmOptOut(interaction, uid);
        }

        // 1. Admin interactions (reset menu, kick menu, reset logs, reserve flow) — no registration required
        if (canHandleAdminInteraction(interaction)) {
            return await handleAdminInteraction(interaction, uid);
        }

        // ── Registration check: only registered users can use the claim system ──
        const userData = rankingDb?.users?.[uid];
        const isRegistered = !!(userData && (userData.nickname || userData.registeredAt || userData.manual === true));
        if (!isRegistered) {
            // Reject unregistered users — they must register first
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ **Access denied.** You must be registered with the bot to use claim features.\n\nPlease register in the registration channel first.',
                        flags: 64
                    });
                }
            } catch { /* interaction may have expired */ }
            return;
        }
        // ────────────────────────────────────────────────────────────────────

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

        // 6. Antidemon password modal submits
        if (canHandleAntidemonModal(interaction)) {
            return await handleAntidemonModal(interaction);
        }

        // 8. Floor interactions (buttons: death, claim, cancel, next)
        if (canHandleFloorInteraction(interaction)) {
            return await handleFloorInteraction(interaction, uid, uName);
        }
    } finally {
        // Always clear the world context, even if an error occurs
        setCurrentWorld(null);
    }
}

// ==========================================
// 🌍 SET CURRENT WORLD FROM INTERACTION CONTEXT
// ==========================================

/**
 * Determine which world a claim interaction belongs to by looking at
 * the channel's parent category. If the parent matches a world's
 * Claims category, that world's database is activated.
 */
function setWorldFromInteraction(interaction) {
    const parentId = interaction.channel?.parentId;
    if (!parentId) {
        setCurrentWorld(null);
        return;
    }

    // Look up the parent category in the ranking database to find its world
    const ws = rankingDb?.config?.worldSetup;
    if (!ws) {
        setCurrentWorld(null);
        return;
    }

    for (const [world, config] of Object.entries(ws)) {
        // Check if interaction is in a Claims category channel
        if (config.claimsCategoryId === parentId) {
            // Initialize the world's claim db if not already loaded
            if (!worldDbs[world]) {
                initWorldClaimDb(world);
            }
            setCurrentWorld(world);
            return;
        }
        // Also check floor channels directly (they have parent = claims category)
        if (config.floorChannels) {
            for (const chId of Object.values(config.floorChannels)) {
                if (chId === interaction.channelId) {
                    if (!worldDbs[world]) {
                        initWorldClaimDb(world);
                    }
                    setCurrentWorld(world);
                    return;
                }
            }
        }
    }

    // Not found in any world — clear context
    setCurrentWorld(null);
}

// ==========================================
// 🔕 DM OPT-OUT HANDLER — toggles DM preference per user
// ==========================================

async function handleDmOptOut(interaction, uid) {
    const currentlyOptedOut = dmOptOut.has(uid);

    if (currentlyOptedOut) {
        dmOptOut.delete(uid);
        saveDmOptOutToDisk();
        await interaction.reply({
            content: '✅ **DM notifications enabled!**\\n\\nYou will now receive claim alerts, boss reminders, and other notifications via DM.',
            flags: 64
        });
    } else {
        dmOptOut.add(uid);
        saveDmOptOutToDisk();
        await interaction.reply({
            content: '🔕 **DM notifications disabled!**\\n\\nYou will no longer receive claim alerts, boss reminders, and other notifications via DM.\\n\\nClick the button again anytime to re-enable them.',
            flags: 64
        });
    }
}
