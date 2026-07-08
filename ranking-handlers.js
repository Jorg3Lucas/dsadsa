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
import { getMsg } from './lang.js';import { 
    confirmationCache, 
    MEMBER_ROLE_ID, 
    WORLD_IDS, 
    DISCORD_SERVER_ID, 
    ORIGIN_SERVER_ID, 
    SECONDARY_SERVER_ID, 
    pendingRegistrations, 
    pendingPilotApprovals, 
    adminChannelId, 
    APPROVER_ROLE_IDS, 
    WELCOME_PANEL_MESSAGE, 
    PENDING_MAX_AGE_MS,
    PRE_REGISTER_MAX_AGE_MS 
} from './ranking-constants.js';
import { findNicknameInCache, findClosestNicknameInCache, getLocalRankingCache, levenshteinDistance, cleanNickname } from './ranking-cache.js';
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
            return interaction.update({ content: '⌛ This request was already processed.', components: [] });
        }

        // Check if the registration has expired (>24h since submission)
        const timeSinceSubmission = Date.now() - (pending.timestamp || 0);
        if (timeSinceSubmission > PENDING_MAX_AGE_MS) {
            delete pendingRegistrations[userId];
            saveLocalStorage();
            return interaction.update({ 
                content: `⌛ **This registration has expired.** (>24h since submission)\n\n👤 **User:** <@${userId}>\n📝 **Nickname:** ${pending.nickname}\n🕐 **Submitted:** ${new Date(pending.timestamp).toLocaleString('en-US')}\n\nThe user must submit a new registration request.`,
                components: [] 
            });
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
                .setPlaceholder('e.g. Not found in ranking. Must be in Top 1000 of an EU server.')
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

        // Look up nickname in ranking cache and check allied clan status
        let correctedNickname = null;
        let cacheHit = findNicknameInCache(nickname);

        // ── Fuzzy matching: if exact nickname not found, try closest match ──
        if (!cacheHit) {
            const rankingCache = getLocalRankingCache();
            if (rankingCache) {
                const fuzzyMatch = findClosestNicknameInCache(nickname, rankingCache);
                if (fuzzyMatch && fuzzyMatch.nickname.toLowerCase() !== nickname.toLowerCase()) {
                    correctedNickname = fuzzyMatch.nickname;
                    // Re-check with the corrected name
                    cacheHit = fuzzyMatch;
                    logEvent(`👑 ${interaction.user.tag} — fuzzy corrected "${nickname}" → "${fuzzyMatch.nickname}" (${WORLD_IDS[fuzzyMatch.worldId] || fuzzyMatch.worldId})`);
                }
            }
        }

        // Use fuzzy-corrected nickname if available
        const effectiveNickname = correctedNickname || nickname;
        pendingRegistrations[userId] = { nickname: effectiveNickname, timestamp: Date.now() };

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

        // ── Fuzzy matching: if exact nickname not found, try closest match ──
        if (!cacheHit) {
            const rankingCache = getLocalRankingCache();
            if (rankingCache) {
                const fuzzyMatch = findClosestNicknameInCache(nickname, rankingCache);
                if (fuzzyMatch && fuzzyMatch.nickname.toLowerCase() !== nickname.toLowerCase()) {
                    correctedNickname = fuzzyMatch.nickname;
                    // Re-check with the corrected name
                    cacheHit = fuzzyMatch;
                    logEvent(`👑 ${interaction.user.tag} — fuzzy corrected "${nickname}" → "${fuzzyMatch.nickname}" (${WORLD_IDS[fuzzyMatch.worldId] || fuzzyMatch.worldId})`);
                }
            }
        }

        let rankingStatus = '❌ Not found in ranking';
        let alliedClanStatus = '❌ Not in allied clan';
        let fuzzyNote = '';

        if (cacheHit) {
            const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;
            rankingStatus = `✅ Found — ${serverName} (${cacheHit.clanName})`;

            if (correctedNickname) {
                fuzzyNote = `\n🔍 **Fuzzy match:** "${nickname}" → "${correctedNickname}"`;
            }

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
            content: `👑 **New Owner Registration**\n\n👤 **User:** ${interaction.user.toString()} (${interaction.user.tag})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${effectiveNickname}${fuzzyNote ? ` (original: "${nickname}")` : ''}\n🔍 **Ranking:** ${rankingStatus}${fuzzyNote}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`,
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

        let ownerEntry = Object.entries(db.users).find(([id, data]) =>
            data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === ownerNick.toLowerCase()
        );

        // ── Fuzzy matching: if exact owner not found, try closest match ──
        let fuzzyCorrectedNick = null;
        if (!ownerEntry) {
            const cleanedInput = cleanNickname(ownerNick);

            if (cleanedInput.length >= 2) {
                // Build set of pilot IDs to exclude (skip pilots, match only owners)
                const pilotIds = new Set();
                for (const [, data] of Object.entries(db.users)) {
                    if (data.pilotIds && data.pilotIds.length > 0) {
                        for (const pid of data.pilotIds) {
                            pilotIds.add(pid);
                        }
                    }
                }

                let bestMatch = null;
                let bestScore = 0;

                for (const [id, data] of Object.entries(db.users)) {
                    if (!data.nickname) continue;
                    // Skip pilots — only match actual owners
                    if (pilotIds.has(id)) continue;
                    const cleanedNick = cleanNickname(data.nickname);
                    if (cleanedNick.length < 2) continue;

                    // Character overlap pre-filter
                    const inputChars = new Set(cleanedInput);
                    const nickChars = new Set(cleanedNick);
                    let commonChars = 0;
                    for (const c of inputChars) {
                        if (nickChars.has(c)) commonChars++;
                    }
                    const overlap = (2 * commonChars) / (inputChars.size + nickChars.size);
                    if (overlap < 0.3) continue;

                    // Levenshtein distance
                    const distance = levenshteinDistance(cleanedInput, cleanedNick);
                    const maxLen = Math.max(cleanedInput.length, cleanedNick.length);
                    const similarity = 1 - (distance / maxLen);

                    if (similarity > bestScore && similarity >= 0.55) {
                        bestScore = similarity;
                        bestMatch = { id, nickname: data.nickname };
                    }
                }

                if (bestMatch) {
                    fuzzyCorrectedNick = bestMatch.nickname;
                    ownerEntry = [bestMatch.id, db.users[bestMatch.id]];
                    logEvent(`✈️ ${interaction.user.tag} — fuzzy matched owner "${ownerNick}" → "${bestMatch.nickname}" for pilot registration`);
                }
            }
        }

        if (!ownerEntry) {
            return interaction.editReply('❌ Owner not found. Verify the nickname is spelled correctly and the owner is already registered.');
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
            const fuzzyReply = fuzzyCorrectedNick
                ? `\n🔍 **Corrected:** you typed \"${ownerNick}\" → using \"${fuzzyCorrectedNick}\"`
                : '';
            return interaction.editReply(`✅ **Request sent!** The owner **${ownerData.nickname}** received a DM to approve your pilot registration.${fuzzyReply}`);
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

        // ── Auto-correct wrong nicknames using fuzzy matching ──
        const rankingCache = getLocalRankingCache();
        let fuzzyCorrected = 0;
        const correctedList = [];

        if (rankingCache) {
            // Build set of pilot IDs to skip
            const pilotIdSet = new Set();
            for (const [, data] of Object.entries(db.users || {})) {
                if (data.pilotIds && data.pilotIds.length > 0) {
                    for (const pid of data.pilotIds) {
                        pilotIdSet.add(pid);
                    }
                }
            }

            for (const [memberId, userData] of Object.entries(db.users || {})) {
                // Skip pilots — only correct owners
                if (pilotIdSet.has(memberId)) continue;
                if (!userData.nickname) continue;

                const currentNick = userData.nickname;
                // Check if current nickname is in ranking cache
                const exactHit = findNicknameInCache(currentNick, rankingCache);
                if (exactHit) continue; // Already correct

                // Try fuzzy matching
                const fuzzyHit = findClosestNicknameInCache(currentNick, rankingCache);
                if (!fuzzyHit || fuzzyHit.nickname.toLowerCase() === currentNick.toLowerCase()) continue;

                // Found a correction!
                const oldNick = currentNick;
                const newNick = fuzzyHit.nickname;
                const serverName = WORLD_IDS[fuzzyHit.worldId] || fuzzyHit.worldId;

                // Update database
                db.users[memberId].nickname = newNick;

                // Update Discord nickname — always set it since the DB was wrong
                const targetMember = await guild.members.fetch(memberId).catch(() => null);
                if (targetMember) {
                    await targetMember.setNickname(newNick).catch(() => {});
                }

                fuzzyCorrected++;
                correctedList.push(`${oldNick} → ${newNick} (${serverName})`);
                logEvent(`🔄 [ForceSync] Fuzzy corrected "${oldNick}" → "${newNick}" for user ${memberId}`);
            }

            if (fuzzyCorrected > 0) {
                saveLocalStorage();
            }
        }

        let responseMsg = getMsg('ranking.responses.forcesync.success') || '✅ **Force sync completed!**';
        if (fuzzyCorrected > 0) {
            const details = correctedList.slice(0, 10).join('\n');
            responseMsg += `\n\n🔍 **Fuzzy auto-corrected ${fuzzyCorrected} nickname(s):**\n${details}`;
            if (correctedList.length > 10) {
                responseMsg += `\n... and ${correctedList.length - 10} more`;
            }
        }

        return interaction.editReply(responseMsg);
    }

    if (commandName === 'manualregister') {
        const targetMember = options.getMember('member');
        const nickname = options.getString('nickname').trim().normalize('NFC');

        let cacheHit = findNicknameInCache(nickname);

        // ── Fuzzy matching: if exact nickname not found, try closest match ──
        let fuzzyManualNick = null;
        if (!cacheHit) {
            const rankingCache = getLocalRankingCache();
            if (rankingCache) {
                const fuzzyMatch = findClosestNicknameInCache(nickname, rankingCache);
                if (fuzzyMatch && fuzzyMatch.nickname.toLowerCase() !== nickname.toLowerCase()) {
                    fuzzyManualNick = fuzzyMatch.nickname;
                    cacheHit = fuzzyMatch;
                    logEvent(`👑 Admin ${interaction.user.tag} — fuzzy corrected "${nickname}" → "${fuzzyMatch.nickname}" in /manualregister`);
                }
            }
        }

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

            const fuzzyManualNote = fuzzyManualNick
                ? `\n🔍 **Fuzzy match:** "${nickname}" → "${fuzzyManualNick}"`
                : '';
            return interaction.reply({
                content: getMsg('ranking.responses.manualregister.confirm', { nickname: cacheHit.nickname, clan: cacheHit.clanName, username: targetMember.displayName }) + `\n${statusLine}${fuzzyManualNote}`,
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
        logEvent(`📋 Admin ${interaction.user.tag} started sending DMs to ${unregistered.length} unregistered members...`);
        for (let i = 0; i < unregistered.length; i++) {
            const member = unregistered[i];
            try {
                await member.send(`👋 Hey **${member.displayName}**, you currently have the member role but haven't registered your MIR4 account yet!\n\nPlease go to <#${REGISTRATION_CHANNEL_ID}> and click:\n👑 **Register as Owner** — if this is your main account\n✈️ **Register as Pilot** — if you play for someone else\n\nThis helps us keep the server organized. Thanks! 🚀`);
                sent++;
                logEvent(`✅ DM sent to ${member.user.tag} (${member.id}) — ${sent}/${unregistered.length}`);
            } catch (e) {
                failed++;
                logEvent(`❌ DM failed for ${member.user.tag} (${member.id}) — ${e.message}`);
            }
            // 5-second delay between each DM
            if (i < unregistered.length - 1) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        logEvent(`📋 Admin ${interaction.user.tag} finished notifying — ${sent} sent, ${failed} failed`);

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
        const rankingCache = getLocalRankingCache();
        let panelsRestored = 0;

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
                let line = `\n${userTag} — **${pending.nickname}**\n`;
                line += `   ⏰ Expires in: ${expiresIn} | Panel: ${hasMessage}\n`;

                // ── Fuzzy suggestion for pending nicknames not found in ranking ──
                const cacheHit = findNicknameInCache(pending.nickname);
                if (!cacheHit && rankingCache) {
                    const fuzzyMatch = findClosestNicknameInCache(pending.nickname, rankingCache);
                    if (fuzzyMatch && fuzzyMatch.nickname.toLowerCase() !== pending.nickname.toLowerCase()) {
                        line += `   🔍 **Fuzzy suggestion:** "${pending.nickname}" → "${fuzzyMatch.nickname}" (${WORLD_IDS[fuzzyMatch.worldId] || fuzzyMatch.worldId})\n`;
                    }
                }

                report += line;

                // ── Re-send admin panel (always, even if one already exists) ──
                if (adminChannelId) {
                    const adminChannel = interaction.guild.channels.cache.get(adminChannelId);
                    if (adminChannel) {
                        // Build ranking status and allied clan status like the original registration flow
                        let rankingStatus = '❌ Not found in ranking';
                        let alliedClanStatus = '❌ Not in allied clan';
                        let fuzzyNote = '';

                        const freshCacheHit = findNicknameInCache(pending.nickname) ||
                            (rankingCache ? findClosestNicknameInCache(pending.nickname, rankingCache) : null);

                        if (freshCacheHit) {
                            const serverName = WORLD_IDS[freshCacheHit.worldId] || `World ${freshCacheHit.worldId}`;
                            rankingStatus = `✅ Found — ${serverName} (${freshCacheHit.clanName})`;
                            if (freshCacheHit.nickname.toLowerCase() !== pending.nickname.toLowerCase()) {
                                fuzzyNote = `\n🔍 **Fuzzy match:** "${pending.nickname}" → "${freshCacheHit.nickname}"`;
                            }
                            const worldAlliedClans = db.config?.alliedClans?.[freshCacheHit.worldId];
                            if (worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === freshCacheHit.clanName.toLowerCase())) {
                                alliedClanStatus = '✅ Yes — Allied clan';
                            }
                        }

                        const isMissingRankingOrAllied = !freshCacheHit || alliedClanStatus === '❌ Not in allied clan';

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

                        try {
                            const adminMsg = await adminChannel.send({
                                content: `👑 **New Owner Registration (re-sent by /pending)**\n\n👤 **User:** ${member ? member.toString() : `<@${userId}>`} (${member ? member.user.tag : userId})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${pending.nickname}\n🔍 **Ranking:** ${rankingStatus}${fuzzyNote}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`,
                                components: [
                                    new ActionRowBuilder().addComponents(approveButtons)
                                ]
                            });

                            pending.channelId = adminChannel.id;
                            pending.messageId = adminMsg.id;
                            saveLocalStorage();
                            panelsRestored++;
                            logEvent(`📤 [Pending] Re-sent admin panel for ${userId} (${pending.nickname})`);
                        } catch (e) {
                            logEvent(`⚠️ [Pending] Failed to re-send admin panel for ${userId}: ${e.message}`);
                        }
                    }
                }
            }
        }

        // ── Pilot approvals ──
        if (pilotEntries.length > 0) {
            if (ownerEntries.length > 0) report += '\n';
            report += `✈️ **Pilot Approvals (${pilotEntries.length})**\n`;

            // Build set of pilot IDs to exclude from fuzzy matching
            const pilotIdSet = new Set();
            for (const [, data] of Object.entries(db.users || {})) {
                if (data.pilotIds && data.pilotIds.length > 0) {
                    for (const pid of data.pilotIds) {
                        pilotIdSet.add(pid);
                    }
                }
            }

            for (const [pilotId, pending] of pilotEntries) {
                const pilotMember = await guild.members.fetch(pilotId).catch(() => null);
                const pilotTag = pilotMember ? pilotMember.toString() : `<@${pilotId}>`;
                const hoursLeft = pending.timestamp
                    ? ((Date.now() - pending.timestamp) / (1000 * 60 * 60)).toFixed(1)
                    : '?';
                const expiresIn = pending.timestamp
                    ? `${Math.max(0, 24 - hoursLeft).toFixed(1)}h`
                    : 'Unknown';

                // Check if ownerNick matches a registered owner
                const ownerMatch = Object.entries(db.users || {}).find(([id, data]) =>
                    data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === pending.ownerNick.toLowerCase()
                );

                let line = `\n${pilotTag} → Owner **${pending.ownerNick}**\n`;
                line += `   ⏰ Expires in: ${expiresIn}\n`;

                // ── Fuzzy suggestion if owner not found ──
                if (!ownerMatch) {
                    const cleanedInput = cleanNickname(pending.ownerNick);
                    if (cleanedInput.length >= 2) {
                        let bestMatch = null;
                        let bestScore = 0;

                        for (const [id, data] of Object.entries(db.users || {})) {
                            if (!data.nickname) continue;
                            if (pilotIdSet.has(id)) continue;
                            const cleanedNick = cleanNickname(data.nickname);
                            if (cleanedNick.length < 2) continue;

                            const inputChars = new Set(cleanedInput);
                            const nickChars = new Set(cleanedNick);
                            let commonChars = 0;
                            for (const c of inputChars) {
                                if (nickChars.has(c)) commonChars++;
                            }
                            const overlap = (2 * commonChars) / (inputChars.size + nickChars.size);
                            if (overlap < 0.3) continue;

                            const distance = levenshteinDistance(cleanedInput, cleanedNick);
                            const maxLen = Math.max(cleanedInput.length, cleanedNick.length);
                            const similarity = 1 - (distance / maxLen);

                            if (similarity > bestScore && similarity >= 0.55) {
                                bestScore = similarity;
                                bestMatch = data.nickname;
                            }
                        }

                        if (bestMatch) {
                            line += `   🔍 **Fuzzy suggestion:** owner "${pending.ownerNick}" → "${bestMatch}"\n`;
                        }
                    }
                }

                report += line;
            }
        }

        // Summary line for re-sent panels
        if (panelsRestored > 0) {
            report += `\n📤 **Re-sent ${panelsRestored} admin panel(s) for review.**`;
        }

        // Truncate if too long
        if (report.length > 1900) {
            report = report.substring(0, 1900) + '\n\n... (truncated)';
        }

        logEvent(`📋 Admin ${interaction.user.tag} checked pending requests (${ownerEntries.length} owners, ${pilotEntries.length} pilots, ${panelsRestored} panels restored)`);
        return interaction.editReply(report);
    }

    // ── SCAN IMPORT ──
    if (commandName === 'scanimport') {
        await interaction.deferReply({ flags: 64 });

        const prodGuild = interaction.guild;
        if (prodGuild.id !== DISCORD_SERVER_ID) {
            return interaction.editReply('❌ This command must be run in the main production server.');
        }

        // ── RESET MODE: clear all existing registrations from scan servers ──
        const doReset = options.getBoolean('reset') || false;
        let totalResetOwners = 0;
        let totalResetPilots = 0;

        if (doReset) {
            const resetServers = [
                { id: ORIGIN_SERVER_ID, name: 'Origin Server' },
                { id: SECONDARY_SERVER_ID, name: 'Secondary Server' }
            ];

            for (const srv of resetServers) {
                const srvGuild = interaction.client.guilds.cache.get(srv.id);
                if (!srvGuild) continue;

                const srvMembers = await srvGuild.members.fetch().catch(() => null);
                if (!srvMembers) continue;

                for (const [memberId] of srvMembers) {
                    if (memberId === interaction.client.user.id) continue;

                    const userData = db.users[memberId];
                    if (!userData || (!userData.registeredAt && !userData.manual)) continue;

                    // Check if this user is a pilot (linked to some owner)
                    const isPilot = Object.values(db.users).some(u => u.pilotIds && u.pilotIds.includes(memberId));

                    if (isPilot) {
                        // Remove pilot link from all owners
                        for (const [oid, od] of Object.entries(db.users)) {
                            if (od.pilotIds && od.pilotIds.includes(memberId)) {
                                od.pilotIds = od.pilotIds.filter(id => id !== memberId);
                            }
                        }
                        totalResetPilots++;
                    } else {
                        // Owner — also remove their pilots
                        if (userData.pilotIds && userData.pilotIds.length > 0) {
                            for (const pId of userData.pilotIds) {
                                if (db.users[pId]) {
                                    delete db.users[pId];
                                    totalResetPilots++;
                                }
                            }
                        }
                        totalResetOwners++;
                    }

                    // Remove from production server: reset nickname + remove role
                    const prodMember = await prodGuild.members.fetch(memberId).catch(() => null);
                    if (prodMember) {
                        if (prodMember.roles.cache.has(MEMBER_ROLE_ID)) {
                            await prodMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                        }
                        await prodMember.setNickname(prodMember.user.username).catch(() => {});
                    }

                    delete db.users[memberId];
                }
            }

            // Also clean any pre-registrations linked to these servers
            if (db.preRegistrations) {
                const preRegIds = Object.keys(db.preRegistrations);
                for (const srv of resetServers) {
                    const srvGuild = interaction.client.guilds.cache.get(srv.id);
                    if (!srvGuild) continue;
                    const srvMembers = await srvGuild.members.fetch().catch(() => null);
                    if (!srvMembers) continue;
                    for (const [memberId] of srvMembers) {
                        if (db.preRegistrations[memberId]) {
                            delete db.preRegistrations[memberId];
                        }
                    }
                }
            }

            saveLocalStorage();
            logEvent(`📥 [ScanImport] 🔄 RESET: removed ${totalResetOwners} owners and ${totalResetPilots} pilots from scan servers — re-importing fresh`);
        }

        // Define origin servers with their parsing strategy
        const originServers = [
            {
                id: ORIGIN_SERVER_ID,
                name: 'Origin Server',
                isPilot(displayName) {
                    return displayName.startsWith('Pilot -');
                },
                parseNick(displayName) {
                    const match = displayName.match(/-\s*(.+?)\s*\|/);
                    return match ? match[1].trim() : null;
                }
            },
            {
                id: SECONDARY_SERVER_ID,
                name: 'Secondary Server',
                isPilot(displayName) {
                    return displayName.endsWith(' - Pilot');
                },
                parseNick(displayName) {
                    const pilotSuffix = ' - Pilot';
                    if (displayName.endsWith(pilotSuffix)) {
                        return displayName.slice(0, -pilotSuffix.length).trim();
                    }
                    return displayName.trim();
                }
            }
        ];

        let totalRegistered = 0;
        let totalPreReg = 0;
        let totalSkipped = 0;
        let totalPilotsLinked = 0;
        let totalPilotPreReg = 0;
        const results = [];
        const pendingPilots = []; // { memberId, ownerNick, member }

        // Build a lookup map of existing owners for pilot linking
        const ownerNickLowerToId = {};
        for (const [id, data] of Object.entries(db.users || {})) {
            if (data.nickname) {
                ownerNickLowerToId[data.nickname.trim().normalize('NFC').toLowerCase()] = id;
            }
        }

        // Helper to check if a nickname is already taken (by someone else)
        const isNicknameTaken = (nick, excludeUserId) => {
            return Object.entries(db.users).find(([id, data]) =>
                id !== excludeUserId &&
                data.nickname &&
                data.nickname.trim().normalize('NFC').toLowerCase() === nick.toLowerCase()
            );
        };

        // Helper to register a pilot whose owner is not yet in Discord (pending link)
        const registerPilotPendingOwner = async (ownerNick, pilotMemberId, pilotMember) => {
            db.users[pilotMemberId] = {
                nickname: ownerNick,
                registeredAt: new Date().toISOString(),
                pilotIds: [],
                pendingOwnerNick: ownerNick
            };
            saveLocalStorage();

            // Also create pre-registration to track the pending link
            if (!db.preRegistrations) db.preRegistrations = {};
            const expiresAt = new Date(Date.now() + PRE_REGISTER_MAX_AGE_MS).toISOString();
            db.preRegistrations[pilotMemberId] = {
                nickname: ownerNick,
                pilotIds: [],
                ownerNick,
                ownerId: null,
                registeredAt: new Date().toISOString(),
                expiresAt
            };
            saveLocalStorage();

            const prodPilot = await prodGuild.members.fetch(pilotMemberId).catch(() => null);
            if (prodPilot) {
                await prodPilot.setNickname(`${ownerNick} - Pilot`).catch(() => {});
                if (!prodPilot.roles.cache.has(MEMBER_ROLE_ID)) {
                    await prodPilot.roles.add(MEMBER_ROLE_ID).catch(() => {});
                }
                logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} registered as pilot — awaiting owner "${ownerNick}"`);
                return `✈️ registered as pilot of "${ownerNick}" (awaiting owner)`;
            } else {
                logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} pre-registered as pilot — awaiting owner "${ownerNick}"`);
                return `⏳ pre-registered as pilot of "${ownerNick}" (awaiting owner)`;
            }
        };

        // Helper to link a pending pilot to an owner who just registered
        const linkPendingPilotToOwner = (ownerId, ownerNick) => {
            const ownerNickLower = ownerNick.toLowerCase();
            let linkedCount = 0;
            for (const [pid, pdata] of Object.entries(db.users)) {
                if (pdata.pendingOwnerNick && pdata.pendingOwnerNick.toLowerCase() === ownerNickLower) {
                    delete pdata.pendingOwnerNick;
                    if (!db.users[ownerId].pilotIds) db.users[ownerId].pilotIds = [];
                    if (!db.users[ownerId].pilotIds.includes(pid) && db.users[ownerId].pilotIds.length < 4) {
                        db.users[ownerId].pilotIds.push(pid);
                        // Update pre-registration with ownerId
                        if (db.preRegistrations && db.preRegistrations[pid]) {
                            db.preRegistrations[pid].ownerId = ownerId;
                        }
                        // Update Discord nickname to reflect proper link
                        const member = prodGuild.members.cache.get(pid);
                        if (member) {
                            member.setNickname(`${ownerNick} - Pilot`).catch(() => {});
                        }
                        linkedCount++;
                    }
                }
            }
            return linkedCount;
        };

        // Helper to register or pre-register a pilot
        const registerPilot = async (ownerId, ownerNick, pilotMemberId, pilotMember) => {
            if (!db.users[ownerId].pilotIds) db.users[ownerId].pilotIds = [];
            if (db.users[ownerId].pilotIds.includes(pilotMemberId)) {
                return '⏭️ already linked';
            }
            if (db.users[ownerId].pilotIds.length >= 4) {
                return '⏭️ owner has max pilots';
            }

            // Register the pilot user (with same nickname as owner, but they're a pilot)
            db.users[pilotMemberId] = {
                nickname: ownerNick,
                registeredAt: new Date().toISOString(),
                pilotIds: []
            };
            db.users[ownerId].pilotIds.push(pilotMemberId);
            saveLocalStorage();

            // Check if in production server
            const prodPilot = await prodGuild.members.fetch(pilotMemberId).catch(() => null);
            if (prodPilot) {
                await prodPilot.setNickname(`${ownerNick} - Pilot`).catch(() => {});
                if (!prodPilot.roles.cache.has(MEMBER_ROLE_ID)) {
                    await prodPilot.roles.add(MEMBER_ROLE_ID).catch(() => {});
                }
                logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} linked as pilot of "${ownerNick}"`);
                return `✈️ linked as pilot of "${ownerNick}"`;
            } else {
                // Pre-register pilot — update if already exists
                if (!db.preRegistrations) db.preRegistrations = {};
                const existing = db.preRegistrations[pilotMemberId];
                if (existing && (existing.nickname !== ownerNick || existing.ownerNick !== ownerNick)) {
                    existing.nickname = ownerNick;
                    existing.ownerNick = ownerNick;
                    existing.ownerId = ownerId;
                    existing.registeredAt = new Date().toISOString();
                    existing.expiresAt = new Date(Date.now() + PRE_REGISTER_MAX_AGE_MS).toISOString();
                    saveLocalStorage();
                    logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} pre-registration updated as pilot of "${ownerNick}"`);
                } else if (!existing) {
                    const expiresAt = new Date(Date.now() + PRE_REGISTER_MAX_AGE_MS).toISOString();
                    db.preRegistrations[pilotMemberId] = {
                        nickname: ownerNick,
                        pilotIds: [],
                        ownerNick,
                        ownerId,
                        registeredAt: new Date().toISOString(),
                        expiresAt
                    };
                    saveLocalStorage();
                }
                logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} pre-registered as pilot of "${ownerNick}"`);
                return `⏳ pre-registered as pilot of "${ownerNick}" (expires in 7d)`;
            }
        };

        // Track processed members across servers — server 1 (origin) takes priority
        const processedMemberIds = new Set();

        for (const server of originServers) {
            const guild = interaction.client.guilds.cache.get(server.id);
            if (!guild) {
                results.push(`⚠️ Server "${server.name}" (${server.id}) not found — skipping`);
                continue;
            }

            const members = await guild.members.fetch().catch(() => null);
            if (!members || members.size === 0) {
                results.push(`⚠️ Server "${server.name}" (${server.id}) has no members — skipping`);
                continue;
            }

            for (const [memberId, member] of members) {
                if (member.user.bot) continue;

                // Skip if already processed by server 1 (Origin Server takes priority)
                if (processedMemberIds.has(memberId)) continue;

                const displayName = member.nickname || member.user.displayName;
                const isPilot = server.isPilot(displayName);
                let gameNick = server.parseNick(displayName);

                if (!gameNick) {
                    totalSkipped++;
                    continue;
                }

                // Mark as processed — server 1 (origin) nickname takes priority over server 2
                processedMemberIds.add(memberId);

                // User already registered — check if wrongly registered as owner (should be pilot)
                if (db.users[memberId] && (db.users[memberId].registeredAt || db.users[memberId].manual === true)) {
                    const isWronglyRegisteredOwner = isPilot && gameNick && 
                        !db.users[memberId].pendingOwnerNick &&
                        !Object.values(db.users || {}).some(u => u.pilotIds && u.pilotIds.includes(memberId));

                    if (isWronglyRegisteredOwner) {
                        // Fix: remove the wrong owner registration — will be properly handled below
                        delete db.users[memberId];
                        saveLocalStorage();
                        logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) FIXED: wrong owner registration removed — now processing as pilot`);
                        // Fall through to isPilot / owner logic below
                    } else {
                        // Normal already-registered: update Discord nickname + DB if needed
                        const prodMember = await prodGuild.members.fetch(memberId).catch(() => null);
                        if (prodMember) {
                            const expectedNick = isPilot && gameNick
                                ? `${gameNick} - Pilot`
                                : gameNick || db.users[memberId].nickname;

                            if (gameNick && db.users[memberId].nickname !== gameNick) {
                                const oldNick = db.users[memberId].nickname;
                                db.users[memberId].nickname = gameNick;
                                saveLocalStorage();
                                logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) DB nickname updated: "${oldNick}" → "${gameNick}"`);
                            }

                            if (prodMember.nickname !== expectedNick) {
                                await prodMember.setNickname(expectedNick).catch(() => {});
                                if (results.length < 20) results.push(`🔄 ${member.user.tag} → updated to "${expectedNick}"`);
                                logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) Discord nickname updated to "${expectedNick}"`);
                            }
                        }
                        totalSkipped++;
                        continue;
                    }
                }

                if (isPilot) {
                    // ── Pilot detection ──
                    const ownerNickLower = gameNick.toLowerCase();
                    let ownerId = ownerNickLowerToId[ownerNickLower];

                    if (ownerId && db.users[ownerId]) {
                        const status = await registerPilot(ownerId, gameNick, memberId, member);
                        if (status.startsWith('✈️')) totalPilotsLinked++;
                        else if (status.startsWith('⏳')) totalPilotPreReg++;
                        else { totalSkipped++; }
                        if (results.length < 20) results.push(`${member.user.tag} ${status}`);
                    } else {
                        // Owner not found yet — register pilot as pending owner link
                        const status = await registerPilotPendingOwner(gameNick, memberId, member);
                        if (status.startsWith('✈️')) totalPilotsLinked++;
                        else if (status.startsWith('⏳')) totalPilotPreReg++;
                        else { totalSkipped++; }
                        if (results.length < 20) results.push(`${member.user.tag} ${status}`);
                        // Also keep in pendingPilots in case owner registers later in the same scan
                        pendingPilots.push({ memberId, ownerNick: gameNick, member, displayName });
                    }
                    continue;
                }

                // ── Owner registration ──
                // Check if nickname already taken
                const takenEntry = Object.entries(db.users).find(([id, data]) =>
                    data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === gameNick.toLowerCase()
                );
                if (takenEntry) {
                    const [existingId] = takenEntry;
                    // Check if the existing user is a wrongly registered pilot (has pilot format in this server)
                    const existingOriginMember = members.get(existingId);
                    if (existingOriginMember) {
                        const existingDisplay = existingOriginMember.nickname || existingOriginMember.user.displayName;
                        if (server.isPilot(existingDisplay)) {
                            // Wrongly registered owner — fix and free the nickname
                            delete db.users[existingId];
                            saveLocalStorage();
                            logEvent(`📥 [ScanImport] ${member.user.tag} FIXED: removed wrong owner ${existingOriginMember.user.tag} — freeing nickname "${gameNick}"`);
                            // Fall through to register the real owner
                        } else {
                            totalSkipped++;
                            if (results.length < 20) results.push(`⏭️ ${member.user.tag} — "${gameNick}" already registered by ${existingOriginMember.user.tag}`);
                            continue;
                        }
                    } else {
                        // Existing user not in this server — can't verify, skip
                        totalSkipped++;
                        if (results.length < 20) results.push(`⏭️ ${member.user.tag} — "${gameNick}" already registered`);
                        continue;
                    }
                }

                const prodMember = await prodGuild.members.fetch(memberId).catch(() => null);

                if (prodMember) {
                    db.users[memberId] = {
                        nickname: gameNick,
                        registeredAt: new Date().toISOString(),
                        pilotIds: []
                    };
                    saveLocalStorage();

                    await prodMember.setNickname(gameNick).catch(() => {});
                    if (!prodMember.roles.cache.has(MEMBER_ROLE_ID)) {
                        await prodMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
                    }

                    ownerNickLowerToId[gameNick.toLowerCase()] = memberId;

                    // Link any pending pilots waiting for this owner
                    const pilotsLinked = linkPendingPilotToOwner(memberId, gameNick);
                    if (pilotsLinked > 0) {
                        totalPilotsLinked += pilotsLinked;
                        if (results.length < 20) results.push(`🔗 ${member.user.tag} → ${pilotsLinked} pending pilot(s) linked`);
                        logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) linked ${pilotsLinked} pending pilot(s) for "${gameNick}"`);
                    }

                    totalRegistered++;
                    if (results.length < 20) results.push(`✅ ${member.user.tag} → registered as "${gameNick}"`);
                    logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) registered as owner "${gameNick}"`);
                } else {
                    // Check if already pre-registered, update nickname if changed
                    if (!db.preRegistrations) db.preRegistrations = {};
                    const existing = db.preRegistrations[memberId];
                    if (existing && existing.nickname !== gameNick) {
                        const oldNick = existing.nickname;
                        existing.nickname = gameNick;
                        existing.registeredAt = new Date().toISOString();
                        existing.expiresAt = new Date(Date.now() + PRE_REGISTER_MAX_AGE_MS).toISOString();
                        saveLocalStorage();
                        logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) pre-registration updated: "${oldNick}" → "${gameNick}"`);
                    } else if (!existing) {
                        const expiresAt = new Date(Date.now() + PRE_REGISTER_MAX_AGE_MS).toISOString();
                        db.preRegistrations[memberId] = {
                            nickname: gameNick,
                            pilotIds: [],
                            registeredAt: new Date().toISOString(),
                            expiresAt
                        };
                        saveLocalStorage();
                    }

                    ownerNickLowerToId[gameNick.toLowerCase()] = memberId;
                    totalPreReg++;
                    if (results.length < 20) results.push(`⏳ ${member.user.tag} → pre-registered as "${gameNick}" (expires in 7d)`);
                    logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) pre-registered as owner "${gameNick}"`);
                }
            }
        }

                // Resolve pending pilots — check if their owner was registered during the scan
        for (const pilot of pendingPilots) {
            const ownerNickLower = pilot.ownerNick.toLowerCase();
            const ownerId = ownerNickLowerToId[ownerNickLower];

            if (ownerId && db.users[ownerId] && db.users[pilot.memberId]) {
                if (db.users[pilot.memberId].pendingOwnerNick) {
                    delete db.users[pilot.memberId].pendingOwnerNick;
                    if (!db.users[ownerId].pilotIds) db.users[ownerId].pilotIds = [];
                    if (!db.users[ownerId].pilotIds.includes(pilot.memberId) && db.users[ownerId].pilotIds.length < 4) {
                        db.users[ownerId].pilotIds.push(pilot.memberId);
                        if (db.preRegistrations && db.preRegistrations[pilot.memberId]) {
                            db.preRegistrations[pilot.memberId].ownerId = ownerId;
                        }
                        saveLocalStorage();
                        const prodPilot = await prodGuild.members.fetch(pilot.memberId).catch(() => null);
                        if (prodPilot) {
                            await prodPilot.setNickname(`${pilot.ownerNick} - Pilot`).catch(() => {});
                        }
                        logEvent(`📥 [ScanImport] ${pilot.member.user.tag} — linked to owner "${pilot.ownerNick}" (resolve)`);
                        if (results.length < 20) results.push(`🔗 ${pilot.member.user.tag} — linked to owner "${pilot.ownerNick}" (resolve)`);
                    }
                }
            } else if (!ownerId || !db.users[ownerId]) {
                logEvent(`📥 [ScanImport] ${pilot.member.user.tag} — still awaiting owner "${pilot.ownerNick}" (already registered as pilot)`);
            }
        }

