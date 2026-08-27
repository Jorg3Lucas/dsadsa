import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    WORLD_IDS,
    confirmationCache,
    pendingRegistrations,
    pendingPilotApprovals,
    adminChannelId,
    WELCOME_PANEL_MESSAGE,
    SUPER_ADMIN_USER_ID,
    MAX_NICKNAME_SUGGESTIONS,
    MEMBER_ROLE_ID,
    DISCORD_SERVER_ID,
    ensureConfig
} from '../core/ranking-constants.js';
import { getLocalRankingCache, getRankingCacheUpdatedAt } from '../core/ranking-cache.js';
import { lookupNickname, lookupTopNicknames } from '../core/ranking-service.js';
import { runDailySynchronization, getOutOfAlliedGraceStatus } from '../core/ranking-sync-engine.js';
import { findOwnerCandidates } from './ranking-pilot.js';
import { buildWelcomePanelComponents } from './ranking-welcome.js';
import { deferReplySafe, deferUpdateSafe } from '../core/interaction-utils.js';
import { buildUserListPage } from './ranking-management.js';

// ==========================================
// 🎯 SLASH COMMAND HANDLERS
// ==========================================
// Extracted from ranking-handlers.js

// Helper: build a nickname select menu for manualregister
function buildManualNicknameSelect(userId, typedNick, topSuggestions, hasSuggestions) {
    if (!hasSuggestions) return null;

    const selectOptions = [
        new StringSelectMenuOptionBuilder()
            .setLabel(`📝 As typed: ${typedNick.substring(0, 80)}`)
            .setValue(typedNick)
            .setDescription('Use the nickname exactly as typed')
            .setDefault(true),
        ...topSuggestions
            .filter(s => s.nickname.toLowerCase() !== typedNick.toLowerCase())
            .slice(0, MAX_NICKNAME_SUGGESTIONS)
            .map(s => new StringSelectMenuOptionBuilder()
                .setLabel(`🔍 ${s.nickname.substring(0, 80)} (${s.serverName})`)
                .setValue(s.nickname)
                .setDescription(s.inAlliedClan ? `✅ Allied clan - ${s.clanName}` : `❌ Not allied - ${s.clanName}`)
            )
    ];

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_manual_nickname_${userId}`)
            .setPlaceholder('Select which nickname to save (optional)')
            .addOptions(selectOptions)
    );
}

// Helper: build a nickname correction dropdown for /pending (owner registrations)
function buildPendingNicknameSelect(userId, typedNick, topSuggestions, defaultNick) {
    const selectOptions = [
        new StringSelectMenuOptionBuilder()
            .setLabel(`📝 Keep as typed: ${typedNick.substring(0, 80)}`)
            .setValue(typedNick)
            .setDescription('Use the nickname exactly as submitted')
            .setDefault(!defaultNick || defaultNick === typedNick),
        ...topSuggestions
            .filter(s => s.nickname.toLowerCase() !== typedNick.toLowerCase())
            .slice(0, MAX_NICKNAME_SUGGESTIONS)
            .map(s => new StringSelectMenuOptionBuilder()
                .setLabel(`🔍 ${s.nickname.substring(0, 80)} (${s.serverName})`)
                .setValue(s.nickname)
                .setDescription(s.inAlliedClan ? `✅ Allied clan - ${s.clanName}` : `❌ Not allied - ${s.clanName}`)
                .setDefault(!!defaultNick && s.nickname === defaultNick)
            )
    ];

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_pending_nickname_${userId}`)
            .setPlaceholder('🔍 Choose the correct nickname')
            .addOptions(selectOptions)
    );
}

// Helper: build an owner-correction dropdown for /pending (pilot approvals)
function buildPendingPilotOwnerSelect(pilotId, typedOwnerNick, candidates, currentOwnerId) {
    const selectOptions = [
        new StringSelectMenuOptionBuilder()
            .setLabel(`📝 Keep as typed: ${typedOwnerNick.substring(0, 80)}`)
            .setValue('keep')
            .setDescription('Keep the owner as currently registered')
            .setDefault(!candidates.some(c => c.id === currentOwnerId)),
        ...candidates.slice(0, MAX_NICKNAME_SUGGESTIONS).map(c => new StringSelectMenuOptionBuilder()
            .setLabel(`🔍 ${c.nickname.substring(0, 80)}`)
            .setValue(c.id)
            .setDescription(`Similarity ${Math.round(c.score * 100)}%`)
            .setDefault(c.id === currentOwnerId)
        )
    ];

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`select_pending_pilot_owner_${pilotId}`)
            .setPlaceholder('🔍 Choose the correct owner')
            .addOptions(selectOptions)
    );
}

