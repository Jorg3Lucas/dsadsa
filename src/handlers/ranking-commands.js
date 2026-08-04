import fs from 'node:fs';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    WORLD_IDS,
    confirmationCache,
    pendingRegistrations,
    pendingPilotApprovals,
    adminChannelId,
    APPROVER_ROLE_IDS,
    WELCOME_PANEL_MESSAGE,
    REGISTRATION_CHANNEL_ID,
    SUPER_ADMIN_USER_ID,
    NUKE_PROTECTED_CHANNEL_IDS,
    ensureConfig
} from '../core/ranking-constants.js';
import { getLocalRankingCache, cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';
import { lookupNickname, lookupTopNicknames } from '../core/ranking-service.js';
import { runDailySynchronization } from '../core/ranking-sync-engine.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';
import { handleScanImport, handleScanImportStatus } from './ranking-scan.js';
import { findOwnerCandidates } from './ranking-pilot.js';
import { buildWelcomePanelComponents } from './ranking-welcome.js';
import { deferReplySafe, deferUpdateSafe, editReplySafe } from '../core/interaction-utils.js';

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
            .slice(0, 2)
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
            .slice(0, 2)
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
        ...candidates.slice(0, 2).map(c => new StringSelectMenuOptionBuilder()
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

        return interaction.editReply({
            content: getMsg('ranking.responses.removepilot.menuContent'),
            components: [row]
        });
    }

    // ── forcesync ──
    if (commandName === 'forcesync') {
        if (!await deferReplySafe(interaction)) return;
        logEvent(getMsg('ranking.responses.forcesync.log', { tag: user.tag }));
        await runDailySynchronization(interaction.client, db, saveLocalStorage, logEvent, true);

        let responseMsg = getMsg('ranking.responses.forcesync.success') || '✅ **Force sync completed!**';

        return interaction.editReply(responseMsg);
    }

    // ── manualregister ──
    if (commandName === 'manualregister') {
        // Defer immediately: the ranking-cache lookups below can take several seconds
        if (!await deferReplySafe(interaction)) return;

        const targetMember = options.getMember('member');
        const nickname = options.getString('nickname').trim().normalize('NFC');

        const lookup = lookupNickname(nickname, db);
        const topSuggestions = lookupTopNicknames(nickname, db, null, 2);
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

    // ── cleandb ──
    if (commandName === 'cleandb') {
        if (!await deferReplySafe(interaction)) return;
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

    // ── manage (/manage slash command) ──
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

    // ── listunregistered ──
    if (commandName === 'listunregistered') {
        if (!await deferReplySafe(interaction)) return;

        const doNotify = options.getBoolean('notify') || false;

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

        const listLines = unregistered.map((m, i) => `${i + 1}. ${m.toString()} — ${m.user.tag}`);
        let report = `📋 **Unregistered Members — ${unregistered.length} total**\n\n`;
        report += listLines.join('\n');

        if (report.length > 1900) {
            report = `📋 **Unregistered Members — ${unregistered.length} total**\n\n`;
            report += listLines.slice(0, 30).join('\n');
            report += `\n\n... and ${unregistered.length - 30} more`;
        }

        if (doNotify) {
            report += `\n\n✉️ **Sending DMs to ${unregistered.length} members...**`;
            await editReplySafe(interaction, report);

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
                if (i < unregistered.length - 1) {
                    await new Promise(r => setTimeout(r, 5000));
                }
            }

            logEvent(`📋 Admin ${interaction.user.tag} finished notifying — ${sent} sent, ${failed} failed`);

            if (adminChannelId) {
                const adminCh = interaction.guild.channels.cache.get(adminChannelId);
                if (adminCh) {
                    const summary = `📋 **Bulk DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total unregistered:** ${unregistered.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}\n🕐 **Finished:** ${new Date().toLocaleString('en-US')}`;
                    await adminCh.send({ content: summary }).catch(() => {});
                }
            }

            return editReplySafe(interaction, `📋 **Unregistered Members — ${unregistered.length} total**\n\n✉️ DMs sent: **${sent}** ✅\n❌ Failed: **${failed}**`);
        }

        logEvent(`📋 Admin ${interaction.user.tag} listed ${unregistered.length} unregistered member(s)`);

        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                const summary = `📋 **Unregistered Members Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total unregistered:** ${unregistered.length}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`;
                await adminCh.send({ content: summary }).catch(() => {});
            }
        }

        return interaction.editReply(report);
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
                    const topSuggestions = lookupTopNicknames(pending.nickname, db, rankingCache, 2);
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
                const pilotMember = await guild.members.fetch(pilotId).catch(() => null);
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

                const ownerCandidates = !ownerMatch ? findOwnerCandidates(pending.ownerNick, db, 3) : [];
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

    // ── elderguide ──
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

    // ── scanimport ──
    if (commandName === 'scanimport') {
        return handleScanImport(interaction, db, saveLocalStorage, logEvent);
    }

    // ── scanimport_status ──
    if (commandName === 'scanimport_status') {
        return handleScanImportStatus(interaction, db, saveLocalStorage, logEvent);
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

        // Ranking cache stats
        const cachePath = './ranking_cache.json';
        let lastSync = '❌ Nunca sincronizado';
        let worldsInCache = 0;
        let playersInCache = 0;

        try {
            if (fs.existsSync(cachePath)) {
                const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                if (raw.updatedAt) {
                    const syncDate = new Date(raw.updatedAt);
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
                if (raw.ranking) {
                    worldsInCache = Object.keys(raw.ranking).length;
                    playersInCache = Object.values(raw.ranking).reduce((sum, w) => sum + (w ? Object.keys(w).length : 0), 0);
                }
            }
        } catch (e) {
            lastSync = '❌ Erro ao ler cache';
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

    // ── backupnow ──
    if (commandName === 'backupnow') {
        // Super admin only
        if (user.id !== SUPER_ADMIN_USER_ID) {
            return interaction.reply({ content: '❌ **Access denied.** Only the super admin can use this command.', flags: 64 });
        }

        if (!await deferReplySafe(interaction)) return;

        try {
            const fs = await import('node:fs');
            const { runBackup, getBackupStats } = await import('../auto-backup.js');
            const { getStorageStats } = await import('../core/ranking-storage.js');

            // Run backup
            const startTime = Date.now();
            const backupCount = runBackup(['./database_ranking.json'], 'manual');
            const elapsed = Date.now() - startTime;

            // Get stats
            const storageStats = getStorageStats();
            const backupStats = getBackupStats();

            let report = '💾 **Backup Completed!**\n\n';
            report += `📦 Files backed up: **${backupCount}**\n`;
            report += `⏱️ Time: **${elapsed}ms**\n`;
            report += `📊 Database users: **${storageStats.lastSaveUserCount || 0}**\n`;
            report += `📁 Total backups: **${backupStats.count}**\n`;
            report += `💿 Total size: **${backupStats.totalSizeMB} MB**\n`;

            if (backupStats.latestBackup) {
                report += `🕐 Latest: **${backupStats.latestBackup}**\n`;
            }

            logEvent(`💾 ${user.tag} ran /backupnow — ${backupCount} file(s) backed up in ${elapsed}ms`);
            return interaction.editReply(report);

        } catch (e) {
            return interaction.editReply(`❌ **Backup failed:** ${e.message}`);
        }
    }

    // ── checkintegrity ──
    if (commandName === 'checkintegrity') {
        // Super admin only
        if (user.id !== SUPER_ADMIN_USER_ID) {
            return interaction.reply({ content: '❌ **Access denied.** Only the super admin can use this command.', flags: 64 });
        }

        if (!await deferReplySafe(interaction)) return;

        const fs = await import('node:fs');
        const DB_RANKING_PATH = './database_ranking.json';
        const BACKUP_DIR = './backups';

        let report = '🔍 **Database Integrity Check**\n\n━━━━━━━━━━━━━━━━━━━━━━\n';
        let issues = [];
        let fixes = [];

        // 1. Check main database file
        report += '📁 **Main Database**\n';
        try {
            if (!fs.existsSync(DB_RANKING_PATH)) {
                report += '   ❌ File does not exist\n';
                issues.push('Main database file missing');
            } else {
                const stats = fs.statSync(DB_RANKING_PATH);
                const sizeKB = (stats.size / 1024).toFixed(1);
                
                if (stats.size === 0) {
                    report += '   ❌ File is empty (0 bytes)\n';
                    issues.push('Database file is empty');
                } else {
                    const data = fs.readFileSync(DB_RANKING_PATH, 'utf8');
                    
                    try {
                        const parsed = JSON.parse(data);
                        
                        // Check structure
                        if (!parsed.users || typeof parsed.users !== 'object') {
                            report += '   ❌ Missing or invalid users object\n';
                            issues.push('Users object missing/invalid');
                        } else {
                            const userCount = Object.keys(parsed.users).length;
                            report += `   ✅ Valid JSON — ${userCount} users\n`;
                            report += `   📊 Size: ${sizeKB} KB\n`;
                            
                            // Check for corrupted entries
                            let corruptedUsers = 0;
                            for (const [id, user] of Object.entries(parsed.users)) {
                                if (!user || typeof user !== 'object') {
                                    corruptedUsers++;
                                } else if (!user.nickname && !user.tempUntil) {
                                    corruptedUsers++;
                                }
                            }
                            
                            if (corruptedUsers > 0) {
                                report += `   ⚠️ ${corruptedUsers} corrupted user entries\n`;
                                issues.push(`${corruptedUsers} corrupted user entries`);
                            } else {
                                report += '   ✅ All user entries valid\n';
                            }
                            
                            // Check metadata
                            if (parsed._metadata) {
                                report += `   📋 Last saved: ${parsed._metadata.savedAt || 'unknown'}\n`;
                                report += `   📋 Version: ${parsed._metadata.version || '1.0'}\n`;
                            }
                        }
                    } catch (e) {
                        report += `   ❌ Invalid JSON: ${e.message}\n`;
                        issues.push('Invalid JSON format');
                    }
                }
            }
        } catch (e) {
            report += `   ❌ Error: ${e.message}\n`;
            issues.push(`File error: ${e.message}`);
        }

        report += '\n━━━━━━━━━━━━━━━━━━━━━━\n';

        // 2. Check backups
        report += '💾 **Backups**\n';
        try {
            if (!fs.existsSync(BACKUP_DIR)) {
                report += '   ⚠️ No backup directory\n';
            } else {
                const backups = fs.readdirSync(BACKUP_DIR)
                    .filter(f => f.startsWith('database_ranking_') && f.endsWith('.json'));
                
                report += `   📁 Found: ${backups.length} backup(s)\n`;
                
                let validBackups = 0;
                let corruptedBackups = 0;
                let emptyBackups = 0;
                
                for (const backup of backups) {
                    try {
                        const backupData = JSON.parse(fs.readFileSync(`${BACKUP_DIR}/${backup}`, 'utf8'));
                        if (backupData.users && Object.keys(backupData.users).length > 0) {
                            validBackups++;
                        } else {
                            emptyBackups++;
                        }
                    } catch (e) {
                        corruptedBackups++;
                    }
                }
                
                report += `   ✅ Valid: ${validBackups}\n`;
                if (emptyBackups > 0) report += `   ⚠️ Empty: ${emptyBackups}\n`;
                if (corruptedBackups > 0) {
                    report += `   ❌ Corrupted: ${corruptedBackups}\n`;
                    issues.push(`${corruptedBackups} corrupted backups`);
                }
            }
        } catch (e) {
            report += `   ❌ Error: ${e.message}\n`;
        }

        report += '\n━━━━━━━━━━━━━━━━━━━━━━\n';

        // 3. Recommendations
        report += '💡 **Recommendations**\n';
        
        if (issues.length === 0) {
            report += '   ✅ No issues found! Database is healthy.\n';
        } else {
            for (const issue of issues) {
                report += `   ⚠️ ${issue}\n`;
            }
            
            // Auto-fix suggestions
            if (issues.includes('Database file is empty') || issues.includes('Main database file missing')) {
                report += '\n   💡 Run `/restorebackup` to restore from a backup.\n';
            }
            if (issues.includes('Invalid JSON format')) {
                report += '   💡 The corrupted file has been saved as .corrupted for analysis.\n';
                report += '   💡 Run `/restorebackup` to restore from a backup.\n';
            }
        }

        logEvent(`🔍 ${user.tag} ran /checkintegrity — ${issues.length} issues found`);
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

    // ── checkdb ──
    if (commandName === 'checkdb') {
        if (!await deferReplySafe(interaction)) return;

        const fs = await import('node:fs');
        const DB_RANKING_PATH = './database_ranking.json';
        const BACKUP_DIR = './backups';
        const CACHE_PATH = './ranking_cache.json';

        let report = '🔍 **Database Health Check**\n\n━━━━━━━━━━━━━━━━━━━━━━\n';

        // 1. Check main database file
        try {
            if (fs.existsSync(DB_RANKING_PATH)) {
                const stats = fs.statSync(DB_RANKING_PATH);
                const ageMs = Date.now() - stats.mtimeMs;
                const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
                const ageDays = Math.floor(ageHours / 24);
                const sizeKB = (stats.size / 1024).toFixed(1);

                const data = JSON.parse(fs.readFileSync(DB_RANKING_PATH, 'utf8'));
                const userCount = data.users ? Object.keys(data.users).length : 0;
                const withNickname = data.users ? Object.values(data.users).filter(u => u && u.nickname).length : 0;
                const tempUsers = data.users ? Object.values(data.users).filter(u => u && u.tempUntil).length : 0;
                const manualUsers = data.users ? Object.values(data.users).filter(u => u && u.manualPermanent).length : 0;

                report += `📁 **Main Database (${DB_RANKING_PATH})**\n`;
                report += `   ✅ File exists\n`;
                report += `   📊 Size: **${sizeKB} KB**\n`;
                report += `   🕐 Last modified: **${ageHours}h ago** (${ageDays}d)\n`;
                report += `   👥 Users: **${userCount}** (${withNickname} with nickname)\n`;
                report += `   ⏳ Temporary: **${tempUsers}**\n`;
                report += `   👑 Manual permanent: **${manualUsers}**\n`;
            } else {
                report += `📁 **Main Database (${DB_RANKING_PATH})**\n`;
                report += `   ❌ **FILE NOT FOUND!**\n`;
                report += `   💡 The database file does not exist. Users need to register first.\n`;
            }
        } catch (e) {
            report += `📁 **Main Database (${DB_RANKING_PATH})**\n`;
            report += `   ❌ **ERROR:** ${e.message}\n`;
        }

        report += '\n━━━━━━━━━━━━━━━━━━━━━━\n';

        // 2. Check ranking cache
        try {
            if (fs.existsSync(CACHE_PATH)) {
                const stats = fs.statSync(CACHE_PATH);
                const ageMs = Date.now() - stats.mtimeMs;
                const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
                const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

                const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
                const worldCount = data.ranking ? Object.keys(data.ranking).length : 0;
                const playerCount = data.ranking ? Object.values(data.ranking).reduce((sum, w) => sum + (w ? Object.keys(w).length : 0), 0) : 0;

                report += `📊 **Ranking Cache (${CACHE_PATH})**\n`;
                report += `   ✅ File exists\n`;
                report += `   📊 Size: **${sizeMB} MB**\n`;
                report += `   🕐 Last sync: **${ageHours}h ago**\n`;
                report += `   🌍 Worlds: **${worldCount}**\n`;
                report += `   👤 Players: **${playerCount.toLocaleString()}**\n`;
            } else {
                report += `📊 **Ranking Cache (${CACHE_PATH})**\n`;
                report += `   ⚠️ No cache file — run /forcesync to create\n`;
            }
        } catch (e) {
            report += `📊 **Ranking Cache (${CACHE_PATH})**\n`;
            report += `   ❌ **ERROR:** ${e.message}\n`;
        }

        report += '\n━━━━━━━━━━━━━━━━━━━━━━\n';

        // 3. Check backups
        try {
            if (fs.existsSync(BACKUP_DIR)) {
                const backupFiles = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'));
                report += `💾 **Backups (${BACKUP_DIR}/)**\n`;
                report += `   📁 Found: **${backupFiles.length}** backup(s)\n`;
                if (backupFiles.length > 0) {
                    // Sort by date and show latest
                    backupFiles.sort().reverse();
                    const latest = backupFiles[0];
                    const latestStats = fs.statSync(`${BACKUP_DIR}/${latest}`);
                    const latestAgeMs = Date.now() - latestStats.mtimeMs;
                    const latestAgeHours = Math.floor(latestAgeMs / (1000 * 60 * 60));
                    report += `   🕐 Latest: **${latest}** (${latestAgeHours}h ago)\n`;
                    if (backupFiles.length > 1) {
                        report += `   📋 Others: ${backupFiles.slice(1, 4).join(', ')}${backupFiles.length > 4 ? `... +${backupFiles.length - 4} more` : ''}\n`;
                    }
                }
            } else {
                report += `💾 **Backups (${BACKUP_DIR}/)**\n`;
                report += `   ⚠️ No backup directory found\n`;
            }
        } catch (e) {
            report += `💾 **Backups (${BACKUP_DIR}/)**\n`;
            report += `   ❌ **ERROR:** ${e.message}\n`;
        }

        report += '\n━━━━━━━━━━━━━━━━━━━━━━\n';

        // 4. In-memory status
        const memUsers = db.users ? Object.keys(db.users).length : 0;
        report += `🧠 **In-Memory Status**\n`;
        report += `   👥 Loaded users: **${memUsers}**\n`;
        report += `   ⏳ Pending registrations: **${Object.keys(pendingRegistrations).length}**\n`;
        report += `   ✈️ Pending pilot approvals: **${Object.keys(pendingPilotApprovals).length}**\n`;

        logEvent(`🔍 ${interaction.user.tag} ran /checkdb`);
        return interaction.editReply(report);
    }

    // ── refreshnames ──
    if (commandName === 'refreshnames') {
        if (!await deferReplySafe(interaction)) return;

        const allMembers = await guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply('❌ Could not fetch guild members.');
        }

        let updated = 0;
        let skipped = 0;
        let failed = 0;
        const details = [];

        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;

            // Check if this member is a pilot
            const ownerIdOfThisPilot = Object.keys(db.users || {}).find(id =>
                db.users[id].pilotIds && db.users[id].pilotIds.includes(memberId)
            );
            const isPilot = !!ownerIdOfThisPilot;

            if (isPilot) {
                const ownerNick = db.users[ownerIdOfThisPilot].nickname;
                if (!ownerNick) { skipped++; continue; }

                const prefixed = buildPrefixedNickname(ownerNick, db, 'Pilot');
                if ((member.nickname || '') !== prefixed) {
                    try {
                        await member.setNickname(prefixed);
                        updated++;
                        if (details.length < 20) details.push(`✈️ ${member.user.tag} → ${prefixed}`);
                    } catch {
                        failed++;
                    }
                } else {
                    skipped++;
                }
            } else if (db.users[memberId] && (db.users[memberId].registeredAt || db.users[memberId].manual === true)) {
                // Owner
                const nickname = db.users[memberId].nickname;
                if (!nickname) { skipped++; continue; }

                const prefixed = buildPrefixedNickname(nickname, db);
                if ((member.nickname || '') !== prefixed) {
                    try {
                        await member.setNickname(prefixed);
                        updated++;
                        if (details.length < 20) details.push(`👑 ${member.user.tag} → ${prefixed}`);
                    } catch {
                        failed++;
                    }
                } else {
                    skipped++;
                }
            }
        }

        let report = `🔄 **Nickname Refresh Complete**\n\n`;
        report += `✅ Updated: **${updated}**\n`;
        report += `⏭️ Already correct: **${skipped}**\n`;
        report += `❌ Failed: **${failed}**\n`;

        if (details.length > 0) {
            report += `\n📋 **Details:**\n${details.join('\n')}`;
        }

        logEvent(`🔄 Admin ${interaction.user.tag} ran /refreshnames — ${updated} updated, ${skipped} skipped, ${failed} failed`);
        return interaction.editReply(report);
    }

    // ── nuke ──
    if (commandName === 'nuke') {
        // High-risk command: only the super admin may use it
        if (user.id !== SUPER_ADMIN_USER_ID) {
            return interaction.reply({ content: '❌ **Access denied.** Only the super admin can use this command.', flags: 64 });
        }

        const categoryCount = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;
        const channelCount = guild.channels.cache.size - categoryCount;
        const protectedChannels = guild.channels.cache.filter(c => NUKE_PROTECTED_CHANNEL_IDS.includes(c.id));

        confirmationCache[`${user.id}-nuke`] = {
            timestamp: Date.now(),
            channelCount,
            categoryCount
        };

        const protectedLine = protectedChannels.size > 0
            ? `\n\n🛡️ **Protected (will NOT be deleted):** ${protectedChannels.map(c => `<#${c.id}>`).join(', ')}`
            : '';

        return interaction.reply({
            content: `💣 **⚠️ DESTRUCTIVE ACTION WARNING ⚠️**\n\nThis will **PERMANENTLY DELETE** all channels and categories from this server:\n\n📁 Categories: **${categoryCount}**\n📢 Channels: **${channelCount}**${protectedLine}\n\n🔴 **THIS ACTION CANNOT BE UNDONE!** All messages, history and permissions will be lost.\n\nAfterwards, a **#geral** channel will be created with the operation summary.\n\nClick **💣 YES, NUKE EVERYTHING** to proceed or **❌ Cancel**.`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-nuke-yes').setLabel('💣 YES, NUKE EVERYTHING').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('confirm-nuke-no').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64
        });
    }

    // ── scanrebuild ──
    if (commandName === 'scanrebuild') {
        if (!await deferReplySafe(interaction)) return;

        const allMembers = await guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply('❌ Could not fetch guild members.');
        }

        // Reset only the users that were in DB (backup was lost)
        const previousCount = Object.keys(db.users || {}).length;
        db.users = {};

        let registered = 0;
        let pilots = 0;
        let fuzzyLinked = 0;
        const errors = [];
        const fuzzyInfos = [];
        const now = new Date().toISOString();

        // Build a map: nickname → memberId for owner lookups
        const nicknameToId = {};

        // First pass: collect all members with member role
        const eligible = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            if (!member.roles.cache.has(MEMBER_ROLE_ID)) continue;
            eligible.push(member);
        }

        // Detect pilots and extract owner nicknames
        const pilotLinks = []; // { pilotId, ownerNick }

        for (const member of eligible) {
            const currentNick = (member.nickname || member.user.username).trim();

            // Detect pilot: nickname ends with " - Pilot"
            if (currentNick.endsWith(' - Pilot')) {
                // Remove suffix and prefix to get owner base name
                let ownerNick = currentNick.replace(/ - Pilot$/, '').trim();
                // Remove known server prefix if present (e.g. "ASIA1 - Name" → "Name")
                // Only strip uppercase server codes (ASIA1, EU2, SA1, etc.)
                const prefixMatch = ownerNick.match(/^[A-Z0-9]+ - (.+)$/);
                if (prefixMatch) {
                    ownerNick = prefixMatch[1].trim();
                }
                pilotLinks.push({ pilotId: member.id, ownerNick, displayName: currentNick });
            } else {
                // Owner: strip server prefix if present
                let baseName = currentNick;
                const prefixMatch = baseName.match(/^[A-Z0-9]+ - (.+)$/);
                if (prefixMatch) {
                    baseName = prefixMatch[1].trim();
                }

                // Register as owner
                db.users[member.id] = {
                    nickname: baseName,
                    registeredAt: now,
                    pilotIds: []
                };
                nicknameToId[baseName.toLowerCase()] = member.id;
                registered++;
            }
        }

        // Second pass: link pilots to owners
        for (const { pilotId, ownerNick, displayName } of pilotLinks) {
            // Try exact cleanNickname match first
            let ownerId = Object.entries(db.users).find(([id, data]) =>
                data.nickname && cleanNickname(data.nickname) === cleanNickname(ownerNick)
            )?.[0];

            // If exact match fails, try fuzzy matching fallback
            if (!ownerId) {
                const cleanedInput = cleanNickname(ownerNick);
                if (cleanedInput.length >= 2) {
                    let bestScore = 0;
                    let bestId = null;
                    let bestNick = null;

                    for (const [id, data] of Object.entries(db.users)) {
                        if (!data.nickname) continue;
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
                            bestId = id;
                            bestNick = data.nickname;
                        }
                    }

                    if (bestId) {
                        ownerId = bestId;
                        fuzzyLinked++;
                        fuzzyInfos.push(`🔍 Pilot ${pilotId} — fuzzy matched owner "${ownerNick}" → "${bestNick}"`);
                    }
                }
            }

            if (ownerId) {
                if (!db.users[ownerId].pilotIds.includes(pilotId)) {
                    db.users[ownerId].pilotIds.push(pilotId);
                }
                // Register pilot as user (so they show in manage panel)
                db.users[pilotId] = {
                    ...db.users[pilotId],
                    nickname: displayName,
                    registeredAt: now,
                    pilotIds: []
                };
                pilots++;
            } else {
                // Owner not found — register pilot as temporary owner with note
                db.users[pilotId] = {
                    nickname: ownerNick,
                    registeredAt: now,
                    pilotIds: [],
                    tempUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                    tempRegisteredAt: now
                };
                errors.push(`⚠️ Pilot ${pilotId} — owner "${ownerNick}" not found, registered as temporary`);
            }
        }

        saveLocalStorage();

        let responseMsg = `🔄 **Database Rebuilt!**\n\n`;
        responseMsg += `📋 Previous entries: **${previousCount}**\n`;
        responseMsg += `👑 Owners registered: **${registered}**\n`;
        responseMsg += `✈️ Pilots linked: **${pilots}**\n`;
        responseMsg += `📦 Total: **${Object.keys(db.users).length}**\n`;

        if (fuzzyInfos.length > 0) {
            responseMsg += `\n🔍 **Fuzzy-matched pilots (${fuzzyLinked}):**\n${fuzzyInfos.slice(0, 5).join('\n')}`;
            if (fuzzyInfos.length > 5) {
                responseMsg += `\n... and ${fuzzyInfos.length - 5} more`;
            }
        }

        if (errors.length > 0) {
            responseMsg += `\n⚠️ **Warnings (${errors.length}):**\n${errors.slice(0, 5).join('\n')}`;
            if (errors.length > 5) {
                responseMsg += `\n... and ${errors.length - 5} more`;
            }
        }

        logEvent(`🔄 Admin ${interaction.user.tag} ran /scanrebuild — ${registered} owners, ${pilots} pilots recovered`);
        return interaction.editReply(responseMsg);
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
