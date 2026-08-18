import {
    Client,
    GatewayIntentBits
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import {
    initClaimSystem,
    handleClaimInteractions
} from './handlers/bot.js';
import { initPanelCommands } from './handlers/panel-commands.js';
import { initAdminCommands } from './handlers/admin-commands.js';
import { initEarlyClaimCommands } from './handlers/early-claim.js';
import { initNoPenaltyCommands } from './handlers/no-penalty.js';
import { initAlertCommands } from './handlers/alert-commands.js';
import { noop, getBotToken, DISCORD_SERVER_ID } from './core/config.js';
import { logger, installGlobalErrorHandlers } from './core/logger.js';

// ═══ RANKING / REGISTRATION SYSTEM ═══
import { registerMir4SlashCommands } from './core/ranking-deploy.js';
import { destroyRankingScraperAgents } from './core/ranking-scraper.js';
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
    handleManageAlliedPage,
    handleManageAlliedAdd,
    handleManageAlliedAddModal,
    handleManageAlliedRemove,
    handleManageNav,
    handleAddClanSuggestion
} from './handlers/ranking-management.js';
import { startAutoBackup, getBackupStats } from './auto-backup.js';
import { DISCORD_SERVER_ID as RANKING_SERVER_ID, ensureConfig } from './core/ranking-constants.js';
import { logRankingEvent } from './core/ranking-logger.js';
import { saveRankingStorage, saveRankingStorageSync, loadLocalStorageRanking, getStorageStats } from './core/ranking-storage.js';
import { getLocalRankingCache } from './core/ranking-cache.js';
import { isExpiredError } from './core/interaction-utils.js';

// Both systems operate on the claim guild — DISCORD_SERVER_ID comes from
// config.js (hardcoded to the claim guild). RANKING_SERVER_ID in
// ranking-constants.js was aligned to the same value.

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

// ══════════════════════════════════════════════════════════
// 🏗️ CLAIM SYSTEM STATE
// ══════════════════════════════════════════════════════════

const dbClaimPath = path.resolve('./database.json');

// Ranking DB — assigned at boot, read by the unified router
let rankingDb = { users: {} };
let rankingDbLoaded = false;
const getRankingDb = () => rankingDb;

let claimDb = {};
const claimLastMessages = {};

function logClaimEvent(message) {
    console.log(`[Claim] ${message}`);
}

try {
    if (fs.existsSync(dbClaimPath)) {
        const claimData = fs.readFileSync(dbClaimPath, 'utf8');
        const parsedClaim = JSON.parse(claimData);
        claimDb = parsedClaim.maps || {};
        if (parsedClaim.panels) {
            for (const panelId in parsedClaim.panels) {
                claimLastMessages[panelId] = parsedClaim.panels[panelId];
            }
        }
        logger.info('Boot', 'Claim database loaded successfully.');
    }
} catch (e) {
    logger.error('Boot', 'Error pre-loading claim database', e);
}

