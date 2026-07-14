import {
    Client,
    GatewayIntentBits
} from 'discord.js';
import 'dotenv/config';

import { registerMir4SlashCommands } from './core/ranking_sync.js';
import { initMir4BotEvents } from './core/ranking-events.js';
import { handleMir4Interactions } from './core/ranking-handlers.js';
import { runDailySynchronization } from './core/ranking-sync-engine.js';
import { handleOwnerRegistrationModal } from './handlers/ranking-registration.js';
import { handleWelcomeRegisterOwner, handleWelcomeRegisterPilot } from './handlers/ranking-welcome.js';
import { handleApproveOwner, handleRejectOwner, handleApprovePilot } from './handlers/ranking-approvals.js';
import { handlePilotRegistrationModal, handlePilotRemoveSelect } from './handlers/ranking-pilot.js';
import { handleConfirmAction } from './handlers/ranking-confirmations.js';
import { handleRankingCommand } from './handlers/ranking-commands.js';
import {
    handleManageUserPage,
    handleManageAction,
    handleManagePilotRemove,
    handleManageAllied,
    handleManageAlliedWorld,
    handleManageAlliedAdd,
    handleManageAlliedAddModal,
    handleManageAlliedRemove,
    handleManageNav
} from './handlers/ranking-management.js';
import { startAutoBackup } from './auto-backup.js';
import { DISCORD_SERVER_ID } from './core/ranking-constants.js';
import { logRankingEvent } from './core/ranking-logger.js';
import { saveRankingStorage, loadLocalStorageRanking } from './core/ranking-storage.js';

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
// 🚀 READY EVENT
// ==========================================
client.once('clientReady', async () => {
    console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);

    rankingDb = loadLocalStorageRanking();
    logRankingEvent(`[Ranking Bot] Connected successfully as ${client.user.tag}`);

    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (guild) {
        await registerMir4SlashCommands(guild);
    } else {
        console.error('❌ Error: Invalid Server ID configuration.');
    }

    initMir4BotEvents(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent);

    setTimeout(async () => {
        console.log('🧪 [Startup] Checking if ranking needs sync...');
        await runDailySynchronization(client, rankingDb, (db) => saveRankingStorage(db || rankingDb), logRankingEvent, false);
    }, 10000);

    // Start auto-backup scheduler
    startAutoBackup(6);
});

// Graceful shutdown handlers (top-level, not inside ready callback)
function handleShutdown(signal) {
    console.log(`\n🛑 [${signal}] Shutting down gracefully...`);
    saveRankingStorage(rankingDb);
    logRankingEvent(`[Ranking Bot] Shutting down (${signal})`);
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
            const result = await handleRankingCommand(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            // Fallback: if command wasn't handled by new module, try giant file (e.g. scanimport)
            if (result !== false) return;
            return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
        }

        // B. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            // Pilot removal (user removing their own pilot)
            if (interaction.customId === 'select_pilot_to_remove') {
                return await handlePilotRemoveSelect(interaction, rankingDb, saveRankingStorage, logRankingEvent);
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
            if (interaction.customId === 'manage_allied_world') {
                return await handleManageAlliedWorld(interaction, rankingDb, saveRankingStorage, logRankingEvent);
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
            // Welcome buttons (register owner / pilot)
            if (interaction.customId === 'welcome_register_owner') {
                return handleWelcomeRegisterOwner(interaction);
            }
            if (interaction.customId === 'welcome_register_pilot') {
                return handleWelcomeRegisterPilot(interaction);
            }

            // Admin approval buttons (approve/reject owner registration)
            if (interaction.customId.startsWith('approve_owner_')) {
                return await handleApproveOwner(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Pilot approval buttons (owner approves/rejects via DM)
            if (interaction.customId.startsWith('approve_pilot_')) {
                return await handleApprovePilot(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            // Confirmation buttons (confirm-manualremove, confirm-manualregister, etc.)
            if (interaction.customId.startsWith('confirm-')) {
                return await handleConfirmAction(interaction, rankingDb, saveRankingStorage, logRankingEvent);
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
