import {
    Client,
    GatewayIntentBits
} from 'discord.js';
import fs from 'node:fs';
import 'dotenv/config';

import {
    registerMir4SlashCommands,
    initMir4BotEvents,
    handleMir4Interactions,
    runDailySynchronization
} from './core/ranking_sync.js';
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
import { startAutoBackup, runBackup } from './auto-backup.js';
import { DISCORD_SERVER_ID, pendingRegistrations, pendingPilotApprovals } from './core/ranking-constants.js';

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

const dbRankingPath = './database_ranking.json';
const rankingLogsPath = './ranking_logs.txt';

let rankingDb = {
    users: {}
};

function logRankingEvent(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(`[Ranking] ${message}`);
    fs.appendFileSync(rankingLogsPath, logMessage, 'utf8');
}

function saveRankingStorage() {
    try {
        // Backup is non-fatal — save first, then try to backup
        try { runBackup(['./database_ranking.json']); } catch (e) {
            console.error('⚠️ [Save] Backup failed (non-fatal):', e.message);
        }

        const dbToSave = { ...rankingDb };
        // Persist pending registrations (deep copy to avoid reference issues)
        dbToSave._pendingRegistrations = JSON.parse(JSON.stringify(pendingRegistrations));
        dbToSave._pendingPilotApprovals = JSON.parse(JSON.stringify(pendingPilotApprovals));
        fs.writeFileSync(dbRankingPath, JSON.stringify(dbToSave, null, 2), 'utf8');
        
        const pendCount = Object.keys(dbToSave._pendingRegistrations).length;
        const pilotCount = Object.keys(dbToSave._pendingPilotApprovals).length;
        if (pendCount > 0 || pilotCount > 0) {
            console.log(`💾 [Save] Saved ${pendCount} pending + ${pilotCount} pilot approvals`);
        }
    } catch (error) {
        console.error('❌ Error saving ranking database:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
    }
}

function loadLocalStorageRanking() {
    try {
        if (fs.existsSync(dbRankingPath)) {
            const data = fs.readFileSync(dbRankingPath, 'utf8');
            rankingDb = JSON.parse(data);
            if (!rankingDb.users) rankingDb.users = {};

            // Restore pending registrations from disk (survive bot restarts)
            if (rankingDb._pendingRegistrations) {
                Object.assign(pendingRegistrations, rankingDb._pendingRegistrations);
                delete rankingDb._pendingRegistrations;
            }
            if (rankingDb._pendingPilotApprovals) {
                Object.assign(pendingPilotApprovals, rankingDb._pendingPilotApprovals);
                delete rankingDb._pendingPilotApprovals;
            }

            console.log('✅ Ranking database loaded successfully.');
            console.log(`📋 Restored ${Object.keys(pendingRegistrations).length} pending registration(s), ${Object.keys(pendingPilotApprovals).length} pending pilot approval(s)`);
        } else {
            saveRankingStorage();
            console.log('📝 New database_ranking.json file created.');
        }
    } catch (error) {
        console.error('❌ Error loading ranking database:', error);
    }
}

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once('clientReady', async () => {
    console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);

    loadLocalStorageRanking();
    logRankingEvent(`[Ranking Bot] Connected successfully as ${client.user.tag}`);

    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (guild) {
        await registerMir4SlashCommands(guild);
    } else {
        console.error('❌ Error: Invalid Server ID configuration.');
    }

    initMir4BotEvents(client, rankingDb, saveRankingStorage, logRankingEvent);

    setTimeout(async () => {
        console.log('🧪 [Startup] Checking if ranking needs sync...');
        await runDailySynchronization(client, rankingDb, saveRankingStorage, logRankingEvent, false);
    }, 10000);

    // Start auto-backup scheduler
    startAutoBackup(6);
});

// Graceful shutdown handlers (top-level, not inside ready callback)
function handleShutdown(signal) {
    console.log(`\n🛑 [${signal}] Shutting down gracefully...`);
    saveRankingStorage();
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
