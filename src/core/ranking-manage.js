// ==========================================
// 🗂️ RANKING — Manage Menu Handlers
// Extracted from ranking-handlers.js
// ==========================================

import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} from 'discord.js';
import { getMsg } from './lang.js';
import { confirmationCache, CLAN_ROLES } from './ranking-constants.js';
import { noop } from "./config.js";

const PAGE_SIZE = 25;

// ── /manage slash command ──
/** Show the /manage user list with pagination. @param {import('discord.js').CommandInteraction} interaction @param {object} db */
export async function handleManageSlashCommand(interaction, db) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: 64 });
    }
    const sorted = buildUserList(db);
    if (sorted.length === 0) {
        return interaction.reply({ content: getMsg('ranking.responses.manage.noUsers'), flags: 64 });
    }
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    const pageItems = sorted.slice(0, PAGE_SIZE);
    const selectOptions = pageItems.map(([id, data]) => ({
        label: data.nickname.substring(0, 100),
        description: `${data.pilotIds ? data.pilotIds.length : 0} pilot(s)`,
        value: id
    }));
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('manage_user_page_0')
        .setPlaceholder(getMsg('ranking.responses.manage.listPlaceholder'))
        .addOptions(selectOptions);
    const components = [new ActionRowBuilder().addComponents(selectMenu)];
    if (totalPages > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('manage_user_prev_0').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('manage_user_next_0').setLabel('Next ▶️').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1)
        ));
    }
    return interaction.reply({
        content: getMsg('ranking.responses.manage.pageInfo', { current: 1, total: totalPages, count: sorted.length }),
        components,
        flags: 64
    });
}

/** Show action menu for a selected user. @param {import('discord.js').Interaction} interaction @param {object} db */
export async function handleManageUserPage(interaction, db) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(noop);
    }
    const targetUserId = interaction.values[0];
    const userData = db.users[targetUserId];
    if (!userData) {return interaction.update({ content: '❌ User no longer registered.', components: [] }).catch(noop);}

    const actionOptions = [
        { label: getMsg('ranking.responses.manage.actionRemove'), description: getMsg('ranking.responses.manage.actionRemoveDesc'), value: `remove_${targetUserId}` },
        { label: getMsg('ranking.responses.manage.actionClan'), description: getMsg('ranking.responses.manage.actionClanDesc'), value: `clan_${targetUserId}` }
    ];
    if (userData.pilotIds && userData.pilotIds.length > 0) {
        actionOptions.push({ label: getMsg('ranking.responses.manage.actionPilot'), description: getMsg('ranking.responses.manage.actionPilotDesc'), value: `pilot_${targetUserId}` });
    }

    const actionMenu = new StringSelectMenuBuilder()
        .setCustomId(`manage_action_${targetUserId}`).setPlaceholder('Select an action...').addOptions(actionOptions);
    const backButton = new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary);

    return interaction.update({
        content: getMsg('ranking.responses.manage.actionPrompt', { username: userData.nickname }),
        components: [new ActionRowBuilder().addComponents(actionMenu), new ActionRowBuilder().addComponents(backButton)]
    }).catch(noop);
}

/** Handle action selection (remove/clan/pilot) for a managed user. @param {import('discord.js').Interaction} interaction @param {object} db */
export async function handleManageAction(interaction, db) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(noop);
    }
    const [actionType, targetUserId] = interaction.values[0].split('_', 2);
    const userData = db.users[targetUserId];
    if (!userData) {return interaction.update({ content: '❌ User no longer registered.', components: [] }).catch(noop);}

    if (actionType === 'remove') {
        confirmationCache[`${interaction.user.id}-manualremove`] = { targetId: targetUserId, targetName: userData.nickname };
        return interaction.update({
            content: getMsg('ranking.responses.manage.actionRemoveConfirm', { username: userData.nickname }),
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('confirm-manualremove-yes').setLabel('✅ Yes, remove').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('confirm-manualremove-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary)
            )]
        }).catch(noop);
    }

    if (actionType === 'clan') {
        const clanOptions = Object.keys(CLAN_ROLES).map(clanName => ({ label: clanName, value: clanName }));
        const clanMenu = new StringSelectMenuBuilder().setCustomId(`select_clan_manual_${targetUserId}`).setPlaceholder('Select a clan...').addOptions(clanOptions);
        return interaction.update({
            content: getMsg('ranking.responses.selectClanMenu.prompt', { nickname: userData.nickname }),
            components: [new ActionRowBuilder().addComponents(clanMenu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary))]
        }).catch(noop);
    }

    if (actionType === 'pilot') {
        if (!userData.pilotIds || userData.pilotIds.length === 0) {return interaction.update({ content: getMsg('ranking.responses.manage.noPilots', { username: userData.nickname }), components: [] }).catch(noop);}
        const pilotOptions = [];
        for (const pId of userData.pilotIds) {
            const memberObj = await interaction.guild.members.fetch(pId).catch(() => null);
            pilotOptions.push({ label: (memberObj ? memberObj.user.tag : `Unknown (${pId})`).substring(0, 100), value: pId });
        }
        const pilotMenu = new StringSelectMenuBuilder().setCustomId(`manage_pilot_${targetUserId}`).setPlaceholder(getMsg('ranking.responses.manage.pilotSelectPlaceholder')).addOptions(pilotOptions);
        return interaction.update({
            content: getMsg('ranking.responses.manage.removePilotConfirm', { username: userData.nickname }),
            components: [new ActionRowBuilder().addComponents(pilotMenu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('manage_back').setLabel(getMsg('ranking.responses.manage.back')).setStyle(ButtonStyle.Secondary))]
        }).catch(noop);
    }

    return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(noop);
}

