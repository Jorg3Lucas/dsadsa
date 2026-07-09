// ==========================================
// 🖱️ MAIN INTERACTION DISPATCHER
// Routes interactions to specialized modules
// ==========================================
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from './lang.js';
import {
    confirmationCache,
    MEMBER_ROLE_ID,
    WORLD_IDS,
    DISCORD_SERVER_ID,
    ORIGIN_SERVER_ID,
    SECONDARY_SERVER_ID,
    pendingRegistrations,
    pendingPilotApprovals,
    adminChannelId,
    APPROVER_ROLE_IDS,
    WELCOME_PANEL_MESSAGE,
    PENDING_MAX_AGE_MS,
    PRE_REGISTER_MAX_AGE_MS
} from './ranking-constants.js';
import { findNicknameInCache, findClosestNicknameInCache, getLocalRankingCache, levenshteinDistance, cleanNickname } from './ranking-cache.js';
import { runDailySynchronization } from './ranking-sync-engine.js';

// ── Sub-handler modules ──
import { handleRegistrationInteractions } from './ranking-registration.js';
import { handleConfirmationButtons } from './ranking-confirmations.js';
import { handleManageInteractions } from './ranking-manage.js';
import { handleAdminCommands } from './ranking-cmd-admin.js';

// ==========================================
// 🖱️ MAIN HANDLER
// ==========================================

export async function handleMir4Interactions(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};

    // ==========================================
    // 🖱️ MAIN DISPATCHER
    // Routes interactions to specialized modules
    // ==========================================

    // ── Registration flow: welcome, modals, approvals, pilots ──
    await handleRegistrationInteractions(interaction, db, saveLocalStorage, logEvent);

    // ── Confirmation buttons ──
    await handleConfirmationButtons(interaction, db, saveLocalStorage, logEvent);

    // ── Manage menu & allied clans ──
    await handleManageInteractions(interaction, db, saveLocalStorage, logEvent);

    // ── Slash commands ──
    if (interaction.isCommand()) {
        await handleAdminCommands(interaction, db, saveLocalStorage, logEvent);
    }

}