function saveClaimStorage() {
    try {
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

// ══════════════════════════════════════════════════════════
// 🚀 READY EVENT
// ══════════════════════════════════════════════════════════

client.once('clientReady', async () => {
    logger.info('Boot', `Bot connected successfully as ${client.user.tag}`);

    // ═══ RANKING / REGISTRATION SYSTEM BOOT ═══
    try {
        rankingDb = loadLocalStorageRanking();
        rankingDbLoaded = true;
        logRankingEvent(`[Ranking Bot] Connected successfully as ${client.user.tag}`);

        // Ensure db.config and alliedClans are initialized before any system runs
        ensureConfig(rankingDb);

        // Log storage status
        const storageStats = getStorageStats();
        const backupStats = getBackupStats();
        console.log('\n📊 Startup Status:');
        console.log(`   Database loaded: ${storageStats.databaseLoaded ? '✅' : '❌'}`);
        console.log(`   Users in memory: ${Object.keys(rankingDb.users || {}).length}`);
        console.log(`   Backups available: ${backupStats.count}`);
        console.log('========================================\n');

        const guild = client.guilds.cache.get(RANKING_SERVER_ID);
        if (guild) {
            await registerMir4SlashCommands(guild);
        } else {
            console.error('❌ Error: Invalid Server ID configuration.');
        }

        initMir4BotEvents(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent);

        // Pre-warm the ranking cache into memory during idle startup so no
        // command or sync ever pays the parse cost again (the in-memory
        // reference is reused via the mtime-based cache).
        setTimeout(() => {
            const cache = getLocalRankingCache();
            if (cache && Object.keys(cache).length > 0) {
                console.log(`⚡ [Startup] Ranking cache pre-warmed (${Object.keys(cache).length} worlds)`);
            }
        }, 1000);

        setTimeout(async () => {
            console.log('🧪 [Startup] Checking if ranking needs sync...');
            await runDailySynchronization(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent, false);
        }, 10000);

        // Start auto-backup scheduler (ranking files)
        startAutoBackup(30);
    } catch (err) {
        logger.error('RankingBoot', 'Failed to initialize ranking system', err);
    }

    // ═══ CLAIM SYSTEM BOOT ═══
    // Inicializa dados dos painéis com recovery: no boot, os painéis já mapeados
    // são re-enviados nos mesmos canais (os antigos são substituídos por novos).
    // O tick é iniciado internamente pelo initClaimSystem.
    initClaimSystem(client, claimDb, saveClaimStorage, logClaimEvent, claimLastMessages, false);

    // Comandos de texto: painéis (!ms, !sp, !summons), admin (!reset, !kick,
    // !earlyclaim, !nopenalty) e canais de alerta (!reminders, !events)
    initPanelCommands(client);
    initAdminCommands(client);
    initEarlyClaimCommands(client);
    initNoPenaltyCommands(client);
    initAlertCommands(client);
});

// Graceful shutdown handlers — save ranking db on exit
// Guard: only persist if the DB was actually loaded, so a shutdown
// before clientReady cannot overwrite the on-disk data with empty state.
function handleShutdown(signal) {
    console.log(`\n🛑 [${signal}] Shutting down gracefully...`);
    if (rankingDbLoaded) {
        try { saveRankingStorageSync(rankingDb); } catch (e) { /* ignore */ }
    }
    logRankingEvent(`[Ranking Bot] Shutting down (${signal})`);
    // Release keep-alive sockets held by the ranking scraper so the process
    // exits cleanly without lingering idle connections.
    destroyRankingScraperAgents();
    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// ══════════════════════════════════════════════════════════
// 🖱️ INTERACTION CREATE EVENT — UNIFIED ROUTER
// 1. Slash commands → ranking system (claim has none)
// 2. Everything else → claim router first, then ranking router
// ══════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
    try {
        // A. SLASH COMMANDS — ranking system only
        if (interaction.isCommand()) {
            // Notify command
            if (interaction.commandName === 'notify') {
                return await handleNotifyCommand(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }

            const result = await handleRankingCommand(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            // Fallback: if command wasn't handled by new module, try legacy dispatcher
            if (result !== false) return;
            return await handleMir4Interactions(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
        }

        // B. CLAIM ROUTER FIRST (has canHandle* guards; returns undefined/false when not matched)
        const claimResult = await handleClaimInteractions(interaction);
        if (claimResult !== undefined && claimResult !== false) return;

        // C. RANKING ROUTER — string select menus, modals, buttons
        // C1. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'notify_select_action') {
                return await handleNotifySelect(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'select_pilot_to_remove') {
                return await handlePilotRemoveSelect(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'restorebackup_select') {
                return await handleRestoreBackupSelect(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('user_select_reg_nickname_')) {
                return await handleUserSelectRegistrationNickname(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('user_select_pilot_owner_')) {
                return await handleUserSelectPilotOwner(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('select_manual_nickname_')) {
                return await handleSelectManualNickname(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('select_pending_nickname_')) {
                return await handleSelectPendingNickname(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('select_pending_pilot_owner_')) {
                return await handleSelectPendingPilotOwner(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_user_page_')) {
                return await handleManageUserPage(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_action_')) {
                return await handleManageAction(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_pilot_')) {
                return await handleManagePilotRemove(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_allied_page_')) {
                return await handleManageAlliedPage(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied_remove') {
                return await handleManageAlliedRemove(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
        }

        // C2. MODAL SUBMITS
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'register_owner_modal') {
                return await handleOwnerRegistrationModal(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'register_pilot_modal') {
                return await handlePilotRegistrationModal(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('reject_owner_')) {
                return await handleRejectOwner(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied_add_modal') {
                return await handleManageAlliedAddModal(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            // Fallback for any other modal submits not caught above
            return;
        }

        // C3. BUTTON CLICKS
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('notify_')) {
                return await handleNotifyButton(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'welcome_register_owner') {
                return handleWelcomeRegisterOwner(interaction);
            }
            if (interaction.customId === 'welcome_register_pilot') {
                return handleWelcomeRegisterPilot(interaction);
            }
            if (interaction.customId === 'welcome_remove_registration') {
                return await handleWelcomeRemoveRegistration(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'welcome_remove_pilot') {
                return await handleWelcomeRemovePilot(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'selfremove_yes' || interaction.customId === 'selfremove_no') {
                return await handleSelfRemoveConfirm(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'restorebackup-confirm') {
                return await handleRestoreBackupConfirm(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'restorebackup-cancel') {
                return await handleRestoreBackupCancel(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('approve_owner_')) {
                return await handleApproveOwner(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('approve_pilot_')) {
                return await handleApprovePilot(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('admin_approve_pilot_')) {
                return await handleAdminApprovePilot(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('owner_remove_pilot_')) {
                return await handleOwnerRemovePilotDm(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            // Order matters: confirm-addclan- must be checked BEFORE the generic confirm- prefix
            if (interaction.customId.startsWith('confirm-addclan-')) {
                return await handleAddClanSuggestion(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('confirm-')) {
                return await handleConfirmAction(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_back' ||
                interaction.customId === 'manage_allied_back' ||
                interaction.customId.startsWith('manage_user_prev_') ||
                interaction.customId.startsWith('manage_user_next_')) {
                return await handleManageNav(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied') {
                return await handleManageAllied(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId === 'manage_allied_remove') {
                return await handleManageAlliedRemove(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_allied_add_')) {
                return await handleManageAlliedAdd(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_')) {
                return await handleMir4Interactions(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
        }

    } catch (error) {
        // 10062 = interaction already expired / already handled — keep to one log line
        if (isExpiredError(error)) {
            const target = interaction.customId || interaction.commandName || 'unknown interaction';
            console.warn(`⚠️ [Router] Interaction expired on "${target}" (${error.code || 10062}) — skipping`);
            return;
        }
        logger.error('Router', 'Error caught in unified interaction router', error, {
            command: interaction.commandName,
            customId: interaction.customId,
            type: interaction.type,
            user: interaction.user?.id
        });
        // Prevent interaction timeout — reply if not already replied
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', flags: 64 }).catch(noop);
            }
        } catch (e) {
            // Silently fail — interaction may have already timed out
        }
    }
});

// Install global error handlers BEFORE login
installGlobalErrorHandlers();

client.login(getBotToken());
