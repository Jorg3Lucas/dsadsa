import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    WORLD_IDS,
    confirmationCache,
    ensureConfig
} from '../core/ranking-constants.js';
import { findNicknameInCache, findTopClanSuggestions, getLocalRankingCache } from '../core/ranking-cache.js';

// ==========================================
// 📋 MANAGE MENU HANDLERS
// ==========================================

// ── Manage: User selected from page → show actions ──
export async function handleManageUserPage(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
    }

    const targetUserId = interaction.values[0];
    const userData = db.users[targetUserId];
    if (!userData) {
        return interaction.update({ content: '❌ User no longer registered.', components: [] }).catch(() => {});
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
    }).catch(() => {});
}

// ── Manage: Action selected (remove, status, clan, pilot, removetemp) ──
export async function handleManageAction(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
    }

    const [actionType, targetUserId] = interaction.values[0].split('_', 2);
    const userData = db.users[targetUserId];
    if (!userData) {
        return interaction.update({ content: '❌ User no longer registered.', components: [] }).catch(() => {});
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
        }).catch(() => {});
    }

    if (actionType === 'clan') {
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
            return interaction.update({ content: getMsg('ranking.responses.manage.noPilots', { username: userData.nickname }), components: [] }).catch(() => {});
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
        }).catch(() => {});
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

    return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(() => {});
}

// ── Manage: Remove a specific pilot from owner ──
export async function handleManagePilotRemove(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
    }

    const targetUserId = interaction.customId.replace('manage_pilot_', '');
    const pilotToRemoveId = interaction.values[0];
    const userData = db.users[targetUserId];

    if (!userData || !userData.pilotIds || !userData.pilotIds.includes(pilotToRemoveId)) {
        return interaction.update({ content: '❌ This pilot is no longer linked.', components: [] }).catch(() => {});
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
    }).catch(() => {});
}

// ── Allied Clans: Show world selector ──
export async function handleManageAllied(interaction, db, saveLocalStorage, logEvent) {
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

// ==========================================
// 🏗️ WORLD VIEW BUILDER (shared by 3 handlers)
// ==========================================

/**
 * Build the content string and component rows for a world's allied clans view.
 * Returns { content, components } ready to pass to interaction.update/editReply.
 */
function buildAlliedWorldView(worldId, clans, worldName) {
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

    return { content, components };
}

// ── Allied Clans: World selected → show clans ──
export async function handleManageAlliedWorld(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
    }

    const worldId = interaction.values[0];
    const worldName = WORLD_IDS[worldId] || `World ${worldId}`;

    ensureConfig(db);
    if (!db.config.alliedClans[worldId]) db.config.alliedClans[worldId] = [];

    const { content, components } = buildAlliedWorldView(worldId, db.config.alliedClans[worldId], worldName);
    return interaction.update({ content, components }).catch(() => {});
}

// ── Allied Clans: Add clan button → modal ──
export async function handleManageAlliedAdd(interaction, db, saveLocalStorage, logEvent) {
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

// ── Allied Clans: Add clan modal submission ──
export async function handleManageAlliedAddModal(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: 64 }).catch(() => {});
    }

    await interaction.deferReply({ flags: 64 });

    const clanName = interaction.fields.getTextInputValue('clan_name').trim();
    const worldId = interaction.fields.getTextInputValue('world_id').trim();
    const worldName = WORLD_IDS[worldId] || `World ${worldId}`;

    if (!clanName) {
        return interaction.editReply('❌ Clan name cannot be empty.');
    }

    ensureConfig(db);
    if (!db.config.alliedClans[worldId]) db.config.alliedClans[worldId] = [];

    // Check for duplicates (case-insensitive)
    const alreadyExists = db.config.alliedClans[worldId].some(
        c => c.toLowerCase() === clanName.toLowerCase()
    );
    if (alreadyExists) {
        return interaction.editReply(`⚠️ **${clanName}** is already an allied clan in **${worldName}**.`);
    }

    // ── Fuzzy suggestion check ──
    const rankingCache = getLocalRankingCache();
    const suggestions = rankingCache
        ? findTopClanSuggestions(clanName, worldId, rankingCache, 2)
        : [];

    // Check if the typed name exactly matches any clan in the ranking cache for this world
    const clanNamesInWorld = rankingCache ? Object.values(rankingCache[worldId] || {}) : [];
    const exactRankingMatch = clanNamesInWorld.some(
        c => c.toLowerCase() === clanName.toLowerCase()
    );

    // If there are fuzzy suggestions AND no exact match in the ranking, show the choice
    const relevantSuggestions = suggestions.filter(
        s => s.clanName.toLowerCase() !== clanName.toLowerCase()
    );

    if (!exactRankingMatch && relevantSuggestions.length > 0) {
        // Store pending in confirmationCache with suggestion names
        confirmationCache[`${interaction.user.id}-addclan`] = {
            clanName,
            worldId,
            worldName,
            suggestions: relevantSuggestions.map(s => s.clanName)
        };

        const suggestionRows = relevantSuggestions.map((s, i) =>
            new ButtonBuilder()
                .setCustomId(`confirm-addclan-suggest${i}`)
                .setLabel(`🔍 ${s.clanName.substring(0, 80)}`)
                .setStyle(ButtonStyle.Primary)
        );

        const typedRow = new ButtonBuilder()
            .setCustomId(`confirm-addclan-typed`)
            .setLabel('📝 Use as typed')
            .setStyle(ButtonStyle.Secondary);

        const cancelRow = new ButtonBuilder()
            .setCustomId('confirm-addclan-cancel')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Danger);

        const suggestionList = relevantSuggestions.map((s, i) =>
            `🔍 **${i + 1}.** ${s.clanName} (${(s.score * 100).toFixed(0)}% similar)`
        ).join('\n');

        return interaction.editReply({
            content: `⚠️ **"${clanName}"** doesn't exactly match any clan in the ranking for **${worldName}**.\n\nDid you mean one of these?\n${suggestionList}\n\nChoose below or use the typed name:`,
            components: [
                new ActionRowBuilder().addComponents(...suggestionRows.slice(0, 2)),
                new ActionRowBuilder().addComponents(typedRow, cancelRow)
            ]
        });
    }

    // No suggestions or exact match — add directly
    db.config.alliedClans[worldId].push(clanName);
    saveLocalStorage();

    let logNote = '';
    if (exactRankingMatch) {
        logNote = ' (matched in ranking)';
    }
    logEvent(`➕ Admin ${interaction.user.tag} added allied clan "${clanName}" to ${worldName}${logNote}`);

    // Refresh the world view
    const { content, components } = buildAlliedWorldView(worldId, db.config.alliedClans[worldId], worldName);
    return interaction.editReply({ content, components });
}

