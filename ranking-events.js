import cron from 'node-cron';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { MEMBER_ROLE_ID, adminChannelId, setAdminChannelId, DISCORD_SERVER_ID, WELCOME_PANEL_MESSAGE, pendingRegistrations, WORLD_IDS } from './ranking-constants.js';
import { findNicknameInCache } from './ranking-cache.js';
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
            return message.reply('❌ You must be an Administrator to use this command.');
        }

        if (!db.config) db.config = {};
        db.config.adminChannelId = message.channel.id;
        saveLocalStorage();
        setAdminChannelId(message.channel.id);
        return message.reply(`✅ Admin approval channel set to ${message.channel.toString()}.`);
    }

    if (command === 'setwelcome') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must be an Administrator to use this command.');
        }

        if (!db.config) db.config = {};
        db.config.welcomeChannelId = message.channel.id;
        saveLocalStorage();
        return message.reply(`✅ Welcome channel set to ${message.channel.toString()}.`);
    }

    if (command === 'enablevalidation') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must be an Administrator to use this command.');
        }

        if (!db.config) db.config = {};
        db.config.rankingValidationEnabled = true;
        saveLocalStorage();
        return message.reply('✅ **Ranking validation ENABLED!** Members not found in any EU ranking will lose their role on next sync.');
    }

    if (command === 'disablevalidation') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must be an Administrator to use this command.');
        }

        if (!db.config) db.config = {};
        db.config.rankingValidationEnabled = false;
        saveLocalStorage();
        return message.reply('🔓 **Ranking validation DISABLED!** Members won\'t lose roles automatically.');
    }
}

// ==========================================
// 🎧 DISCORD EVENT HANDLERS
// ==========================================

/**
 * Restore admin approval messages for pending registrations on bot startup.
 * If any admin approval message was deleted, re-sends it to the admin channel
 * with fresh approve/reject buttons.
 */
async function restoreAdminApprovalMessages(client, db, saveLocalStorage, logEvent) {
    try {
        const pendingEntries = Object.entries(pendingRegistrations);
        if (pendingEntries.length === 0) return;

        const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
        if (!guild) {
            logEvent('⚠️ [Admin Panel Restore] Guild not found');
            return;
        }

        const adminChId = db.config?.adminChannelId || adminChannelId;
        if (!adminChId) {
            logEvent('⚠️ [Admin Panel Restore] No admin channel configured');
            return;
        }

        const adminChannel = guild.channels.cache.get(adminChId);
        if (!adminChannel) {
            logEvent('⚠️ [Admin Panel Restore] Admin channel not found');
            return;
        }

        let restoredCount = 0;

        for (const [userId, pending] of pendingEntries) {
            if (!pending.nickname) continue;

            // Try to fetch the existing admin message
            if (pending.channelId && pending.messageId) {
                try {
                    const existingMsg = await adminChannel.messages.fetch(pending.messageId).catch(() => null);
                    if (existingMsg) continue; // Message still exists
                } catch (e) {
                    // Message not found — will re-send
                }
            }

            // Fetch the user to display their info
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) {
                logEvent(`⚠️ [Admin Panel Restore] User ${userId} no longer exists — removing pending registration`);
                delete pendingRegistrations[userId];
                continue;
            }

            const nickname = pending.nickname;
            const cacheHit = findNicknameInCache(nickname);

            let rankingStatus = '❌ Not found in ranking';
            let alliedClanStatus = '❌ Not in allied clan';

            if (cacheHit) {
                const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;
                rankingStatus = `✅ Found — ${serverName} (${cacheHit.clanName})`;

                const worldAlliedClans = db.config?.alliedClans?.[cacheHit.worldId];
                if (worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === cacheHit.clanName.toLowerCase())) {
                    alliedClanStatus = '✅ Yes — Allied clan';
                }
            }

            const isMissingRankingOrAllied = !cacheHit || alliedClanStatus === '❌ Not in allied clan';

            const approveButtons = [
                new ButtonBuilder().setCustomId(`approve_owner_${userId}-yes`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
            ];

            if (isMissingRankingOrAllied) {
                approveButtons.push(
                    new ButtonBuilder().setCustomId(`approve_owner_${userId}-temp`).setLabel('⏳ Approve Temporarily (3 days)').setStyle(ButtonStyle.Primary)
                );
            }

            approveButtons.push(
                new ButtonBuilder().setCustomId(`approve_owner_${userId}-no`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
            );

            const newMsg = await adminChannel.send({
                content: `👑 **New Owner Registration**\n\n👤 **User:** ${user.toString()} (${user.tag})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${nickname}\n🔍 **Ranking:** ${rankingStatus}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`,
                components: [
                    new ActionRowBuilder().addComponents(approveButtons)
                ]
            });

            pendingRegistrations[userId].channelId = adminChannel.id;
            pendingRegistrations[userId].messageId = newMsg.id;
            restoredCount++;
        }

        if (restoredCount > 0) {
            saveLocalStorage();
            logEvent(`🔄 [Admin Panel Restore] Restored ${restoredCount} missing admin approval message(s)`);
        }
    } catch (error) {
        logEvent(`❌ [Admin Panel Restore] Error: ${error.message}`);
    }
}

