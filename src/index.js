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
import { startAutoBackup, runBackup } from './auto-backup.js';
import { initTempVoiceSystem } from './handlers/temp-voice.js';
import { initTicketSystem } from './handlers/ticket-system.js';
import {
    registerMir4SlashCommands,
    initMir4BotEvents,
    handleMir4Interactions,
    runDailySynchronization,
    DISCORD_SERVER_ID
} from './core/ranking_sync.js';
import { loadSalaryState } from './handlers/salary-state.js';
import { initSalaryCron } from './handlers/salary-lifecycle.js';
import { exportVotesToSheets } from './handlers/salary-sheets.js';
import { handleManagementInteraction, handleMgmtSlash } from './handlers/management-menu.js';
import { noop, getBotToken} from './core/config.js';

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

const dbClaimPath = path.resolve('./database.json');
const dbRankingPath = path.resolve('./database_ranking.json');
const rankingLogsPath = path.resolve('./ranking_logs.txt');

let claimDb = {};
let rankingDb = {
    users: {}
};
const claimLastMessages = {};

function logRankingEvent(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(`[Ranking] ${message}`);
    fs.appendFileSync(rankingLogsPath, logMessage, 'utf8');
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
        console.log('✅ Claim database loaded successfully.');
    }
} catch (e) {
    console.error('❌ Error pre-loading claim database:', e);
}

function saveClaimStorage() {
    try {
        // Backup before overwriting
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
        console.error('❌ Error saving claim database:', e);
    }
}

function saveRankingStorage() {
    try {
        // Backup before overwriting
        runBackup(['./database_ranking.json']);

        fs.writeFileSync(dbRankingPath, JSON.stringify(rankingDb, null, 2), 'utf8');
    } catch (error) {
        console.error('❌ Error saving ranking database:', error);
    }
}

function loadLocalStorageRanking() {
    try {
        if (fs.existsSync(dbRankingPath)) {
            const data = fs.readFileSync(dbRankingPath, 'utf8');
            rankingDb = JSON.parse(data);
            if (!rankingDb.users) rankingDb.users = {};
            console.log('✅ Ranking database loaded successfully.');
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
client.once('ready', async () => {
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
        console.log('🧪 [Test] Starting forced validation scan...');
        await runDailySynchronization(client, rankingDb, saveRankingStorage, logRankingEvent, true);
    }, 10000);

    // Start auto-backup scheduler
    startAutoBackup(6);

    initClaimSystem(client, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages, rankingDb);

    // Auto-setup channels after panels are initialized
    setTimeout(async () => {
        try {
            const { setupAllChannels } = await import('./handlers/auto-channel-setup.js');
            await setupAllChannels(client, DISCORD_SERVER_ID);
        } catch (err) {
            console.error('❌ [Auto Setup] Error:', err.message);
        }
    }, 5000);

    // Initialize Temp Voice system
    initTempVoiceSystem(client);

    // Initialize Ticket system
    initTicketSystem(client);

    // Initialize Salary Poll system
    loadSalaryState();
    initSalaryCron();

    // Re-export votes to Google Sheets on boot
    // Ensures stones are re-applied to the spreadsheet after restart
    setTimeout(async () => {
        try {
            console.log("📊 [Boot] Re-exporting votes to Google Sheets...");
            const result = await exportVotesToSheets();
            if (result) console.log("✅ [Boot] Votes re-exported successfully.");
        } catch (err) {
            console.error("❌ [Boot] Error re-exporting votes to sheets:", err.message);
        }
    }, 3000);


});

// ==========================================
// 🖱️ INTERACTION CREATE EVENT
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        // A. SLASH COMMANDS (/)
        if (interaction.isCommand()) {
            // Management panel — show main menu
            if (interaction.commandName === 'manage') {
                return await handleMgmtSlash(interaction);
            }

            const rankingCommands = [
                'register',
                'pilot',
                'removepilot',
                'forcesync',
                'manualregister',
                'manualpilot',
                'manualremove',
                'manualremovepilot',
                'cleandb'
            ];

            if (rankingCommands.includes(interaction.commandName)) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
        }

        // B. USER SELECT MENUS (e.g. ticket add member)
        if (interaction.isUserSelectMenu()) {
            return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
        }

        // C. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('mgmt-')) {
                return await handleManagementInteraction(interaction);
            }

            const rankingMenus = ['select_pilot_to_remove', 'select_clan_manual_', 'manage_'];
            const isRankingMenu = rankingMenus.some(id => interaction.customId.startsWith(id));

            if (isRankingMenu) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            } else {
                return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
            }
        }

        // D. MODAL SUBMITS
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'register_modal') {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            } else if (interaction.customId === 'mgmt-salary-spreadsheet-modal' || interaction.customId === 'mgmt-reservations-add-modal') {
                return await handleManagementInteraction(interaction);
            } else {
                return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
            }
        }

        // E. PANEL BUTTON CLICKS
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('mgmt-')) {
                return await handleManagementInteraction(interaction);
            }
            if (interaction.customId.startsWith('confirm-manual') || interaction.customId.startsWith('manage_')) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
        }

    } catch (error) {
        console.error('❌ Error caught in unified interaction router:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
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

client.login(getBotToken());
