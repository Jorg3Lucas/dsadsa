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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const dbClaimPath = path.resolve('./database.json');

let claimDb = {};
const claimLastMessages = {};

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
        fs.writeFileSync(dbClaimPath, JSON.stringify({
            maps: claimDb,
            panels: persistentMessages
        }, null, 2), 'utf8');
    } catch (e) {
        console.error('❌ Error saving claim database:', e);
    }
}

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once('ready', async () => {
    console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);

    initClaimSystem(client, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
});

// ==========================================
// ✉️ MESSAGE CREATE EVENT
// ==========================================
client.on('messageCreate', async (message) => {
    try {
        await handleClaimMessages(message, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
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
        return await handleClaimInteractions(interaction, claimDb, saveClaimStorage, (msg) => console.log(`[Claim] ${msg}`), claimLastMessages);
    } catch (error) {
        console.error('❌ Error caught in interaction handler:', error);
    }
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
