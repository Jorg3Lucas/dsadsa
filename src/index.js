import {
    Client,
    GatewayIntentBits
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

// ── Ranking system (main) ──
import { registerMir4SlashCommands } from './core/ranking-deploy.js';
import { initMir4BotEvents } from './core/ranking-events.js';
import { handleMir4Interactions } from './core/ranking-handlers.js';
import { runDailySynchronization } from './core/ranking-sync-engine.js';
import { handleOwnerRegistrationModal, handleSelectRegistrationNickname } from './handlers/ranking-registration.js';
import { handleWelcomeRegisterOwner, handleWelcomeRegisterPilot } from './handlers/ranking-welcome.js';
import { handleApproveOwner, handleRejectOwner, handleApprovePilot, handleAdminApprovePilot } from './handlers/ranking-approvals.js';
import { handlePilotRegistrationModal, handlePilotRemoveSelect, handleOwnerRemovePilotDm } from './handlers/ranking-pilot.js';
import { handleConfirmAction } from './handlers/ranking-confirmations.js';
import { handleRankingCommand, handleSelectManualNickname } from './handlers/ranking-commands.js';
import {
    handleSetupSelectWorlds,
    handleSetupNav,
    handleSetupConfirm,
    handleSetupCancel
} from './handlers/setup-handler.js';
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
    handleManageAlliedWorld,
    handleManageAlliedAdd,
    handleManageAlliedAddModal,
    handleManageAlliedRemove,
    handleManageNav,
    handleAddClanSuggestion
} from './handlers/ranking-management.js';
import { startAutoBackup, runBackup } from './auto-backup.js';
import { DISCORD_SERVER_ID } from './core/ranking-constants.js';
import { saveRankingStorage, loadLocalStorageRanking } from './core/ranking-storage.js';

// ── Claim system (eu11) ──
import { initClaimSystem, handleClaimInteractions } from './handlers/bot.js';
import { initTempVoiceSystem } from './handlers/temp-voice.js';
import { initTicketSystem } from './handlers/ticket-system.js';
import { loadRegistrationRequests } from './handlers/registration-panel.js';
import { loadSalaryState } from './handlers/salary-state.js';
import { initSalaryCron } from './handlers/salary-lifecycle.js';
import { exportVotesToSheets } from './handlers/salary-sheets.js';
import { handleManagementInteraction, handleMgmtSlash } from './handlers/management-menu.js';
import { syncTicketConfig } from './handlers/ticket-core.js';
import { noop, getBotToken } from './core/config.js';
import { logger, installGlobalErrorHandlers } from './core/logger.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    rest: {
        timeout: 60000
    }
});

// ── Database paths ──
const dbClaimPath = path.resolve('./database.json');
const dbRankingPath = path.resolve('./database_ranking.json');
const rankingLogsPath = path.resolve('./ranking_logs.txt');

let claimDb = {};
let rankingDb = {
    users: {}
};
const claimLastMessages = {};

// ── Claim database functions ──
function loadClaimStorage() {
    try {
        if (fs.existsSync(dbClaimPath)) {
            const data = fs.readFileSync(dbClaimPath, 'utf8');
            const parsed = JSON.parse(data);
            claimDb = parsed.maps || {};
            if (parsed.panels) {
                for (const panelId in parsed.panels) {
                    claimLastMessages[panelId] = parsed.panels[panelId];
                }
            }
            logger.info('Boot', 'Claim database loaded successfully.');
        }
    } catch (e) {
        logger.error('Boot', 'Error pre-loading claim database', e);
    }
}

function saveClaimStorage() {
    try {
        runBackup(['./database.json']);
        const persistentMessages = {};
        for (const panelId in claimLastMessages) {
            if (claimLastMessages[panelId]) {
                persistentMessages[panelId] = {
                    channelId: claimLastMessages[panelId].channelId,
                    messageId: claimLastMessages[panelId].id || claimLastMessages[panelId].messageId
                };
            }
        }
        fs.writeFileSync(dbClaimPath, JSON.stringify({
            maps: claimDb,
            panels: persistentMessages
        }, null, 2), 'utf8');
    } catch (e) {
        logger.error('Database', 'Error saving claim database', e);
    }
}

// ── Ranking DB wrapper ──
function saveRankingDb(db) {
    saveRankingStorage(db || rankingDb);
}

