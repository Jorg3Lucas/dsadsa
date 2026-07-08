import cron from 'node-cron';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { MEMBER_ROLE_ID, setAdminChannelId } from './ranking-constants.js';
import { getMsg } from './lang.js';
import { runDailySynchronization } from './ranking-sync-engine.js';

// ==========================================
// 💬 TEXT COMMANDS (!setadminchannel)
// ==========================================

async function handleTextCommands(message, db, saveLocalStorage) {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'setadminchannel') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ Você precisa ser Administrador para usar este comando.');
        }

        setAdminChannelId(message.channel.id);
        return message.reply(`✅ Canal de aprovação configurado para ${message.channel.toString()}.`);
    }

    if (command === 'setwelcome') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ Você precisa ser Administrador para usar este comando.');
        }

        if (!db.config) db.config = {};
        db.config.welcomeChannelId = message.channel.id;
        saveLocalStorage();
        return message.reply(`✅ Canal de boas-vindas configurado para ${message.channel.toString()}.`);
    }

    if (command === 'enablevalidation') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ Você precisa ser Administrador para usar este comando.');
        }

        if (!db.config) db.config = {};
        db.config.rankingValidationEnabled = true;
        saveLocalStorage();
        return message.reply('✅ **Validação de ranking ativada!** A partir da próxima sincronização, membros que não estiverem em nenhum ranking EU perderão o cargo.');
    }

    if (command === 'disablevalidation') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ Você precisa ser Administrador para usar este comando.');
        }

        if (!db.config) db.config = {};
        db.config.rankingValidationEnabled = false;
        saveLocalStorage();
        return message.reply('🔓 **Validação de ranking desativada!** Membros fora do ranking não perderão mais o cargo automaticamente.');
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

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('welcome_register_owner')
                    .setLabel('👑 Registrar como Dono')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('welcome_register_pilot')
                    .setLabel('✈️ Registrar como Piloto')
                    .setStyle(ButtonStyle.Secondary)
            );

            await welcomeChannel.send({ content: welcomeMsg, components: [row] });
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
                                await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
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