// ── Allied Clans: Remove clan from select menu ──
export async function handleManageAlliedRemove(interaction, db, saveLocalStorage, logEvent) {
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
    const { content, components } = buildAlliedWorldView(worldId, clans, worldName);
    return interaction.update({ content, components }).catch(() => {});
}

// ── Allied Clans: Handle suggestion buttons (add clan modal flow) ──
export async function handleAddClanSuggestion(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
    }

    await interaction.deferUpdate();

    const customId = interaction.customId;
    const cacheKey = `${interaction.user.id}-addclan`;
    const cached = confirmationCache[cacheKey];

    if (!cached) {
        return interaction.editReply({ content: '⌛ This request has expired. Please try again.', components: [] }).catch(() => {});
    }

    delete confirmationCache[cacheKey];

    if (customId === 'confirm-addclan-cancel') {
        logEvent(`❌ Admin ${interaction.user.tag} cancelled adding allied clan "${cached.clanName}" to ${cached.worldName}`);
        return interaction.editReply({ content: '❌ **Cancelled.**', components: [] }).catch(() => {});
    }

    let finalClanName;
    let logSource;

    if (customId === 'confirm-addclan-typed') {
        finalClanName = cached.clanName;
        logSource = 'as typed';
    } else if (customId.startsWith('confirm-addclan-suggest')) {
        // Extract the suggestion index from cached suggestions
        const suggestIndex = parseInt(customId.replace('confirm-addclan-suggest', ''), 10);
        if (cached.suggestions && cached.suggestions[suggestIndex]) {
            finalClanName = cached.suggestions[suggestIndex];
            logSource = `suggestion #${suggestIndex + 1}`;
        } else {
            finalClanName = cached.clanName;
            logSource = 'as typed (suggestion unavailable)';
        }
    } else {
        return interaction.editReply({ content: '❌ Unknown action.', components: [] }).catch(() => {});
    }

    const { worldId, worldName } = cached;

    ensureConfig(db);
    if (!db.config.alliedClans[worldId]) db.config.alliedClans[worldId] = [];

    // Re-check duplicates after the selection
    const alreadyExists = db.config.alliedClans[worldId].some(
        c => c.toLowerCase() === finalClanName.toLowerCase()
    );
    if (alreadyExists) {
        return interaction.editReply({
            content: `⚠️ **${finalClanName}** is already an allied clan in **${worldName}**.`,
            components: []
        }).catch(() => {});
    }

    db.config.alliedClans[worldId].push(finalClanName);
    saveLocalStorage();

    logEvent(`➕ Admin ${interaction.user.tag} added allied clan "${finalClanName}" to ${worldName} (${logSource})`);

    // Refresh the world view
    const { content, components } = buildAlliedWorldView(worldId, db.config.alliedClans[worldId], worldName);
    return interaction.editReply({ content, components }).catch(() => {});
}

// ── Manage: Navigation buttons (back, prev, next) ──
export async function handleManageNav(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(() => {});
    }

    if (interaction.customId === 'manage_back' || interaction.customId === 'manage_allied_back') {
        const userEntries = Object.entries(db.users || {}).filter(([id, data]) => data && data.nickname);
        if (userEntries.length === 0) {
            return interaction.update({ content: getMsg('ranking.responses.manage.noUsers'), components: [] }).catch(() => {});
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
        }).catch(() => {});
    }

    const [, , , pageStr] = interaction.customId.split('_');
    const currentPage = parseInt(pageStr, 10);
    const newPage = interaction.customId.includes('next') ? currentPage + 1 : currentPage - 1;

    const userEntries = Object.entries(db.users || {}).filter(([id, data]) => data && data.nickname);
    const sorted = userEntries.sort((a, b) => a[1].nickname.localeCompare(b[1].nickname));
    const PAGE_SIZE = 25;
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

    if (newPage < 0 || newPage >= totalPages) {
        return interaction.deferUpdate().catch(() => {});
    }

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
    }).catch(() => {});
}
