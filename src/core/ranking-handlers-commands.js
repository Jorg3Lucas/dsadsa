// ==========================================
// 🖱️ RANKING — Slash Command Handlers
// /register, /pilot, /removepilot, /forcesync,
// /manualregister, /manualpilot, /manualremovepilot,
// /cleandb, /manage, /manualremove
// Extracted from ranking-handlers.js
// ==========================================

import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from './lang.js';
import { confirmationCache, CLAN_ROLES } from './ranking-constants.js';
import { getLocalRankingCache, findClosestNicknameInCache } from './ranking-cache.js';
import { runDailySynchronization } from './ranking-sync-engine.js';
import { noop } from "./config.js";
import { applyImmediateRoleWithCache } from './ranking-role.js';
import { handleManageSlashCommand } from './ranking-manage.js';

/** Handle the /register slash command — shows the registration modal. @param {import('discord.js').CommandInteraction} interaction @returns {Promise} */
export async function handleRegisterCommand(interaction) {
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

/** Handle the /pilot slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent @returns {Promise} */
export async function handlePilotCommand(interaction, db, saveLocalStorage) {
    await interaction.deferReply({ flags: 64 });
    const pilotMember = interaction.options.getMember('member');

    const userProfile = db.users[interaction.user.id];
    const isActuallyRegistered = userProfile && (userProfile.registeredAt || userProfile.manual === true);

    if (!isActuallyRegistered) {
        return interaction.editReply(getMsg('ranking.responses.pilot.notRegistered'));
    }

    if (pilotMember.id === interaction.user.id) return interaction.editReply(getMsg('ranking.responses.pilot.selfPilot'));

    if (!db.users[interaction.user.id].pilotIds) db.users[interaction.user.id].pilotIds = [];

    if (db.users[interaction.user.id].pilotIds.length >= 4) {
        return interaction.editReply(getMsg('ranking.responses.pilot.limitReached'));
    }

    if (db.users[interaction.user.id].pilotIds.includes(pilotMember.id)) {
        return interaction.editReply(getMsg('ranking.responses.pilot.alreadyLinked'));
    }

    db.users[interaction.user.id].pilotIds.push(pilotMember.id);
    saveLocalStorage();

    const ownerNick = db.users[interaction.user.id].nickname.trim().normalize('NFC');
    await pilotMember.setNickname(`${ownerNick} - Pilot`).catch(noop);
    await applyImmediateRoleWithCache(interaction, pilotMember, ownerNick, interaction.user.id);

    return interaction.editReply(getMsg('ranking.responses.pilot.success', {
        pilotMember: pilotMember.toString(),
        count: db.users[interaction.user.id].pilotIds.length,
        nick: ownerNick
    }));
}

/** Handle the /removepilot slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @returns {Promise} */
export async function handleRemovePilotCommand(interaction, db) {
    const userProfile = db.users[interaction.user.id];
    const isActuallyRegistered = userProfile && (userProfile.registeredAt || userProfile.manual === true);

    if (!isActuallyRegistered || !userProfile.pilotIds || userProfile.pilotIds.length === 0) {
        return interaction.reply({ content: getMsg('ranking.responses.removepilot.noPilots'), flags: 64 });
    }

    const menuOptions = [];
    for (const pilotId of userProfile.pilotIds) {
        const memberObj = await interaction.guild.members.fetch(pilotId).catch(() => null);
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

/** Handle the /forcesync slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent @returns {Promise} */
export async function handleForceSyncCommand(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferReply({ flags: 64 });
    logEvent(getMsg('ranking.responses.forcesync.log', { tag: interaction.user.tag }));
    await runDailySynchronization(interaction.client, db, saveLocalStorage, logEvent, true);
    return interaction.editReply(getMsg('ranking.responses.forcesync.success'));
}

/** Handle the /manage slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @returns {Promise} */
export async function handleManageCommand(interaction, db) {
    return handleManageSlashCommand(interaction, db);
}

/** Handle the /manualregister slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent @returns {Promise} */
export async function handleManualRegisterCommand(interaction, db, saveLocalStorage, logEvent) {
    const targetMember = interaction.options.getMember('member');
    const nickname = interaction.options.getString('nickname').trim().normalize('NFC');

    const localCache = getLocalRankingCache() || {};
    const exactMatchKey = Object.keys(localCache).find(k => k.normalize('NFC').toLowerCase() === nickname.toLowerCase());

    if (exactMatchKey) {
        const foundClan = localCache[exactMatchKey];

        confirmationCache[`${interaction.user.id}-manualregister`] = {
            targetId: targetMember.id,
            nickname: exactMatchKey,
            clan: foundClan
        };

        return interaction.reply({
            content: getMsg('ranking.responses.manualregister.confirm', {
                nickname: exactMatchKey, clan: foundClan, username: targetMember.displayName
            }),
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-manualregister-yes').setLabel('✅ Yes, register').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('confirm-manualregister-no').setLabel('❌ No, cancel').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64
        });
    }

    // ── Fuzzy match
    const fuzzyMatch = findClosestNicknameInCache(nickname, localCache);
    if (fuzzyMatch && fuzzyMatch.nickname.toLowerCase() !== nickname.toLowerCase()) {
        confirmationCache[`${interaction.user.id}-manualregisterfuzzy`] = {
            targetId: targetMember.id,
            nickname: fuzzyMatch.nickname,
            clan: fuzzyMatch.clanName,
            originalTypedName: nickname
        };
        logEvent(`👑 Admin ${interaction.user.tag} — fuzzy corrected "${nickname}" → "${fuzzyMatch.nickname}" in /manualregister`);

        return interaction.reply({
            content: `🔍 **Fuzzy match found:** "${nickname}" → **${fuzzyMatch.nickname}** in **${fuzzyMatch.clanName}**\n\nRegister **${targetMember.displayName}** with this suggestion?`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm-manualregisterfuzzy-yes').setLabel('✅ Use suggestion').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('confirm-manualregisterfuzzy-ignore').setLabel('✍️ Register as typed').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('confirm-manualregisterfuzzy-no').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary)
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

    const selectOptions = Object.keys(CLAN_ROLES).map(clanName => ({
        label: clanName,
        description: getMsg('ranking.responses.manualregister.optionDescription', { clanName }),
        value: clanName
    }));

    const menuComponent = new StringSelectMenuBuilder()
        .setCustomId(`select_clan_manual_${targetMember.id}`)
        .setPlaceholder(getMsg('ranking.responses.manualregister.menuPlaceholder'))
        .addOptions(selectOptions);

    const actionRow = new ActionRowBuilder().addComponents(menuComponent);

    return interaction.reply({
        content: getMsg('ranking.responses.manualregister.cacheNotFound', { nickname }),
        components: [actionRow],
        flags: 64
    });
}

/** Handle the /manualpilot slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @returns {Promise} */
export async function handleManualPilotCommand(interaction, db) {
    const ownerMember = interaction.options.getMember('owner');
    const pilotMember = interaction.options.getMember('pilot');

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

    confirmationCache[`${interaction.user.id}-manualpilot`] = {
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

/** Handle the /manualremovepilot slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @returns {Promise} */
export async function handleManualRemovePilotCommand(interaction, db) {
    const ownerMember = interaction.options.getMember('owner');
    const pilotMember = interaction.options.getMember('pilot');

    if (!db.users[ownerMember.id]) {
        return interaction.reply({ content: getMsg('ranking.responses.manualremovepilot.ownerNotRegistered', { displayName: ownerMember.displayName }), flags: 64 });
    }

    if (!db.users[ownerMember.id].pilotIds || !db.users[ownerMember.id].pilotIds.includes(pilotMember.id)) {
        return interaction.reply({ content: getMsg('ranking.responses.manualremovepilot.notLinked', { pilotDisplay: pilotMember.displayName }), flags: 64 });
    }

    confirmationCache[`${interaction.user.id}-manualremovepilot`] = {
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

/** Handle the /manualremove slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @returns {Promise} */
export async function handleManualRemoveCommand(interaction, db) {
    const targetMember = interaction.options.getMember('member');

    if (!db.users[targetMember.id]) return interaction.reply({ content: getMsg('ranking.responses.manualremove.noRegistration'), flags: 64 });

    confirmationCache[`${interaction.user.id}-manualremove`] = {
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

/** Handle the /cleandb slash command. @param {import('discord.js').CommandInteraction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent @returns {Promise} */
export async function handleCleanDbCommand(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferReply({ flags: 64 });
    const seenNicknames = {};
    const duplicatesRemoved = [];

    for (const [memberId, userData] of Object.entries(db.users)) {
        const cleanNick = userData.nickname.trim().normalize('NFC').toLowerCase();
        if (!seenNicknames[cleanNick]) seenNicknames[cleanNick] = [];
        seenNicknames[cleanNick].push({ id: memberId, ...userData });
    }

    for (const [, userList] of Object.entries(seenNicknames)) {
        if (userList.length > 1) {
            let realOwnerId = null;
            for (const u of userList) {
                const member = await interaction.guild.members.fetch(u.id).catch(() => null);
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
