// ==========================================
// 💬 CLAIM TEXT COMMANDS
// !setreminders / !setevents / !setlogs  — alert channels
// !sp7 / !sp8 / … / !ms12 / !summons     — claim panel channels
// Always registered — independent of the RANKING_ENABLED flag.
// (They configure the claim system, so they must work even with
// the ranking/registration system off.)
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { dailyLogs, db, lastMessages, saveLocalStorage, logEvent } from '../core/state.js';
import { saveDailyLogs } from '../core/daily-logs.js';
import { renderEmbed, renderButtons } from './panel-render.js';
import { noop } from '../core/config.js';

// ==========================================
// 📋 FLOOR → PANELS (command name → panel keys)
// ==========================================
// Run the command in the channel you want and the bot posts (and keeps
// refreshing) that floor's panels there. No fixed categories, no channel
// creation — the bot only uses the channels you point it at.
export const FLOOR_PANELS = {
    sp7: ['7peak'],
    sp8: ['8peak'],
    sp9: ['9peak'],
    sp10: ['10peak'],
    sp11: ['11peak', '11goblin'],
    sp12: ['12peak', '12randomevent', '12goblin'],
    summons: ['summon'],

    ms7: ['7squarenormal', '7squareantidemon'],
    ms8: ['8squarenormal', '8squareantidemon'],
    ms9: ['9squarenormal', '9squareantidemon'],
    ms10: ['10squarenormal', '10squareantidemon'],
    ms11: ['11squareleaders', '11squareevents', '11squareantidemon', '11msgoblin'],
    ms12: ['12squareleaders', '12squareevents', '12squareantidemon', '12msgoblin']
};

/** List of every bindable command name (sp7, …, ms12, summons). */
export const FLOOR_COMMANDS = Object.keys(FLOOR_PANELS);

function isAdmin(message) {
    return !!message.member?.permissions?.has(PermissionFlagsBits.Administrator);
}

/**
 * Post (or move) a floor's panels to the channel the command was used in and
 * persist the binding so the panels keep refreshing there across restarts.
 * @param {import('discord.js').Message} message
 * @param {string[]} panelKeys
 */
async function deployPanels(message, panelKeys) {
    if (!db._panelMapping) db._panelMapping = {};

    let sent = 0;
    for (const key of panelKeys) {
        if (!db[key]) {
            await message.reply(`⚠️ Panel \`${key}\` isn't initialized yet — try again in a few seconds.`).catch(noop);
            continue;
        }

        // Remove the previous copy of this panel, wherever it was posted.
        const old = db._panelMapping[key];
        if (old && old.channelId && old.messageId) {
            const oldChannel = await message.client.channels.fetch(old.channelId).catch(() => null);
            if (oldChannel) {
                const oldMsg = await oldChannel.messages.fetch(old.messageId).catch(() => null);
                if (oldMsg) await oldMsg.delete().catch(noop);
            }
        }

        const msg = await message.channel.send({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        }).catch(() => null);
        if (!msg) continue;

        lastMessages[key] = msg;
        db._panelMapping[key] = { channelId: message.channel.id, messageId: msg.id };
        sent++;
    }

    if (typeof saveLocalStorage === 'function') saveLocalStorage();
    if (typeof logEvent === 'function') {
        logEvent(`📋 ${message.author.tag} set #${message.channel.name} for [${panelKeys.join(', ')}]`);
    }
    return sent;
}

/** Registers the claim text-command listener. @param {import('discord.js').Client} client */
export function initTextCommands(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'setreminders') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply('❌ You must be an Administrator to use this command.');
            }
            dailyLogs.bossSpawnChannelId = message.channel.id;
            saveDailyLogs();
            return message.reply(`✅ Boss spawn alerts will be sent to ${message.channel.toString()}.`);
        }

        if (command === 'setevents') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply('❌ You must be an Administrator to use this command.');
            }
            dailyLogs.scheduledEventChannelId = message.channel.id;
            saveDailyLogs();
            return message.reply(`✅ Event alerts will be sent to ${message.channel.toString()}.`);
        }

        if (command === 'setlogs') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply('❌ You must be an Administrator to use this command.');
            }
            dailyLogs.configChannelId = message.channel.id;
            saveDailyLogs();
            return message.reply(`✅ Daily claim reports will be sent to ${message.channel.toString()}.`);
        }

        // ── Floor panel channels (!sp7 … !ms12, !summons) ──
        const panelKeys = FLOOR_PANELS[command];
        if (panelKeys) {
            if (!isAdmin(message)) {
                return message.reply('❌ You must be an Administrator to use this command.');
            }
            const sent = await deployPanels(message, panelKeys);
            if (sent === 0) return;
            return message.reply(
                `✅ ${sent} panel(s) posted here — this channel is now the **${command.toUpperCase()}** channel.`
            );
        }
    });
}
