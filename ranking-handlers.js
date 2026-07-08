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
import { confirmationCache, MEMBER_ROLE_ID, WORLD_IDS } from './ranking-constants.js';
import { findNicknameInCache } from './ranking-cache.js';
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

    // A. MODAL SUBMIT HANDLER
    if (interaction.isModalSubmit() && interaction.customId === 'register_modal') {
        await interaction.deferReply({ flags: 64 });
        
        const nickname = interaction.fields.getTextInputValue('character_nickname').trim().normalize('NFC');

        const databaseRecord = Object.entries(db.users).find(([id, data]) => data.nickname.trim().normalize('NFC').toLowerCase() === nickname.toLowerCase());
        if (databaseRecord && databaseRecord[0] !== interaction.user.id) {
            return interaction.editReply(getMsg('ranking.responses.register.alreadyRegistered'));
        }

        db.users[interaction.user.id] = { ...db.users[interaction.user.id], nickname, registeredAt: new Date().toISOString() };
        if (!db.users[interaction.user.id].pilotIds) db.users[interaction.user.id].pilotIds = [];
        saveLocalStorage();

        interaction.guild.members.fetch(interaction.user.id)
            .then(async (member) => {
                if (member) {
                    await member.setNickname(nickname).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
                    await applyImmediateRoleWithCache(member, nickname, interaction.user.id).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
                }
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });

        return interaction.editReply(getMsg('ranking.responses.register.success', { nickname }));
    }

    // B. MANUAL CLAN SELECTION DROPDOWN (ADMIN)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_clan_manual_')) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: getMsg('ranking.responses.selectClanMenu.noPermission'), flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });
        const targetId = interaction.customId.replace('select_clan_manual_', '');
        const selectedClan = interaction.values[0];

        if (db.users[targetId]) {
            db.users[targetId].clanManual = selectedClan;
            saveLocalStorage();

            const guild = interaction.guild;
            const member = await guild.members.fetch(targetId).catch(() => null);

            if (member) {
                const normalizedNick = db.users[targetId].nickname.trim().normalize('NFC');
                await member.setNickname(normalizedNick).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
                if (!member.roles.cache.has(MEMBER_ROLE_ID)) {
                    await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                }
            }
            logEvent(getMsg('ranking.logs.manualLink', { targetId, selectedClan }));
            return interaction.editReply(getMsg('ranking.responses.selectClanMenu.success', { clan: selectedClan }));
        }
        return interaction.editReply(getMsg('ranking.responses.selectClanMenu.error'));
    }

    // C. PILOT REMOVAL HANDLER (user removing their own pilot)
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
            if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
            if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;
            saveLocalStorage();

            await targetMember.setNickname(cached.nickname).catch(() => {});
            if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
                await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
            }

            logEvent(`Admin ${interaction.user.tag} manually registered ${cached.targetId} as ${cached.nickname} in ${cached.clan}`);
            return interaction.update({
                content: getMsg('ranking.responses.manualregister.cacheFound', { nickname: cached.nickname, clan: cached.clan }),
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
            { label: getMsg('ranking.responses.manage.actionClan'), description: getMsg('ranking.responses.manage.actionClanDesc'), value: `clan_${targetUserId}` }
        ];

        if (userData.pilotIds && userData.pilotIds.length > 0) {
            actionOptions.push({
                label: getMsg('ranking.responses.manage.actionPilot'),
                description: getMsg('ranking.responses.manage.actionPilotDesc'),
                value: `pilot_${targetUserId}`
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

    // H. MANAGE NAVIGATION BUTTONS
    if (interaction.isButton() && (interaction.customId.startsWith('manage_user_prev_') || interaction.customId.startsWith('manage_user_next_') || interaction.customId === 'manage_back')) {
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

    // /REGISTER COMMAND: DIRECT MODAL POPUP
    if (commandName === 'register') {
        const modal = new ModalBuilder()
            .setCustomId('register_modal')
            .setTitle(getMsg('ranking.commands.register.modalTitle'));

        const nicknameInput = new TextInputBuilder()
            .setCustomId('character_nickname')
            .setLabel(getMsg('ranking.commands.register.inputLabel'))
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(getMsg('ranking.commands.register.inputPlaceholder'))
            .setMinLength(2)
            .setMaxLength(30)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(nicknameInput);
        modal.addComponents(firstActionRow);

        return await interaction.showModal(modal);
    }

    if (commandName === 'pilot') {
        await interaction.deferReply({ flags: 64 });
        const pilotMember = options.getMember('member');
        
        const userProfile = db.users[user.id];
        const isActuallyRegistered = userProfile && (userProfile.registeredAt || userProfile.manual === true);

        if (!isActuallyRegistered) {
            return interaction.editReply(getMsg('ranking.responses.pilot.notRegistered'));
        }

        if (pilotMember.id === user.id) return interaction.editReply(getMsg('ranking.responses.pilot.selfPilot'));
        
        if (!db.users[user.id].pilotIds) db.users[user.id].pilotIds = [];

        if (db.users[user.id].pilotIds.length >= 4) {
            return interaction.editReply(getMsg('ranking.responses.pilot.limitReached'));
        }

        if (db.users[user.id].pilotIds.includes(pilotMember.id)) {
            return interaction.editReply(getMsg('ranking.responses.pilot.alreadyLinked'));
        }

        db.users[user.id].pilotIds.push(pilotMember.id);
        saveLocalStorage();

        const ownerNick = db.users[user.id].nickname.trim().normalize('NFC');
        await pilotMember.setNickname(`${ownerNick} - Pilot`).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        await applyImmediateRoleWithCache(pilotMember, ownerNick, user.id);

        return interaction.editReply(getMsg('ranking.responses.pilot.success', { pilotMember: pilotMember.toString(), count: db.users[user.id].pilotIds.length, nick: ownerNick }));
    }

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
        return interaction.editReply(getMsg('ranking.responses.forcesync.success'));
    }

    if (commandName === 'manualregister') {
        const targetMember = options.getMember('member');
        const nickname = options.getString('nickname').trim().normalize('NFC');

        const cacheHit = findNicknameInCache(nickname);

        if (cacheHit) {
            const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;

            confirmationCache[`${user.id}-manualregister`] = {
                targetId: targetMember.id,
                nickname: cacheHit.nickname,
                clan: cacheHit.clanName,
                worldId: cacheHit.worldId
            };

            return interaction.reply({
                content: getMsg('ranking.responses.manualregister.confirm', { nickname: cacheHit.nickname, clan: cacheHit.clanName, username: targetMember.displayName }) + `\n🌍 Server: **${serverName}**`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('confirm-manualregister-yes').setLabel('✅ Yes, register').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('confirm-manualregister-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                    )
                ],
                flags: 64
            });
        }

        db.users[targetMember.id] = {
            ...db.users[targetMember.id],
            nickname: nickname,
            registeredAt: new Date().toISOString(),
            manual: true 
        };
        if (!db.users[targetMember.id].pilotIds) db.users[targetMember.id].pilotIds = [];
        saveLocalStorage();

        // Assign member role directly
        if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        }

        return interaction.reply({
            content: getMsg('ranking.responses.manualregister.success', { nickname }),
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
            description: `${data.pilotIds ? data.pilotIds.length : 0} pilot(s)`,
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
}
