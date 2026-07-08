import {
    Client,
    GatewayIntentBits
} from 'discord.js';
import fs from 'fs';
import 'dotenv/config';

import {
    registerMir4SlashCommands,
    initMir4BotEvents,
    handleMir4Interactions,
    runDailySynchronization
} from './ranking_sync.js';
import { startAutoBackup, runBackup } from './auto-backup.js';

const DISCORD_SERVER_ID = '1432320162278670440';

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
});

// ==========================================
// 🖱️ INTERACTION CREATE EVENT
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        // A. SLASH COMMANDS (/)
        if (interaction.isCommand()) {
            return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
        }

        // B. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            const rankingMenus = ['select_pilot_to_remove', 'manage_'];
            const isRankingMenu = rankingMenus.some(id => interaction.customId.startsWith(id));

            if (isRankingMenu) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
        }

        // C. MODAL SUBMITS
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'register_modal') {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
        }

        // D. BUTTON CLICKS
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('confirm-manual') || interaction.customId.startsWith('manage_')) {
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
