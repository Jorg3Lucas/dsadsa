// ==========================================
// 📡 ALERT CHANNEL TEXT COMMANDS
// !reminders — set the boss-spawn alert channel to the current channel
// !events    — set the scheduled-event alert channel to the current channel
// !setlogs   — set the claim report channel to the current channel
// !logs      — manually dispatch the accumulated claim report
// Usage in any channel: "!reminders" (or "!reminders #channel" to target another)
// Persists to daily-logs.json via saveDailyLogs().
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from '../core/lang.js';
import { dailyLogs } from '../core/state.js';
import { saveDailyLogs, dispatchDailyLogs } from '../core/daily-logs.js';

function hasManageMessages(msg) {
    return msg.member && msg.member.permissions.has(PermissionFlagsBits.ManageMessages);
}

async function setAlertChannel(msg, key, label) {
    // Target: mentioned channel, else the channel where the command was typed
    const target = msg.mentions.channels.first() || msg.channel;

    dailyLogs[key] = target.id;
    saveDailyLogs();

    await msg.reply(`✅ **${label}** set to ${target} — alerts will be posted there.`).catch(() => {});

    // Keep the channel clean (only when the command was typed in the target itself)
    if (msg.channel.id === target.id) {
        try { await msg.delete(); } catch (e) {}
    }
}

/** Registers the !reminders / !events text command listener. @param {import('discord.js').Client} client */
export function initAlertCommands(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (!['reminders', 'events', 'setlogs', 'logs'].includes(command)) return;

        if (!hasManageMessages(message)) {
            return message.reply(getMsg('system.permissionDeniedManageMessages')).catch(() => {});
        }

        // ── !reminders — boss spawn alerts ──
        if (command === 'reminders') {
            return setAlertChannel(message, 'bossSpawnChannelId', '🛡️ Boss alert channel');
        }

        // ── !events — scheduled event alerts ──
        if (command === 'events') {
            return setAlertChannel(message, 'scheduledEventChannelId', '🚨 Event alert channel');
        }

        // ── !setlogs — claim report channel ──
        if (command === 'setlogs') {
            return setAlertChannel(message, 'configChannelId', '📜 Claim report channel');
        }

        // ── !logs — manual dispatch of the accumulated claim report ──
        if (command === 'logs') {
            if (!dailyLogs.configChannelId) {
                return message.reply(getMsg('logs.noChannel')).catch(() => {});
            }
            const ok = await dispatchDailyLogs(true);
            return message.reply(getMsg(ok ? 'logs.dispatchSuccess' : 'logs.dispatchError')).catch(() => {});
        }
    });
}
