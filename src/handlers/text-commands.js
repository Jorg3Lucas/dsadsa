// ==========================================
// 💬 CLAIM TEXT COMMANDS (!setreminders, !setevents, !setlogs)
// Always registered — independent of the RANKING_ENABLED flag.
// (They configure the claim system's alert channels, so they
// must work even with the ranking/registration system off.)
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { dailyLogs } from '../core/state.js';
import { saveDailyLogs } from '../core/daily-logs.js';

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
    });
}
