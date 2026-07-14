import cron from 'node-cron';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { MEMBER_ROLE_ID, adminChannelId, setAdminChannelId, DISCORD_SERVER_ID, WELCOME_PANEL_MESSAGE, pendingRegistrations, PENDING_MAX_AGE_MS, ensureConfig } from './ranking-constants.js';
import { lookupNickname } from './ranking-service.js';
import { getMsg } from '../lang/lang.js';
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

        ensureConfig(db);
        db.config.adminChannelId = message.channel.id;
        saveLocalStorage();
        setAdminChannelId(message.channel.id);
        return message.reply(`✅ Admin approval channel set to ${message.channel.toString()}.`);
    }

    if (command === 'setwelcome') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must be an Administrator to use this command.');
        }

        ensureConfig(db);
        db.config.welcomeChannelId = message.channel.id;
        saveLocalStorage();
        return message.reply(`✅ Welcome channel set to ${message.channel.toString()}.`);
    }

    if (command === 'enablevalidation') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must be an Administrator to use this command.');
        }

        ensureConfig(db);
        db.config.rankingValidationEnabled = true;
        saveLocalStorage();
        return message.reply('✅ **Ranking validation ENABLED!** Members not found in any EU ranking will lose their role on next sync.');
    }

    if (command === 'disablevalidation') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You must be an Administrator to use this command.');
        }

        ensureConfig(db);
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
        let expiredCount = 0;

        for (const [userId, pending] of pendingEntries) {
            if (!pending.nickname) continue;

            // Check if this registration has expired (>24h) while the bot was offline
            const timeSinceSubmission = Date.now() - (pending.timestamp || 0);
            const isExpired = timeSinceSubmission > PENDING_MAX_AGE_MS;

            // Try to fetch the existing admin message
            if (pending.channelId && pending.messageId) {
                try {
                    const existingMsg = await adminChannel.messages.fetch(pending.messageId).catch(() => null);
                    if (existingMsg) {
                        if (isExpired) {
                            // Update the message to show it's expired, remove buttons
                            await existingMsg.edit({
                                content: `⌛ **This registration has expired.** (>24h since submission)\n\n👤 **User:** <@${userId}>\n📝 **Nickname:** ${pending.nickname}\n🕐 **Submitted:** ${new Date(pending.timestamp).toLocaleString('en-US')}\n\nThe user must submit a new registration request.`,
                                components: []
                            }).catch(() => {});
                            delete pendingRegistrations[userId];
                            expiredCount++;
                        }
                        continue; // Message still exists
                    }
                } catch (e) {
                    // Message not found — will re-send
                }
            }

            // If expired and message was deleted, just remove from memory
            if (isExpired) {
                delete pendingRegistrations[userId];
                expiredCount++;
                continue;
            }

            // Fetch the user to display their info
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) {
                logEvent(`⚠️ [Admin Panel Restore] User ${userId} no longer exists — removing pending registration`);
                delete pendingRegistrations[userId];
                continue;
            }

            const nickname = pending.nickname;
            const lookup = lookupNickname(nickname, db);

            let rankingStatus = '❌ Not found in ranking';
            let alliedClanStatus = '❌ Not in allied clan';

            if (lookup.found) {
                rankingStatus = `✅ Found — ${lookup.serverName} (${lookup.clanName})`;
                if (lookup.inAlliedClan) {
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

        if (restoredCount > 0 || expiredCount > 0) {
            saveLocalStorage();
            if (restoredCount > 0) logEvent(`🔄 [Admin Panel Restore] Restored ${restoredCount} missing admin approval message(s)`);
            if (expiredCount > 0) logEvent(`🧹 [Admin Panel Restore] Marked ${expiredCount} expired registration(s) (>24h)`);
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

    // Clean up expired pre-registrations on startup
    if (db.preRegistrations) {
        const now = Date.now();
        const entries = Object.entries(db.preRegistrations);
        let cleaned = 0;
        for (const [userId, preReg] of entries) {
            if (preReg.expiresAt && new Date(preReg.expiresAt).getTime() < now) {
                delete db.preRegistrations[userId];
                cleaned++;
            }
        }
        if (cleaned > 0) {
            saveLocalStorage();
            logEvent(`🧹 [PreReg] Cleaned up ${cleaned} expired pre-registration(s) on startup`);
        }
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
            // ── Check for pre-registration first ──
            if (member.guild.id === DISCORD_SERVER_ID && db.preRegistrations && db.preRegistrations[member.id]) {
                const preReg = db.preRegistrations[member.id];
                const expiresAt = new Date(preReg.expiresAt).getTime();

                if (expiresAt > Date.now()) {
                    // Valid pre-registration — check if pilot (has ownerNick)
                    if (preReg.ownerNick) {
                        // Try to find the owner: by ownerId or by nickname lookup
                        let ownerId = preReg.ownerId;
                        if (!ownerId || !db.users[ownerId]) {
                            // Owner not in db.users yet — look up by nickname
                            const ownerEntry = Object.entries(db.users).find(([id, data]) =>
                                data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === preReg.ownerNick.toLowerCase()
                            );
                            if (ownerEntry) {
                                ownerId = ownerEntry[0];
                            }
                        }

                        if (ownerId && db.users[ownerId]) {
                            // ── Pilot pre-registration: link to owner ──
                            if (!db.users[ownerId].pilotIds) db.users[ownerId].pilotIds = [];
                            if (!db.users[ownerId].pilotIds.includes(member.id)) {
                                db.users[ownerId].pilotIds.push(member.id);
                            }
                            db.users[member.id] = {
                                nickname: preReg.nickname,
                                registeredAt: new Date().toISOString(),
                                pilotIds: []
                            };
                            delete db.preRegistrations[member.id];
                            saveLocalStorage();

                            await member.setNickname(`${preReg.ownerNick} - Pilot`).catch(() => {});
                            if (!member.roles.cache.has(MEMBER_ROLE_ID)) {
                                await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                            }

                            logEvent(`📥 [PreReg] ${member.user.tag} joined — auto-registered as pilot of "${preReg.ownerNick}" from pre-registration`);
                        } else {
                            // ── Owner not in Discord yet — register pilot with pending owner link ──
                            db.users[member.id] = {
                                nickname: preReg.nickname,
                                registeredAt: new Date().toISOString(),
                                pilotIds: [],
                                pendingOwnerNick: preReg.ownerNick
                            };
                            // Update pre-registration - mark that user joined but owner still pending
                            if (db.preRegistrations[member.id]) {
                                db.preRegistrations[member.id].ownerNick = preReg.ownerNick;
                                db.preRegistrations[member.id].registeredAt = new Date().toISOString();
                            }
                            saveLocalStorage();

                            await member.setNickname(`${preReg.ownerNick} - Pilot`).catch(() => {});
                            if (!member.roles.cache.has(MEMBER_ROLE_ID)) {
                                await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                            }

                            logEvent(`📥 [PreReg] ${member.user.tag} joined — registered as pilot awaiting owner "${preReg.ownerNick}"`);
                        }
                    } else {
                        // ── Owner pre-registration (no ownerNick) ──
                        db.users[member.id] = {
                            nickname: preReg.nickname,
                            registeredAt: new Date().toISOString(),
                            pilotIds: preReg.pilotIds || []
                        };
                        delete db.preRegistrations[member.id];
                        saveLocalStorage();

                        await member.setNickname(preReg.nickname).catch(() => {});
                        if (!member.roles.cache.has(MEMBER_ROLE_ID)) {
                            await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                        }

                        logEvent(`📥 [PreReg] ${member.user.tag} joined — auto-registered as "${preReg.nickname}" from pre-registration`);
                    }
                } else {
                    // Expired — remove pre-registration
                    delete db.preRegistrations[member.id];
                    saveLocalStorage();
                    logEvent(`📥 [PreReg] ${member.user.tag} joined — pre-registration expired (was "${preReg.nickname}")`);
                }
            }

            // ── Send welcome message ──
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
