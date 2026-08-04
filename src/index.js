import {
    Client,
    GatewayIntentBits
} from 'discord.js';
import 'dotenv/config';

import { registerMir4SlashCommands } from './core/ranking-deploy.js';
import { initMir4BotEvents } from './core/ranking-events.js';
import { handleMir4Interactions } from './core/ranking-handlers.js';
import { runDailySynchronization } from './core/ranking-sync-engine.js';
import { handleOwnerRegistrationModal, handleUserSelectRegistrationNickname } from './handlers/ranking-registration.js';
import { handleWelcomeRegisterOwner, handleWelcomeRegisterPilot, handleWelcomeRemoveRegistration, handleSelfRemoveConfirm, handleWelcomeRemovePilot } from './handlers/ranking-welcome.js';
import { handleApproveOwner, handleRejectOwner, handleApprovePilot, handleAdminApprovePilot } from './handlers/ranking-approvals.js';
import { handlePilotRegistrationModal, handlePilotRemoveSelect, handleOwnerRemovePilotDm, handleUserSelectPilotOwner } from './handlers/ranking-pilot.js';
import { handleConfirmAction, handleRestoreBackupSelect, handleRestoreBackupCancel, handleRestoreBackupConfirm } from './handlers/ranking-confirmations.js';
import { handleRankingCommand, handleSelectManualNickname, handleSelectPendingNickname, handleSelectPendingPilotOwner } from './handlers/ranking-commands.js';
import {
    handleNotifyCommand,
    handleNotifySelect,
    handleNotifyButton
} from './handlers/ranking-notify.js';
import {
    handleManageUserPage,
    handleManageAction,
    handleManagePilotRemove,
    handleManageAllied,
    handleManageAlliedRegion,
    handleManageAlliedWorld,
    handleManageAlliedPage,
    handleManageAlliedAdd,
    handleManageAlliedAddModal,
    handleManageAlliedRemove,
    handleManageNav,
    handleAddClanSuggestion
} from './handlers/ranking-management.js';
import { startAutoBackup, getBackupStats } from './auto-backup.js';
import { DISCORD_SERVER_ID, ensureConfig } from './core/ranking-constants.js';
import { logRankingEvent } from './core/ranking-logger.js';
import { saveRankingStorage, saveRankingStorageSync, loadLocalStorageRanking, getStorageStats } from './core/ranking-storage.js';
import { isExpiredError } from './core/interaction-utils.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    rest: {
        timeout: 60000
    }
});

let rankingDb = {
    users: {}
};

// Handlers/events call save with no arguments — wrap so the current in-memory db is saved
const saveRankingStorageWrapped = (db) => saveRankingStorage(db || rankingDb);

// ==========================================
// 🚀 STARTUP VALIDATION
// ==========================================

console.log('========================================');
console.log('🤖 MIR4 Ranking Bot Starting...');
console.log('========================================');

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once('clientReady', async () => {
    console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);

    // Load database with recovery
    rankingDb = loadLocalStorageRanking();
    
    // Log storage status
    const storageStats = getStorageStats();
    const backupStats = getBackupStats();
    
    console.log('\n📊 Startup Status:');
    console.log(`   Database loaded: ${storageStats.databaseLoaded ? '✅' : '❌'}`);
    console.log(`   Users in memory: ${Object.keys(rankingDb.users || {}).length}`);
    console.log(`   Backups available: ${backupStats.count}`);
    console.log('========================================\n');

    logRankingEvent(`[Ranking Bot] Connected successfully as ${client.user.tag}`);

    // Ensure db.config and alliedClans are initialized before any system runs
    ensureConfig(rankingDb);

    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (guild) {
        await registerMir4SlashCommands(guild);
    } else {
        console.error('❌ Error: Invalid Server ID configuration.');
    }

    initMir4BotEvents(client, rankingDb, saveRankingStorageWrapped, logRankingEvent);

    // Start sync after 15 seconds (give time for everything to initialize)
    setTimeout(async () => {
        console.log('🧪 [Startup] Checking if ranking needs sync...');
        await runDailySynchronization(client, rankingDb, saveRankingStorageWrapped, logRankingEvent, false);
    }, 15000);

    // Start auto-backup every 30 minutes
    startAutoBackup(30);
});

// ==========================================
// 🛑 GRACEFUL SHUTDOWN
// ==========================================

let isShuttingDown = false;

