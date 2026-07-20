import cron from 'node-cron';
import { PermissionFlagsBits } from 'discord.js';
import { CLAN_ROLES } from './ranking-constants.js';
import { getMsg } from './lang.js';
import { runDailySynchronization } from './ranking-sync-engine.js';
import { noop } from "./config.js";
import { addEarlyClaimUser, removeEarlyClaimUser, earlyClaimUsers } from './state.js';


// ==========================================
// 💬 TEXT COMMANDS (!setwelcome, !earlyclaim)
// ==========================================

async function handleTextCommands(message, db, saveLocalStorage) {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'setwelcome') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(getMsg('ranking.responses.setwelcome.noPermission'));
        }

        if (!db.config) db.config = {};
        db.config.welcomeChannelId = message.channel.id;
        saveLocalStorage();

        return message.reply(getMsg('ranking.responses.setwelcome.success', { channel: message.channel.toString() }));
    }

    // ── !earlyclaim add/remove/list ──
    if (command === 'earlyclaim') {
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
    }
}

// ==========================================
// 🎧 DISCORD EVENT HANDLERS
// ==========================================

export function initMir4BotEvents(client, db, saveLocalStorage, logEvent) {
    client.on('error', (err) => {
        console.error('⚠️ [Discord Client Error Handled Safely]:', err.message);
        if (err.stack) {
            console.error('📋 [Stack Trace]:', err.stack);
        }
    });

    client.on('messageCreate', async (message) => {
        await handleTextCommands(message, db, saveLocalStorage);
    });

    client.on('guildMemberAdd', async (member) => {
        try {
            if (!db.config || !db.config.welcomeChannelId) return;

            const welcomeChannel = member.guild.channels.cache.get(db.config.welcomeChannelId);
            if (!welcomeChannel) return;

            const welcomeMsg = getMsg('ranking.welcome.message', { member: member.toString() });

            await welcomeChannel.send(welcomeMsg);
        } catch (error) {
            console.error(getMsg('ranking.logs.welcomeError', { error: error.message }));
        }
    });

    client.on('guildMemberRemove', async (member) => {
        try {
            if (db.users && db.users[member.id]) {
                const userData = db.users[member.id];
                const isActuallyRegistered = userData.registeredAt || userData.manual === true;
                
                if (isActuallyRegistered) {
                    logEvent(getMsg('ranking.logs.memberLeave', { tag: member.user.tag }));
                    
                    if (userData.pilotIds && userData.pilotIds.length > 0) {
                        for (const pId of userData.pilotIds) {
                            const pilotMember = await member.guild.members.fetch(pId).catch(() => null);
                            if (pilotMember) {
                                for (const roleId of Object.values(CLAN_ROLES)) await pilotMember.roles.remove(roleId).catch(noop);
                                await pilotMember.setNickname(pilotMember.user.username).catch(noop);
                                logEvent(getMsg('ranking.logs.pilotCleaned', { tag: pilotMember.user.tag }));
                            }
                        }
                    }
                    delete db.users[member.id];
                    saveLocalStorage();
                }
            }
        } catch (error) {
            console.error(getMsg('ranking.logs.leaveError', { error: error.message }));
        }
    });

    cron.schedule('0 17 * * *', async () => {
        await runDailySynchronization(client, db, saveLocalStorage, logEvent, true);
    }, { scheduled: true, timezone: "America/Sao_Paulo" });
}