/** Remove a pilot from a user's roster via manage menu. @param {import('discord.js').Interaction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent */
export async function handleManagePilot(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(noop);
    }
    const targetUserId = interaction.customId.replace('manage_pilot_', '');
    const pilotToRemoveId = interaction.values[0];
    const userData = db.users[targetUserId];
    if (!userData || !userData.pilotIds || !userData.pilotIds.includes(pilotToRemoveId)) {return interaction.update({ content: '❌ This pilot is no longer linked.', components: [] }).catch(noop);}

    userData.pilotIds = userData.pilotIds.filter(id => id !== pilotToRemoveId);
    saveLocalStorage();
    interaction.guild.members.fetch(pilotToRemoveId).then(async (pilotMember) => {
        if (pilotMember) {
            for (const roleId of Object.values(CLAN_ROLES)) {if (pilotMember.roles.cache.has(roleId)) {await pilotMember.roles.remove(roleId).catch(noop);}}
            await pilotMember.setNickname(pilotMember.user.username).catch(noop);
        }
    }).catch(noop);
    logEvent(`Admin ${interaction.user.tag} removed pilot ${pilotToRemoveId} from ${targetUserId} via manage menu`);
    return interaction.update({ content: '✅ Pilot removed successfully.', components: [] }).catch(noop);
}

function buildUserList(db) {
    return Object.entries(db.users || {}).filter(([_id, data]) => data && data.nickname)
        .sort((a, b) => a[1].nickname.localeCompare(b[1].nickname));
}

/** Handle pagination navigation (prev/next/back) in the manage menu. @param {import('discord.js').Interaction} interaction @param {object} db */
export async function handleManageNavigation(interaction, db) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.update({ content: '❌ Permission denied.', components: [] }).catch(noop);
    }
    if (interaction.customId === 'manage_back') {
        const sorted = buildUserList(db);
        if (sorted.length === 0) {return interaction.update({ content: getMsg('ranking.responses.manage.noUsers'), components: [] }).catch(noop);}
        const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
        const pageItems = sorted.slice(0, PAGE_SIZE);
        const selectOptions = pageItems.map(([id, data]) => ({ label: data.nickname.substring(0, 100), description: `${data.pilotIds ? data.pilotIds.length : 0} pilot(s)`, value: id }));
        const selectMenu = new StringSelectMenuBuilder().setCustomId('manage_user_page_0').setPlaceholder(getMsg('ranking.responses.manage.listPlaceholder')).addOptions(selectOptions);
        const components = [new ActionRowBuilder().addComponents(selectMenu)];
        if (totalPages > 1) {
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('manage_user_prev_0').setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('manage_user_next_0').setLabel('Next ▶️').setStyle(ButtonStyle.Primary)
            ));
        }
        return interaction.update({ content: getMsg('ranking.responses.manage.pageInfo', { current: 1, total: totalPages, count: sorted.length }), components }).catch(noop);
    }

    const [, , , pageStr] = interaction.customId.split('_');
    const currentPage = parseInt(pageStr, 10);
    const newPage = interaction.customId.includes('next') ? currentPage + 1 : currentPage - 1;
    const sorted = buildUserList(db);
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    if (newPage < 0 || newPage >= totalPages) {return interaction.deferUpdate().catch(noop);}

    const pageItems = sorted.slice(newPage * PAGE_SIZE, (newPage + 1) * PAGE_SIZE);
    const selectOptions = pageItems.map(([id, data]) => ({ label: data.nickname.substring(0, 100), description: `${data.pilotIds ? data.pilotIds.length : 0} pilot(s)`, value: id }));
    const selectMenu = new StringSelectMenuBuilder().setCustomId(`manage_user_page_${newPage}`).setPlaceholder(getMsg('ranking.responses.manage.listPlaceholder')).addOptions(selectOptions);
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`manage_user_prev_${newPage}`).setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 0),
        new ButtonBuilder().setCustomId(`manage_user_next_${newPage}`).setLabel('Next ▶️').setStyle(ButtonStyle.Primary).setDisabled(newPage >= totalPages - 1)
    );
    return interaction.update({ content: getMsg('ranking.responses.manage.pageInfo', { current: newPage + 1, total: totalPages, count: sorted.length }), components: [new ActionRowBuilder().addComponents(selectMenu), navRow] }).catch(noop);
}
