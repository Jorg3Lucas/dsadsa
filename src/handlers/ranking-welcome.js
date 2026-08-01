import {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { getMsg } from '../lang/lang.js';

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
