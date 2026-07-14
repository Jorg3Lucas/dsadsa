// ==========================================
// ✅ RANKING — Confirmation Button Handlers
// Extracted from ranking-handlers.js
// ==========================================

import {
    ActionRowBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import { getMsg } from './lang.js';
import { confirmationCache, CLAN_ROLES } from './ranking-constants.js';
import { applyImmediateRoleWithCache, applyClanRoleOnly } from './ranking-role.js';
import { noop } from "./config.js";

/** Handle confirmation button clicks for ranking admin actions (remove, register, pilot). @param {import('discord.js').Interaction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent */
export async function handleConfirmButtons(interaction, db, saveLocalStorage, logEvent) {
    const [_, action, result] = interaction.customId.split('-');
    const cacheKey = `${interaction.user.id}-${action}`;
    const cached = confirmationCache[cacheKey];

    if (!cached) {
        return interaction.update({ content: '⌛ This confirmation has expired. Please run the command again.', components: [] }).catch(noop);
    }

    if (result === 'no') {
        delete confirmationCache[cacheKey];
        return interaction.update({ content: '❌ Action cancelled.', components: [] }).catch(noop);
    }

    delete confirmationCache[cacheKey];

    if (action === 'manualremove') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
        if (!targetMember || !db.users[cached.targetId]) {
            return interaction.update({ content: '❌ Target user no longer available.', components: [] }).catch(noop);
        }
        const userData = db.users[cached.targetId];
        if (userData.pilotIds && userData.pilotIds.length > 0) {
            for (const pId of userData.pilotIds) {
                const pilotMember = await guild.members.fetch(pId).catch(() => null);
                if (pilotMember) {
                    for (const roleId of Object.values(CLAN_ROLES)) {await pilotMember.roles.remove(roleId).catch(noop);}
                    await pilotMember.setNickname(pilotMember.user.username).catch(noop);
                }
            }
        }
        for (const roleId of Object.values(CLAN_ROLES)) {
            if (targetMember.roles.cache.has(roleId)) {await targetMember.roles.remove(roleId).catch(noop);}
        }
        await targetMember.setNickname(targetMember.user.username).catch(noop);
        delete db.users[cached.targetId];
        saveLocalStorage();
        logEvent(`Admin ${interaction.user.tag} manually removed user ${cached.targetId}`);
        return interaction.update({ content: getMsg('ranking.responses.manualremove.success', { username: cached.targetName }), components: [] }).catch(noop);
    }

    if (action === 'manualremovepilot') {
        const guild = interaction.guild;
        const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
        const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);
        if (!ownerMember || !db.users[cached.ownerId]) {
            return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(noop);
        }
        if (!db.users[cached.ownerId].pilotIds || !db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
            return interaction.update({ content: '❌ This pilot is no longer linked.', components: [] }).catch(noop);
        }
        db.users[cached.ownerId].pilotIds = db.users[cached.ownerId].pilotIds.filter(id => id !== cached.pilotId);
        saveLocalStorage();
        if (pilotMember) {
            for (const roleId of Object.values(CLAN_ROLES)) {if (pilotMember.roles.cache.has(roleId)) {await pilotMember.roles.remove(roleId).catch(noop);}}
            await pilotMember.setNickname(pilotMember.user.username).catch(noop);
        }
        logEvent(`Admin ${interaction.user.tag} removed pilot ${cached.pilotName} from ${cached.ownerName}`);
        return interaction.update({ content: getMsg('ranking.responses.manualremovepilot.success', { ownerDisplay: cached.ownerName, pilotDisplay: cached.pilotName }), components: [] }).catch(noop);
    }

    if (action === 'manualpilot') {
        const guild = interaction.guild;
        const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
        const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);
        if (!ownerMember || !db.users[cached.ownerId]) {
            return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(noop);
        }
        if (!db.users[cached.ownerId].pilotIds) db.users[cached.ownerId].pilotIds = [];
        if (!db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {db.users[cached.ownerId].pilotIds.push(cached.pilotId);}
        saveLocalStorage();
        if (pilotMember) {await pilotMember.setNickname(`${cached.ownerNick} - Pilot`).catch(noop);}
        if (pilotMember) {applyImmediateRoleWithCache(interaction, pilotMember, cached.ownerNick, cached.ownerId).catch(noop);}
        logEvent(`Admin ${interaction.user.tag} manually linked pilot ${cached.pilotName} to ${cached.ownerName}`);
        return interaction.update({ content: getMsg('ranking.responses.manualpilot.success', { pilotMember: cached.pilotName, nick: cached.ownerNick }), components: [] }).catch(noop);
    }

    if (action === 'manualregister') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
        if (!targetMember) {return interaction.update({ content: '❌ Member no longer available.', components: [] }).catch(noop);}
        db.users[cached.targetId] = { ...db.users[cached.targetId], nickname: cached.nickname, registeredAt: new Date().toISOString() };
        if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
        if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;
        saveLocalStorage();
        await targetMember.setNickname(cached.nickname).catch(noop);
        await applyClanRoleOnly(interaction, targetMember, cached.clan);
        logEvent(`Admin ${interaction.user.tag} manually registered ${cached.targetId} as ${cached.nickname} in ${cached.clan}`);
        return interaction.update({ content: getMsg('ranking.responses.manualregister.cacheFound', { nickname: cached.nickname, clan: cached.clan }), components: [] }).catch(noop);
    }

    if (action === 'manualregisterfuzzy') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
        if (!targetMember) {return interaction.update({ content: '❌ Member no longer available.', components: [] }).catch(noop);}
        if (result === 'ignore') {
            db.users[cached.targetId] = { ...db.users[cached.targetId], nickname: cached.originalTypedName, registeredAt: new Date().toISOString(), manual: true };
            if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
            saveLocalStorage();
            const selectOptions = Object.keys(CLAN_ROLES).map(clanName => ({ label: clanName, description: getMsg('ranking.responses.manualregister.optionDescription', { clanName }), value: clanName }));
            const menuComponent = new StringSelectMenuBuilder()
                .setCustomId(`select_clan_manual_${cached.targetId}`)
                .setPlaceholder(getMsg('ranking.responses.manualregister.menuPlaceholder'))
                .addOptions(selectOptions);
            return interaction.update({ content: `✍️ Registering **${cached.originalTypedName}** as typed. Select the correct clan below:`, components: [new ActionRowBuilder().addComponents(menuComponent)] }).catch(noop);
        }
        db.users[cached.targetId] = { ...db.users[cached.targetId], nickname: cached.nickname, registeredAt: new Date().toISOString() };
        if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
        if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;
        saveLocalStorage();
        await targetMember.setNickname(cached.nickname).catch(noop);
        await applyClanRoleOnly(interaction, targetMember, cached.clan);
        logEvent(`Admin ${interaction.user.tag} manually registered ${cached.targetId} as ${cached.nickname} in ${cached.clan} (fuzzy corrected from "${cached.originalTypedName}")`);
        return interaction.update({ content: getMsg('ranking.responses.manualregister.cacheFound', { nickname: cached.nickname, clan: cached.clan }), components: [] }).catch(noop);
    }

    return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(noop);
}
