// ==========================================
// 🎫 TICKET SYSTEM — Panel Command (!ticket)
// Posts/refreshes the support-ticket panel in
// the current channel (admin only).
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from '../core/lang.js';
import { setupTicketPanel } from './ticket-system.js';

/** Registers the !ticket text command listener. @param {import('discord.js').Client} client */
export function initTicketCommand(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        if (command !== 'ticket' && command !== 'ticketpanel') return;

        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply(getMsg('system.permissionDeniedAdminDropped'));
        }

        await setupTicketPanel(message.channel);
        await message.delete().catch(() => {});
    });
}
