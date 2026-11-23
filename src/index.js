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
import { initTextCommands } from './handlers/text-commands.js';
import { initKickCommand } from './handlers/kick-command.js';
import { initAdminCommands } from './handlers/admin-commands.js';
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
    // Inicializa os dados dos painéis (sem enviar nada): o auto-setup logo
    // abaixo recria os canais e publica todos os painéis do zero.
    await initClaimSystem(client, claimDb, saveClaimStorage, logClaimEvent, claimLastMessages);

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

    // 🩺 Watchdog dos painéis de claim: heartbeat a cada 5m e recuperação
    // automática escalonada (reexpede a mensagem; se falhar, recria o canal)
    // quando um painel fica > 1h sem atualizar com sucesso.
    const { startPanelWatchdog } = await import('./handlers/panel-recovery.js');
    startPanelWatchdog(DISCORD_SERVER_ID);

    // Admin text commands (!kick / !reset / !reserve)
    initKickCommand(client);
    initAdminCommands(client);

    // Claim text commands (!setreminders / !setevents / !setlogs)
    initTextCommands(client);
});

// ══════════════════════════════════════════════════════════
// 🖱️ INTERACTION CREATE EVENT
// Todos os handlers são do sistema de claim (botões e menus).
// ══════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
    try {
        // Não há slash commands no bot — só botões/menus dos painéis.
        if (interaction.isCommand()) return;

        await handleClaimInteractions(interaction);
    } catch (error) {
        logger.error('Router', 'Error caught in claim interaction router', error, {
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