export async function handleRankingCommand(interaction, db, saveLocalStorage, logEvent) {
    const { commandName, options, user, guild } = interaction;

    // ── removepilot ──
    if (commandName === 'removepilot') {
        // Defer immediately: we fetch guild members below, which can exceed Discord's 3s reply window
        if (!await deferReplySafe(interaction)) return;

        const userProfile = db.users[user.id];
        const isActuallyRegistered = userProfile && (userProfile.registeredAt || userProfile.manual === true);

        if (!isActuallyRegistered || !userProfile.pilotIds || userProfile.pilotIds.length === 0) {
            return interaction.editReply({ content: getMsg('ranking.responses.removepilot.noPilots') });
        }

        // Fetch all pilots concurrently to build the menu (independent lookups).
        const menuOptions = await Promise.all(userProfile.pilotIds.map(async (pilotId) => {
            const memberObj = await guild.members.fetch(pilotId).catch(() => null);
            const pilotTag = memberObj ? memberObj.user.tag : `Disconnected User (${pilotId})`;
            const pilotNick = memberObj ? (memberObj.nickname || memberObj.user.username) : 'Unknown';

            return {
                label: pilotTag,
                description: `${pilotNick} - ${getMsg('ranking.responses.removepilot.optionDescription')}`,
                value: pilotId
            };
        }));

        const pilotMenu = new StringSelectMenuBuilder()
            .setCustomId('select_pilot_to_remove')
            .setPlaceholder(getMsg('ranking.responses.removepilot.menuPlaceholder'))
            .addOptions(menuOptions);

        const row = new ActionRowBuilder().addComponents(pilotMenu);

        return interaction.editReply({
            content: getMsg('ranking.responses.removepilot.menuContent'),
            components: [row]
        });
    }

    // ── forcesync ──
    if (commandName === 'forcesync') {
        if (!await deferReplySafe(interaction)) return;
        logEvent(getMsg('ranking.responses.forcesync.log', { tag: user.tag }));
        const ran = await runDailySynchronization(interaction.client, db, saveLocalStorage, logEvent, true);

        if (!ran) {
            return interaction.editReply('⏳ **Sincronização não executada.**\n\nOutro sync (startup, cron ou outro comando) já está em andamento, ou o servidor não está disponível. Espere o sync atual terminar e tente novamente — rodar dois syncs ao mesmo tempo fazia o bot travar e parar de responder.');
        }

        let responseMsg = getMsg('ranking.responses.forcesync.success') || '✅ **Force sync completed!**';

        return interaction.editReply(responseMsg);
    }

    // ── resetgrace ──
    if (commandName === 'resetgrace') {
        if (!await deferReplySafe(interaction)) return;

        const guild = interaction.client.guilds.cache.get(DISCORD_SERVER_ID);
        if (!guild) {
            return interaction.editReply('❌ Servidor não encontrado.');
        }

        // 1. Force-expire all grace timers by setting outOfAlliedSince to >72h ago.
        //    This makes getOutOfAlliedGraceStatus() return { expired: true } so the
        //    next sync removes the role from everyone in grace.
        const EXPIRED_TIME = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
        let graceTimersExpired = 0;
        if (db.roleNotify) {
            for (const [memberId, flags] of Object.entries(db.roleNotify)) {
                if (flags && flags.outOfAlliedSince) {
                    flags.outOfAlliedSince = EXPIRED_TIME;
                    graceTimersExpired++;
                }
            }
        }
        saveLocalStorage();

        // 2. Immediately remove MEMBER_ROLE from members who have an active grace timer
        //    (they are outside an allied clan, so the role should go)
        let rolesRemoved = 0;
        let rolesFailed = 0;
        await guild.members.fetch();
        const graceMemberIds = new Set();
        for (const [memberId, flags] of Object.entries(db.roleNotify || {})) {
            if (flags && flags.outOfAlliedSince) graceMemberIds.add(memberId);
        }
        for (const [memberId, member] of guild.members.cache) {
            if (member.user.bot) continue;
            if (member.roles.cache.has(MEMBER_ROLE_ID) && graceMemberIds.has(memberId)) {
                try {
                    await member.roles.remove(MEMBER_ROLE_ID);
                    rolesRemoved++;
                } catch {
                    rolesFailed++;
                }
            }
        }

        logEvent(`🔄 [ResetGrace] Admin ${user.tag} force-expired ${graceTimersExpired} grace timer(s) and removed role from ${rolesRemoved} member(s) (${rolesFailed} failed)`);

        return interaction.editReply(
            `🔄 **Grace Reset + Role Removal**\n\n` +
            `⏱️ **${graceTimersExpired}** timer(s) de grace expirados\n` +
            `🚫 **${rolesRemoved}** membro(s) perderam o cargo` +
            (rolesFailed > 0 ? `\n⚠️ **${rolesFailed}** falha(s) ao remover cargo` : '') +
            `\n\nO sync vai limpar os registros de grace expirados automaticamente.`
        );
    }

    // ── manualregister ──
    if (commandName === 'manualregister') {
        // Defer immediately: the ranking-cache lookups below can take several seconds
        if (!await deferReplySafe(interaction)) return;

        const targetMember = options.getMember('member');
        const nickname = options.getString('nickname').trim().normalize('NFC');

        const lookup = lookupNickname(nickname, db);
        // Reuse the fuzzy pool lookupNickname already computed (exact-miss path)
        // so the suggestion dropdown doesn't re-scan the ranking.
        const topSuggestions = lookupTopNicknames(nickname, db, null, MAX_NICKNAME_SUGGESTIONS, lookup.fuzzyCandidates);
        const hasSuggestions = topSuggestions.some(s => s.nickname.toLowerCase() !== nickname.toLowerCase());

        if (lookup.found) {
            const statusLine = lookup.inAlliedClan
                ? `🌍 Server: **${lookup.serverName}** — ✅ Allied clan`
                : `🌍 Server: **${lookup.serverName}** (${lookup.clanName}) — ⏳ Will be temporary (3 days)`;

            if (!lookup.exactMatch && lookup.fuzzySuggestion) {
                logEvent(`👑 Admin ${interaction.user.tag} — fuzzy corrected "${nickname}" → "${lookup.fuzzySuggestion}" in /manualregister`);
            }

            const fuzzyManualNote = !lookup.exactMatch && lookup.fuzzySuggestion
                ? `\n🔍 **Fuzzy match:** "${nickname}" → "${lookup.fuzzySuggestion}"`
                : '';

            // Build nickname components
            const nicknameRow = buildManualNicknameSelect(user.id, nickname, topSuggestions, hasSuggestions);

            confirmationCache[`${user.id}-manualregister`] = {
                targetId: targetMember.id,
                nickname: nickname,
                clan: lookup.clanName,
                worldId: lookup.worldId,
                needsTempApproval: !lookup.inAlliedClan,
                selectedNickname: nickname
            };

            return interaction.editReply({
                content: getMsg('ranking.responses.manualregister.confirm', { nickname: lookup.nickname, clan: lookup.clanName, username: targetMember.displayName }) + `\n${statusLine}${fuzzyManualNote}${hasSuggestions ? '\n\n📌 Use the **dropdown below** to select a different nickname before confirming.' : ''}`,
                components: [
                    ...(nicknameRow ? [nicknameRow] : []),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm-manualregister-yes').setLabel('✅ Yes, register').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('confirm-manualregister-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        // Not found in ranking — check if there are suggestions anyway
        if (hasSuggestions) {
            const nicknameRow = buildManualNicknameSelect(user.id, nickname, topSuggestions, hasSuggestions);

            confirmationCache[`${user.id}-manualregister`] = {
                targetId: targetMember.id,
                nickname: nickname,
                clan: '',
                worldId: '',
                needsTempApproval: true,
                selectedNickname: nickname
            };

            return interaction.editReply({
                content: `❌ **"${nickname}" not found in ranking.**\n\nHowever, there are similar nicknames available. Select one from the dropdown below and confirm to register as temporary (3 days).${hasSuggestions ? '\n\n📌 Use the **dropdown below** to select a different nickname before confirming.' : ''}`,
                components: [
                    ...(nicknameRow ? [nicknameRow] : []),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm-manualregister-yes').setLabel('✅ Yes, register').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('confirm-manualregister-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        // Not found in ranking — ask for confirmation before registering as temporary (3 days)
        confirmationCache[`${user.id}-manualregister`] = {
            targetId: targetMember.id,
            nickname: nickname,
            clan: '',
            worldId: '',
            needsTempApproval: true,
            selectedNickname: nickname
        };

        return interaction.editReply({
            content: `❌ **"${nickname}" not found in ranking.** Register as temporary (3 days) anyway? The user will be converted to permanent once found in an allied clan during daily sync.`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-manualregister-yes').setLabel('✅ Yes, register').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('confirm-manualregister-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                )
            ]
        });
    }

    // ── manualpilot ──
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

    // ── manualremovepilot ──
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

    // ── manage (/manage slash command) ──
    if (commandName === 'manage') {
        const { content, components, count } = buildUserListPage(db, 0, { withAlliedButton: true });
        if (count === 0) {
            return interaction.reply({ content: getMsg('ranking.responses.manage.noUsers'), flags: 64 });
        }
        return interaction.reply({ content, components, flags: 64 });
    }

    // ── manualremove ──
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

    // ── manualforce ──
    if (commandName === 'manualforce') {
        const targetMember = options.getMember('member');
        const nickname = options.getString('nickname').trim().normalize('NFC');

        confirmationCache[`${user.id}-manualforce`] = {
            targetId: targetMember.id,
            targetName: targetMember.displayName,
            nickname: nickname
        };

        return interaction.reply({
            content: getMsg('ranking.responses.manualforce.confirm', { username: targetMember.displayName, nickname: nickname }),
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-manualforce-yes').setLabel('✅ Yes, force register').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('confirm-manualforce-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64
        });
    }

    // ── sendpanel ──
    if (commandName === 'sendpanel') {
        if (!await deferReplySafe(interaction)) return;

        const panelMessage = await interaction.channel.send({ content: WELCOME_PANEL_MESSAGE, components: buildWelcomePanelComponents() });

        ensureConfig(db);
        db.config.panelChannelId = interaction.channelId;
        db.config.panelMessageId = panelMessage.id;
        saveLocalStorage();

        logEvent(`📋 Admin ${interaction.user.tag} sent registration panel in #${interaction.channel.name}`);
        return interaction.editReply('✅ **Registration panel sent!**');
    }

    // ── pending ──
    if (commandName === 'pending') {
        if (!await deferReplySafe(interaction)) return;

        const ownerEntries = Object.entries(pendingRegistrations);
        const pilotEntries = Object.entries(pendingPilotApprovals);

        if (ownerEntries.length === 0 && pilotEntries.length === 0) {
            return interaction.editReply('✅ **No pending registration requests.**');
        }

        let report = `⏳ **Pending Registrations**\n\n`;
        const rankingCache = getLocalRankingCache();
        let panelsRestored = 0;
        // Dropdowns to correct nicknames via fuzzy suggestions (Discord allows max 5 action rows)
        const fuzzySelectRows = [];

        // Resolve all pending users CONCURRENTLY (pure reads — no rate-limit
        // risk on GETs). The loops below only consume these maps; the admin
        // channel sends stay serial inside the loop to respect write limits.
        const ownerMemberById = new Map();
        const pilotMemberById = new Map();
        await Promise.all([
            ...ownerEntries.map(async ([userId]) => {
                ownerMemberById.set(userId, await guild.members.fetch(userId).catch(() => null));
            }),
            ...pilotEntries.map(async ([pilotId]) => {
                pilotMemberById.set(pilotId, await guild.members.fetch(pilotId).catch(() => null));
            })
        ]);

        // ── Owner registrations ──
        if (ownerEntries.length > 0) {
            report += `👑 **Owner Registrations (${ownerEntries.length})**\n`;
            for (const [userId, pending] of ownerEntries) {
                const member = ownerMemberById.get(userId);
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

                if (pending.selectedNickname && pending.selectedNickname !== pending.nickname) {
                    line += `   ✅ **Selected:** "${pending.selectedNickname}"\n`;
                }

                const lookup = lookupNickname(pending.nickname, db, rankingCache);
                if (lookup.fuzzySuggestion) {
                    line += `   🔍 **Fuzzy suggestion:** "${pending.nickname}" → "${lookup.fuzzySuggestion}" (${lookup.serverName})\n`;
                }

                report += line;

                // Offer a dropdown to correct the nickname when fuzzy suggestions exist
                if (fuzzySelectRows.length < 5) {
                    // Reuse the fuzzy pool lookupNickname already computed
                    // (exact-miss path) instead of re-scanning the ranking.
                    const topSuggestions = lookupTopNicknames(pending.nickname, db, rankingCache, MAX_NICKNAME_SUGGESTIONS, lookup.fuzzyCandidates);
                    const hasFuzzyOptions = topSuggestions.some(s => s.nickname.toLowerCase() !== pending.nickname.toLowerCase());
                    if (hasFuzzyOptions) {
                        fuzzySelectRows.push(buildPendingNicknameSelect(userId, pending.nickname, topSuggestions, pending.selectedNickname));
                    }
                }

                // Re-send admin panel
                if (adminChannelId) {
                    const adminChannel = interaction.guild.channels.cache.get(adminChannelId);
                    if (adminChannel) {
                        let rankingStatus = '❌ Not found in ranking';
                        let alliedClanStatus = '❌ Not in allied clan';
                        let fuzzyNote = '';

                        if (lookup.found) {
                            rankingStatus = `✅ Found — ${lookup.serverName} (${lookup.clanName})`;
                            if (!lookup.exactMatch && lookup.fuzzySuggestion) {
                                fuzzyNote = `\n🔍 **Fuzzy match:** "${pending.nickname}" → "${lookup.fuzzySuggestion}"`;
                            }
                            if (lookup.inAlliedClan) {
                                alliedClanStatus = '✅ Yes — Allied clan';
                            }
                        }

                        const isMissingRankingOrAllied = !lookup.found || !lookup.inAlliedClan;

                        const displayNick = pending.selectedNickname || pending.nickname;
                        const selectedNote = pending.selectedNickname && pending.selectedNickname !== pending.nickname
                            ? `\n✅ **Corrected by admin:** "${pending.nickname}" → "${pending.selectedNickname}"`
                            : '';

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
                                content: `👑 **New Owner Registration (re-sent by /pending)**\n\n👤 **User:** ${member ? member.toString() : `<@${userId}>`} (${member ? member.user.tag : userId})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${displayNick}${selectedNote}\n🔍 **Ranking:** ${rankingStatus}${fuzzyNote}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`,
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

            for (const [pilotId, pending] of pilotEntries) {
                const pilotMember = pilotMemberById.get(pilotId);
                const pilotTag = pilotMember ? pilotMember.toString() : `<@${pilotId}>`;
                const hoursLeft = pending.timestamp
                    ? ((Date.now() - pending.timestamp) / (1000 * 60 * 60)).toFixed(1)
                    : '?';
                const expiresIn = pending.timestamp
                    ? `${Math.max(0, 24 - hoursLeft).toFixed(1)}h`
                    : 'Unknown';

                const ownerMatch = Object.entries(db.users || {}).find(([id, data]) =>
                    data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === pending.ownerNick.toLowerCase()
                );

                let line = `\n${pilotTag} → Owner **${pending.ownerNick}**\n`;
                line += `   ⏰ Expires in: ${expiresIn}\n`;

                if (pending.originalOwnerNick && pending.originalOwnerNick !== pending.ownerNick) {
                    line += `   ✅ **Owner corrected:** "${pending.originalOwnerNick}" → "${pending.ownerNick}"\n`;
                }

                const ownerCandidates = !ownerMatch ? findOwnerCandidates(pending.ownerNick, db, MAX_NICKNAME_SUGGESTIONS) : [];
                if (!ownerMatch && ownerCandidates.length > 0) {
                    line += `   🔍 **Fuzzy suggestion:** owner "${pending.ownerNick}" → "${ownerCandidates[0].nickname}"\n`;
                }

                report += line;

                // Offer a dropdown to correct the owner when they aren't found (Discord allows max 5 action rows total)
                if (!ownerMatch && ownerCandidates.length > 0 && fuzzySelectRows.length < 5) {
                    fuzzySelectRows.push(buildPendingPilotOwnerSelect(pilotId, pending.ownerNick, ownerCandidates, pending.ownerId));
                }
            }
        }

        if (panelsRestored > 0) {
            report += `\n📤 **Re-sent ${panelsRestored} admin panel(s) for review.**`;
        }

        if (report.length > 1900) {
            report = report.substring(0, 1900) + '\n\n... (truncated)';
        }

        logEvent(`📋 Admin ${interaction.user.tag} checked pending requests (${ownerEntries.length} owners, ${pilotEntries.length} pilots, ${panelsRestored} panels restored)`);
        return interaction.editReply({
            content: report,
            components: fuzzySelectRows
        });
    }

    // ── stats ──
    if (commandName === 'stats') {
        if (!await deferReplySafe(interaction)) return;

        // Count owners (registered users who are not pilots of someone else)
        const pilotIdSet = new Set();
        for (const [, data] of Object.entries(db.users || {})) {
            if (data.pilotIds && data.pilotIds.length > 0) {
                for (const pid of data.pilotIds) {
                    pilotIdSet.add(pid);
                }
            }
        }

        const totalUsers = Object.keys(db.users || {}).length;
        const totalPilots = pilotIdSet.size;
        const totalOwners = totalUsers - totalPilots;
        const totalTemp = Object.values(db.users || {}).filter(u => u.tempUntil).length;

        // Count temps expiring within 24h
        const now = Date.now();
        const expiringSoon = Object.values(db.users || {}).filter(u => {
            if (!u.tempUntil) return false;
            const hoursLeft = (new Date(u.tempUntil).getTime() - now) / (1000 * 60 * 60);
            return hoursLeft > 0 && hoursLeft <= 24;
        }).length;

        // Pending
        const pendingOwners = Object.keys(pendingRegistrations).length;
        const pendingPilots = Object.keys(pendingPilotApprovals).length;

        // Ranking cache stats — served from the in-memory cache. The previous
        // code re-read and re-parsed the whole ~76k-player file on every /stats;
        // getLocalRankingCache() returns the same in-memory reference instead.
        const rankingCache = getLocalRankingCache();
        const cacheUpdatedAt = getRankingCacheUpdatedAt();
        let lastSync = '❌ Nunca sincronizado';
        let worldsInCache = 0;
        let playersInCache = 0;

        if (rankingCache) {
            if (cacheUpdatedAt) {
                const syncDate = new Date(cacheUpdatedAt);
                const hoursAgo = Math.floor((now - syncDate.getTime()) / (1000 * 60 * 60));
                const minsAgo = Math.floor((now - syncDate.getTime()) / (1000 * 60));
                if (hoursAgo < 1) {
                    lastSync = `🟢 ${minsAgo} min atrás`;
                } else if (hoursAgo < 24) {
                    lastSync = `🟡 ${hoursAgo}h atrás`;
                } else {
                    lastSync = `🔴 ${Math.floor(hoursAgo / 24)}d atrás`;
                }
            }
            worldsInCache = Object.keys(rankingCache).length;
            playersInCache = Object.values(rankingCache).reduce((sum, w) => sum + (w ? Object.keys(w).length : 0), 0);
        }

        // Allied clans
        const alliedClans = db.config?.alliedClans || {};
        const totalAlliedClans = Object.values(alliedClans).reduce((sum, clans) => sum + (clans ? clans.length : 0), 0);
        const alliedWorlds = Object.keys(alliedClans).length;

        // Pre-registrations
        const preRegs = db.preRegistrations ? Object.keys(db.preRegistrations).length : 0;

        const report = `📊 **Bot Statistics**

` +
            `━━━━━━━━━━━━━━━━━━━━━━
` +
            `👥 **Registrations**
` +
            `   👑 Owners: **${totalOwners}**
` +
            `   ✈️ Pilots: **${totalPilots}**
` +
            `   📦 Total: **${totalUsers}**
` +
            `   ⏳ Temporary: **${totalTemp}** (${expiringSoon} expiring < 24h)
` +
            `   ⏳ Pre-registrations: **${preRegs}**

` +
            `⏰ **Pending Approvals**
` +
            `   👑 Owners: **${pendingOwners}**
` +
            `   ✈️ Pilots: **${pendingPilots}**

` +
            `🌍 **Ranking Cache**
` +
            `   🗺️ Worlds: **${worldsInCache}**
` +
            `   👤 Players: **${playersInCache.toLocaleString()}**
` +
            `   🕐 Last sync: ${lastSync}

` +
            `🤝 **Allied Clans**
` +
            `   🗺️ Worlds: **${alliedWorlds}**
` +
            `   🏰 Clans: **${totalAlliedClans}**
` +
            `━━━━━━━━━━━━━━━━━━━━━━`;

        logEvent(`📊 ${interaction.user.tag} requested bot stats`);
        return interaction.editReply(report);
    }

    // ── grace ──
    if (commandName === 'grace') {
        if (!await deferReplySafe(interaction)) return;

        const graceEnabled = db.config?.graceEnabled !== false; // default: enabled
        const graceStatusLine = graceEnabled
            ? '✅ **Grace: ENABLED** (members have 72h before role removal)'
            : '🔓 **Grace: DISABLED** (members lose role immediately on next sync)';

        const targetOption = options.getMember('member') || options.getUser('member');

        // ── Single-member lookup ──
        if (targetOption) {
            const memberId = targetOption.id;
            const userData = db.users[memberId];
            const grace = getOutOfAlliedGraceStatus(db, memberId);
            const displayName = targetOption.displayName || targetOption.user?.username || targetOption.tag || targetOption.username || `<@${memberId}>`;
            const nicknameLine = userData?.nickname ? `\n📝 **Nickname:** ${userData.nickname}` : '';

            if (!grace.started) {
                return interaction.editReply(`⏳ **Grace Status — ${displayName}**${nicknameLine}\n\n${graceStatusLine}\n\n✅ **No active grace period.** This member is currently in an allied clan (or was never detected outside one).`);
            }

            const since = db.roleNotify?.[memberId]?.outOfAlliedSince;
            const startedLine = since ? `\n🕐 **Started:** ${new Date(since).toLocaleString()}` : '';

            if (grace.expired) {
                return interaction.editReply(`⏳ **Grace Status — ${displayName}**${nicknameLine}${startedLine}\n\n${graceStatusLine}\n\n❌ **Grace EXPIRED** — their role can be removed on the next sync.`);
            }

            return interaction.editReply(`⏳ **Grace Status — ${displayName}**${nicknameLine}${startedLine}\n\n${graceStatusLine}\n\n🟢 **${grace.hoursLeft}h remaining** of the 72h grace period.\n\n⚠️ Their role will be removed if they don't rejoin an allied clan before the deadline.`);
        }

        // ── Full report: all members with an active grace timer ──
        const graceEntries = [];
        for (const [memberId, flags] of Object.entries(db.roleNotify || {})) {
            if (!flags || !flags.outOfAlliedSince) continue;
            const status = getOutOfAlliedGraceStatus(db, memberId);
            graceEntries.push({ memberId, status, since: flags.outOfAlliedSince });
        }

        if (graceEntries.length === 0) {
            return interaction.editReply(`⏳ **72h Grace Period Status**\n\n${graceStatusLine}\n\n✅ **No members currently in the 72h grace period.** Everyone is in an allied clan (or has no active out-of-allied timer).`);
        }

        // Resolve display names concurrently (pure reads — no rate-limit risk on GETs).
        // Cap the fetches: the ~1900-char report only renders a few dozen rows, so
        // fetching more than FETCH_CAP members wastes GET requests on data the
        // truncated report would never display. Unfetched members fall back to a
        // plain mention below.
        const FETCH_CAP = 100;
        const fetchList = graceEntries.slice(0, FETCH_CAP);
        const memberById = new Map();
        await Promise.all(fetchList.map(async ({ memberId }) => {
            memberById.set(memberId, await guild.members.fetch(memberId).catch(() => null));
        }));

        const inGrace = graceEntries.filter(({ status }) => !status.expired)
            .sort((a, b) => a.status.hoursLeft - b.status.hoursLeft); // most urgent first
        const expired = graceEntries.filter(({ status }) => status.expired);

        let report = `⏳ **72h Grace Period Status**\n\n${graceStatusLine}\n\n`;

        if (inGrace.length > 0) {
            report += `🟢 **In grace (${inGrace.length})**\n`;
            for (const { memberId, status } of inGrace) {
                const member = memberById.get(memberId);
                const tag = member ? member.toString() : `<@${memberId}>`;
                const nick = db.users[memberId]?.nickname ? ` — **${db.users[memberId].nickname}**` : '';
                report += `• ${tag}${nick} — ⏳ ${status.hoursLeft}h left\n`;
            }
            report += '\n';
        }

        if (expired.length > 0) {
            report += `🔴 **Grace expired (${expired.length})**\n`;
            for (const { memberId, since } of expired) {
                const member = memberById.get(memberId);
                const tag = member ? member.toString() : `<@${memberId}>`;
                const nick = db.users[memberId]?.nickname ? ` — **${db.users[memberId].nickname}**` : '';
                const sinceLine = since ? ` — since ${new Date(since).toLocaleDateString()}` : '';
                report += `• ${tag}${nick} — ❌ role can be removed${sinceLine}\n`;
            }
            report += '\n';
        }

        report += `━━━━━━━━━━━━━━━━━━━━━━\nℹ️ Members keep their role for **72h** after leaving an allied clan; the timer resets when they return.`;

        if (report.length > 1900) {
            report = report.substring(0, 1900) + '\n\n... (truncated)';
        }

        logEvent(`⏳ Admin ${interaction.user.tag} checked 72h grace status (${graceEntries.length} members)`);
        return interaction.editReply(report);
    }

    // ── restorebackup ──
    if (commandName === 'restorebackup') {
        // Super admin only
        if (user.id !== SUPER_ADMIN_USER_ID) {
            return interaction.reply({ content: '❌ **Access denied.** Only the super admin can use this command.', flags: 64 });
        }

        if (!await deferReplySafe(interaction)) return;

        const fs = await import('node:fs');
        const BACKUP_DIR = './backups';
        const DB_RANKING_PATH = './database_ranking.json';

        try {
            if (!fs.existsSync(BACKUP_DIR)) {
                return interaction.editReply('❌ **No backup directory found.** No backups available to restore.');
            }

            const backupFiles = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith('database_ranking_') && f.endsWith('.json'))
                .sort()
                .reverse();

            if (backupFiles.length === 0) {
                return interaction.editReply('❌ **No database backups found** in ./backups/');
            }

            // Store in confirmation cache
            confirmationCache[`${user.id}-restorebackup`] = {
                backups: backupFiles,
                timestamp: Date.now()
            };

            // Build backup list
            let report = '💾 **Available Database Backups**\n\n';
            report += `📁 Found: **${backupFiles.length}** backup(s)\n\n`;

            const selectOptions = backupFiles.slice(0, 25).map((file, i) => {
                const stats = fs.statSync(`${BACKUP_DIR}/${file}`);
                const ageMs = Date.now() - stats.mtimeMs;
                const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
                const ageDays = Math.floor(ageHours / 24);
                const sizeKB = (stats.size / 1024).toFixed(1);

                // Extract timestamp from filename
                const timestamp = file.replace('database_ranking_', '').replace('.json', '');

                let ageStr;
                if (ageHours < 1) {
                    ageStr = `${Math.floor(ageMs / (1000 * 60))}min ago`;
                } else if (ageHours < 24) {
                    ageStr = `${ageHours}h ago`;
                } else {
                    ageStr = `${ageDays}d ago`;
                }

                return {
                    label: `Backup #${i + 1} (${ageStr})`,
                    description: `${sizeKB} KB - ${timestamp.substring(0, 19)}`,
                    value: file
                };
            });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('restorebackup_select')
                .setPlaceholder('Select a backup to restore...')
                .addOptions(selectOptions);

            const components = [
                new ActionRowBuilder().addComponents(selectMenu),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('restorebackup-cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary)
                )
            ];

            logEvent(`💾 ${user.tag} opened /restorebackup (${backupFiles.length} backups available)`);
            return interaction.editReply({ content: report, components });

        } catch (e) {
            return interaction.editReply(`❌ **Error listing backups:** ${e.message}`);
        }
    }

    // ── autoregister ──
    if (commandName === 'autoregister') {
        if (!await deferReplySafe(interaction)) return;

        const targetChannel = options.getChannel('channel');
        if (!targetChannel) {
            return interaction.editReply('❌ Channel not found.');
        }

        // Check if ranking cache exists
        const cache = getLocalRankingCache();
        if (!cache || Object.keys(cache).length === 0) {
            return interaction.editReply('❌ **Ranking cache not available.** Run /forcesync first to build the cache.');
        }

        // Fetch all members
        await guild.members.fetch();

        // Get members with access to the target channel
        const membersWithAccess = [];
        for (const [, member] of guild.members.cache) {
            try {
                const permissions = targetChannel.permissionsFor(member);
                if (permissions && permissions.has(PermissionFlagsBits.ViewChannel)) {
                    membersWithAccess.push(member);
                }
            } catch (e) {}
        }

        const registered = [];
        const skipped = [];
        const notFound = [];

        for (const member of membersWithAccess) {
            // Skip members who already have the role
            if (member.roles.cache.has(MEMBER_ROLE_ID)) continue;

            const nickname = member.nickname || member.user.username;

            // Extract game nickname from Discord nickname
            let gameNickname = nickname;
            let serverCode = null;

            // Remove " - Pilot" suffix
            gameNickname = gameNickname.replace(/\s*-\s*Pilot$/i, '').trim();
            // Remove "* " prefix
            gameNickname = gameNickname.replace(/^\*\s+/, '').trim();
            // Remove "Name: " prefix
            gameNickname = gameNickname.replace(/^Name:\s*/i, '').trim();

            // Try "ServerCode - GameName" or "ServerCode | GameName"
            const serverMatch = gameNickname.match(/^(EU|SA|NA|ASIA|BASIA|BNA|BEU|BSA|BINMENA|INMENA)(\d{3})\s*[-|]\s*(.+)$/i);
            if (serverMatch) {
                serverCode = serverMatch[1].toUpperCase() + serverMatch[2];
                gameNickname = serverMatch[3].trim();
            } else {
                // Try without separator
                const serverMatch2 = gameNickname.match(/^(EU|SA|NA|ASIA|BASIA|BNA|BEU|BSA|BINMENA|INMENA)(\d{3})\s+(.+)$/i);
                if (serverMatch2) {
                    serverCode = serverMatch2[1].toUpperCase() + serverMatch2[2];
                    gameNickname = serverMatch2[3].trim();
                }
            }

            // Look up in ranking cache
            const lookup = lookupNickname(gameNickname, db, cache);

            if (lookup.found && lookup.inAlliedClan) {
                // Register: save to db and add role
                db.users[member.id] = {
                    nickname: lookup.nickname,
                    registeredAt: new Date().toISOString(),
                    serverName: lookup.serverName,
                    clanName: lookup.clanName,
                    worldId: lookup.worldId,
                    pilotIds: []
                };
                await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                saveLocalStorage(db);
                registered.push({
                    username: member.user.username,
                    nickname: lookup.nickname,
                    server: lookup.serverName,
                    clan: lookup.clanName
                });
                logEvent(`🎯 Auto-registered ${member.user.tag} → ${lookup.nickname} (${lookup.clanName} @ ${lookup.serverName})`);
            } else if (lookup.found && !lookup.inAlliedClan) {
                skipped.push({
                    username: member.user.username,
                    nickname: lookup.nickname,
                    reason: `Not allied (${lookup.clanName})`
                });
            } else {
                notFound.push({
                    username: member.user.username,
                    discordNickname: nickname,
                    extracted: gameNickname
                });
            }
        }

        // Build response
        let response = `🎯 **Auto-Register Results** — Channel: ${targetChannel}\n\n`;
        response += `📋 Scanned: ${membersWithAccess.length} members with access\n\n`;

        if (registered.length > 0) {
            response += `✅ **Registered (${registered.length}):**\n`;
            for (const r of registered) {
                response += `   • ${r.username} → ${r.nickname} (${r.clan} @ ${r.server})\n`;
            }
            response += '\n';
        }

        if (skipped.length > 0) {
            response += `⏳ **Skipped - not allied (${skipped.length}):**\n`;
            for (const s of skipped) {
                response += `   • ${s.username} → ${s.nickname} — ${s.reason}\n`;
            }
            response += '\n';
        }

        if (notFound.length > 0) {
            response += `❌ **Not found in ranking (${notFound.length}):**\n`;
            for (const n of notFound) {
                response += `   • ${n.username} (${n.extracted})\n`;
            }
        }

        if (registered.length === 0 && skipped.length === 0 && notFound.length === 0) {
            response += 'ℹ️ All members already have the role.';
        }

        return interaction.editReply({ content: response.substring(0, 2000) });
    }


    return false;
}

// ── Select Menu: Admin chooses nickname for manualregister ──
export async function handleSelectManualNickname(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferUpdateSafe(interaction)) return;

    const userId = interaction.customId.replace('select_manual_nickname_', '');
    const selectedNick = interaction.values[0];
    const cacheKey = `${userId}-manualregister`;
    const cached = confirmationCache[cacheKey];

    if (!cached) {
        await interaction.followUp({ content: '⌛ This confirmation has expired. Please run /manualregister again.', flags: 64 });
        return;
    }

    cached.selectedNickname = selectedNick;

    const originalMsg = interaction.message.content;
    const updatedContent = originalMsg.includes('📌 Selected')
        ? originalMsg.replace(/📌 Selected: .+/, `📌 Selected: **${selectedNick}**`)
        : `${originalMsg}\n📌 Selected: **${selectedNick}**`;

    await interaction.editReply({
        content: updatedContent.substring(0, 1900),
        components: interaction.message.components
    }).catch(() => {});

    logEvent(`📌 Admin selected nickname "${selectedNick}" for manualregister (was "${cached.nickname}")`);
}

// ── Select Menu: Admin corrects the nickname of a pending owner registration ──
export async function handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferUpdateSafe(interaction)) return;

    const userId = interaction.customId.replace('select_pending_nickname_', '');
    const selectedNick = interaction.values[0];
    const pending = pendingRegistrations[userId];

    if (!pending) {
        await interaction.followUp({ content: '⌛ This pending registration no longer exists. Run /pending again.', flags: 64 }).catch(() => {});
        return;
    }

    const previousNick = pending.selectedNickname || pending.nickname;
    pending.selectedNickname = selectedNick;
    saveLocalStorage();

    // Update the /pending report: replace this user's fuzzy line with the selection (anchored to avoid touching other entries)
    let updatedContent = interaction.message.content;
    const anchor = `<@${userId}> — **`;
    const anchorIdx = updatedContent.indexOf(anchor);
    if (anchorIdx !== -1) {
        const blockStart = anchorIdx;
        const blockEnd = updatedContent.indexOf('\n<@', anchorIdx + anchor.length);
        const block = blockEnd === -1 ? updatedContent.slice(blockStart) : updatedContent.slice(blockStart, blockEnd);
        const selectionLine = `   ✅ **Selected:** "${selectedNick}" (instead of "${previousNick}")\n`;
        // Drop any previous selection line first, then replace the fuzzy line (or append)
        let newBlock = block.replace(/\n {3}✅ \*\*Selected:\*\* .*\n?/, '\n');
        if (/ {3}🔍 \*\*Fuzzy suggestion:\*\* .*\n?/.test(newBlock)) {
            newBlock = newBlock.replace(/ {3}🔍 \*\*Fuzzy suggestion:\*\* .*\n?/, selectionLine);
        } else {
            newBlock = `${newBlock.replace(/\n+$/, '')}\n${selectionLine}`;
        }
        updatedContent = updatedContent.slice(0, blockStart) + newBlock + (blockEnd === -1 ? '' : updatedContent.slice(blockEnd));
    } else {
        // Fallback: append a note at the end
        updatedContent = `${updatedContent.replace(/\n+$/, '')}\n📌 **Selected for <@${userId}>:** "${selectedNick}"`;
    }

    await interaction.editReply({
        content: updatedContent.substring(0, 1900),
        components: interaction.message.components
    }).catch(() => {});

    // Keep the admin panel in sync so approval uses the corrected nickname
    if (pending.channelId && pending.messageId) {
        try {
            const channel = interaction.guild.channels.cache.get(pending.channelId);
            if (channel) {
                const panelMsg = await channel.messages.fetch(pending.messageId).catch(() => null);
                if (panelMsg) {
                    const correctedNote = previousNick !== selectedNick
                        ? ` (corrected from "${previousNick}")`
                        : '';
                    const panelContent = panelMsg.content
                        .replace(/📝 \*\*Nickname:\*\* [^\n]*/, `📝 **Nickname:** ${selectedNick}${correctedNote}`)
                        .replace(/\n✅ \*\*Corrected by admin:\*\* [^\n]*/, '');
                    await panelMsg.edit({ content: panelContent.substring(0, 1900), components: panelMsg.components }).catch(() => {});
                }
            }
        } catch {
            // best-effort: never let a panel sync failure break the selection
        }
    }

    logEvent(`✅ Admin ${interaction.user.tag} corrected pending nickname for <@${userId}>: "${pending.nickname}" → "${selectedNick}"`);
}

// ── Select Menu: Admin corrects the owner of a pending pilot approval ──
export async function handleSelectPendingPilotOwner(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferUpdateSafe(interaction)) return;

    const pilotId = interaction.customId.replace('select_pending_pilot_owner_', '');
    const selected = interaction.values[0];
    const pending = pendingPilotApprovals[pilotId];

    if (!pending) {
        await interaction.followUp({ content: '⌛ This pilot request no longer exists. Run /pending again.', flags: 64 }).catch(() => {});
        return;
    }

    const previousNick = pending.ownerNick;
    const previousOwnerId = pending.ownerId;

    if (selected !== 'keep') {
        const ownerData = db.users[selected];
        if (!ownerData) {
            await interaction.followUp({ content: '❌ That owner is no longer registered.', flags: 64 }).catch(() => {});
            return;
        }
        if (!pending.originalOwnerNick) pending.originalOwnerNick = pending.ownerNick;
        pending.ownerId = selected;
        pending.ownerNick = ownerData.nickname;
    }
    saveLocalStorage();

    // Update the /pending report: replace this pilot's fuzzy line with the correction note (anchored per-entry)
    let updatedContent = interaction.message.content;
    const anchor = `<@${pilotId}> → Owner **`;
    const anchorIdx = updatedContent.indexOf(anchor);
    if (anchorIdx !== -1) {
        const blockEnd = updatedContent.indexOf('\n<@', anchorIdx + anchor.length);
        const block = blockEnd === -1 ? updatedContent.slice(anchorIdx) : updatedContent.slice(anchorIdx, blockEnd);
        const note = selected === 'keep'
            ? `   ✅ **Owner kept as typed:** "${pending.ownerNick}"\n`
            : `   ✅ **Owner corrected:** "${pending.originalOwnerNick}" → "${pending.ownerNick}"\n`;
        // Drop any previous correction note first, then replace the fuzzy line (or append)
        let newBlock = block.replace(/\n {3}✅ \*\*Owner (corrected|kept as typed):\*\* .*\n?/, '\n');
        if (/ {3}🔍 \*\*Fuzzy suggestion:\*\* owner .*\n?/.test(newBlock)) {
            newBlock = newBlock.replace(/ {3}🔍 \*\*Fuzzy suggestion:\*\* owner .*\n?/, note);
        } else {
            newBlock = `${newBlock.replace(/\n+$/, '')}\n${note}`;
        }
        updatedContent = updatedContent.slice(0, anchorIdx) + newBlock + (blockEnd === -1 ? '' : updatedContent.slice(blockEnd));
    } else {
        // Fallback: append a note at the end
        updatedContent = `${updatedContent.replace(/\n+$/, '')}\n📌 **Owner corrected for <@${pilotId}>:** "${pending.ownerNick}"`;
    }

    await interaction.editReply({
        content: updatedContent.substring(0, 1900),
        components: interaction.message.components
    }).catch(() => {});

    // Notify the corrected owner so they can approve (best-effort)
    if (selected !== 'keep' && pending.ownerId !== previousOwnerId) {
        try {
            const ownerMember = await interaction.guild.members.fetch(pending.ownerId);
            const dmChannel = await ownerMember.createDM();
            await dmChannel.send({
                content: `✈️ **Pilot Approval**\n\n👤 **${pending.pilotTag}** wants to register as your pilot.\n📝 **Owner nickname:** ${pending.ownerNick}\n\nDo you approve this pilot?`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-yes`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-no`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
                    )
                ]
            });
            logEvent(`✈️ Admin ${interaction.user.tag} corrected owner for pilot ${pilotId}: "${previousNick}" → "${pending.ownerNick}" — DM sent to new owner`);
        } catch (err) {
            logEvent(`⚠️ Could not DM corrected owner ${pending.ownerNick} for pilot ${pilotId}: ${err.message}`);
        }
    } else {
        logEvent(`✅ Admin ${interaction.user.tag} kept owner for pilot ${pilotId}: "${previousNick}"`);
    }
}
