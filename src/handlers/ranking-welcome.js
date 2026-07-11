import {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';

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
