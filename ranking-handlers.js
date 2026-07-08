import { 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    PermissionFlagsBits, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from './lang.js';
import { confirmationCache, MEMBER_ROLE_ID, WORLD_IDS, DISCORD_SERVER_ID, pendingRegistrations, pendingPilotApprovals, adminChannelId, APPROVER_ROLE_IDS, WELCOME_PANEL_MESSAGE } from './ranking-constants.js';
import { findNicknameInCache } from './ranking-cache.js';
import { runDailySynchronization } from './ranking-sync-engine.js';

// ==========================================
// 🖱️ SLASH COMMAND / MENU HANDLERS
// ==========================================

export async function handleMir4Interactions(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};

    const applyImmediateRoleWithCache = async (targetMember, _ownerNick, _ownerId) => {
        // Assign the general member role for verified players
        if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
            logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: targetMember.user.username }));
        }
    };

    // A0. WELCOME & APPROVAL BUTTONS

    // ── Welcome: Register as Owner ──
    if (interaction.isButton() && interaction.customId === 'welcome_register_owner') {
        const modal = new ModalBuilder()
            .setCustomId('register_owner_modal')
            .setTitle('📝 Register Main Account');

        const nicknameInput = new TextInputBuilder()
            .setCustomId('owner_nickname')
            .setLabel('Your EXACT in-game name — one account only')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Type your exact character name as shown in MIR4')
            .setMinLength(2)
            .setMaxLength(30)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nicknameInput));
        return interaction.showModal(modal);
    }

    // ── Welcome: Register as Pilot ──
    if (interaction.isButton() && interaction.customId === 'welcome_register_pilot') {
        const modal = new ModalBuilder()
            .setCustomId('register_pilot_modal')
            .setTitle('✈️ Register as Pilot');

        const ownerNickInput = new TextInputBuilder()
            .setCustomId('owner_nickname')
            .setLabel('Owner\'s in-game character nickname')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the owner\'s nickname')
            .setMinLength(2)
            .setMaxLength(30)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(ownerNickInput));
        return interaction.showModal(modal);
    }

    // ── Admin Approval: Owner Registration ──
    if (interaction.isButton() && interaction.customId.startsWith('approve_owner_')) {
        const rest = interaction.customId.replace('approve_owner_', '');
        const [userId, result] = rest.split('-');
        const pending = pendingRegistrations[userId];

        if (!pending) {
            return interaction.update({ content: '⌛ This registration has expired or was already processed.', components: [] });
        }

        if (result === 'no') {
            // Check permission: admin or approver role
            const canApprove = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                interaction.member.roles.cache.some(r => APPROVER_ROLE_IDS.includes(r.id));
            if (!canApprove) {
                await interaction.deferUpdate();
                return interaction.followUp({ content: '❌ You do not have permission to reject registrations.', flags: 64 });
            }

            // Show a modal so the admin can write a rejection reason
            const modal = new ModalBuilder()
                .setCustomId(`reject_owner_${userId}`)
                .setTitle('❌ Reject Registration');

            const reasonInput = new TextInputBuilder()
                .setCustomId('reject_reason')
                .setLabel('Reason — explain how to resolve')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('e.g. Your character was not found in ranking. Please make sure you are in the Top 1000 of an EU server.')
                .setMinLength(1)
                .setMaxLength(500)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            return interaction.showModal(modal);
        }

        await interaction.deferUpdate();

        const canApprove = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.some(r => APPROVER_ROLE_IDS.includes(r.id));
        if (!canApprove) {
            return interaction.followUp({ content: '❌ You do not have permission to approve registrations.', flags: 64 });
        }

        if (!pending) {
            return interaction.editReply({ content: '⌛ This registration has expired or was already processed.', components: [] });
        }

        delete pendingRegistrations[userId];

        const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!targetMember) {
            logEvent(`❌ Admin ${interaction.user.tag} tried to approve ${userId} (${pending.nickname}) but user is no longer in the server`);
            return interaction.editReply({ content: '❌ User is no longer in the server.', components: [] });
        }

        const isTempApproval = result === 'temp';

        db.users[userId] = {
            ...db.users[userId],
            nickname: pending.nickname,
            registeredAt: new Date().toISOString()
        };

        if (isTempApproval) {
            const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
            db.users[userId].tempUntil = threeDaysFromNow.toISOString();
            db.users[userId].tempRegisteredAt = db.users[userId].registeredAt;
        }

        if (!db.users[userId].pilotIds) db.users[userId].pilotIds = [];
        saveLocalStorage();

        await targetMember.setNickname(pending.nickname).catch(() => {});
        if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        }

        const approvalLabel = isTempApproval ? '⏳ TEMPORARILY APPROVED (3 days)' : '✅ APPROVED';
        const dmMsg = isTempApproval
            ? '⏳ **Temporary registration approved!** You have 3 days to join an allied clan and appear in the ranking. After that, your role will be removed if you\'re not in an allied clan.'
            : '✅ **Registration approved!** You received the member role.';

        logEvent(`${approvalLabel} Admin ${interaction.user.tag} approved registration for ${userId} as ${pending.nickname}`);

        await interaction.editReply({
            content: `${approvalLabel}\n\n👤 **User:** ${targetMember.toString()}\n📝 **Nickname:** ${pending.nickname}\n✅ **Approved by:** ${interaction.user.tag}`,
            components: []
        });

        try { await targetMember.send(dmMsg); } catch (e) {}
        return;
    }

    // ── Admin Rejection Modal Submit ──
    if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_owner_')) {
        const canApprove = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.some(r => APPROVER_ROLE_IDS.includes(r.id));
        if (!canApprove) {
            return interaction.reply({ content: '❌ You do not have permission to reject registrations.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const userId = interaction.customId.replace('reject_owner_', '');
        const reason = interaction.fields.getTextInputValue('reject_reason').trim();
        const pending = pendingRegistrations[userId];

        if (!pending) {
            return interaction.editReply('⌛ This registration has expired or was already processed.');
        }

        delete pendingRegistrations[userId];
        saveLocalStorage(); // Persist rejection so it doesn't reappear on bot restart

        logEvent(`❌ Admin ${interaction.user.tag} REJECTED registration for ${userId} (nickname: ${pending.nickname}) — reason: ${reason}`);

        // Update the admin channel message to show the rejection reason
        if (pending.channelId && pending.messageId) {
            const adminChannel = interaction.guild.channels.cache.get(pending.channelId);
            if (adminChannel) {
                const adminMsg = await adminChannel.messages.fetch(pending.messageId).catch(() => null);
                if (adminMsg) {
                    await adminMsg.edit({
                        content: `❌ **Registration Rejected**\n\n👤 **User:** <@${userId}>\n📝 **Nickname:** ${pending.nickname}\n📝 **Reason:** ${reason}\n🕐 **Processed by:** ${interaction.user.tag}`,
                        components: []
                    }).catch(() => {});
                }
            }
        }

        // Send DM to the user with the reason
        try {
            const user = await interaction.client.users.fetch(userId);
            await user.send(`❌ **Registration Rejected**\n\nYour registration was rejected by an administrator.\n\n📝 **Reason:** ${reason}\n\nIf you need further assistance, please contact an administrator.`);
        } catch (e) {
            logEvent(`⚠️ Could not send rejection DM to ${userId} (DMs closed or user not found)`);
        }

        return interaction.editReply(`❌ **Registration rejected.** The user was notified via DM with the reason.`);
    }

    // ── Owner DM Approval: Pilot Registration ──
    if (interaction.isButton() && interaction.customId.startsWith('approve_pilot_')) {
        await interaction.deferUpdate();

        const rest = interaction.customId.replace('approve_pilot_', '');
        const [pilotUserId, result] = rest.split('-');
        const pending = pendingPilotApprovals[pilotUserId];

        if (!pending) {
            return interaction.editReply({ content: '⌛ This request has expired or was already processed.', components: [] });
        }

        if (interaction.user.id !== pending.ownerId) {
            return interaction.editReply({ content: '❌ Only the account owner can respond to this request.', components: [] });
        }

        delete pendingPilotApprovals[pilotUserId];
        saveLocalStorage(); // Persist pilot approval response

        if (result === 'no') {
            logEvent(`❌ ${pending.ownerNick} REJECTED pilot ${pilotUserId} (${pending.pilotTag})`);
            await interaction.editReply({ content: '❌ **Request rejected.**', components: [] });
            try { const u = await interaction.client.users.fetch(pilotUserId); await u.send('❌ The owner rejected your pilot registration.'); } catch (e) {}
            return;
        }

        const guild = interaction.client.guilds.cache.get(DISCORD_SERVER_ID);
        if (!guild) {
            logEvent(`❌ Pilot approval failed: guild not found for owner ${pending.ownerNick} approving pilot ${pilotUserId}`);
            return interaction.editReply({ content: '❌ Error finding the server.', components: [] });
        }

        const pilotMember = await guild.members.fetch(pilotUserId).catch(() => null);
        const ownerMember = await guild.members.fetch(pending.ownerId).catch(() => null);

        if (!pilotMember || !ownerMember) {
            logEvent(`❌ Pilot approval failed: owner ${pending.ownerId} or pilot ${pilotUserId} no longer in server`);
            return interaction.editReply({ content: '❌ One of the members is no longer in the server.', components: [] });
        }

        if (!db.users[pending.ownerId].pilotIds) db.users[pending.ownerId].pilotIds = [];
        if (!db.users[pending.ownerId].pilotIds.includes(pilotUserId)) {
            db.users[pending.ownerId].pilotIds.push(pilotUserId);
        }
        saveLocalStorage();

        await pilotMember.setNickname(`${pending.ownerNick} - Pilot`).catch(() => {});
        await applyImmediateRoleWithCache(pilotMember, pending.ownerNick, pending.ownerId);

        logEvent(`${interaction.user.tag} approved pilot ${pilotUserId} for ${pending.ownerNick}`);

        await interaction.editReply({ content: `✅ **Pilot approved!** <@${pilotUserId}> is now your pilot.`, components: [] });

        try { const u = await interaction.client.users.fetch(pilotUserId); await u.send('✅ **Registration approved!** The owner accepted your pilot request.'); } catch (e) {}
        return;
    }

    // A1. NEW REGISTRATION MODAL SUBMITS

    // ── Owner Registration Modal ──
    if (interaction.isModalSubmit() && interaction.customId === 'register_owner_modal') {
        await interaction.deferReply({ flags: 64 });

        const nickname = interaction.fields.getTextInputValue('owner_nickname').trim().normalize('NFC');

        const existingUser = Object.entries(db.users).find(([id, data]) =>
            data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === nickname.toLowerCase()
        );
        if (existingUser) {
            logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but name already taken by user ${existingUser[0]}`);
            return interaction.editReply('❌ This character name is already registered by another user.');
        }

        const userId = interaction.user.id;
        pendingRegistrations[userId] = { nickname, timestamp: Date.now() };

        if (!adminChannelId) {
            logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but admin channel not configured`);
            delete pendingRegistrations[userId];
            return interaction.editReply('❌ Admin approval channel not configured. Use !setadminchannel first.');
        }

        const adminChannel = interaction.guild.channels.cache.get(adminChannelId);
        if (!adminChannel) {
            logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but admin channel ${adminChannelId} not found`);
            delete pendingRegistrations[userId];
            return interaction.editReply('❌ Admin approval channel not found. Contact an administrator.');
        }

        // Look up nickname in ranking cache and check allied clan status
        const cacheHit = findNicknameInCache(nickname);
        let rankingStatus = '❌ Not found in ranking';
        let alliedClanStatus = '❌ Not in allied clan';

        if (cacheHit) {
            const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;
            rankingStatus = `✅ Found — ${serverName} (${cacheHit.clanName})`;

            // Check if the clan is an allied clan
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

        const adminMsg = await adminChannel.send({
            content: `👑 **New Owner Registration**\n\n👤 **User:** ${interaction.user.toString()} (${interaction.user.tag})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${nickname}\n🔍 **Ranking:** ${rankingStatus}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`,
            components: [
                new ActionRowBuilder().addComponents(approveButtons)
            ]
        });

        pendingRegistrations[userId].channelId = adminChannel.id;
        pendingRegistrations[userId].messageId = adminMsg.id;
        saveLocalStorage(); // Persist pending registration to survive bot restarts

        logEvent(`👑 ${interaction.user.tag} submitted owner registration for "${nickname}" — awaiting admin approval`);
        return interaction.editReply('✅ **Registration sent for approval!** An administrator will review it shortly.');
    }

    // ── Allied Clans: Add Clan Modal Submit ──
    if (interaction.isModalSubmit() && interaction.customId === 'manage_allied_add_modal') {
        await interaction.deferReply({ flags: 64 });

        const clanName = interaction.fields.getTextInputValue('clan_name').trim();
        const worldId = interaction.fields.getTextInputValue('world_id').trim();
        const worldName = WORLD_IDS[worldId] || `World ${worldId}`;

        if (!db.config) db.config = {};
        if (!db.config.alliedClans) db.config.alliedClans = {};
        if (!db.config.alliedClans[worldId]) db.config.alliedClans[worldId] = [];

        const alreadyExists = db.config.alliedClans[worldId].some(
            c => c.toLowerCase() === clanName.toLowerCase()
        );

        if (alreadyExists) {
            return interaction.editReply(`❌ **${clanName}** is already configured as an allied clan for **${worldName}**.`);
        }

        db.config.alliedClans[worldId].push(clanName);
        saveLocalStorage();

        logEvent(`➕ Admin ${interaction.user.tag} added allied clan "${clanName}" to ${worldName}`);
        return interaction.editReply(`✅ **${clanName}** added as an allied clan for **${worldName}**!`);
    }

    // ── Pilot Registration Modal ──
    if (interaction.isModalSubmit() && interaction.customId === 'register_pilot_modal') {
        await interaction.deferReply({ flags: 64 });

        const ownerNick = interaction.fields.getTextInputValue('owner_nickname').trim().normalize('NFC');

        const ownerEntry = Object.entries(db.users).find(([id, data]) =>
            data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === ownerNick.toLowerCase()
        );

        if (!ownerEntry) {
            return interaction.editReply('❌ Owner not found. Verify the nickname is correct and the owner is already registered.');
        }

        const [ownerId, ownerData] = ownerEntry;
        const pilotId = interaction.user.id;

        if (ownerId === pilotId) {
            return interaction.editReply('❌ You cannot register as your own pilot.');
        }

        if (!ownerData.pilotIds) ownerData.pilotIds = [];
        if (ownerData.pilotIds.length >= 4) {
            return interaction.editReply('❌ This owner already has the maximum of 4 pilots.');
        }
        if (ownerData.pilotIds.includes(pilotId)) {
            return interaction.editReply('❌ You are already registered as a pilot for this owner.');
        }

        pendingPilotApprovals[pilotId] = {
            ownerId,
            ownerNick: ownerData.nickname,
            pilotId,
            pilotTag: interaction.user.tag,
            timestamp: Date.now()
        };
        saveLocalStorage(); // Persist pending pilot approval to survive bot restarts

        try {
            const ownerMember = await interaction.guild.members.fetch(ownerId);
            const dmChannel = await ownerMember.createDM();

            await dmChannel.send({
                content: `✈️ **Pilot Approval**\n\n👤 **${interaction.user.tag}** wants to register as your pilot.\n📝 **Owner nickname:** ${ownerData.nickname}\n\nDo you approve this pilot?`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-yes`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-no`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
                    )
                ]
            });

            logEvent(`✈️ ${interaction.user.tag} requested to be pilot of ${ownerData.nickname} — DM sent to owner for approval`);
            return interaction.editReply(`✅ **Request sent!** The owner **${ownerData.nickname}** received a DM to approve your pilot registration.`);
        } catch (error) {
            logEvent(`❌ Failed to send pilot DM: ${interaction.user.tag} → owner ${ownerData.nickname} (${ownerId}): ${error.message}`);
            delete pendingPilotApprovals[pilotId];
            saveLocalStorage();
            return interaction.editReply('❌ Could not send DM to the owner. Make sure they have DMs enabled on this server.');
        }
    }

    // B. PILOT REMOVAL HANDLER (user removing their own pilot)
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_pilot_to_remove') {
        await interaction.deferUpdate();
        
        const pilotToRemoveId = interaction.values[0];
        const userProfile = db.users[interaction.user.id];

        if (!userProfile || !userProfile.pilotIds || !userProfile.pilotIds.includes(pilotToRemoveId)) {
            return interaction.followUp({ content: getMsg('ranking.responses.removepilot.error'), flags: 64 });
        }

        userProfile.pilotIds = userProfile.pilotIds.filter(id => id !== pilotToRemoveId);
        saveLocalStorage();

        await interaction.webhook.editMessage(interaction.message.id, {
            content: getMsg('ranking.responses.removepilot.success'),
            components: []
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });            interaction.guild.members.fetch(pilotToRemoveId)
            .then(async (pilotMember) => {
                if (pilotMember) {
                    if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                        await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                    }
                    await pilotMember.setNickname(pilotMember.user.username).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
                }
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        return;
    }

    // CONFIRMATION BUTTON HANDLER for /manual* commands
    if (interaction.isButton() && interaction.customId.startsWith('confirm-')) {
        const [_, action, result] = interaction.customId.split('-');
        const cacheKey = `${interaction.user.id}-${action}`;
        const cached = confirmationCache[cacheKey];
        
        if (!cached) {
            return interaction.update({
                content: '⌛ This confirmation has expired. Please run the command again.',
                components: []
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        if (result === 'no') {
            delete confirmationCache[cacheKey];
            return interaction.update({
                content: '❌ Action cancelled.',
                components: []
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        delete confirmationCache[cacheKey];

        if (action === 'manualremove') {
            const guild = interaction.guild;
            const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
            if (!targetMember || !db.users[cached.targetId]) {
                return interaction.update({ content: '❌ Target user no longer available.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            const userData = db.users[cached.targetId];
            if (userData.pilotIds && userData.pilotIds.length > 0) {
                for (const pId of userData.pilotIds) {
                    const pilotMember = await guild.members.fetch(pId).catch(() => null);
                    if (pilotMember) {
                        if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                            await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                        }
                        await pilotMember.setNickname(pilotMember.user.username).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
                    }
                }
            }
            if (targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
                await targetMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
            }
            await targetMember.setNickname(targetMember.user.username).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            delete db.users[cached.targetId];
            saveLocalStorage();

            logEvent(`Admin ${interaction.user.tag} manually removed user ${cached.targetId}`);
            return interaction.update({
                content: getMsg('ranking.responses.manualremove.success', { username: cached.targetName }),
                components: []
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        if (action === 'manualremovepilot') {
            const guild = interaction.guild;
            const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
            const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);

            if (!ownerMember || !db.users[cached.ownerId]) {
                return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            if (!db.users[cached.ownerId].pilotIds || !db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
                return interaction.update({ content: '❌ This pilot is no longer linked.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            db.users[cached.ownerId].pilotIds = db.users[cached.ownerId].pilotIds.filter(id => id !== cached.pilotId);
            saveLocalStorage();

            if (pilotMember) {
                if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                }
                await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
            }

            logEvent(`Admin ${interaction.user.tag} removed pilot ${cached.pilotName} from ${cached.ownerName}`);
            return interaction.update({
                content: getMsg('ranking.responses.manualremovepilot.success', { ownerDisplay: cached.ownerName, pilotDisplay: cached.pilotName }),
                components: []
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        if (action === 'manualpilot') {
            const guild = interaction.guild;
            const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
            const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);

            if (!ownerMember || !db.users[cached.ownerId]) {
                return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            if (!db.users[cached.ownerId].pilotIds) db.users[cached.ownerId].pilotIds = [];
            if (!db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
                db.users[cached.ownerId].pilotIds.push(cached.pilotId);
            }
            saveLocalStorage();

            if (pilotMember) {
                await pilotMember.setNickname(`${cached.ownerNick} - Pilot`).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            if (pilotMember) {
                applyImmediateRoleWithCache(pilotMember, cached.ownerNick, cached.ownerId).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            logEvent(`Admin ${interaction.user.tag} manually linked pilot ${cached.pilotName} to ${cached.ownerName}`);
            return interaction.update({
                content: getMsg('ranking.responses.manualpilot.success', { pilotMember: cached.pilotName, nick: cached.ownerNick }),
                components: []
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        if (action === 'manualregister') {
            const guild = interaction.guild;
            const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);

            if (!targetMember) {
                return interaction.update({ content: '❌ Member no longer available.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            db.users[cached.targetId] = {
                ...db.users[cached.targetId],
                nickname: cached.nickname,
                registeredAt: new Date().toISOString()
            };

            if (cached.needsTempApproval) {
                const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
                db.users[cached.targetId].tempUntil = threeDaysFromNow.toISOString();
                db.users[cached.targetId].tempRegisteredAt = db.users[cached.targetId].registeredAt;
            }

            if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
            if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;
            saveLocalStorage();

            await targetMember.setNickname(cached.nickname).catch(() => {});
            if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
                await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
            }

            const tempLabel = cached.needsTempApproval ? ' (temporary — 3 days)' : '';
            logEvent(`Admin ${interaction.user.tag} manually registered ${cached.targetId} as ${cached.nickname} in ${cached.clan}${tempLabel}`);

            const responseMsg = cached.needsTempApproval
                ? `⏳ **${cached.nickname}** registered as temporary (3 days) in **${cached.clan}**. Will be converted to permanent once found in an allied clan.`
                : getMsg('ranking.responses.manualregister.cacheFound', { nickname: cached.nickname, clan: cached.clan });

            return interaction.update({
                content: responseMsg,
                components: []
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // E. MANAGE MENU HANDLERS
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('manage_user_page_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        const targetUserId = interaction.values[0];
        const userData = db.users[targetUserId];
        if (!userData) {
            return interaction.update({ content: '❌ User no longer registered.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        const actionOptions = [
            { label: getMsg('ranking.responses.manage.actionRemove'), description: getMsg('ranking.responses.manage.actionRemoveDesc'), value: `remove_${targetUserId}` },
            { label: '📋 View Status', description: 'View detailed registration status and ranking info', value: `status_${targetUserId}` },
            { label: getMsg('ranking.responses.manage.actionClan'), description: getMsg('ranking.responses.manage.actionClanDesc'), value: `clan_${targetUserId}` }
        ];

        if (userData.pilotIds && userData.pilotIds.length > 0) {
            actionOptions.push({
                label: getMsg('ranking.responses.manage.actionPilot'),
                description: getMsg('ranking.responses.manage.actionPilotDesc'),
                value: `pilot_${targetUserId}`
            });
        }

        if (userData.tempUntil) {
            actionOptions.push({
                label: '🗑️ Remove Temp',
                description: 'Remove this temporary registration immediately',
                value: `removetemp_${targetUserId}`
            });
        }

        const actionMenu = new StringSelectMenuBuilder()
            .setCustomId(`manage_action_${targetUserId}`)
            .setPlaceholder('Select an action...')
            .addOptions(actionOptions);

        const backButton = new ButtonBuilder()
            .setCustomId('manage_back')
            .setLabel(getMsg('ranking.responses.manage.back'))
            .setStyle(ButtonStyle.Secondary);

        return interaction.update({
            content: getMsg('ranking.responses.manage.actionPrompt', { username: userData.nickname }),
            components: [
                new ActionRowBuilder().addComponents(actionMenu),
                new ActionRowBuilder().addComponents(backButton)
            ]
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // F. MANAGE ACTION HANDLER
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('manage_action_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        const [actionType, targetUserId] = interaction.values[0].split('_', 2);
        const userData = db.users[targetUserId];
        if (!userData) {
            return interaction.update({ content: '❌ User no longer registered.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        if (actionType === 'remove') {
            confirmationCache[`${interaction.user.id}-manualremove`] = {
                targetId: targetUserId,
                targetName: userData.nickname
            };
            return interaction.update({
                content: getMsg('ranking.responses.manage.actionRemoveConfirm', { username: userData.nickname }),
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm-manualremove-yes').setLabel('✅ Yes, remove').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('confirm-manualremove-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary)
                    )
                ]
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        if (actionType === 'clan') {
            // Clan selection no longer applies — just assign member role
            const clanTarget = await interaction.guild.members.fetch(targetUserId).catch(() => null);
            if (clanTarget && !clanTarget.roles.cache.has(MEMBER_ROLE_ID)) {
                await clanTarget.roles.add(MEMBER_ROLE_ID).catch(() => {});
            }
            return interaction.update({
                content: '✅ Member role assigned.',
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary)
                    )
                ]
            }).catch(() => {});
        }

        if (actionType === 'pilot') {
            if (!userData.pilotIds || userData.pilotIds.length === 0) {
                return interaction.update({ content: getMsg('ranking.responses.manage.noPilots', { username: userData.nickname }), components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }

            const pilotOptions = [];
            for (const pId of userData.pilotIds) {
                const memberObj = await interaction.guild.members.fetch(pId).catch(() => null);
                const label = memberObj ? memberObj.user.tag : `Unknown (${pId})`;
                pilotOptions.push({ label: label.substring(0, 100), value: pId });
            }

            const pilotMenu = new StringSelectMenuBuilder()
                .setCustomId(`manage_pilot_${targetUserId}`)
                .setPlaceholder(getMsg('ranking.responses.manage.pilotSelectPlaceholder'))
                .addOptions(pilotOptions);

            return interaction.update({
                content: getMsg('ranking.responses.manage.removePilotConfirm', { username: userData.nickname }),
                components: [
                    new ActionRowBuilder().addComponents(pilotMenu),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary)
                    )
                ]
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        // ── View Status ──
        if (actionType === 'status') {
            const cacheHit = findNicknameInCache(userData.nickname);

            let statusLines = `📋 **User Status: ${userData.nickname}**\n\n`;
            statusLines += `🆔 **ID:** ${targetUserId}\n`;
            statusLines += `${userData.tempUntil ? '⏳ **Type:** Temporary' : '✅ **Type:** Permanent'}\n`;
            statusLines += `📅 **Registered:** ${new Date(userData.registeredAt).toLocaleString('en-US')}\n`;

            if (userData.tempUntil) {
                const expires = new Date(userData.tempUntil);
                const hoursLeft = (expires - new Date()) / (1000 * 60 * 60);
                statusLines += `⏳ **Temp Expires:** ${expires.toLocaleString('en-US')}\n`;
                statusLines += `⏰ **Time Left:** ${hoursLeft > 0 ? `${hoursLeft.toFixed(1)}h` : 'Expired'}\n`;
            }

            statusLines += `✈️ **Pilots:** ${userData.pilotIds ? userData.pilotIds.length : 0}\n`;

            if (cacheHit) {
                const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;
                const worldAlliedClans = db.config?.alliedClans?.[cacheHit.worldId];
                const inAlliedClan = worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === cacheHit.clanName.toLowerCase());
                statusLines += `\n🔍 **Ranking:** ✅ Found — ${serverName}\n`;
                statusLines += `🏰 **Clan:** ${cacheHit.clanName}\n`;
                statusLines += `${inAlliedClan ? '✅ **Allied Clan:** Yes' : '❌ **Allied Clan:** No'}\n`;
            } else {
                statusLines += `\n🔍 **Ranking:** ❌ Not found\n`;
            }

            return interaction.update({
                content: statusLines,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary)
                    )
                ]
            }).catch(() => {});
        }

        // ── Remove Temp ──
        if (actionType === 'removetemp') {
            confirmationCache[`${interaction.user.id}-manualremove`] = {
                targetId: targetUserId,
                targetName: userData.nickname
            };
            return interaction.update({
                content: `⚠️ Remove temporary registration for **${userData.nickname}**?`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm-manualremove-yes').setLabel('✅ Yes, remove').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('confirm-manualremove-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary)
                    )
                ]
            }).catch(() => {});
        }

        return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // G. MANAGE PILOT REMOVAL HANDLER
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('manage_pilot_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        const targetUserId = interaction.customId.replace('manage_pilot_', '');
        const pilotToRemoveId = interaction.values[0];
        const userData = db.users[targetUserId];

        if (!userData || !userData.pilotIds || !userData.pilotIds.includes(pilotToRemoveId)) {
            return interaction.update({ content: '❌ This pilot is no longer linked.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        userData.pilotIds = userData.pilotIds.filter(id => id !== pilotToRemoveId);
        saveLocalStorage();

        interaction.guild.members.fetch(pilotToRemoveId).then(async (pilotMember) => {
            if (pilotMember) {
                if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                }
                await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
            }
        }).catch(() => {});

        logEvent(`Admin ${interaction.user.tag} removed pilot ${pilotToRemoveId} from ${targetUserId} via manage menu`);
        return interaction.update({
            content: '✅ Pilot removed successfully.',
            components: []
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // I. ALLIED CLANS MANAGEMENT

    // ── Allied Clans: Show world selector ──
    if (interaction.isButton() && interaction.customId === 'manage_allied') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
        }

        const worldOptions = Object.entries(WORLD_IDS).map(([id, name]) => ({
            label: name,
            description: `World ID ${id}`,
            value: id
        }));

        const worldMenu = new StringSelectMenuBuilder()
            .setCustomId('manage_allied_world')
            .setPlaceholder('Select a server to manage allied clans...')
            .addOptions(worldOptions);

        return interaction.update({
            content: '🌍 **Allied Clans Configuration**\n\nSelect a server to view and manage its allied clans.\n\nMembers will only keep their role if they are in an allied clan of any configured server.',
            components: [
                new ActionRowBuilder().addComponents(worldMenu),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('manage_allied_back').setLabel('🔙 Back to Users').setStyle(ButtonStyle.Secondary)
                )
            ]
        }).catch(() => {});
    }

    // ── Allied Clans: World selected → show clans ──
    if (interaction.isStringSelectMenu() && interaction.customId === 'manage_allied_world') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
        }

        const worldId = interaction.values[0];
        const worldName = WORLD_IDS[worldId] || `World ${worldId}`;

        if (!db.config) db.config = {};
        if (!db.config.alliedClans) db.config.alliedClans = {};
        if (!db.config.alliedClans[worldId]) db.config.alliedClans[worldId] = [];

        const clans = db.config.alliedClans[worldId];

        let content = `🌍 **${worldName}** (ID: ${worldId})\n\n`;
        if (clans.length === 0) {
            content += '❌ No allied clans configured for this server yet.\n\nUse **Add Clan** below to add one.';
        } else {
            content += '**Allied Clans:**\n';
            clans.forEach((clan, i) => {
                content += `\n${i + 1}. **${clan}**`;
            });
        }

        const removeOptions = clans.map((clan, i) => ({
            label: `🗑️ ${clan}`,
            value: `${worldId}_${i}`
        }));

        const components = [];

        if (removeOptions.length > 0) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('manage_allied_remove')
                    .setPlaceholder('Select a clan to remove...')
                    .addOptions(removeOptions)
            ));
        }

        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`manage_allied_add_${worldId}`).setLabel('➕ Add Clan').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('manage_allied').setLabel('🔙 Back to Worlds').setStyle(ButtonStyle.Secondary)
        ));

        return interaction.update({ content, components }).catch(() => {});
    }

    // ── Allied Clans: Add clan button → modal ──
    if (interaction.isButton() && interaction.customId.startsWith('manage_allied_add_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
        }

        const worldId = interaction.customId.replace('manage_allied_add_', '');
        const worldName = WORLD_IDS[worldId] || `World ${worldId}`;

        const modal = new ModalBuilder()
            .setCustomId('manage_allied_add_modal')
            .setTitle(`➕ Add Clan - ${worldName}`);

        const clanInput = new TextInputBuilder()
            .setCustomId('clan_name')
            .setLabel('Clan name (exactly as in the ranking)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. ToxicFamily')
            .setMinLength(1)
            .setMaxLength(50)
            .setRequired(true);

        const worldInput = new TextInputBuilder()
            .setCustomId('world_id')
            .setLabel('World ID (do not change)')
            .setStyle(TextInputStyle.Short)
            .setValue(worldId)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(clanInput),
            new ActionRowBuilder().addComponents(worldInput)
        );

        return interaction.showModal(modal);
    }

    // ── Allied Clans: Remove clan from select menu ──
    if (interaction.isStringSelectMenu() && interaction.customId === 'manage_allied_remove') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
        }

        const value = interaction.values[0];
        const [worldId, indexStr] = value.split('_');
        const index = parseInt(indexStr, 10);
        const worldName = WORLD_IDS[worldId] || `World ${worldId}`;

        if (db.config?.alliedClans?.[worldId]?.[index]) {
            const removedClan = db.config.alliedClans[worldId][index];
            db.config.alliedClans[worldId].splice(index, 1);
            if (db.config.alliedClans[worldId].length === 0) {
                delete db.config.alliedClans[worldId];
            }
            saveLocalStorage();
            logEvent(`🗑️ Admin ${interaction.user.tag} removed allied clan "${removedClan}" from ${worldName}`);
        }

        // Refresh the world view
        const clans = db.config?.alliedClans?.[worldId] || [];
        let content = `🌍 **${worldName}** (ID: ${worldId})\n\n`;
        if (clans.length === 0) {
            content += '❌ No allied clans configured for this server yet.\n\nUse **Add Clan** below to add one.';
        } else {
            content += '**Allied Clans:**\n';
            clans.forEach((clan, i) => {
                content += `\n${i + 1}. **${clan}**`;
            });
        }

        const removeOptions = clans.map((clan, i) => ({
            label: `🗑️ ${clan}`,
            value: `${worldId}_${i}`
        }));

        const components = [];
        if (removeOptions.length > 0) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('manage_allied_remove')
                    .setPlaceholder('Select a clan to remove...')
                    .addOptions(removeOptions)
            ));
        }
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`manage_allied_add_${worldId}`).setLabel('➕ Add Clan').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('manage_allied').setLabel('🔙 Back to Worlds').setStyle(ButtonStyle.Secondary)
        ));

        return interaction.update({ content, components }).catch(() => {});
    }

    // H. MANAGE NAVIGATION BUTTONS
    if (interaction.isButton() && (interaction.customId.startsWith('manage_user_prev_') || interaction.customId.startsWith('manage_user_next_') || interaction.customId === 'manage_back' || interaction.customId === 'manage_allied_back')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        if (interaction.customId === 'manage_back') {
            const userEntries = Object.entries(db.users || {}).filter(([id, data]) => data && data.nickname);
            if (userEntries.length === 0) {
                return interaction.update({ content: getMsg('ranking.responses.manage.noUsers'), components: [] }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
            }
            const sorted = userEntries.sort((a, b) => a[1].nickname.localeCompare(b[1].nickname));
            const PAGE_SIZE = 25;
            const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
            const page = 0;
            const pageItems = sorted.slice(0, PAGE_SIZE);
            const selectOptions = pageItems.map(([id, data]) => ({
                label: data.nickname.substring(0, 100),
                description: `${data.pilotIds ? data.pilotIds.length : 0} pilot(s)`,
                value: id
            }));
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`manage_user_page_0`)
                .setPlaceholder(getMsg('ranking.responses.manage.listPlaceholder'))
                .addOptions(selectOptions);
            const components = [new ActionRowBuilder().addComponents(selectMenu)];
            if (totalPages > 1) {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('manage_user_prev_0').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('manage_user_next_0').setLabel('Next ▶️').setStyle(ButtonStyle.Primary)
                ));
            }
            return interaction.update({
                content: getMsg('ranking.responses.manage.pageInfo', { current: 1, total: totalPages, count: sorted.length }),
                components
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        }

        const [, , , pageStr] = interaction.customId.split('_');
        const currentPage = parseInt(pageStr, 10);
        const newPage = interaction.customId.includes('next') ? currentPage + 1 : currentPage - 1;

        const userEntries = Object.entries(db.users || {}).filter(([id, data]) => data && data.nickname);
        const sorted = userEntries.sort((a, b) => a[1].nickname.localeCompare(b[1].nickname));
        const PAGE_SIZE = 25;
        const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

        if (newPage < 0 || newPage >= totalPages) {return interaction.deferUpdate().catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}

        const pageItems = sorted.slice(newPage * PAGE_SIZE, (newPage + 1) * PAGE_SIZE);
        const selectOptions = pageItems.map(([id, data]) => ({
            label: data.nickname.substring(0, 100),
            description: `${data.pilotIds ? data.pilotIds.length : 0} pilot(s)`,
            value: id
        }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`manage_user_page_${newPage}`)
            .setPlaceholder(getMsg('ranking.responses.manage.listPlaceholder'))
            .addOptions(selectOptions);

        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`manage_user_prev_${newPage}`).setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 0),
            new ButtonBuilder().setCustomId(`manage_user_next_${newPage}`).setLabel('Next ▶️').setStyle(ButtonStyle.Primary).setDisabled(newPage >= totalPages - 1)
        );

        return interaction.update({
            content: getMsg('ranking.responses.manage.pageInfo', { current: newPage + 1, total: totalPages, count: sorted.length }),
            components: [new ActionRowBuilder().addComponents(selectMenu), navRow]
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!interaction.isCommand()) return;
    const { commandName, options, user, guild } = interaction;

    if (commandName === 'removepilot') {
        const userProfile = db.users[user.id];
        const isActuallyRegistered = userProfile && (userProfile.registeredAt || userProfile.manual === true);

        if (!isActuallyRegistered || !userProfile.pilotIds || userProfile.pilotIds.length === 0) {
            return interaction.reply({ content: getMsg('ranking.responses.removepilot.noPilots'), flags: 64 });
        }

        const menuOptions = [];
        for (const pilotId of userProfile.pilotIds) {
            const memberObj = await guild.members.fetch(pilotId).catch(() => null);
            const pilotTag = memberObj ? memberObj.user.tag : `Disconnected User (${pilotId})`;
            const pilotNick = memberObj ? (memberObj.nickname || memberObj.user.username) : 'Unknown';
            
            menuOptions.push({
                label: pilotTag,
                description: `${pilotNick} - ${getMsg('ranking.responses.removepilot.optionDescription')}`,
                value: pilotId
            });
        }

        const pilotMenu = new StringSelectMenuBuilder()
            .setCustomId('select_pilot_to_remove')
            .setPlaceholder(getMsg('ranking.responses.removepilot.menuPlaceholder'))
            .addOptions(menuOptions);

        const row = new ActionRowBuilder().addComponents(pilotMenu);

        return interaction.reply({
            content: getMsg('ranking.responses.removepilot.menuContent'),
            components: [row],
            flags: 64
        });
    }

    if (commandName === 'forcesync') {
        await interaction.deferReply({ flags: 64 });
        logEvent(getMsg('ranking.responses.forcesync.log', { tag: user.tag }));
        await runDailySynchronization(interaction.client, db, saveLocalStorage, logEvent, true); 
        return interaction.editReply(getMsg('ranking.responses.forcesync.success'));
    }

    if (commandName === 'manualregister') {
        const targetMember = options.getMember('member');
        const nickname = options.getString('nickname').trim().normalize('NFC');

        const cacheHit = findNicknameInCache(nickname);

        if (cacheHit) {
            const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;

            // Check if this clan is an allied clan
            const worldAlliedClans = db.config?.alliedClans?.[cacheHit.worldId];
            const inAlliedClan = worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === cacheHit.clanName.toLowerCase());

            confirmationCache[`${user.id}-manualregister`] = {
                targetId: targetMember.id,
                nickname: cacheHit.nickname,
                clan: cacheHit.clanName,
                worldId: cacheHit.worldId,
                needsTempApproval: !inAlliedClan
            };

            const statusLine = inAlliedClan
                ? `🌍 Server: **${serverName}** — ✅ Allied clan`
                : `🌍 Server: **${serverName}** (${cacheHit.clanName}) — ⏳ Will be temporary (3 days)`;

            return interaction.reply({
                content: getMsg('ranking.responses.manualregister.confirm', { nickname: cacheHit.nickname, clan: cacheHit.clanName, username: targetMember.displayName }) + `\n${statusLine}`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm-manualregister-yes').setLabel('✅ Yes, register').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('confirm-manualregister-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                    )
                ],
                flags: 64
            });
        }

        // Not found in ranking — register as temporary (3 days)
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

        db.users[targetMember.id] = {
            ...db.users[targetMember.id],
            nickname: nickname,
            registeredAt: new Date().toISOString(),
            tempUntil: threeDaysFromNow.toISOString(),
            tempRegisteredAt: new Date().toISOString()
        };
        if (!db.users[targetMember.id].pilotIds) db.users[targetMember.id].pilotIds = [];
        saveLocalStorage();

        // Assign nickname and member role directly
        await targetMember.setNickname(nickname).catch(() => {});
        if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        }

        logEvent(`👑 Admin ${interaction.user.tag} manually registered ${targetMember.id} as ${nickname} (temporary — not in ranking)`);

        return interaction.reply({
            content: `⏳ **${nickname}** registered as temporary (3 days). They will be converted to permanent once found in an allied clan in the ranking.`,
            flags: 64
        });
    }

    if (commandName === 'manualpilot') {
        const ownerMember = options.getMember('owner');
        const pilotMember = options.getMember('pilot');

        if (!db.users[ownerMember.id]) {
            return interaction.reply({ content: getMsg('ranking.responses.manualpilot.ownerNotRegistered', { displayName: ownerMember.displayName }), flags: 64 });
        }
        if (ownerMember.id === pilotMember.id) {
            return interaction.reply({ content: getMsg('ranking.responses.manualpilot.selfPilot'), flags: 64 });
        }

        if (!db.users[ownerMember.id].pilotIds) db.users[ownerMember.id].pilotIds = [];

        if (db.users[ownerMember.id].pilotIds.length >= 4) {
            return interaction.reply({ content: getMsg('ranking.responses.manualpilot.limitReached'), flags: 64 });
        }

        if (db.users[ownerMember.id].pilotIds.includes(pilotMember.id)) {
            return interaction.reply({ content: getMsg('ranking.responses.manualpilot.alreadyLinked'), flags: 64 });
        }

        confirmationCache[`${user.id}-manualpilot`] = {
            ownerId: ownerMember.id,
            ownerName: ownerMember.displayName,
            pilotId: pilotMember.id,
            pilotName: pilotMember.displayName,
            ownerNick: db.users[ownerMember.id].nickname.trim().normalize('NFC')
        };

        return interaction.reply({
            content: getMsg('ranking.responses.manualpilot.confirm', { ownerDisplay: ownerMember.displayName, pilotDisplay: pilotMember.displayName }),
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-manualpilot-yes').setLabel('✅ Yes, link').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('confirm-manualpilot-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64
        });
    }

    if (commandName === 'manualremovepilot') {
        const ownerMember = options.getMember('owner');
        const pilotMember = options.getMember('pilot');

        if (!db.users[ownerMember.id]) {
            return interaction.reply({ content: getMsg('ranking.responses.manualremovepilot.ownerNotRegistered', { displayName: ownerMember.displayName }), flags: 64 });
        }

        if (!db.users[ownerMember.id].pilotIds || !db.users[ownerMember.id].pilotIds.includes(pilotMember.id)) {
            return interaction.reply({ content: getMsg('ranking.responses.manualremovepilot.notLinked', { pilotDisplay: pilotMember.displayName }), flags: 64 });
        }

        confirmationCache[`${user.id}-manualremovepilot`] = {
            ownerId: ownerMember.id,
            ownerName: ownerMember.displayName,
            pilotId: pilotMember.id,
            pilotName: pilotMember.displayName
        };

        return interaction.reply({
            content: getMsg('ranking.responses.manualremovepilot.confirm', { ownerDisplay: ownerMember.displayName, pilotDisplay: pilotMember.displayName }),
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-manualremovepilot-yes').setLabel('✅ Yes, remove').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('confirm-manualremovepilot-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64
        });
    }

    if (commandName === 'cleandb') {
        await interaction.deferReply({ flags: 64 });
        const seenNicknames = {};
        const duplicatesRemoved = [];

        for (const [memberId, userData] of Object.entries(db.users)) {
            const cleanNick = userData.nickname.trim().normalize('NFC').toLowerCase();
            if (!seenNicknames[cleanNick]) seenNicknames[cleanNick] = [];
            seenNicknames[cleanNick].push({ id: memberId, ...userData });
        }

        for (const [cleanNick, userList] of Object.entries(seenNicknames)) {
            if (userList.length > 1) {
                let realOwnerId = null;
                for (const u of userList) {
                    const member = await guild.members.fetch(u.id).catch(() => null);
                    if (member) {
                        const currentNick = (member.nickname || member.user.username).trim().normalize('NFC');
                        if (!currentNick.endsWith(' - Pilot')) { realOwnerId = u.id; break; }
                    }
                }
                if (!realOwnerId) {
                    userList.sort((a, b) => new Date(a.registeredAt) - new Date(b.registeredAt));
                    realOwnerId = userList[0].id;
                }
                for (const u of userList) {
                    if (u.id !== realOwnerId) {
                        duplicatesRemoved.push(`${u.nickname} (ID: ${u.id})`);
                        delete db.users[u.id]; 
                    }
                }
            }
        }

        saveLocalStorage();
        await runDailySynchronization(interaction.client, db, saveLocalStorage, logEvent, true);
        if (duplicatesRemoved.length === 0) return interaction.editReply(getMsg('ranking.responses.cleandb.noDuplicates'));
        return interaction.editReply(getMsg('ranking.responses.cleandb.success', { list: duplicatesRemoved.map(d => `• ${d}`).join('\n') }));
    }

    if (commandName === 'manage') {
        const userEntries = Object.entries(db.users || {}).filter(([id, data]) => data && data.nickname);
        if (userEntries.length === 0) {
            return interaction.reply({ content: getMsg('ranking.responses.manage.noUsers'), flags: 64 });
        }

        const sorted = userEntries.sort((a, b) => a[1].nickname.localeCompare(b[1].nickname));
        const PAGE_SIZE = 25;
        const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
        const page = 0;
        const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        const selectOptions = pageItems.map(([id, data]) => ({
            label: data.nickname.substring(0, 100),
            description: `${data.tempUntil ? '⏳ Temp' : '✅ Perm'} | ${data.pilotIds ? data.pilotIds.length : 0} pilot(s)`,
            value: id
        }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`manage_user_page_${page}`)
            .setPlaceholder(getMsg('ranking.responses.manage.listPlaceholder'))
            .addOptions(selectOptions);

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        if (totalPages > 1) {
            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('manage_user_prev_0').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('manage_user_next_0').setLabel('Next ▶️').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1)
            );
            components.push(navRow);
        }

        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('manage_allied').setLabel('⚙️ Allied Clans').setStyle(ButtonStyle.Secondary)
        ));

        return interaction.reply({
            content: getMsg('ranking.responses.manage.pageInfo', { current: page + 1, total: totalPages, count: sorted.length }),
            components,
            flags: 64
        });
    }

    if (commandName === 'manualremove') {
        const targetMember = options.getMember('member');

        if (!db.users[targetMember.id]) return interaction.reply({ content: getMsg('ranking.responses.manualremove.noRegistration'), flags: 64 });

        confirmationCache[`${user.id}-manualremove`] = {
            targetId: targetMember.id,
            targetName: targetMember.displayName
        };

        return interaction.reply({
            content: getMsg('ranking.responses.manualremove.confirm', { username: targetMember.displayName }),
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-manualremove-yes').setLabel('✅ Yes, remove').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('confirm-manualremove-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64
        });
    }

    if (commandName === 'sendpanel') {
        await interaction.deferReply({ flags: 64 });

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

        const panelMessage = await interaction.channel.send({ content: WELCOME_PANEL_MESSAGE, components: [row] });

        // Save panel info so it can be restored on bot restart
        if (!db.config) db.config = {};
        db.config.panelChannelId = interaction.channelId;
        db.config.panelMessageId = panelMessage.id;
        saveLocalStorage();

        logEvent(`📋 Admin ${interaction.user.tag} sent registration panel in #${interaction.channel.name}`);
        return interaction.editReply('✅ **Registration panel sent!**');
    }

    if (commandName === 'listunregistered') {
        await interaction.deferReply({ flags: 64 });

        const doNotify = options.getBoolean('notify') || false;
        const REGISTRATION_CHANNEL_ID = '1524296969521070120';

        // Fetch all guild members
        const allMembers = await guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply('❌ Could not fetch guild members.');
        }

        const unregistered = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            if (!member.roles.cache.has(MEMBER_ROLE_ID)) continue;
            if (db.users[memberId] && (db.users[memberId].registeredAt || db.users[memberId].manual === true)) continue;
            unregistered.push(member);
        }

        if (unregistered.length === 0) {
            logEvent(`📋 Admin ${interaction.user.tag} checked unregistered members — none found`);
            return interaction.editReply('✅ **All members with the role are registered!** No unregistered members found.');
        }

        // Build the list message
        const listLines = unregistered.map((m, i) => `${i + 1}. ${m.toString()} — ${m.user.tag}`);
        let report = `📋 **Unregistered Members — ${unregistered.length} total**\n\n`;
        report += listLines.join('\n');

        if (report.length > 1900) {
            // Truncate if too long
            report = `📋 **Unregistered Members — ${unregistered.length} total**\n\n`;
            report += listLines.slice(0, 30).join('\n');
            report += `\n\n... and ${unregistered.length - 30} more`;
        }

        if (doNotify) {
            report += `\n\n✉️ **Sending DMs to ${unregistered.length} members...**`;
            await interaction.editReply(report);

            let sent = 0;
            let failed = 0;
            for (let i = 0; i < unregistered.length; i++) {
                const member = unregistered[i];
                try {
                    await member.send(`👋 Hey **${member.displayName}**, you currently have the member role but haven't registered your MIR4 account yet!\n\nPlease go to <#${REGISTRATION_CHANNEL_ID}> and click **👑 Register as Owner** to register your character.\n\nThis helps us keep the server organized. Thanks! 🚀`);
                    sent++;
                } catch (e) {
                    failed++;
                }
                // 5-second delay between each DM
                if (i < unregistered.length - 1) {
                    await new Promise(r => setTimeout(r, 5000));
                }
            }

            logEvent(`📋 Admin ${interaction.user.tag} notified ${sent} unregistered member(s) via DM (${failed} failed)`);

            // Send feedback to the admin channel
            if (adminChannelId) {
                const adminCh = interaction.guild.channels.cache.get(adminChannelId);
                if (adminCh) {
                    const summary = `📋 **Bulk DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total unregistered:** ${unregistered.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}\n🕐 **Finished:** ${new Date().toLocaleString('en-US')}`;
                    await adminCh.send({ content: summary }).catch(() => {});
                }
            }

            return interaction.editReply(`📋 **Unregistered Members — ${unregistered.length} total**\n\n✉️ DMs sent: **${sent}** ✅\n❌ Failed: **${failed}**`);
        }

        logEvent(`📋 Admin ${interaction.user.tag} listed ${unregistered.length} unregistered member(s)`);

        // Send summary to admin channel
        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                const summary = `📋 **Unregistered Members Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total unregistered:** ${unregistered.length}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`;
                await adminCh.send({ content: summary }).catch(() => {});
            }
        }

        return interaction.editReply(report);
    }

    if (commandName === 'pending') {
        await interaction.deferReply({ flags: 64 });

        const ownerEntries = Object.entries(pendingRegistrations);
        const pilotEntries = Object.entries(pendingPilotApprovals);

        if (ownerEntries.length === 0 && pilotEntries.length === 0) {
            return interaction.editReply('✅ **No pending registration requests.**');
        }

        let report = `⏳ **Pending Registrations**\n\n`;

        // ── Owner registrations ──
        if (ownerEntries.length > 0) {
            report += `👑 **Owner Registrations (${ownerEntries.length})**\n`;
            for (const [userId, pending] of ownerEntries) {
                const member = await guild.members.fetch(userId).catch(() => null);
                const userTag = member ? member.toString() : `<@${userId}>`;
                const hoursLeft = pending.timestamp
                    ? ((Date.now() - pending.timestamp) / (1000 * 60 * 60)).toFixed(1)
                    : '?';
                const expiresIn = pending.timestamp
                    ? `${Math.max(0, 24 - hoursLeft).toFixed(1)}h`
                    : 'Unknown';
                const hasMessage = pending.channelId && pending.messageId ? '✅' : '❌';
                report += `\n${userTag} — **${pending.nickname}**\n`;
                report += `   ⏰ Expires in: ${expiresIn} | Panel: ${hasMessage}\n`;
            }
        }

        // ── Pilot approvals ──
        if (pilotEntries.length > 0) {
            if (ownerEntries.length > 0) report += '\n';
            report += `✈️ **Pilot Approvals (${pilotEntries.length})**\n`;
            for (const [pilotId, pending] of pilotEntries) {
                const pilotMember = await guild.members.fetch(pilotId).catch(() => null);
                const pilotTag = pilotMember ? pilotMember.toString() : `<@${pilotId}>`;
                const hoursLeft = pending.timestamp
                    ? ((Date.now() - pending.timestamp) / (1000 * 60 * 60)).toFixed(1)
                    : '?';
                const expiresIn = pending.timestamp
                    ? `${Math.max(0, 24 - hoursLeft).toFixed(1)}h`
                    : 'Unknown';
                report += `\n${pilotTag} → Owner **${pending.ownerNick}**\n`;
                report += `   ⏰ Expires in: ${expiresIn}\n`;
            }
        }

        // Truncate if too long
        if (report.length > 1900) {
            report = report.substring(0, 1900) + '\n\n... (truncated)';
        }

        logEvent(`📋 Admin ${interaction.user.tag} checked pending requests (${ownerEntries.length} owners, ${pilotEntries.length} pilots)`);
        return interaction.editReply(report);
    }
}
