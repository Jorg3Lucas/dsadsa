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
import { removeMemberRoles } from '../core/clan-roles.js';

// ==========================================
// 👋 WELCOME BUTTON HANDLERS
// ==========================================
// Extracted from ranking-handlers.js

// ── Shared panel component builder (used by /sendpanel + restoreWelcomePanel) ──
export function buildWelcomePanelComponents() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('welcome_register_owner')
            .setLabel('👑 Register as Owner')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('welcome_register_pilot')
            .setLabel('✈️ Register as Pilot')
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('welcome_remove_registration')
            .setLabel('🗑️ Remove My Registration')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('welcome_remove_pilot')
            .setLabel('✈️ Remove Pilot')
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

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

// ── Welcome: Remove my registration (self-service) ──
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
        warning = `\n\n⚠️ You have **${pilotCount} pilot(s)** linked to your account — they will lose their member roles too.`;
    } else if (isPilot) {
        warning = '\n\n⚠️ You are registered as a **pilot** of another owner.';
    }

    return interaction.editReply({
        content: `🗑️ **Remove your registration?**\n\nYou are registered as **${userData.nickname}**.${warning}\n\nThis will **remove your member roles**, **reset your nickname** and **delete your registration**. This cannot be undone.`,
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
    for (const [ownerId, ownerData] of Object.entries(db.users)) {
        if (ownerData.pilotIds && ownerData.pilotIds.includes(userId)) {
            ownerData.pilotIds = ownerData.pilotIds.filter(id => id !== userId);
        }
    }

    // If the user is an owner with pilots, unlink + strip roles/nicknames
    if (userData.pilotIds && userData.pilotIds.length > 0) {
        for (const pId of userData.pilotIds) {
            const pilotMember = await guild.members.fetch(pId).catch(() => null);
            if (pilotMember) {
                await removeMemberRoles(pilotMember, db);
                await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
            }
        }
    }

    const selfMember = await guild.members.fetch(userId).catch(() => null);
    if (selfMember) {
        await removeMemberRoles(selfMember, db);
        await selfMember.setNickname(selfMember.user.username).catch(() => {});
    }

    delete db.users[userId];
    saveLocalStorage();

    logEvent(`🗑️ ${interaction.user.tag} removed their own registration (${userData.nickname}) via welcome panel`);
    return interaction.editReply({
        content: `✅ **Registration removed.**\n\nYour member roles were removed and your nickname was reset.\n\nYou can register again anytime with **👑 Register as Owner**.`,
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
