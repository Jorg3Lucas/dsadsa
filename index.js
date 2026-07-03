import {
    Client,
    GatewayIntentBits
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import {
    initClaimSystem,
    handleClaimMessages,
    handleClaimInteractions
} from './bot.js';
import { loadServerConfig, getActiveServerIds, getServerDataFiles } from './server-config.js';
import { DISCORD_SERVER_ID, reloadRankingConstants } from './ranking-constants.js';
import { initTempVoiceSystem } from './temp-voice.js';
import { loadTicketState, initTicketSystem } from './ticket-system.js';
import {
    registerMir4SlashCommands,
    initMir4BotEvents,
    handleMir4Interactions,
    runDailySynchronization
} from './ranking_sync.js';
import {
    loadAllSalaryStates,
    initSalaryCron
} from './salary-poll.js';

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
        const persistentMessages = {};
        for (const panelId in claimLastMessages) {
            if (claimLastMessages[panelId]) {
                persistentMessages[panelId] = {
                    channelId: claimLastMessages[panelId].channelId,
                    messageId: claimLastMessages[panelId].id || claimLastMessages[panelId].messageId
                };
            }
        }

        const serverIds = getActiveServerIds();
        if (serverIds.length === 0) {
            // Legacy fallback — save single file
            fs.writeFileSync(dbClaimPath, JSON.stringify({
                maps: claimDb,
                panels: persistentMessages
            }, null, 2), 'utf8');
            return;
        }

        // Save to EACH server's file (same merged data)
        for (const serverId of serverIds) {
            const dbPath = getServerDataFiles(serverId).claimDb;
            fs.writeFileSync(dbPath, JSON.stringify({
                maps: claimDb,
                panels: persistentMessages
            }, null, 2), 'utf8');
        }
    } catch (e) {
        console.error('❌ Error saving claim database:', e);
    }
}

// ─── Per-server claim DB loading ─────────────

function loadClaimDbs() {
    const serverIds = getActiveServerIds();
    if (serverIds.length === 0) {
        console.log('📝 [Claim] No servers configured, using single DB.');
        return;
    }

    let foundAnyFile = false;
    const mergedMaps = {};
    const mergedPanels = {};

    for (const serverId of serverIds) {
        try {
            const dbPath = getServerDataFiles(serverId).claimDb;
            if (fs.existsSync(dbPath)) {
                foundAnyFile = true;
                const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                if (data.maps) Object.assign(mergedMaps, data.maps);
                if (data.panels) {
                    for (const panelId in data.panels) {
                        mergedPanels[panelId] = data.panels[panelId];
                    }
                }
                console.log(`✅ [Claim] Loaded ${Object.keys(data.maps || {}).length} panels from ${serverId}.`);
            } else {
                console.log(`📝 [Claim] No DB file for ${serverId}, will create on save.`);
            }
        } catch (e) {
            console.error(`❌ [Claim] Error loading DB for ${serverId}:`, e.message);
        }
    }

    if (foundAnyFile) {
        // Replace in-memory data with per-server data
        Object.keys(claimDb).forEach(k => delete claimDb[k]);
        Object.assign(claimDb, mergedMaps);
        Object.keys(claimLastMessages).forEach(k => delete claimLastMessages[k]);
        Object.assign(claimLastMessages, mergedPanels);
        console.log(`✅ [Claim] Per-server DB loaded: ${Object.keys(claimDb).length} total panels.`);
    } else if (Object.keys(claimDb).length > 0) {
        // No per-server files yet, but legacy data exists — migrate now
        console.log('📝 [Claim] Migrating legacy database.json to per-server files...');
        saveClaimStorage();
        // Rename legacy file to prevent re-migration on next boot
        try {
            const backupPath = path.resolve('./claim-database.backup');
            fs.renameSync(dbClaimPath, backupPath);
            console.log('✅ [Claim] Legacy database.json renamed to claim-database.backup');
        } catch (e) {
            console.error('❌ [Claim] Could not rename legacy file:', e.message);
        }
    }
}

// ─── Per-server ranking DB loading/saving ────