function logEvent(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    console.log(`[Ranking] ${message}`);
    try {
        fs.appendFileSync(rankingLogsPath, logLine, 'utf8');
    } catch (e) {
        // Silently fail
    }
}

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once('clientReady', async () => {
    console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);

    // Load databases
    rankingDb = loadLocalStorageRanking();
    syncTicketConfig(rankingDb);
    loadClaimStorage();
    loadRegistrationRequests();
    logEvent(`Connected successfully as ${client.user.tag}`);

    // Register slash commands
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (guild) {
        await registerMir4SlashCommands(guild);
    } else {
        console.error('❌ Error: Invalid Server ID configuration.');
    }

    // Initialize ranking events
    initMir4BotEvents(client, rankingDb, saveRankingDb, logEvent);

    // Initial sync after 10s
    setTimeout(async () => {
        console.log('🧪 [Startup] Checking if ranking needs sync...');
        await runDailySynchronization(client, rankingDb, saveRankingDb, logEvent, false);
    }, 10000);

    // Start auto-backup scheduler (every 6h)
    startAutoBackup(6);

    // ── Initialize claim system ──
    initClaimSystem(client, claimDb, saveClaimStorage, (msg) => logger.info('Claim', msg), claimLastMessages, rankingDb, true);

    // Auto-setup claim channels
    try {
        const { setupAllChannels } = await import('./handlers/auto-channel-setup.js');
        await setupAllChannels(client, DISCORD_SERVER_ID);
    } catch (err) {
        logger.error('AutoSetup', 'Failed to auto-setup channels', err);
    }

    // Start tick interval
    try {
        const { startTickInterval } = await import('./handlers/panel-tick.js');
        startTickInterval();
    } catch (err) {
        logger.error('Tick', 'Failed to start tick interval', err);
    }

    // Initialize Temp Voice system
    initTempVoiceSystem(client);

    // Initialize Ticket system
    initTicketSystem(client);

    // Initialize Salary Poll system
    loadSalaryState();
    initSalaryCron();

    // Re-export votes to Google Sheets on boot
    setTimeout(async () => {
        try {
            logger.info('Boot', 'Re-exporting votes to Google Sheets...');
            const result = await exportVotesToSheets();
            if (result) logger.info('Boot', 'Votes re-exported successfully.');
        } catch (err) {
            logger.error('Boot', 'Error re-exporting votes to sheets', err);
        }
    }, 3000);
});

