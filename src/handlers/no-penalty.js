// ==========================================
// 🛡️ NO PENALTY — Admin Management (!nopenalty)
// Grants/revokes the exemption from the 5-minute
// cooldown applied when cancelling a claim.
// Part of the claim system.
// ==========================================

import { PermissionFlagsBits } from 'discord.js';
import { getMsg } from '../core/lang.js';
import { addNoPenaltyUser, removeNoPenaltyUser, noPenaltyUsers } from '../core/state.js';

/** Registers the !nopenalty text command listener. @param {import('discord.js').Client} client */
export function initNoPenaltyCommands(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        if (command !== 'nopenalty') return;

        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply(getMsg('system.permissionDeniedAdminDropped'));
        }

        const subcommand = args.shift();

        if (subcommand === 'add') {
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('❌ Please mention a user to add. Example: `!nopenalty add @user`');
            }
            addNoPenaltyUser(targetUser.id);
            return message.reply(`✅ **${targetUser.username}** is now exempt from the cancel penalty.`);
        }

        if (subcommand === 'remove') {
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply('❌ Please mention a user to remove. Example: `!nopenalty remove @user`');
            }
            removeNoPenaltyUser(targetUser.id);
            return message.reply(`✅ **${targetUser.username}** is no longer exempt from the cancel penalty.`);
        }

        if (subcommand === 'list') {
            if (noPenaltyUsers.size === 0) {
                return message.reply('📭 No users are currently exempt from the cancel penalty.');
            }
            const members = [];
            for (const uid of noPenaltyUsers) {
                const member = await message.guild.members.fetch(uid).catch(() => null);
                members.push(member ? `• ${member.user.tag}` : `• Unknown (${uid})`);
            }
            return message.reply(`**🛡️ No-Penalty Users**\n${members.join("\n")}`);
        }

        // No valid subcommand — show usage
        return message.reply(
            '**Usage:**\n' +
            '`!nopenalty add @user` — Exempt a user from the 5-minute cancel cooldown\n' +
            '`!nopenalty remove @user` — Remove the cancel penalty exemption\n' +
            '`!nopenalty list` — Show all exempt users'
        );
    });
}