/**
 * Restore the welcome/fixed registration panel on bot startup.
 * If the saved panel message was deleted, re-sends it to the saved channel.
 */
async function restoreWelcomePanel(client, db, saveLocalStorage, logEvent) {
    try {
        if (!db.config?.panelChannelId) return;

        const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
        if (!guild) {
            logEvent('⚠️ [Panel Restore] Guild not found');
            return;
        }

        const panelChannel = guild.channels.cache.get(db.config.panelChannelId);
        if (!panelChannel) {
            logEvent('⚠️ [Panel Restore] Saved panel channel no longer exists — clearing config');
            delete db.config.panelChannelId;
            delete db.config.panelMessageId;
            saveLocalStorage();
            return;
        }

        // Try to fetch the saved panel message
        if (db.config.panelMessageId) {
            try {
                const msg = await panelChannel.messages.fetch(db.config.panelMessageId);
                if (msg) {
                    logEvent('✅ [Panel Restore] Welcome panel already exists — no restoration needed');
                    return; // Panel still exists
                }
            } catch (e) {
                // Message not found (deleted) — will re-send below
            }
        }

        // Re-send the panel
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('welcome_register_owner')
                .setLabel('👑 Register as Owner')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('welcome_register_pilot')
                .setLabel('✈️ Register as Pilot')
                .setStyle(ButtonStyle.Secondary)
        );

        const newMsg = await panelChannel.send({ content: WELCOME_PANEL_MESSAGE, components: [row] });
        db.config.panelMessageId = newMsg.id;
        saveLocalStorage();
        logEvent('🔄 [Panel Restore] Welcome panel was missing — re-sent and saved new message ID');
    } catch (error) {
        logEvent(`❌ [Panel Restore] Failed to restore welcome panel: ${error.message}`);
    }
}

export function initMir4BotEvents(client, db, saveLocalStorage, logEvent) {
    // Load persisted admin channel ID on startup
    if (db.config?.adminChannelId && !adminChannelId) {
        setAdminChannelId(db.config.adminChannelId);
    }

    // Restore the welcome/fixed panel on startup if it was deleted
    restoreWelcomePanel(client, db, saveLocalStorage, logEvent).catch(err => {
        logEvent(`❌ [Panel Restore] Unexpected error: ${err.message}`);
    });

    // Restore admin approval messages for pending registrations on startup
    restoreAdminApprovalMessages(client, db, saveLocalStorage, logEvent).catch(err => {
        logEvent(`❌ [Admin Panel Restore] Unexpected error: ${err.message}`);
    });

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
                    .setLabel('👑 Register as Owner')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('welcome_register_pilot')
                    .setLabel('✈️ Register as Pilot')
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