// Graceful shutdown
function handleShutdown(signal) {
    console.log(`\n🛑 [${signal}] Shutting down gracefully...`);
    saveClaimStorage();
    saveRankingDb(rankingDb);
    logEvent(`Shutting down (${signal})`);
    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// ==========================================
// 🖱️ INTERACTION CREATE EVENT
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        // A. SLASH COMMANDS (/)
        if (interaction.isCommand()) {
            // Management panel — redirect to eu11's management system
            if (interaction.commandName === 'manage') {
                return await handleMgmtSlash(interaction);
            }

            // Notify command
            if (interaction.commandName === 'notify') {
                return await handleNotifyCommand(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Ranking commands (handleRankingCommand returns false if not a ranking command)
            const result = await handleRankingCommand(interaction, rankingDb, saveRankingDb, logEvent);
            if (result !== false) return;

            // Fallback: try legacy ranking handler
            const legacyResult = await handleMir4Interactions(interaction, rankingDb, saveRankingDb, logEvent);
            if (legacyResult !== false) return;

            // Fallback: claim interactions
            return await handleClaimInteractions(interaction);
        }

        // B. USER SELECT MENUS
        if (interaction.isUserSelectMenu()) {
            return await handleClaimInteractions(interaction);
        }

        // C. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            // Setup wizard — world selection
            if (interaction.customId === 'setup_select_worlds') {
                return await handleSetupSelectWorlds(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Management menus
            if (interaction.customId.startsWith('mgmt-')) {
                return await handleManagementInteraction(interaction);
            }

            // Notify select menu
            if (interaction.customId === 'notify_select_action') {
                return await handleNotifySelect(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Pilot removal (user removing their own pilot)
            if (interaction.customId === 'select_pilot_to_remove') {
                return await handlePilotRemoveSelect(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Registration nickname selection
            if (interaction.customId.startsWith('select_reg_nickname_')) {
                return await handleSelectRegistrationNickname(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Manualregister nickname selection
            if (interaction.customId.startsWith('select_manual_nickname_')) {
                return await handleSelectManualNickname(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Manage menu routing
            if (interaction.customId.startsWith('manage_user_page_')) {
                return await handleManageUserPage(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId.startsWith('manage_action_')) {
                return await handleManageAction(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId.startsWith('manage_pilot_')) {
                return await handleManagePilotRemove(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId === 'manage_allied_world') {
                return await handleManageAlliedWorld(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId === 'manage_allied_remove') {
                return await handleManageAlliedRemove(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Claim fallback for unhandled select menus
            return await handleClaimInteractions(interaction);
        }

        // D. MODAL SUBMITS
        if (interaction.isModalSubmit()) {
            // Management modals
            if (interaction.customId === 'mgmt-salary-spreadsheet-modal' || interaction.customId === 'mgmt-reservations-add-modal') {
                return await handleManagementInteraction(interaction);
            }

            // Ranking registration modals
            if (interaction.customId === 'register_owner_modal') {
                return await handleOwnerRegistrationModal(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId === 'register_pilot_modal') {
                return await handlePilotRegistrationModal(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId.startsWith('reject_owner_')) {
                return await handleRejectOwner(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId === 'manage_allied_add_modal') {
                return await handleManageAlliedAddModal(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Claim fallback
            return await handleClaimInteractions(interaction);
        }

        // E. BUTTON CLICKS
        if (interaction.isButton()) {
            // Setup wizard buttons
            if (interaction.customId === 'setup_confirm') {
                return await handleSetupConfirm(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId === 'setup_cancel') {
                return await handleSetupCancel(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId === 'setup_next_page') {
                return await handleSetupNav(interaction, rankingDb, saveRankingDb, logEvent, 'next');
            }
            if (interaction.customId === 'setup_prev_page') {
                return await handleSetupNav(interaction, rankingDb, saveRankingDb, logEvent, 'prev');
            }

            // Management buttons
            if (interaction.customId.startsWith('mgmt-')) {
                return await handleManagementInteraction(interaction);
            }

            // Notify buttons
            if (interaction.customId.startsWith('notify_')) {
                return await handleNotifyButton(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Welcome buttons (register owner / pilot)
            if (interaction.customId === 'welcome_register_owner') {
                return handleWelcomeRegisterOwner(interaction);
            }
            if (interaction.customId === 'welcome_register_pilot') {
                return handleWelcomeRegisterPilot(interaction);
            }

            // Admin approval buttons (approve/reject owner registration)
            if (interaction.customId.startsWith('approve_owner_')) {
                return await handleApproveOwner(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Pilot approval buttons (owner approves/rejects via DM)
            if (interaction.customId.startsWith('approve_pilot_')) {
                return await handleApprovePilot(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Admin pilot approval buttons
            if (interaction.customId.startsWith('admin_approve_pilot_')) {
                return await handleAdminApprovePilot(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Owner remove pilot button (from DM after admin approval)
            if (interaction.customId.startsWith('owner_remove_pilot_')) {
                return await handleOwnerRemovePilotDm(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Confirmation buttons
            if (interaction.customId.startsWith('confirm-')) {
                return await handleConfirmAction(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Ranking manage navigation buttons
            if (interaction.customId === 'manage_back' ||
                interaction.customId === 'manage_allied_back' ||
                interaction.customId.startsWith('manage_user_prev_') ||
                interaction.customId.startsWith('manage_user_next_')) {
                return await handleManageNav(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Ranking manage: Allied clans buttons
            if (interaction.customId === 'manage_allied') {
                return await handleManageAllied(interaction, rankingDb, saveRankingDb, logEvent);
            }
            if (interaction.customId.startsWith('manage_allied_add_')) {
                return await handleManageAlliedAdd(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Allied clans: suggestion buttons
            if (interaction.customId.startsWith('confirm-addclan-')) {
                return await handleAddClanSuggestion(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Fallback: any remaining manage_ prefixed button to ranking
            if (interaction.customId.startsWith('manage_')) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingDb, logEvent);
            }

            // Claim fallback for unhandled buttons
            return await handleClaimInteractions(interaction);
        }

    } catch (error) {
        logger.error('Router', 'Error caught in unified interaction router', error, {
            command: interaction.commandName,
            customId: interaction.customId,
            type: interaction.type,
            user: interaction.user?.id
        });
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', flags: 64 }).catch(noop);
            }
        } catch (e) {
            // Silently fail
        }
    }
});

// Install global error handlers BEFORE login
installGlobalErrorHandlers();

client.login(getBotToken());
