// ==========================================
// 📦 REGISTRATION — Panel & Welcome Deployment
// Extracted from registration-panel.js
// ==========================================

import { client } from '../core/state.js';
import { noop } from '../core/config.js';
import { logger } from '../core/logger.js';
import { buildRegPanelEmbed, buildWelcomeEmbed, buildRegPanelButtons } from './registration-embed.js';
import { WELCOME_EMBED_TITLE, REG_PANEL_EMBED_TITLE } from './registration-shared.js';

// ── Deployed message tracking ──
let regPanelMessage = null;
let regPanelChannelId = null;
let welcomeMessage = null;

/**
 * Try to recover an already-deployed fixed bot message (welcome/panel) in a channel
 * by scanning recent bot-authored messages for a matching embed title.
 * Returns the message if found, otherwise null.
 * @param {import('discord.js').TextChannel} channel
 * @param {string} embedTitle
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function findExistingFixedMessage(channel, embedTitle) {
    try {
        const botId = client.user?.id;
        if (!botId) return null;
        const messages = await channel.messages.fetch({ limit: 100 });
        return messages.find(
            m => m.author?.id === botId && m.embeds?.[0]?.title === embedTitle
        ) || null;
    } catch {
        return null;
    }
}

/** Best-effort cleanup of older duplicate fixed messages (welcome/panel) left by previous restarts. @param {import('discord.js').TextChannel} channel @param {string} embedTitle @param {import('discord.js').Message} keep */
async function cleanupOldFixedMessages(channel, embedTitle, keep) {
    try {
        const botId = client.user?.id;
        if (!botId) return;
        const messages = await channel.messages.fetch({ limit: 100 });
        const stale = messages.filter(
            m => m.id !== keep.id && m.author?.id === botId && m.embeds?.[0]?.title === embedTitle
        );
        for (const msg of stale.values()) {
            await msg.delete().catch(noop);
        }
    } catch {
        // Ignore — cleanup is best-effort
    }
}

/** Post or update the registration panel in the configured channel. @param {import('discord.js').TextChannel} channel @param {object} rankingDb */
export async function deployRegistrationPanel(channel, rankingDb) {
    const embed = buildRegPanelEmbed(rankingDb);
    const components = buildRegPanelButtons(false);

    try {
        if (!regPanelMessage) {
            // Recover the previously deployed panel after a restart (avoid duplicates)
            regPanelMessage = await findExistingFixedMessage(channel, REG_PANEL_EMBED_TITLE);
            if (regPanelMessage) {
                regPanelChannelId = channel.id;
                await cleanupOldFixedMessages(channel, REG_PANEL_EMBED_TITLE, regPanelMessage);
            }
        }

        if (regPanelMessage) {
            // Update existing message
            regPanelMessage = await regPanelMessage.edit({
                embeds: [embed],
                components
            }).catch(() => null);
        }

        if (!regPanelMessage) {
            // Send new message
            regPanelMessage = await channel.send({
                embeds: [embed],
                components
            });
            regPanelChannelId = channel.id;
        }

        logger.info('Registration', `Panel deployed in #${channel.name}`);
        return regPanelMessage;
    } catch (err) {
        logger.error('Registration', 'Failed to deploy registration panel', err);
        return null;
    }
}

/** Refresh the registration panel embed (e.g. after a registration). Always re-attaches the action buttons so they are never lost. @param {object} rankingDb */
export async function refreshRegPanel(rankingDb) {
    if (!regPanelMessage) return;
    const embed = buildRegPanelEmbed(rankingDb);
    const components = buildRegPanelButtons(false);
    try {
        regPanelMessage = await regPanelMessage.edit({ embeds: [embed], components }).catch(() => null);
    } catch {
        regPanelMessage = null;
    }
}

/** Post or update the fixed welcome message in the configured channel. Always attaches the registration action buttons for consistency with the panel. @param {import('discord.js').TextChannel} channel */
export async function deployWelcomeMessage(channel) {
    const embed = buildWelcomeEmbed();
    const components = buildRegPanelButtons(false);

    try {
        if (!welcomeMessage) {
            // Recover the previously deployed welcome message after a restart (avoid duplicates)
            welcomeMessage = await findExistingFixedMessage(channel, WELCOME_EMBED_TITLE);
            if (welcomeMessage) {
                await cleanupOldFixedMessages(channel, WELCOME_EMBED_TITLE, welcomeMessage);
            }
        }

        if (welcomeMessage) {
            // Update existing message
            welcomeMessage = await welcomeMessage.edit({ embeds: [embed], components }).catch(() => null);
        }

        if (!welcomeMessage) {
            // Send new message
            welcomeMessage = await channel.send({ embeds: [embed], components });
        }

        logger.info('Registration', `Welcome message deployed in #${channel.name}`);
        return welcomeMessage;
    } catch (err) {
        logger.error('Registration', 'Failed to deploy welcome message', err);
        return null;
    }
}

/** Configure the welcome channel and deploy the fixed welcome message. @param {import('discord.js').TextChannel} channel */
export async function setWelcomeChannel(channel) {
    welcomeMessage = null; // Force re-deploy
    await deployWelcomeMessage(channel);
}

/** Configure the registration panel channel. @param {import('discord.js').TextChannel} channel @param {object} rankingDb */
export async function setRegistrationChannel(channel, rankingDb) {
    regPanelChannelId = channel.id;
    regPanelMessage = null; // Force re-deploy
    await deployRegistrationPanel(channel, rankingDb);
}

/** Get the current registration panel channel ID. */
export function getRegPanelChannelId() {
    return regPanelChannelId;
}
