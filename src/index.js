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

// ══════════════════════════════════════════════════════════
// 🏗️ CLAIM SYSTEM STATE
// ══════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════
// 🚀 READY EVENT
// ══════════════════════════════════════════════════════════

client.once('clientReady', async () => {
    logger.info('Boot', `Bot connected successfully as ${client.user.tag}`);

    // ═══ CLAIM SYSTEM BOOT ═══
    // Inicializa dados dos painéis com recovery: no boot, os painéis já mapeados
    // são re-enviados nos mesmos canais (os antigos são substituídos por novos).
    // O tick é iniciado internamente pelo initClaimSystem.
    initClaimSystem(client, claimDb, saveClaimStorage, logClaimEvent, claimLastMessages, false);

    // Comandos de texto: painéis (!ms, !sp, !summons) e admin (!reset, !kick, !reserve, !earlyclaim)
    initPanelCommands(client);
    initAdminCommands(client);
    initEarlyClaimCommands(client);
});

// ══════════════════════════════════════════════════════════
// 🖱️ INTERACTION CREATE EVENT — CLAIM ROUTER
// ══════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
    try {
        // Claim router (has canHandle* guards; returns undefined/false when not matched)
        const claimResult = await handleClaimInteractions(interaction);
        if (claimResult !== undefined && claimResult !== false) return;
    } catch (error) {
        logger.error('Router', 'Error caught in claim interaction router', error, {
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
