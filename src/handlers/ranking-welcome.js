import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { MEMBER_ROLE_ID } from '../core/ranking-constants.js';

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

    delete db.users[userId];
    saveLocalStorage();

    logEvent(`🗑️ ${interaction.user.tag} removed their own registration (${userData.nickname}) via welcome panel`);
    return interaction.editReply({
        content: `✅ **Registration removed.**\n\nYour member role was removed and your nickname was reset.\n\nYou can register again anytime with **👑 Register as Owner**.`,
        components: []
    });
}

// ── Welcome: Remove a pilot (self-service, owner removes their own pilot) ──
export async function handleWelcomeRemovePilot(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferReply({ flags: 64 });

    const userData = db.users[interaction.user.id];
    const isActuallyRegistered = userData && (userData.registeredAt || userData.manual === true);

    if (!isActuallyRegistered || !userData.pilotIds || userData.pilotIds.length === 0) {
        return interaction.editReply('❌ You have no pilots linked to your account.');
    }

    const menuOptions = [];
    for (const pilotId of userData.pilotIds) {
        const memberObj = await interaction.guild.members.fetch(pilotId).catch(() => null);
        const pilotTag = memberObj ? memberObj.user.tag : `Unknown (${pilotId})`;
        menuOptions.push({
            label: pilotTag.substring(0, 100),
            description: 'Click to remove this pilot',
            value: pilotId
        });
    }

    const pilotMenu = new StringSelectMenuBuilder()
        .setCustomId('select_pilot_to_remove')
        .setPlaceholder('Select a pilot to remove...')
        .addOptions(menuOptions);

    return interaction.editReply({
        content: '✈️ **Select a pilot to remove:**',
        components: [new ActionRowBuilder().addComponents(pilotMenu)]
    });
}
