// ==========================================
// 👑 EARLY CLAIM — Admin Management (!earlyclaim)
// Grants/revokes the permission to claim Fury/Frenzy
// events 5 minutes before the window opens.
// Part of the claim system.
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from '../core/lang.js';
import { addEarlyClaimUser, removeEarlyClaimUser, earlyClaimUsers } from '../core/state.js';

/** Registers the !earlyclaim text command listener. @param {import('discord.js').Client} client */
export function initEarlyClaimCommands(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        if (command !== 'earlyclaim') return;

        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply(getMsg('system.permissionDeniedAdminDropped'));
        }

        const subcommand = args.shift();

        if (subcommand === 'add') {
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('❌ Please mention a user to add. Example: `!earlyclaim add @user`');
            }
            addEarlyClaimUser(targetUser.id);
            return message.reply(`✅ **${targetUser.username}** can now claim Fury/Frenzy 5 minutes early.`);
        }

        if (subcommand === 'remove') {
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('❌ Please mention a user to remove. Example: `!earlyclaim remove @user`');
            }
            removeEarlyClaimUser(targetUser.id);
            return message.reply(`✅ **${targetUser.username}** can no longer claim Fury/Frenzy early.`);
        }

        if (subcommand === 'list') {
            if (earlyClaimUsers.size === 0) {
                return message.reply('📭 No users are currently authorized for early claim.');
            }
            const members = [];
            for (const uid of earlyClaimUsers) {
                const member = await message.guild.members.fetch(uid).catch(() => null);
                members.push(member ? `• ${member.user.tag}` : `• Unknown (${uid})`);
            }
            return message.reply(`**👑 Early Claim Users**\n${members.join("\n")}`);
        }

        // No valid subcommand — show usage
        return message.reply(
            '**Usage:**\n' +
            '`!earlyclaim add @user` — Allow a user to claim Fury/Frenzy 5 minutes early\n' +
            '`!earlyclaim remove @user` — Remove early claim permission\n' +
            '`!earlyclaim list` — Show all users with early claim permission'
        );
    });
}
