// ==========================================
// 🛠️ MANAGEMENT UI & ALLIED CLANS
// Manage menus, navigation, and allied clan configuration
// ==========================================
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { getMsg } from './lang.js';
import {
    confirmationCache,
    MEMBER_ROLE_ID,
    WORLD_IDS,
} from './ranking-constants.js';
import { findNicknameInCache, getLocalRankingCache, levenshteinDistance, cleanNickname } from './ranking-cache.js';

// ==========================================
// 🔍 Fuzzy clan matching helper
// Returns the closest matching clan name from the ranking cache, or null
// ==========================================

function findFuzzyClanSuggestion(clanName, worldId) {
    const rankingCache = getLocalRankingCache();
    if (!rankingCache || !rankingCache[worldId]) return null;

    const clanSet = new Set();
    for (const [, cName] of Object.entries(rankingCache[worldId])) {
        clanSet.add(cName);
    }
    const clanNames = [...clanSet];

    const cleanedInput = cleanNickname(clanName);
    if (cleanedInput.length < 2) return null;

    let bestMatch = null;
    let bestScore = 0;
    const threshold = 0.6;

    for (const cName of clanNames) {
        const cleanedClan = cleanNickname(cName);
        if (cleanedClan.length < 2) continue;

        const inputChars = new Set(cleanedInput);
        const clanChars = new Set(cleanedClan);
        let commonChars = 0;
        for (const c of inputChars) {
            if (clanChars.has(c)) commonChars++;
        }
        const overlap = (2 * commonChars) / (inputChars.size + clanChars.size);
        if (overlap < 0.3) continue;

        const distance = levenshteinDistance(cleanedInput, cleanedClan);
        const maxLen = Math.max(cleanedInput.length, cleanedClan.length);
        const similarity = 1 - (distance / maxLen);

        if (similarity > bestScore) {
            bestScore = similarity;
            bestMatch = cName;
        }
    }

    return (bestMatch && bestScore >= threshold) ? bestMatch : null;
}

// ==========================================
// 📋 Build allied clans view — shared by all allied clan handlers
// Returns { content, components }
// ==========================================

function buildAlliedClansView(clans, worldId, worldName) {
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

    const bottomRow = [
        new ButtonBuilder().setCustomId(`manage_allied_add_${worldId}`).setLabel('➕ Add Clan').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('manage_allied').setLabel('🔙 Back to Worlds').setStyle(ButtonStyle.Secondary)
    ];
    components.push(new ActionRowBuilder().addComponents(bottomRow));

    return { content, components };
}

// ==========================================
// 🖱️ HANDLER
// ==========================================

export async function handleManageInteractions(interaction, db, saveLocalStorage, logEvent) {
    
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
            const view = buildAlliedClansView(clans, worldId, worldName);
            return interaction.update({ content: view.content, components: view.components }).catch(() => {});
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
    
        // ── Allied Clans: Add clan modal submit with fuzzy check ──
        if (interaction.isModalSubmit() && interaction.customId === 'manage_allied_add_modal') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Permission denied.', flags: 64 }).catch(() => {});
            }
    
            const clanName = interaction.fields.getTextInputValue('clan_name').trim().normalize('NFC');
            const worldId = interaction.fields.getTextInputValue('world_id');
            const worldName = WORLD_IDS[worldId] || `World ${worldId}`;
    
            if (!db.config) db.config = {};
            if (!db.config.alliedClans) db.config.alliedClans = {};
            if (!db.config.alliedClans[worldId]) db.config.alliedClans[worldId] = [];
    
            // Check if already added (case-insensitive)
            if (db.config.alliedClans[worldId].some(c => c.toLowerCase() === clanName.toLowerCase())) {
                return interaction.reply({ content: `⚠️ **${clanName}** is already an allied clan for **${worldName}**.`, flags: 64 });
            }
    
            // ── Auto-correct via fuzzy check ──
            const fuzzySuggestion = findFuzzyClanSuggestion(clanName, worldId);
            const finalName = fuzzySuggestion && fuzzySuggestion.toLowerCase() !== clanName.toLowerCase()
                ? fuzzySuggestion
                : clanName;
            const wasCorrected = finalName !== clanName;
    
            // Check if already added (case-insensitive) using the corrected name
            if (db.config.alliedClans[worldId].some(c => c.toLowerCase() === finalName.toLowerCase())) {
                return interaction.reply({ content: `⚠️ **${finalName}** is already an allied clan for **${worldName}**.`, flags: 64 });
            }
    
            // Add the clan (use corrected name if available)
            db.config.alliedClans[worldId].push(finalName);
            saveLocalStorage();
            logEvent(`➕ Admin ${interaction.user.tag} added allied clan "${finalName}" to ${worldName}${wasCorrected ? ` (auto-corrected from "${clanName}")` : ''}`);
    
            let response = wasCorrected
                ? `✅ **${finalName}** added as allied clan for **${worldName}**.\n\n✏️ **Auto-corrected** from **${clanName}** → **${finalName}**.`
                : `✅ **${finalName}** added as allied clan for **${worldName}**.`;
    
            return interaction.reply({ content: response, flags: 64 });
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
            const view = buildAlliedClansView(clans, worldId, worldName);
            return interaction.update({ content: view.content, components: view.components }).catch(() => {});
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
    
        
}
