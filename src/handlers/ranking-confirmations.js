import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    SUPER_ADMIN_USER_ID,
    NUKE_PROTECTED_CHANNEL_IDS,
    confirmationCache,
    WELCOME_PANEL_MESSAGE,
    ensureConfig,
    setRegistrationChannelId,
    setAdminChannelId,
    APPROVER_ROLE_IDS
} from '../core/ranking-constants.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';
import { assignClanRole, assignTempRole, removeMemberRoles } from '../core/clan-roles.js';
import { CLAIM_CATEGORIES, GENERAL_CATEGORY, ELDER_ROLE_ID, buildClaimOverwrites, buildMemberOverwrites, LEGACY_DELETED_CHANNELS, findTextChannel } from '../core/server-structure.js';
import { renderEmbed, renderButtons } from './panel-render.js';
import { saveDailyLogs } from '../core/daily-logs.js';
import {
    db as claimDb,
    saveLocalStorage as saveClaimStorage,
    lastMessages as claimLastMessages,
    dailyLogs
} from '../core/state.js';

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
                    await removeMemberRoles(pilotMember, db);
                    await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
                }
            }
        }
        if (targetMember) {
            await removeMemberRoles(targetMember, db);
            await targetMember.setNickname(targetMember.user.username).catch(() => {});
        }
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
            await removeMemberRoles(pilotMember, db);
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
            // Pilots inherit the owner's clan role
            await assignClanRole(pilotMember, db, logEvent);
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
        // Clan role is now the member marker (GoW Kids as fallback for temp/unresolvable)
        if (cached.needsTempApproval) {
            await assignTempRole(targetMember, db, saveLocalStorage, logEvent);
        } else {
            const assigned = await assignClanRole(targetMember, db, logEvent);
            if (!assigned) await assignTempRole(targetMember, db, saveLocalStorage, logEvent);
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
        // Note: if a protected ID is itself a category, only the category survives —
        // its child channels are still deleted unless individually protected.
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

        // Deliberately preserved channels (protected + categories sheltering them),
        // NOT deletion outcomes — a failed delete() still counts as "deleted" above.
        const kept = allChannels.length - deletable.length;

        // Create a default channel and post the operation summary
        try {
            const geral = await guild.channels.create({
                name: 'geral',
                reason: '💣 Post-nuke default channel'
            });
            let summary = `💣 **NUKE COMPLETED!**\n\n🗑️ **${deletedCategories}** categor(ies) deleted\n📢 **${deleted - deletedCategories}** channel(s) deleted`;
            if (kept > 0) {
                summary += `\n🛡️ **${kept}** channel(s)/categor(ies) kept (protected)`;
            }
            summary += `\n👤 Executed by: ${interaction.user.tag}\n🕐 ${new Date().toLocaleString('en-US')}`;
            await geral.send(summary);
        } catch (e) {
            console.error('❌ Failed to create #geral after nuke:', e);
        }

        logEvent(`💣 SUPER ADMIN ${interaction.user.tag} (${interaction.user.id}) NUKE — deleted ${deleted} channels (${deletedCategories} categories), kept ${kept}`);

        // Nothing left to update — all channels (including this one) are gone
        return null;
    }

    // ── setup: Create the full server structure (super admin only) ──
    if (action === 'setup') {
        const guild = interaction.guild;

        // Safety: re-check super admin before creating anything
        if (interaction.user.id !== SUPER_ADMIN_USER_ID) {
            return interaction.update({
                content: '❌ **Access denied.** Only the super admin can confirm this action.',
                components: []
            }).catch(() => {});
        }

        // Acknowledge before the (possibly long) creation loop
        await interaction.update({
            content: '🏗️ **SETUP STARTED** — creating missing channels and categories...',
            components: []
        }).catch(() => {});

        const botId = interaction.client.user.id;
        const everyoneRole = guild.roles.everyone;
        const elderRole = guild.roles.cache.get(ELDER_ROLE_ID);
        if (!elderRole) {
            console.error(`⚠️ [Setup] Elder role ${ELDER_ROLE_ID} not found — elder-only channels will be view-only for everyone.`);
        }

        // Build permission overwrites for a given channel mode
        const buildOverwrites = (mode) => {
            // member → only registered members (clan roles + GoW Kids) can view and chat (market, main-chat)
            if (mode === 'member') {
                const memberRoleIds = [
                    ...Object.values(db.config?.clanRoles || {}).filter(id => id && guild.roles.cache.has(id)),
                    ...(db.config?.tempRoleId && guild.roles.cache.has(db.config.tempRoleId) ? [db.config.tempRoleId] : [])
                ];
                return buildMemberOverwrites(everyoneRole.id, botId, memberRoleIds);
            }
            // staff → only approver roles (+ admins/bot) can view and chat (approvals)
            if (mode === 'staff') {
                const overwrites = [
                    { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ];
                for (const rid of APPROVER_ROLE_IDS) {
                    overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
                }
                return overwrites;
            }
            // elders/bot/system → everyone views, only elders/bot write
            const overwrites = [
                { id: everyoneRole.id, deny: [PermissionFlagsBits.SendMessages] },
                { id: botId, allow: [PermissionFlagsBits.SendMessages] }
            ];
            if (mode === 'elders' && elderRole) {
                overwrites.push({ id: elderRole.id, allow: [PermissionFlagsBits.SendMessages] });
            }
            return overwrites;
        };

        // Find a category by name (fallback to legacy ID)
        const findCategory = (def) => {
            const byName = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === def.name);
            if (byName) return byName;
            if (def.legacyId) return guild.channels.cache.get(def.legacyId);
            return null;
        };

        // Rename a channel to its pretty name if it was found under a legacy name
        const renameToPretty = async (channel, chanDef) => {
            if (channel && channel.name !== chanDef.name) {
                await channel.setName(chanDef.name, '🏗️ /setup renamed channel').catch(() => {});
            }
        };

        let createdCategories = 0;
        let createdChannels = 0;
        let panelsSent = 0;
        const createdChannelIds = {}; // logical name → channel id (for system wiring)
        const newlyCreatedChannels = new Set(); // names of General channels created this run

        // Only re-point daily-logs to a channel if it was (re)created now or the
        // current target is empty/stale — preserves manual daily-logs.json config.
        const shouldRewireDailyLogs = (chanKey, currentId) =>
            newlyCreatedChannels.has(chanKey) ||
            !currentId ||
            !guild.channels.cache.has(currentId);

        // ── 1. Claim categories (members view-only, bot sends panels) ──
        for (const catDef of CLAIM_CATEGORIES) {
            let category = findCategory(catDef);
            if (!category) {
                try {
                    category = await guild.channels.create({
                        name: catDef.name,
                        type: ChannelType.GuildCategory,
                        permissionOverwrites: buildOverwrites('bot'),
                        reason: '🏗️ /setup by super admin'
                    });
                    createdCategories++;
                } catch (e) {
                    console.error(`❌ [Setup] Failed to create category ${catDef.name}: ${e.message}`);
                    continue;
                }
            }

            for (const chanDef of catDef.channels) {
                let channel = findTextChannel(guild, category.id, chanDef);
                const isNew = !channel;
                if (isNew) {
                    try {
                        channel = await guild.channels.create({
                            name: chanDef.name,
                            type: ChannelType.GuildText,
                            parent: category.id,
                            permissionOverwrites: buildOverwrites('bot'),
                            reason: '🏗️ /setup by super admin'
                        });
                        createdChannels++;
                    } catch (e) {
                        console.error(`❌ [Setup] Failed to create channel ${catDef.name}/${chanDef.name}: ${e.message}`);
                        continue;
                    }
                } else {
                    // Found under a legacy name/key → rename to the pretty name
                    await renameToPretty(channel, chanDef);
                }

                // Send panels only for freshly created channels (idempotent)
                if (isNew) {
                    for (const panelKey of chanDef.panels || []) {
                        if (!claimDb[panelKey]) {
                            console.warn(`⚠️ [Setup] Panel ${panelKey} not in claim DB, skipping.`);
                            continue;
                        }
                        try {
                            const sent = await channel.send({
                                embeds: [renderEmbed(panelKey)],
                                components: renderButtons(panelKey)
                            });
                            claimLastMessages[panelKey] = sent;
                            if (!claimDb._panelMapping) claimDb._panelMapping = {};
                            claimDb._panelMapping[panelKey] = { channelId: channel.id, messageId: sent.id };
                            panelsSent++;
                        } catch (e) {
                            console.error(`❌ [Setup] Failed to send panel ${panelKey} in ${catDef.name}/${chanDef.name}: ${e.message}`);
                        }
                    }
                }
            }
        }

        // ── 2. General category with all general channels ──
        let generalCategory = findCategory(GENERAL_CATEGORY);
        if (!generalCategory) {
            try {
                generalCategory = await guild.channels.create({
                    name: GENERAL_CATEGORY.name,
                    type: ChannelType.GuildCategory,
                    reason: '🏗️ /setup by super admin'
                });
                createdCategories++;
            } catch (e) {
                console.error(`❌ [Setup] Failed to create category ${GENERAL_CATEGORY.name}: ${e.message}`);
            }
        } else if (generalCategory.name !== GENERAL_CATEGORY.name) {
            await generalCategory.setName(GENERAL_CATEGORY.name, '🏗️ /setup renamed category').catch(() => {});
        }

        if (generalCategory) {
            for (const chanDef of GENERAL_CATEGORY.channels) {
                let channel = findTextChannel(guild, generalCategory.id, chanDef);
                if (!channel) {
                    try {
                        channel = await guild.channels.create({
                            name: chanDef.name,
                            type: ChannelType.GuildText,
                            parent: generalCategory.id,
                            permissionOverwrites: buildOverwrites(chanDef.mode),
                            reason: '🏗️ /setup by super admin'
                        });
                        createdChannels++;
                        newlyCreatedChannels.add(chanDef.key);
                    } catch (e) {
                        console.error(`❌ [Setup] Failed to create channel ${chanDef.name}: ${e.message}`);
                        continue;
                    }
                } else {
                    // Found under a legacy name/key → rename to the pretty name
                    await renameToPretty(channel, chanDef);
                    // Re-sync permissions to the channel's configured mode (fixes stale perms)
                    await channel.permissionOverwrites.set(buildOverwrites(chanDef.mode), '🏗️ /setup permission sync').catch(() => {});
                }
                createdChannelIds[chanDef.key] = channel.id;
            }
        }

        // ── 2b. Remove channels from removed features (domination/standby) ──
        for (const ch of [...guild.channels.cache.values()]) {
            if (ch.type !== ChannelType.GuildText) continue;
            if (LEGACY_DELETED_CHANNELS.includes(ch.name.toLowerCase())) {
                await ch.delete('🗑️ /setup removed legacy channel').catch(() => {});
                console.log(`🗑️ [Setup] Deleted legacy channel #${ch.name}`);
            }
        }

        // ── 3. System wiring (registration panel, notification IDs, daily logs) ──
        ensureConfig(db);

        // ── 3a. Sync claim-channel permissions: view restricted to clan roles + GoW Kids ──
        const claimRoleIds = [
            ...Object.values(db.config?.clanRoles || {}),
            ...(db.config?.tempRoleId ? [db.config.tempRoleId] : [])
        ];
        const claimOverwrites = buildClaimOverwrites(everyoneRole.id, botId, claimRoleIds);
        for (const catDef of CLAIM_CATEGORIES) {
            const category = findCategory(catDef);
            if (!category) continue;
            await category.permissionOverwrites.set(claimOverwrites, '🏗️ /setup claim access').catch(() => {});
            for (const chanDef of catDef.channels) {
                const channel = findTextChannel(guild, category.id, chanDef);
                if (!channel) continue;
                await channel.permissionOverwrites.set(claimOverwrites, '🏗️ /setup claim access').catch(() => {});
            }
        }

        // Registration channel → send the welcome panel + persist ID
        const regChId = createdChannelIds['registration'];
        if (regChId) {
            setRegistrationChannelId(regChId);
            if (!db.config.channelIds) db.config.channelIds = {};
            db.config.channelIds.registration = regChId;
            try {
                const regChannel = guild.channels.cache.get(regChId);
                if (regChannel) {
                    const welcomeRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('welcome_register_owner').setLabel('👑 Register as Owner').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('welcome_register_pilot').setLabel('✈️ Register as Pilot').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('welcome_remove_pilot').setLabel('🗑️ Remove Pilot').setStyle(ButtonStyle.Danger)
                    );
                    const panelMessage = await regChannel.send({ content: WELCOME_PANEL_MESSAGE, components: [welcomeRow] });
                    db.config.panelChannelId = regChId;
                    db.config.panelMessageId = panelMessage.id;
                }
            } catch (e) {
                console.error(`❌ [Setup] Failed to send welcome panel in #registration: ${e.message}`);
            }
        }

        // Approvals channel (staff) → where the bot posts registration approval panels
        const approvalsChId = createdChannelIds['approvals'];
        if (approvalsChId) {
            setAdminChannelId(approvalsChId);
            if (!db.config.channelIds) db.config.channelIds = {};
            db.config.channelIds.approvals = approvalsChId;
            db.config.adminChannelId = approvalsChId;
        }

        // Bot-managed alert channels → wire into daily-logs (only if newly created
        // or the previous target is empty/stale, so manual configs are preserved)
        let dailyLogsChanged = false;
        if (createdChannelIds['reminders'] && shouldRewireDailyLogs('reminders', dailyLogs.bossSpawnChannelId)) {
            dailyLogs.bossSpawnChannelId = createdChannelIds['reminders'];
            dailyLogsChanged = true;
        }
        if (createdChannelIds['events'] && shouldRewireDailyLogs('events', dailyLogs.scheduledEventChannelId)) {
            dailyLogs.scheduledEventChannelId = createdChannelIds['events'];
            dailyLogsChanged = true;
        }
        if (createdChannelIds['events'] && shouldRewireDailyLogs('events', dailyLogs.configChannelId)) {
            dailyLogs.configChannelId = createdChannelIds['events'];
            dailyLogsChanged = true;
        }
        if (dailyLogsChanged) saveDailyLogs();

        saveLocalStorage();      // ranking db (config.channelIds / panel refs)
        saveClaimStorage();      // claim db (panel mapping for freshly created claim channels)

        // ── 4. Summary ──
        let summary = `🏗️ **SETUP COMPLETED!**\n\n📁 Categories created: **${createdCategories}**\n📢 Channels created: **${createdChannels}**\n📋 Panels sent: **${panelsSent}**\n\n✅ Existing channels/categories were kept, renamed to the pretty names and permissions re-synced (idempotent).`;
        if (!elderRole) {
            summary += `\n\n⚠️ **Elder role not found** (${ELDER_ROLE_ID}) — tower-rules/announcements/allied-list are view-only for now.`;
        }
        summary += `\n\n🔒 Claim channels restricted to clan roles + GoW Kids (run /syncroles to ensure the roles exist).`;
        summary += `\n💬 market/main-chat open to registered members only (clan roles + GoW Kids).`;
        summary += `\n\nℹ️ On the next restart the bot rebuilds the claim channels with fresh panels.`;
        summary += `\n👤 Executed by: ${interaction.user.tag}\n🕐 ${new Date().toLocaleString('en-US')}`;
        try {
            await interaction.followUp({ content: summary, flags: 64 }).catch(() => {});
        } catch (e) {
            console.error('❌ [Setup] Failed to send summary:', e);
        }

        logEvent(`🏗️ SUPER ADMIN ${interaction.user.tag} (${interaction.user.id}) SETUP — created ${createdCategories} categories, ${createdChannels} channels, ${panelsSent} panels`);
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
        // manualforce = permanent — try the clan role, fall back to the temp role
        const assigned = await assignClanRole(targetMember, db, logEvent);
        if (!assigned) {
            await assignTempRole(targetMember, db, saveLocalStorage, logEvent);
        }

        logEvent(`👑 Admin ${interaction.user.tag} force-registered ${cached.targetId} as ${cached.nickname} (permanent — no ranking check)`);

        return interaction.update({
            content: getMsg('ranking.responses.manualforce.success', { username: cached.targetName, nickname: cached.nickname }),
            components: []
        }).catch(() => {});
    }

    return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(() => {});
}
