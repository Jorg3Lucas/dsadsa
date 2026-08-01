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

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once('clientReady', async () => {
    logger.info('Boot', `Bot connected successfully as ${client.user.tag}`);

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

// ==========================================
// 🖱️ INTERACTION CREATE EVENT
// ==========================================
client.on('interactionCreate', async (interaction) => {
    try {
        return await handleClaimInteractions(interaction);
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
