import fs from 'node:fs';
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
    MEMBER_ROLE_ID,
    WORLD_IDS,
    confirmationCache,
    pendingRegistrations,
    pendingPilotApprovals,
    adminChannelId,
    APPROVER_ROLE_IDS,
    WELCOME_PANEL_MESSAGE,
    REGISTRATION_CHANNEL_ID,
    ensureConfig
} from '../core/ranking-constants.js';
import { getLocalRankingCache, cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';
import { lookupNickname, lookupTopNicknames } from '../core/ranking-service.js';
import { runDailySynchronization } from '../core/ranking-sync-engine.js';
import { handleScanImport, handleScanImportStatus } from './ranking-scan.js';

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

export async function handleRankingCommand(interaction, db, saveLocalStorage, logEvent) {
    const { commandName, options, user, guild } = interaction;

    // ── removepilot ──
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

    // ── forcesync ──
    if (commandName === 'forcesync') {
        await interaction.deferReply({ flags: 64 });
        logEvent(getMsg('ranking.responses.forcesync.log', { tag: user.tag }));
        await runDailySynchronization(interaction.client, db, saveLocalStorage, logEvent, true);

        // Auto-correct wrong nicknames using fuzzy matching
        const rankingCache = getLocalRankingCache();
        let fuzzyCorrected = 0;
        const correctedList = [];

        if (rankingCache) {
            const pilotIdSet = new Set();
            for (const [, data] of Object.entries(db.users || {})) {
                if (data.pilotIds && data.pilotIds.length > 0) {
                    for (const pid of data.pilotIds) {
                        pilotIdSet.add(pid);
                    }
                }
            }

            for (const [memberId, userData] of Object.entries(db.users || {})) {
                if (pilotIdSet.has(memberId)) continue;
                if (!userData.nickname) continue;

                const currentNick = userData.nickname;
                const exactHit = findNicknameInCache(currentNick, rankingCache);
                if (exactHit) continue;

                const fuzzyHit = findClosestNicknameInCache(currentNick, rankingCache);
                if (!fuzzyHit || fuzzyHit.nickname.toLowerCase() === currentNick.toLowerCase()) continue;

                const oldNick = currentNick;
                const newNick = fuzzyHit.nickname;
                const serverName = WORLD_IDS[fuzzyHit.worldId] || fuzzyHit.worldId;

                db.users[memberId].nickname = newNick;

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

    // ── manualregister ──
    if (commandName === 'manualregister') {
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
                nickname: lookup.nickname,
                clan: lookup.clanName,
                worldId: lookup.worldId,
                needsTempApproval: !lookup.inAlliedClan,
                selectedNickname: lookup.nickname
            };

            return interaction.reply({
                content: getMsg('ranking.responses.manualregister.confirm', { nickname: lookup.nickname, clan: lookup.clanName, username: targetMember.displayName }) + `\n${statusLine}${fuzzyManualNote}${hasSuggestions ? '\n\n📌 Use the **dropdown below** to select a different nickname before confirming.' : ''}`,
                components: [
                    ...(nicknameRow ? [nicknameRow] : []),
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm-manualregister-yes').setLabel('✅ Yes, register').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('confirm-manualregister-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                    )
                ],
                flags: 64
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

            return interaction.reply({
                content: `❌ **"${nickname}" not found in ranking.**\n\nHowever, there are similar nicknames available. Select one from the dropdown below and confirm to register as temporary (3 days).${hasSuggestions ? '\n\n📌 Use the **dropdown below** to select a different nickname before confirming.' : ''}`,
                components: [
                    ...(nicknameRow ? [nicknameRow] : []),
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

        ensureConfig(db);
        db.config.panelChannelId = interaction.channelId;
        db.config.panelMessageId = panelMessage.id;
        saveLocalStorage();

        logEvent(`📋 Admin ${interaction.user.tag} sent registration panel in #${interaction.channel.name}`);
        return interaction.editReply('✅ **Registration panel sent!**');
    }

    // ── listunregistered ──
    if (commandName === 'listunregistered') {
        await interaction.deferReply({ flags: 64 });

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

            return interaction.editReply(`📋 **Unregistered Members — ${unregistered.length} total**\n\n✉️ DMs sent: **${sent}** ✅\n❌ Failed: **${failed}**`);
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

                const lookup = lookupNickname(pending.nickname, db, rankingCache);
                if (lookup.fuzzySuggestion) {
                    line += `   🔍 **Fuzzy suggestion:** "${pending.nickname}" → "${lookup.fuzzySuggestion}" (${lookup.serverName})\n`;
                }

                report += line;

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

                const ownerMatch = Object.entries(db.users || {}).find(([id, data]) =>
                    data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === pending.ownerNick.toLowerCase()
                );

                let line = `\n${pilotTag} → Owner **${pending.ownerNick}**\n`;
                line += `   ⏰ Expires in: ${expiresIn}\n`;

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

        if (panelsRestored > 0) {
            report += `\n📤 **Re-sent ${panelsRestored} admin panel(s) for review.**`;
        }

        if (report.length > 1900) {
            report = report.substring(0, 1900) + '\n\n... (truncated)';
        }

        logEvent(`📋 Admin ${interaction.user.tag} checked pending requests (${ownerEntries.length} owners, ${pilotEntries.length} pilots, ${panelsRestored} panels restored)`);
        return interaction.editReply(report);
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
        await interaction.deferReply({ flags: 64 });

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

    return false;
}

// ── Select Menu: Admin chooses nickname for manualregister ──
export async function handleSelectManualNickname(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferUpdate();

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
