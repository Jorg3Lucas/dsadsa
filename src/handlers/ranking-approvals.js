import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    DISCORD_SERVER_ID,
    pendingRegistrations,
    pendingPilotApprovals,
    APPROVER_ROLE_IDS,
    PENDING_MAX_AGE_MS
} from '../core/ranking-constants.js';

// ==========================================
// ✅ ADMIN APPROVAL HANDLERS
// ==========================================
// Extracted from ranking-handlers.js

// ── Admin Approval: Owner Registration ──
export async function handleApproveOwner(interaction, db, saveLocalStorage, logEvent) {
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
        const canApprove = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.some(r => APPROVER_ROLE_IDS.includes(r.id));
        if (!canApprove) {
            await interaction.deferUpdate();
            return interaction.followUp({ content: '❌ You do not have permission to reject registrations.', flags: 64 });
        }

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
export async function handleRejectOwner(interaction, db, saveLocalStorage, logEvent) {
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
    saveLocalStorage();

    logEvent(`❌ Admin ${interaction.user.tag} REJECTED registration for ${userId} (nickname: ${pending.nickname}) — reason: ${reason}`);

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

    try {
        const user = await interaction.client.users.fetch(userId);
        await user.send(`❌ **Registration Rejected**\n\nYour registration was rejected by an administrator.\n\n📝 **Reason:** ${reason}\n\nIf you need further assistance, please contact an administrator.`);
    } catch (e) {
        logEvent(`⚠️ Could not send rejection DM to ${userId} (DMs closed or user not found)`);
    }

    return interaction.editReply('❌ **Registration rejected.** The user was notified via DM with the reason.');
}

// ── Owner DM Approval: Pilot Registration ──
export async function handleApprovePilot(interaction, db, saveLocalStorage, logEvent) {
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
    saveLocalStorage();

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
    // Apply member role
    if (!pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
        await pilotMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: pilotMember.user.username }));
    }

    logEvent(`${interaction.user.tag} approved pilot ${pilotUserId} for ${pending.ownerNick}`);

    await interaction.editReply({ content: `✅ **Pilot approved!** <@${pilotUserId}> is now your pilot.`, components: [] });

    try { const u = await interaction.client.users.fetch(pilotUserId); await u.send('✅ **Registration approved!** The owner accepted your pilot request.'); } catch (e) {}
    return;
}
