// ==========================================
// 📝 REGISTRATION FLOW
// Welcome buttons, modals, admin approval, pilot management
// ==========================================
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
import {
    confirmationCache,
    MEMBER_ROLE_ID,
    WORLD_IDS,
    DISCORD_SERVER_ID,
    pendingRegistrations,
    pendingPilotApprovals,
    adminChannelId,
    APPROVER_ROLE_IDS,
    WELCOME_PANEL_MESSAGE,
    PENDING_MAX_AGE_MS
} from './ranking-constants.js';
import { findNicknameInCache, findClosestNicknameInCache, getLocalRankingCache, levenshteinDistance, cleanNickname } from './ranking-cache.js';
import { assignMemberRole } from './ranking-utils.js';

// ==========================================
// 🖱️ HANDLER
// ==========================================

export async function handleRegistrationInteractions(interaction, db, saveLocalStorage, logEvent) {
    
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
    
        // ── Register as Pilot from owner registration conflict (skip modal) ──
        if (interaction.isButton() && interaction.customId === 'reg_pilot_conflict_cancel') {
            return interaction.update({ content: '❌ Operação cancelada.', components: [] });
        }
    
        if (interaction.isButton() && interaction.customId.startsWith('reg_pilot_conflict_')) {
            await interaction.deferUpdate();
    
            const ownerId = interaction.customId.replace('reg_pilot_conflict_', '');
            const ownerData = db.users[ownerId];
    
            if (!ownerData) {
                logEvent(`❌ Conflict pilot request failed: owner ${ownerId} no longer registered`);
                return interaction.editReply({ content: '❌ O dono desta conta não está mais registrado.', components: [] });
            }
    
            const pilotId = interaction.user.id;
            const ownerNick = ownerData.nickname;
    
            if (ownerId === pilotId) {
                return interaction.editReply({ content: '❌ Você não pode se registrar como seu próprio piloto.', components: [] });
            }
    
            if (!ownerData.pilotIds) ownerData.pilotIds = [];
            if (ownerData.pilotIds.length >= 4) {
                return interaction.editReply({ content: '❌ Este dono já atingiu o limite máximo de 4 pilotos.', components: [] });
            }
            if (ownerData.pilotIds.includes(pilotId)) {
                return interaction.editReply({ content: '❌ Você já está registrado como piloto deste dono.', components: [] });
            }
    
            pendingPilotApprovals[pilotId] = {
                ownerId,
                ownerNick,
                pilotId,
                pilotTag: interaction.user.tag,
                timestamp: Date.now()
            };
            saveLocalStorage();
    
            try {
                const ownerMember = await interaction.guild.members.fetch(ownerId);
                const dmChannel = await ownerMember.createDM();
    
                await dmChannel.send({
                    content: `✈️ **Aprovação de Piloto**\n\n👤 **${interaction.user.tag}** quer se registrar como seu piloto.\n📝 **Seu personagem:** ${ownerNick}\n\nVocê aprova este piloto?`,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-yes`).setLabel('✅ Aprovar').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-no`).setLabel('❌ Rejeitar').setStyle(ButtonStyle.Danger)
                        )
                    ]
                });
    
                logEvent(`✈️ ${interaction.user.tag} requested to be pilot of ${ownerNick} (from registration conflict) — DM sent to owner`);
                return interaction.editReply({
                    content: `✅ **Solicitação enviada!** O dono **${ownerNick}** recebeu uma mensagem no privado para aprovar seu registro como piloto.`,
                    components: []
                });
            } catch (error) {
                logEvent(`❌ Failed to send pilot DM from conflict: ${interaction.user.tag} → owner ${ownerNick} (${ownerId}): ${error.message}`);
                delete pendingPilotApprovals[pilotId];
                saveLocalStorage();
                return interaction.editReply({ content: '❌ Não foi possível enviar mensagem para o dono. Certifique-se de que ele tem as DMs ativadas neste servidor.', components: [] });
            }
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
            await assignMemberRole(pilotMember, logEvent);
    
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
                const [ownerId, ownerData] = existingUser;
    
                // Same user — already registered as this character
                if (ownerId === interaction.user.id) {
                    logEvent(`⚠️ ${interaction.user.tag} tried to register as "${nickname}" but they already own this nickname`);
                    return interaction.editReply(`⚠️ **Você já está registrado como \`${nickname}\`.** Seu personagem já está vinculado à sua conta.`);
                }
    
                // Different user — show who is registered
                logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but name already taken by user ${ownerId}`);
    
                // Look up the owner's Discord member info
                const ownerMember = await interaction.guild.members.fetch(ownerId).catch(() => null);
                const ownerDisplay = ownerMember ? ownerMember.toString() : `<@${ownerId}>`;
    
                const responseMsg = `⚠️ **Este personagem \`${nickname}\` já está registrado por ${ownerDisplay}.**\n\n` +
                    `Se você é o **dono desta conta**, entre em contato com **@Sourvessel** para resolver a situação.\n\n` +
                    `Caso contrário, você pode se registrar como **piloto** desta conta — o dono receberá uma mensagem no privado para aprovar.`;
    
                return interaction.editReply({
                    content: responseMsg,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`reg_pilot_conflict_${ownerId}`)
                                .setLabel('✈️ Registrar como Piloto')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId('reg_pilot_conflict_cancel')
                                .setLabel('❌ Cancelar')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ]
                });
            }
    
            // ── Fuzzy matching: if exact match not found, try closest match in db.users ──
            let fuzzyRegisteredMatch = null;
            const cleanedInput = cleanNickname(nickname);
            if (cleanedInput.length >= 2) {
                // Build set of pilot IDs to exclude (skip pilots, match only owners)
                const fuzzyPilotIds = new Set();
                for (const [, data] of Object.entries(db.users)) {
                    if (data.pilotIds && data.pilotIds.length > 0) {
                        for (const pid of data.pilotIds) {
                            fuzzyPilotIds.add(pid);
                        }
                    }
                }
    
                let bestFuzzyMatch = null;
                let bestFuzzyScore = 0;
    
                for (const [id, data] of Object.entries(db.users)) {
                    if (!data.nickname) continue;
                    // Skip pilots — only match actual owners
                    if (fuzzyPilotIds.has(id)) continue;
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
    
                    if (similarity > bestFuzzyScore && similarity >= 0.55) {
                        bestFuzzyScore = similarity;
                        bestFuzzyMatch = { id, nickname: data.nickname };
                    }
                }
    
                if (bestFuzzyMatch) {
                    fuzzyRegisteredMatch = bestFuzzyMatch;
                    logEvent(`👑 ${interaction.user.tag} — fuzzy conflict detected: "${nickname}" → "${bestFuzzyMatch.nickname}" (user ${bestFuzzyMatch.id})`);
                }
            }
    
            if (fuzzyRegisteredMatch) {
                const [ownerId, ownerData] = [fuzzyRegisteredMatch.id, db.users[fuzzyRegisteredMatch.id]];
    
                // Same user — fuzzy matched themselves
                if (ownerId === interaction.user.id) {
                    return interaction.editReply(`⚠️ **Você já está registrado como \`${ownerData.nickname}\`** (você digitou "${nickname}"). Seu personagem já está vinculado à sua conta.`);
                }
    
                // Different user — fuzzy match found
                const ownerMember = await interaction.guild.members.fetch(ownerId).catch(() => null);
                const ownerDisplay = ownerMember ? ownerMember.toString() : `<@${ownerId}>`;
    
                const responseMsg = `⚠️ **O nome "${nickname}" é muito semelhante a "${ownerData.nickname}", que já está registrado por ${ownerDisplay}.**\n\n` +
                    `Se você é o **dono desta conta**, entre em contato com **@Sourvessel** para resolver a situação.\n\n` +
                    `Caso contrário, você pode se registrar como **piloto** desta conta — o dono receberá uma mensagem no privado para aprovar.`;
    
                return interaction.editReply({
                    content: responseMsg,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`reg_pilot_conflict_${ownerId}`)
                                .setLabel('✈️ Registrar como Piloto')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId('reg_pilot_conflict_cancel')
                                .setLabel('❌ Cancelar')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ]
                });
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
    
        
}