function loadRankingDbs() {
    const serverIds = getActiveServerIds();
    if (serverIds.length === 0) {
        console.log('📝 [Ranking] No servers configured, using single DB.');
        // Try loading from legacy path
        const legacyPath = path.resolve('./database_ranking.json');
        if (fs.existsSync(legacyPath)) {
            try {
                rankingDb = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
                if (!rankingDb.users) rankingDb.users = {};
                console.log('✅ Ranking database loaded from legacy path.');
            } catch (e) {
                console.error('❌ Error loading legacy ranking DB:', e.message);
            }
        }
        return;
    }

    // Load per-server files and merge into rankingDb
    rankingDb = { users: {}, config: {} };
    for (const serverId of serverIds) {
        try {
            const dbPath = getServerDataFiles(serverId).rankingDb;
            if (fs.existsSync(dbPath)) {
                const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                if (data.users) {
                    Object.assign(rankingDb.users, data.users);
                }
                if (data.config && !rankingDb.config) {
                    rankingDb.config = data.config;
                }
                console.log(`✅ [Ranking] Loaded ${Object.keys(data.users || {}).length} users from ${serverId}.`);
            } else {
                console.log(`📝 [Ranking] No DB file for ${serverId}, will create on save.`);
            }
        } catch (e) {
            console.error(`❌ [Ranking] Error loading DB for ${serverId}:`, e.message);
        }
    }
    console.log(`✅ [Ranking] Merged DB: ${Object.keys(rankingDb.users).length} total users.`);
}

function saveRankingStorage() {
    const serverIds = getActiveServerIds();
    if (serverIds.length === 0) {
        // Legacy fallback
        try {
            fs.writeFileSync(path.resolve('./database_ranking.json'), JSON.stringify(rankingDb, null, 2), 'utf8');
        } catch (e) {
            console.error('❌ Error saving ranking database:', e);
        }
        return;
    }

    // Save to EACH server's file (same merged data)
    for (const serverId of serverIds) {
        try {
            const dbPath = getServerDataFiles(serverId).rankingDb;
            fs.writeFileSync(dbPath, JSON.stringify(rankingDb, null, 2), 'utf8');
        } catch (e) {
            console.error(`❌ [Ranking] Error saving DB for ${serverId}:`, e.message);
        }
    }
}

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once('ready', async () => {
    console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);

    loadServerConfig();
    reloadRankingConstants();

    // Load per-server ranking and claim files and merge
    loadRankingDbs();
    loadClaimDbs();
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

    initClaimSystem(client, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages, rankingDb);

    setTimeout(async () => {
        try {
            const { setupAllChannels } = await import('./auto-channel-setup.js');
            await setupAllChannels(client, DISCORD_SERVER_ID);
        } catch (err) {
            console.error('❌ [Auto Setup] Error:', err.message);
        }
    }, 5000);

    initTempVoiceSystem(client);
    initTicketSystem(client);

    loadAllSalaryStates();
    initSalaryCron();

    console.log(`🏁 Bot fully initialized. ${DISCORD_SERVER_ID ? `Discord Server: ${DISCORD_SERVER_ID}` : 'No Discord server configured - use !setup'}`);
});

// ==========================================
// ✉️ MESSAGE CREATE EVENT
// ==========================================
client.on('messageCreate', async (message) => {
    try {
        await handleClaimMessages(message);
    } catch (error) {
        console.error('❌ [MessageCreate Error]:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
    }
});

// ==========================================
// 🖱️ INTERACTION CREATE EVENT
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        // A. SLASH COMMANDS (/)
        if (interaction.isCommand()) {
            const rankingCommands = [
                'register',
                'pilot',
                'removepilot',
                'forcesync',
                'manualregister',
                'manualpilot',
                'manualremove',
                'manualremovepilot',
                'cleandb',
                'manage'
            ];

            if (rankingCommands.includes(interaction.commandName)) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }

            return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
        }

        // B. USER SELECT MENUS
        if (interaction.isUserSelectMenu()) {
            return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
        }

        // C. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
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
            } else {
                return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
            }
        }

        // E. PANEL BUTTON CLICKS
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('confirm-manual') || interaction.customId.startsWith('manage_')) {
                return await handleMir4Interactions(interaction, rankingDb, saveRankingStorage, logRankingEvent);
            }
            return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
        }

    } catch (error) {
        console.error('❌ Error caught in unified interaction router:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', flags: 64 }).catch(() => {});
            }
        } catch (e) {}
    }
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
