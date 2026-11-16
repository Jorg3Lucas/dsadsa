// ==========================================
// 💰 SALARY — Admin Command (!salary)
// Configures the salary poll channel and the Google Sheets ID from Discord,
// replacing the management panel that was removed with the old system.
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { getSalaryState, setSalaryChannelId, setSalarySpreadsheetId, getFormattedWeekRange } from './salary-state.js';
import { createOrUpdatePollMessage } from './salary-lifecycle.js';

function buildStatus() {
    const state = getSalaryState();
    const status = state.status === 'open' ? '🟢 Open' : state.status === 'closed' ? '🔴 Closed' : '⚪ Idle';
    const channel = state.channelId ? `<#${state.channelId}>` : '❌ Not configured';
    const spreadsheet = state.spreadsheetId ? `\`${state.spreadsheetId}\`` : '❌ Not set (default used)';
    return (
        '💰 **Salary Poll**\n' +
        `**Status:** ${status}\n` +
        `**Week:** ${getFormattedWeekRange()}\n` +
        `**Votes:** ${Object.keys(state.votes).length} member(s)\n` +
        `**Channel:** ${channel}\n` +
        `**Spreadsheet:** ${spreadsheet}\n\n` +
        '**Usage:**\n' +
        '`!salary channel` — set the channel to this one and post/refresh the poll\n' +
        '`!salary sheet <id>` — set the Google Sheets ID (`clear` to unset)\n' +
        '`!salary` — show this configuration'
    );
}

/** Registers the !salary text command listener. @param {import('discord.js').Client} client */
export function initSalaryCommand(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        if (command !== 'salary') return;

        if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ You need the **Manage Server** permission to configure the salary poll.').catch(() => {});
        }

        const sub = (args.shift() || '').toLowerCase();

        if (!sub || sub === 'status') {
            return message.reply(buildStatus()).catch(() => {});
        }

        if (sub === 'channel') {
            setSalaryChannelId(message.channel.id);
            const posted = await createOrUpdatePollMessage();
            return message.reply(posted
                ? `✅ Salary poll channel set to ${message.channel.toString()} and the poll message posted.`
                : `✅ Salary poll channel set to ${message.channel.toString()}, but the poll message could not be posted — check the bot's permissions in this channel.`
            ).catch(() => {});
        }

        if (sub === 'sheet') {
            const id = args.join(' ').trim();
            if (!id) {
                return message.reply('❌ Usage: `!salary sheet <spreadsheet-id>` or `!salary sheet clear`.').catch(() => {});
            }
            if (['clear', 'none', 'off', 'reset'].includes(id.toLowerCase())) {
                setSalarySpreadsheetId(null);
                return message.reply('✅ Salary spreadsheet unset — the default spreadsheet will be used.').catch(() => {});
            }
            setSalarySpreadsheetId(id);
            return message.reply(`✅ Salary spreadsheet set to \`${id}\`.`).catch(() => {});
        }

        return message.reply('❌ Unknown option. Use `!salary`, `!salary channel` or `!salary sheet <id>`.').catch(() => {});
    });
}
