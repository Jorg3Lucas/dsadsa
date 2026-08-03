import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    SUPER_ADMIN_USER_ID,
    NUKE_PROTECTED_CHANNEL_IDS,
    confirmationCache
} from '../core/ranking-constants.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';

// ==========================================
// ✅ CONFIRMATION BUTTON HANDLERS
// ==========================================
// Handles confirm-* button clicks from /manual* commands
// Extracted from ranking-handlers.js

export async function handleConfirmAction(interaction, db, saveLocalStorage, logEvent) {
    const [_, action, result] = interaction.customId.split('-');
    const cacheKey = `${interaction.user.id}-${action}`;
    const cached = confirmationCache[cacheKey];

    if (!cached) {
        return interaction.update({
            content: '⌛ This confirmation has expired. Please run the command again.',
            components: []
        }).catch(() => {});
    }

    if (result === 'no') {
        delete confirmationCache[cacheKey];
        return interaction.update({
            content: '❌ Action cancelled.',
            components: []
        }).catch(() => {});
    }

    delete confirmationCache[cacheKey];

    // ── manualremove: Remove a user's registration ──
    if (action === 'manualremove') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
        if (!targetMember || !db.users[cached.targetId]) {
            return interaction.update({ content: '❌ Target user no longer available.', components: [] }).catch(() => {});
        }

        const userData = db.users[cached.targetId];
        if (userData.pilotIds && userData.pilotIds.length > 0) {
            for (const pId of userData.pilotIds) {
                const pilotMember = await guild.members.fetch(pId).catch(() => null);
                if (pilotMember) {
                    if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                        await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                    }
                    await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
                }
            }
        }
        if (targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await targetMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
        }
        await targetMember.setNickname(targetMember.user.username).catch(() => {});
        delete db.users[cached.targetId];
        saveLocalStorage();

        logEvent(`Admin ${interaction.user.tag} manually removed user ${cached.targetId}`);
        return interaction.update({
            content: getMsg('ranking.responses.manualremove.success', { username: cached.targetName }),
            components: []
        }).catch(() => {});
    }

    // ── manualremovepilot: Remove a specific pilot from an owner ──
    if (action === 'manualremovepilot') {
        const guild = interaction.guild;
        const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
        const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);

        if (!ownerMember || !db.users[cached.ownerId]) {
            return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(() => {});
        }

        if (!db.users[cached.ownerId].pilotIds || !db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
            return interaction.update({ content: '❌ This pilot is no longer linked.', components: [] }).catch(() => {});
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
        }).catch(() => {});
    }

    // ── manualpilot: Link a pilot to an owner ──
    if (action === 'manualpilot') {
        const guild = interaction.guild;
        const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
        const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);

        if (!ownerMember || !db.users[cached.ownerId]) {
            return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(() => {});
        }

        if (!db.users[cached.ownerId].pilotIds) db.users[cached.ownerId].pilotIds = [];
        if (!db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
            db.users[cached.ownerId].pilotIds.push(cached.pilotId);
        }
        saveLocalStorage();

        if (pilotMember) {
            await pilotMember.setNickname(buildPrefixedNickname(cached.ownerNick, db, 'Pilot')).catch(() => {});
        }

        // Apply member role
        if (pilotMember && !pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await pilotMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
            logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: pilotMember.user.username }));
        }

        logEvent(`Admin ${interaction.user.tag} manually linked pilot ${cached.pilotName} to ${cached.ownerName}`);
        return interaction.update({
            content: getMsg('ranking.responses.manualpilot.success', { pilotMember: cached.pilotName, nick: cached.ownerNick }),
            components: []
        }).catch(() => {});
    }

    // ── manualregister: Register a user directly ──
    if (action === 'manualregister') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);

        if (!targetMember) {
            return interaction.update({ content: '❌ Member no longer available.', components: [] }).catch(() => {});
        }

        const finalNickname = cached.selectedNickname || cached.nickname;

        db.users[cached.targetId] = {
            ...db.users[cached.targetId],
            nickname: finalNickname,
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

        await targetMember.setNickname(buildPrefixedNickname(finalNickname, db)).catch(() => {});
        if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        }

        const tempLabel = cached.needsTempApproval ? ' (temporary — 3 days)' : '';
        logEvent(`Admin ${interaction.user.tag} manually registered ${cached.targetId} as ${finalNickname} in ${cached.clan}${tempLabel}`);

        const responseMsg = cached.needsTempApproval
            ? `⏳ **${finalNickname}** registered as temporary (3 days) in **${cached.clan}**. Will be converted to permanent once found in an allied clan.`
            : getMsg('ranking.responses.manualregister.cacheFound', { nickname: finalNickname, clan: cached.clan });

        return interaction.update({
            content: responseMsg,
            components: []
        }).catch(() => {});
    }

    // ── nuke: Delete ALL channels and categories (super admin only) ──
    if (action === 'nuke') {
        const guild = interaction.guild;

        // Safety: re-check super admin before executing the nuke
        if (interaction.user.id !== SUPER_ADMIN_USER_ID) {
            return interaction.update({
                content: '❌ **Access denied.** Only the super admin can confirm this action.',
                components: []
            }).catch(() => {});
        }

        // Acknowledge before channels start disappearing
        await interaction.update({
            content: '💣 **NUKE INITIATED** — deleting all channels and categories...',
            components: []
        }).catch(() => {});

        // Delete regular channels first, then categories (avoids double-delete errors).
        // Protected channels are never deleted, and neither are categories that
        // contain a protected channel (Discord cascade-deletes a category's children).
        const allChannels = [...guild.channels.cache.values()];
        const isProtected = c => NUKE_PROTECTED_CHANNEL_IDS.includes(c.id);
        const protectedChannels = allChannels.filter(isProtected);
        const categoriesToKeep = allChannels.filter(c =>
            c.type === ChannelType.GuildCategory &&
            protectedChannels.some(p => p.parentId === c.id)
        );

        const deletable = allChannels.filter(c =>
            !isProtected(c) && !categoriesToKeep.includes(c)
        );
        const categories = deletable.filter(c => c.type === ChannelType.GuildCategory);
        const regular = deletable.filter(c => c.type !== ChannelType.GuildCategory);

        let deleted = 0;
        let deletedCategories = 0;
        for (const ch of regular) {
            await ch.delete('💣 Nuke by super admin').then(() => deleted++).catch(() => {});
        }
        for (const ch of categories) {
            await ch.delete('💣 Nuke by super admin').then(() => { deleted++; deletedCategories++; }).catch(() => {});
        }

        // Clean up bot config references to now-deleted channels (avoids errors during daily sync)
        if (db.config) {
            if (db.config.panelChannelId) delete db.config.panelChannelId;
            if (db.config.panelMessageId) delete db.config.panelMessageId;
            saveLocalStorage();
        }

        // Create a default channel and post the operation summary
        try {
            const geral = await guild.channels.create({
                name: 'geral',
                reason: '💣 Post-nuke default channel'
            });
            let summary = `💣 **NUKE COMPLETED!**\n\n🗑️ **${deletedCategories}** categor(ies) deleted\n📢 **${deleted - deletedCategories}** channel(s) deleted`;
            const kept = allChannels.length - deleted;
            if (kept > 0) {
                summary += `\n🛡️ **${kept}** channel(s)/categor(ies) kept (protected)`;
            }
            summary += `\n👤 Executed by: ${interaction.user.tag}\n🕐 ${new Date().toLocaleString('en-US')}`;
            await geral.send(summary);
        } catch (e) {
            console.error('❌ Failed to create #geral after nuke:', e);
        }

        logEvent(`💣 SUPER ADMIN ${interaction.user.tag} (${interaction.user.id}) NUKE — deleted ${deleted} channels (${deletedCategories} categories), kept ${allChannels.length - deleted}`);

        // Nothing left to update — all channels (including this one) are gone
        return null;
    }

    // ── manualforce: Force-register a user as permanent (no ranking check) ──
    if (action === 'manualforce') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);

        if (!targetMember) {
            return interaction.update({ content: '❌ Member no longer available.', components: [] }).catch(() => {});
        }

        // Register immediately as permanent — no tempUntil, no ranking check
        db.users[cached.targetId] = {
            ...db.users[cached.targetId],
            nickname: cached.nickname,
            registeredAt: new Date().toISOString(),
            manualPermanent: true
        };

        // Clean up any stale temp fields if they exist
        if (db.users[cached.targetId].tempUntil) delete db.users[cached.targetId].tempUntil;
        if (db.users[cached.targetId].tempRegisteredAt) delete db.users[cached.targetId].tempRegisteredAt;
        if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;

        if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
        saveLocalStorage();

        await targetMember.setNickname(buildPrefixedNickname(cached.nickname, db)).catch(() => {});
        if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        }

        logEvent(`👑 Admin ${interaction.user.tag} force-registered ${cached.targetId} as ${cached.nickname} (permanent — no ranking check)`);

        return interaction.update({
            content: getMsg('ranking.responses.manualforce.success', { username: cached.targetName, nickname: cached.nickname }),
            components: []
        }).catch(() => {});
    }

    return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(() => {});
}
