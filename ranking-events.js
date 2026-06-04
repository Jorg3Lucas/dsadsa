import cron from 'node-cron';
import { PermissionFlagsBits } from 'discord.js';
import { CLAN_ROLES } from './ranking-constants.js';
import { getMsg } from './lang.js';
import { runDailySynchronization } from './ranking-sync-engine.js';

// ==========================================
// 💬 TEXT COMMANDS (!setwelcome)
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
                                for (const roleId of Object.values(CLAN_ROLES)) await pilotMember.roles.remove(roleId).catch(() => {});
                                await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
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