function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n🛑 [${signal}] Shutting down gracefully...`);
    logRankingEvent(`[Ranking Bot] Shutting down (${signal})`);
    
    // Save with sync version for critical shutdown
    const saved = saveRankingStorageSync(rankingDb);
    if (saved) {
        console.log('💾 Database saved successfully');
    } else {
        console.error('❌ Failed to save database on shutdown!');
    }
    
    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    logRankingEvent(`[FATAL] Uncaught exception: ${error.message}`);
    
    // Try to save before crashing
    try {
        saveRankingStorageSync(rankingDb);
        console.log('💾 Emergency save completed');
    } catch (e) {
        console.error('❌ Emergency save failed:', e.message);
    }
    
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    logRankingEvent(`[ERROR] Unhandled rejection: ${reason}`);
});

// ==========================================
// 🖱️ INTERACTION ROUTER
// ==========================================
// Map-based router: exact match (O(1)) first, prefix match as fallback.
// This replaces the old if/else chain for faster routing.


// ── Slash commands ──
const COMMAND_ROUTES = new Map([
    ['notify', handleNotifyCommand],
]);

// ── Exact match routes ──
const BUTTON_EXACT = new Map([
    ['welcome_register_owner', handleWelcomeRegisterOwner],
    ['welcome_register_pilot', handleWelcomeRegisterPilot],
    ['welcome_remove_registration', handleWelcomeRemoveRegistration],
    ['welcome_remove_pilot', handleWelcomeRemovePilot],
    ['selfremove_yes', handleSelfRemoveConfirm],
    ['selfremove_no', handleSelfRemoveConfirm],
    ['restorebackup-confirm', handleRestoreBackupConfirm],
    ['restorebackup-cancel', handleRestoreBackupCancel],
    ['manage_allied', handleManageAllied],
    ['manage_allied_region', handleManageAlliedRegion],
    ['manage_allied_world', handleManageAlliedWorld],
    ['manage_allied_remove', handleManageAlliedRemove],
    ['manage_back', handleManageNav],
    ['manage_allied_back', handleManageNav],
]);

const SELECT_EXACT = new Map([
    ['notify_select_action', handleNotifySelect],
    ['select_pilot_to_remove', handlePilotRemoveSelect],
    ['restorebackup_select', handleRestoreBackupSelect],
    ['manage_allied_region', handleManageAlliedRegion],
    ['manage_allied_world', handleManageAlliedWorld],
    ['manage_allied_remove', handleManageAlliedRemove],
]);

const MODAL_EXACT = new Map([
    ['register_owner_modal', handleOwnerRegistrationModal],
    ['register_pilot_modal', handlePilotRegistrationModal],
    ['manage_allied_add_modal', handleManageAlliedAddModal],
]);

// ── Prefix match routes (order matters: longest prefix first) ──
const BUTTON_PREFIX = [
    ['admin_approve_pilot_', handleAdminApprovePilot],
    ['owner_remove_pilot_', handleOwnerRemovePilotDm],
    ['approve_owner_', handleApproveOwner],
    ['approve_pilot_', handleApprovePilot],
    ['manage_user_prev_', handleManageNav],
    ['manage_user_next_', handleManageNav],
    ['manage_allied_add_', handleManageAlliedAdd],
    ['confirm-addclan-', handleAddClanSuggestion],
    ['confirm-', handleConfirmAction],
    ['notify_', handleNotifyButton],
    ['manage_', handleMir4Interactions],  // fallback for manage_
];

const SELECT_PREFIX = [
    ['user_select_pilot_owner_', handleUserSelectPilotOwner],
    ['user_select_reg_nickname_', handleUserSelectRegistrationNickname],
    ['select_manual_nickname_', handleSelectManualNickname],
    ['select_pending_nickname_', handleSelectPendingNickname],
    ['select_pending_pilot_owner_', handleSelectPendingPilotOwner],
    ['manage_user_page_', handleManageUserPage],
    ['manage_action_', handleManageAction],
    ['manage_pilot_', handleManagePilotRemove],
    ['manage_allied_page_', handleManageAlliedPage],
];

const MODAL_PREFIX = [
    ['reject_owner_', handleRejectOwner],
];

// ── Route resolver ──
function resolveHandler(customId, exactMap, prefixList) {
    // Fast path: exact match
    const exact = exactMap.get(customId);
    if (exact) return exact;

    // Slow path: prefix match
    for (const [prefix, handler] of prefixList) {
        if (customId.startsWith(prefix)) return handler;
    }

    return null;
}

// ── Main interaction handler ──
client.on('interactionCreate', async (interaction) => {
    try {
        const { customId } = interaction;

        // A. SLASH COMMANDS
        if (interaction.isCommand()) {
            const handler = COMMAND_ROUTES.get(interaction.commandName);
            if (handler) {
                return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            }
            const result = await handleRankingCommand(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            if (result !== false) return;
            return await handleMir4Interactions(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
        }

        // B. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            const handler = resolveHandler(customId, SELECT_EXACT, SELECT_PREFIX);
            if (handler) return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
        }

        // C. MODAL SUBMITS
        if (interaction.isModalSubmit()) {
            const handler = resolveHandler(customId, MODAL_EXACT, MODAL_PREFIX);
            if (handler) return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            return; // unhandled modal — acknowledge silently
        }

        // D. BUTTON CLICKS
        if (interaction.isButton()) {
            const handler = resolveHandler(customId, BUTTON_EXACT, BUTTON_PREFIX);
            if (handler) return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
        }

    } catch (error) {
        // 10062 = interaction already expired / already handled — nothing to respond to, keep to one log line
        if (isExpiredError(error)) {
            const target = interaction.customId || interaction.commandName || 'unknown interaction';
            console.warn(`⚠️ [Router] Interaction expired on "${target}" (${error.code || 10062}) — skipping`);
            return;
        }
        console.error('❌ Error caught in interaction router:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', flags: 64 }).catch(() => {});
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: '❌ An unexpected error occurred. Please try again.' }).catch(() => {});
            }
        } catch {
            // Silently fail
        }
    }
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
