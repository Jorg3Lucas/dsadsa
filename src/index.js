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
import { handleRankingCommand, handleSelectManualNickname } from './handlers/ranking-commands.js';
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
import { saveRankingStorage, saveRankingStorageSync, loadLocalStorageRanking, isDatabaseLoaded, hasUsers, getStorageStats } from './core/ranking-storage.js';

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

    initMir4BotEvents(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent);

    // Start sync after 15 seconds (give time for everything to initialize)
    setTimeout(async () => {
        console.log('🧪 [Startup] Checking if ranking needs sync...');
        await runDailySynchronization(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent, false);
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

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
    logRankingEvent(`[ERROR] Unhandled rejection: ${reason}`);
});

// ==========================================
// 🖱️ INTERACTION CREATE EVENT
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        // A. SLASH COMMANDS (/)
        if (interaction.isCommand()) {
            // Notify command
            if (interaction.commandName === 'notify') {
                return await handleNotifyCommand(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            const result = await handleRankingCommand(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            // Fallback: if command wasn't handled by new module, try giant file (e.g. scanimport)
            if (result !== false) return;
            return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
        }

        // B. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            // Notify select menu
            if (interaction.customId === 'notify_select_action') {
                return await handleNotifySelect(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Pilot registration: user picks the correct owner from fuzzy candidates
            if (interaction.customId.startsWith('user_select_pilot_owner_')) {
                return await handleUserSelectPilotOwner(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Pilot removal (user removing their own pilot)
            if (interaction.customId === 'select_pilot_to_remove') {
                return await handlePilotRemoveSelect(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Registration nickname selection (user choosing between typed vs suggestions)
            if (interaction.customId.startsWith('user_select_reg_nickname_')) {
                return await handleUserSelectRegistrationNickname(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Manualregister nickname selection
            if (interaction.customId.startsWith('select_manual_nickname_')) {
                return await handleSelectManualNickname(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Restore backup select menu
            if (interaction.customId === 'restorebackup_select') {
                return await handleRestoreBackupSelect(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Manage menu routing
            if (interaction.customId.startsWith('manage_user_page_')) {
                return await handleManageUserPage(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_action_')) {
                return await handleManageAction(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_pilot_')) {
                return await handleManagePilotRemove(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied_region') {
                return await handleManageAlliedRegion(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied_world') {
                return await handleManageAlliedWorld(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_allied_page_')) {
                return await handleManageAlliedPage(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied_remove') {
                return await handleManageAlliedRemove(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
        }

        // C. MODAL SUBMITS
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'register_owner_modal') {
                return await handleOwnerRegistrationModal(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'register_pilot_modal') {
                return await handlePilotRegistrationModal(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('reject_owner_')) {
                return await handleRejectOwner(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied_add_modal') {
                return await handleManageAlliedAddModal(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            // Fallback for any other modal submits not caught above
            return;
        }

        // D. BUTTON CLICKS
        if (interaction.isButton()) {
            // Notify buttons
            if (interaction.customId.startsWith('notify_')) {
                return await handleNotifyButton(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Welcome buttons (register owner / pilot)
            if (interaction.customId === 'welcome_register_owner') {
                return handleWelcomeRegisterOwner(interaction);
            }
            if (interaction.customId === 'welcome_register_pilot') {
                return handleWelcomeRegisterPilot(interaction);
            }

            // Welcome: self-service remove registration / pilot
            if (interaction.customId === 'welcome_remove_registration') {
                return await handleWelcomeRemoveRegistration(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'welcome_remove_pilot') {
                return await handleWelcomeRemovePilot(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'selfremove_yes' || interaction.customId === 'selfremove_no') {
                return await handleSelfRemoveConfirm(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Admin approval buttons (approve/reject owner registration)
            if (interaction.customId.startsWith('approve_owner_')) {
                return await handleApproveOwner(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Pilot approval buttons (owner approves/rejects via DM)
            if (interaction.customId.startsWith('approve_pilot_')) {
                return await handleApprovePilot(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Admin pilot approval buttons (admin approves/rejects from admin channel)
            if (interaction.customId.startsWith('admin_approve_pilot_')) {
                return await handleAdminApprovePilot(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Owner remove pilot button (from DM after admin approval)
            if (interaction.customId.startsWith('owner_remove_pilot_')) {
                return await handleOwnerRemovePilotDm(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Confirmation buttons (confirm-manualremove, confirm-manualregister, etc.)
            if (interaction.customId.startsWith('confirm-')) {
                return await handleConfirmAction(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Restore backup buttons
            if (interaction.customId === 'restorebackup-confirm') {
                return await handleRestoreBackupConfirm(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'restorebackup-cancel') {
                return await handleRestoreBackupCancel(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Manage navigation buttons (back, prev, next)
            if (interaction.customId === 'manage_back' ||
                interaction.customId === 'manage_allied_back' ||
                interaction.customId.startsWith('manage_user_prev_') ||
                interaction.customId.startsWith('manage_user_next_')) {
                return await handleManageNav(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Manage: Allied clans buttons
            if (interaction.customId === 'manage_allied') {
                return await handleManageAllied(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_allied_add_')) {
                return await handleManageAlliedAdd(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Allied clans: suggestion buttons (add clan modal fuzzy flow)
            if (interaction.customId.startsWith('confirm-addclan-')) {
                return await handleAddClanSuggestion(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Fallback: any remaining manage_ prefixed button
            if (interaction.customId.startsWith('manage_')) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
        }

    } catch (error) {
        console.error('❌ Error caught in interaction router:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', flags: 64 }).catch(() => {});
            }
        } catch (e) {
            // Silently fail
        }
    }
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
