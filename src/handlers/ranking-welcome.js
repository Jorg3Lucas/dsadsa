import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import { MEMBER_ROLE_ID } from '../core/ranking-constants.js';

// ==========================================
// 👋 WELCOME BUTTON HANDLERS
// ==========================================
// Extracted from ranking-handlers.js

// ── Welcome: Register as Owner ──
export function handleWelcomeRegisterOwner(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('register_owner_modal')
        .setTitle('📝 Register Main Account');

    const nicknameInput = new TextInputBuilder()
        .setCustomId('owner_nickname')
        .setLabel('Your EXACT in-game name — one account only')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Type your exact character name as shown in MIR4')
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(nicknameInput));
    return interaction.showModal(modal);
}

// ── Welcome: Register as Pilot ──
export function handleWelcomeRegisterPilot(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('register_pilot_modal')
        .setTitle('✈️ Register as Pilot');

    const ownerNickInput = new TextInputBuilder()
        .setCustomId('owner_nickname')
        .setLabel("Owner's in-game character nickname")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Enter the owner's nickname")
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(ownerNickInput));
    return interaction.showModal(modal);
}

// ── Welcome: Remove my own registration (self-service) ──
export async function handleWelcomeRemoveRegistration(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const userData = db.users[userId];

    const isActuallyRegistered = userData && (userData.registeredAt || userData.manual === true);
    if (!isActuallyRegistered) {
        return interaction.editReply('❌ You are not registered. Use **👑 Register as Owner** first.');
    }

    const isPilot = Object.entries(db.users).some(([, d]) => d.pilotIds && d.pilotIds.includes(userId));
    const pilotCount = userData.pilotIds ? userData.pilotIds.length : 0;

    let warning = '';
    if (pilotCount > 0) {
        warning = `\n\n⚠️ You have **${pilotCount} pilot(s)** linked to your account — they will lose their member role too.`;
    } else if (isPilot) {
        warning = '\n\n⚠️ You are registered as a **pilot** of another owner.';
    }

    return interaction.editReply({
        content: `🗑️ **Remove your registration?**\n\nYou are registered as **${userData.nickname}**.${warning}\n\nThis will **remove your member role**, **reset your nickname** and **delete your registration**. This cannot be undone.`,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('selfremove_yes').setLabel('✅ Yes, remove').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('selfremove_no').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary)
            )
        ]
    });
}

// ── Confirm: remove my own registration ──
export async function handleSelfRemoveConfirm(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferUpdate();

    if (interaction.customId === 'selfremove_no') {
        return interaction.editReply({ content: '❌ Cancelled.', components: [] });
    }

    const userId = interaction.user.id;
    const userData = db.users[userId];
    if (!userData) {
        return interaction.editReply({ content: '❌ You are not registered.', components: [] });
    }

    const guild = interaction.guild;

    // If the user is a pilot of someone, unlink them from that owner
    for (const ownerData of Object.values(db.users)) {
        if (ownerData.pilotIds && ownerData.pilotIds.includes(userId)) {
            ownerData.pilotIds = ownerData.pilotIds.filter(id => id !== userId);
        }
    }

    // If the user is an owner with pilots, unlink + strip roles/nicknames
    if (userData.pilotIds && userData.pilotIds.length > 0) {
        for (const pId of userData.pilotIds) {
            const pilotMember = await guild.members.fetch(pId).catch(() => null);
            if (pilotMember) {
                if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                }
                await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
            }
        }
    }

    const selfMember = await guild.members.fetch(userId).catch(() => null);
    if (selfMember) {
        if (selfMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await selfMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
        }
        await selfMember.setNickname(selfMember.user.username).catch(() => {});
    }

    const removedNickname = userData.nickname;
    delete db.users[userId];
    saveLocalStorage();

    logEvent(`🗑️ ${interaction.user.tag} removed their own registration (${removedNickname}) via welcome panel`);
    return interaction.editReply({
        content: '✅ **Registration removed.**\n\nYour member role was removed and your nickname was reset.\n\nYou can register again anytime with **👑 Register as Owner**.',
        components: []
    });
}

// ── Welcome: Remove Pilot ──
// Shows the same pilot-removal select menu as /removepilot so the
// existing handlePilotRemoveSelect (customId 'select_pilot_to_remove')
// handles the actual removal, role cleanup, and nickname reset.
export async function handleWelcomeRemovePilot(interaction, db) {
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

        menuOptions.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(pilotTag.substring(0, 100))
                .setDescription(`${pilotNick} - ${getMsg('ranking.responses.removepilot.optionDescription')}`)
                .setValue(pilotId)
        );
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
