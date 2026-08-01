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
import { initEarlyClaimCommands } from './handlers/early-claim.js';
import { noop, getBotToken, DISCORD_SERVER_ID } from './core/config.js';
import { logger, installGlobalErrorHandlers } from './core/logger.js';

// ═══ RANKING / REGISTRATION SYSTEM (imported from main branch) ═══
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
import { startAutoBackup } from './auto-backup.js';
import { DISCORD_SERVER_ID as RANKING_SERVER_ID, MEMBER_ROLE_ID, ensureConfig } from './core/ranking-constants.js';
import { logRankingEvent } from './core/ranking-logger.js';
import { saveRankingStorage, loadLocalStorageRanking } from './core/ranking-storage.js';

// Both systems now operate on the claim guild — DISCORD_SERVER_ID comes from
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

        const guild = client.guilds.cache.get(RANKING_SERVER_ID);
        if (guild) {
            await registerMir4SlashCommands(guild);

            // Verify the member role exists — a wrong MEMBER_ROLE_ID silently
            // breaks role management and /scanrebuild, so surface it at boot.
            const memberRole = guild.roles.cache.get(MEMBER_ROLE_ID);
            if (memberRole) {
                console.log(`✅ [Ranking] Member role found: ${memberRole.name} (${MEMBER_ROLE_ID})`);
            } else {
                console.error(`❌ [Ranking] MEMBER_ROLE_ID (${MEMBER_ROLE_ID}) not found in guild ${RANKING_SERVER_ID} — check the role ID.`);
            }
        } else {
            console.error('❌ Error: Invalid Server ID configuration.');
        }

        initMir4BotEvents(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent);

        setTimeout(async () => {
            console.log('🧪 [Startup] Checking if ranking needs sync...');
            await runDailySynchronization(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent, false);
        }, 10000);

        // Start auto-backup scheduler (ranking files)
        startAutoBackup(6);
    } catch (err) {
        logger.error('RankingBoot', 'Failed to initialize ranking system', err);
    }

    // ═══ CLAIM SYSTEM BOOT ═══
    // Inicializa dados dos painéis sem recovery (não envia para canais antigos)
    initClaimSystem(client, claimDb, saveClaimStorage, logClaimEvent, claimLastMessages, true);

    // Recria canais e envia painéis frescos para os canais novos
    try {
        const { setupAllChannels } = await import('./handlers/auto-channel-setup.js');
        await setupAllChannels(client, DISCORD_SERVER_ID);
    } catch (err) {
        logger.error('AutoSetup', 'Failed to auto-setup channels', err);
    }

    // Inicia o tick AFTER os canais/painéis existirem
    const { startTickInterval } = await import('./handlers/panel-tick.js');
    startTickInterval();

    // Early claim admin commands (!earlyclaim add/remove/list)
    initEarlyClaimCommands(client);
});

// Graceful shutdown handlers — save ranking db on exit
// Guard: only persist if the DB was actually loaded, so a shutdown
// before clientReady cannot overwrite the on-disk data with empty state.
function handleShutdown(signal) {
    console.log(`\n🛑 [${signal}] Shutting down gracefully...`);
    if (rankingDbLoaded) {
        try { saveRankingStorage(rankingDb); } catch (e) { /* ignore */ }
    }
    logRankingEvent(`[Ranking Bot] Shutting down (${signal})`);
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
            if (interaction.customId.startsWith('select_reg_nickname_')) {
                return await handleSelectRegistrationNickname(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('select_manual_nickname_')) {
                return await handleSelectManualNickname(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
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
            if (interaction.customId === 'manage_allied_world') {
                return await handleManageAlliedWorld(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
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
            if (interaction.customId.startsWith('manage_allied_add_')) {
                return await handleManageAlliedAdd(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
            if (interaction.customId.startsWith('manage_')) {
                return await handleMir4Interactions(interaction, getRankingDb(), saveRankingStorage, logRankingEvent);
            }
        }

    } catch (error) {
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