let report = `📥 **Scan Import Complete**\n\n`;
        report += `✅ **Registered (owners):** ${totalRegistered}\n`;
        report += `✈️ **Pilots linked:** ${totalPilotsLinked}\n`;
        report += `⏳ **Pre-registered (owners):** ${totalPreReg}\n`;
        report += `⏳ **Pre-registered (pilots):** ${totalPilotPreReg}\n`;
        report += `⏭️ **Skipped:** ${totalSkipped}\n\n`;

        if (results.length > 0) {
            report += `📋 **Details:**\n`;
            report += results.join('\n');
        }

        if (report.length > 1900) {
            report = report.substring(0, 1900) + '\n\n... (truncated)';
        }

        logEvent(`📥 [ScanImport] ${interaction.user.tag} scan: ${totalRegistered} owners, ${totalPilotsLinked} pilots, ${totalPreReg} pre-reg, ${totalSkipped} skipped`);
        return interaction.editReply(report);
    }

    // ── SCAN IMPORT STATUS — check pre-registrations and auto-convert ──
    if (commandName === 'scanimport_status') {
        await interaction.deferReply({ flags: 64 });

        if (guild.id !== DISCORD_SERVER_ID) {
            return interaction.editReply('❌ This command must be run in the main production server.');
        }

        // Load ranking cache
        const { getLocalRankingCache } = await import('./ranking-cache.js');
        const rankingCache = getLocalRankingCache();

        if (!rankingCache) {
            return interaction.editReply('❌ No ranking cache available. Wait for the daily sync or run /forcesync first to populate the cache.');
        }

        if (!db.preRegistrations || Object.keys(db.preRegistrations).length === 0) {
            return interaction.editReply('✅ **No pre-registrations found.** Everything is clean!');
        }

        let totalChecked = 0;
        let totalExpired = 0;
        let totalConverted = 0;
        let totalInAlliedClan = 0;
        let totalNotFound = 0;
        let totalNotInProd = 0;
        const results = [];
        const prodGuild = guild;

        // Fetch all prod members once
        const prodMembers = await prodGuild.members.fetch().catch(() => null);

        for (const [memberId, preReg] of Object.entries(db.preRegistrations)) {
            totalChecked++;

            // ── Check expiry ──
            if (preReg.expiresAt && new Date(preReg.expiresAt).getTime() < Date.now()) {
                delete db.preRegistrations[memberId];
                totalExpired++;
                if (results.length < 30) results.push(`🗑️ **${preReg.nickname}** — expired, removed`);
                logEvent(`📊 [ScanImportStatus] Removed expired pre-registration for "${preReg.nickname}" (${memberId})`);
                continue;
            }

            // ── Check if user is in production server ──
            const prodMember = prodMembers ? prodMembers.get(memberId) : null;

            if (!prodMember) {
                totalNotInProd++;
                if (results.length < 30) results.push(`⏳ **${preReg.nickname}** — not in prod server yet`);
                continue;
            }

            // ── Check ranking cache ──
            const cacheHit = findNicknameInCache(preReg.nickname, rankingCache);

            if (!cacheHit) {
                totalNotFound++;
                if (results.length < 30) results.push(`❌ **${preReg.nickname}** — not found in ranking`);
                continue;
            }

            // ── Check if in allied clan ──
            const worldAlliedClans = db.config?.alliedClans?.[cacheHit.worldId];
            const inAlliedClan = worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === cacheHit.clanName.toLowerCase());
            const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;

            if (!inAlliedClan) {
                totalInAlliedClan++;
                if (results.length < 30) results.push(`⚠️ **${preReg.nickname}** — found in ${serverName} (${cacheHit.clanName}) but NOT allied clan`);
                continue;
            }

            // ── AUTO-CONVERT: in prod server + in ranking + in allied clan ──
            // Check if this is a pilot pre-registration
            if (preReg.ownerNick && preReg.ownerId && db.users[preReg.ownerId]) {
                // Pilot auto-conversion
                if (!db.users[preReg.ownerId].pilotIds) db.users[preReg.ownerId].pilotIds = [];
                if (!db.users[preReg.ownerId].pilotIds.includes(memberId)) {
                    db.users[preReg.ownerId].pilotIds.push(memberId);
                }
                db.users[memberId] = {
                    nickname: preReg.nickname,
                    registeredAt: new Date().toISOString(),
                    pilotIds: []
                };

                await prodMember.setNickname(`${preReg.ownerNick} - Pilot`).catch(() => {});
                if (!prodMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await prodMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
                }
                delete db.preRegistrations[memberId];
                totalConverted++;
                if (results.length < 30) results.push(`✈️ **${preReg.nickname}** → CONVERTED as pilot of **${preReg.ownerNick}** (${serverName} — ${cacheHit.clanName})`);
                logEvent(`📊 [ScanImportStatus] Auto-converted pilot "${preReg.nickname}" (${memberId}) — linked to owner "${preReg.ownerNick}" (${serverName} — ${cacheHit.clanName})`);
            } else {
                // Owner auto-conversion
                db.users[memberId] = {
                    nickname: preReg.nickname,
                    registeredAt: new Date().toISOString(),
                    pilotIds: preReg.pilotIds || []
                };

                await prodMember.setNickname(preReg.nickname).catch(() => {});
                if (!prodMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await prodMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
                }
                delete db.preRegistrations[memberId];
                totalConverted++;
                if (results.length < 30) results.push(`✅ **${preReg.nickname}** → CONVERTED to permanent (${serverName} — ${cacheHit.clanName})`);
                logEvent(`📊 [ScanImportStatus] Auto-converted owner "${preReg.nickname}" (${memberId}) — found in allied clan ${cacheHit.clanName} (${serverName})`);
            }
        }

        saveLocalStorage();

        let report = `📊 **Pre-Registration Status**\n\n`;
        report += `📋 **Total checked:** ${totalChecked}\n`;
        report += `🗑️ **Expired (removed):** ${totalExpired}\n`;
        report += `⏳ **Not in prod server:** ${totalNotInProd}\n`;
        report += `❌ **Not found in ranking:** ${totalNotFound}\n`;
        report += `⚠️ **Not in allied clan:** ${totalInAlliedClan}\n`;
        report += `✅ **CONVERTED to permanent:** ${totalConverted}\n\n`;

        if (results.length > 0) {
            report += `📋 **Details:**\n`;
            report += results.join('\n');
        }

        if (report.length > 1900) {
            report = report.substring(0, 1900) + '\n\n... (truncated)';
        }

        logEvent(`📊 [ScanImportStatus] ${interaction.user.tag} checked ${totalChecked} pre-registrations — ${totalConverted} auto-converted, ${totalExpired} expired`);
        return interaction.editReply(report);
    }

    // ── ELDER GUIDE ──
    if (commandName === 'elderguide') {
        const isApprover = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.some(r => APPROVER_ROLE_IDS.includes(r.id));

        if (!isApprover) {
            return interaction.reply({ content: '❌ You do not have permission to view this guide.', flags: 64 });
        }

        const guide = `📋 **Elder Guide**\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📩 **1. How approvals appear**\n\n` +
            `When someone clicks **👑 Register as Owner**, a message appears in the admin channel with the user info, ranking status, and allied clan status.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `✅ **2. Approve (permanent)**\n\n` +
            `Click **✅ Approve** when the nickname is in the ranking AND in an allied clan. → Permanent role + nickname set automatically.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⏳ **3. Approve Temporarily (3 days)**\n\n` +
            `Click **⏳ Approve Temporarily** when NOT in ranking or NOT in allied clan yet. → Temporary role (3 days). Auto-converts to permanent once found in an allied clan during daily sync.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `❌ **4. Reject with reason**\n\n` +
            `Click **❌ Reject** → write the reason. The user gets a DM explaining why. Always write a clear reason so the user can fix it.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `✈️ **5. Pilot Registration**\n\n` +
            `When someone clicks **✈️ Register as Pilot**, the bot DMs the owner to approve/reject directly. Elders do NOT approve pilots.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `⏰ **6. Expiration**\n\n` +
            `Pending approvals expire after **24h**. The message updates showing "expired". User must re-submit.\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `❓ Need help? Contact an Administrator.`;

        return interaction.reply({ content: guide });
    }
}
