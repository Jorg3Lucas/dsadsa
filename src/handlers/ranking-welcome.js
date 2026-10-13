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
import { lookupNickname } from '../core/ranking-service.js';
import { setMemberNickname } from '../core/ranking-utils.js';

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
            .setCustomId('welcome_my_registration')
            .setLabel('📋 My Registration')
            .setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('welcome_remove_registration')
            .setLabel('🗑️ Remove My Registration')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('welcome_remove_pilot')
            .setLabel('✈️ Remove Pilot')
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2, row3];
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
    try {
        await interaction.deferReply({ flags: 64 });
    } catch (e) {
        console.warn(`⚠️ [Welcome] deferReply failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

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
    try {
        await interaction.deferUpdate();
    } catch (e) {
        console.warn(`⚠️ [Welcome] deferUpdate failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

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

    // Fetch + clean up every linked pilot AND the user concurrently — each
    // member's role removal + nickname reset are independent Discord calls.
    const pilotCleanups = (userData.pilotIds || []).map(async (pId) => {
        const pilotMember = await guild.members.fetch(pId).catch(() => null);
        if (!pilotMember) return;
        if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
        }
        await setMemberNickname(pilotMember, pilotMember.user.username, logEvent);
    });
    const selfCleanup = (async () => {
        const selfMember = await guild.members.fetch(userId).catch(() => null);
        if (!selfMember) return;
        if (selfMember.roles.cache.has(MEMBER_ROLE_ID)) {
            await selfMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
        }
        await setMemberNickname(selfMember, selfMember.user.username, logEvent);
    })();
    await Promise.all([...pilotCleanups, selfCleanup]);

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
    try {
        await interaction.deferReply({ flags: 64 });
    } catch (e) {
        console.warn(`⚠️ [Welcome] deferReply failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

    const userData = db.users[interaction.user.id];
    const isActuallyRegistered = userData && (userData.registeredAt || userData.manual === true);

    if (!isActuallyRegistered || !userData.pilotIds || userData.pilotIds.length === 0) {
        return interaction.editReply('❌ You have no pilots linked to your account.');
    }

    // Fetch all pilots concurrently to build the menu (independent lookups).
    const menuOptions = await Promise.all(userData.pilotIds.map(async (pilotId) => {
        const memberObj = await interaction.guild.members.fetch(pilotId).catch(() => null);
        const pilotTag = memberObj ? memberObj.user.tag : `Unknown (${pilotId})`;
        return {
            label: pilotTag.substring(0, 100),
            description: 'Click to remove this pilot',
            value: pilotId
        };
    }));

    const pilotMenu = new StringSelectMenuBuilder()
        .setCustomId('select_pilot_to_remove')
        .setPlaceholder('Select a pilot to remove...')
        .addOptions(menuOptions);

    return interaction.editReply({
        content: '✈️ **Select a pilot to remove:**',
        components: [new ActionRowBuilder().addComponents(pilotMenu)]
    });
}

// ── Welcome: "My Registration" (self-service status) ──
export async function handleWelcomeMyRegistration(interaction, db, saveLocalStorage, logEvent) {
    try {
        await interaction.deferReply({ flags: 64 });
    } catch (e) {
        console.warn(`⚠️ [Welcome] deferReply failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

    const userId = interaction.user.id;
    const userData = db.users[userId];
    const isActuallyRegistered = userData && (userData.registeredAt || userData.manual === true);

    // Not an owner — maybe they are a pilot of someone.
    if (!isActuallyRegistered) {
        const ownerEntry = Object.entries(db.users).find(([, d]) => d.pilotIds && d.pilotIds.includes(userId));
        if (ownerEntry) {
            return interaction.editReply(`✈️ **You are a pilot for ${ownerEntry[1].nickname}.**\n\nYour nickname and role are managed by the owner. Contact them if you need anything.`);
        }
        return interaction.editReply('📋 **You have no registration yet.**\n\nClick **👑 Register as Owner** (main account) or **✈️ Register as Pilot** (you play for someone else) to get started.');
    }

    const lines = ['📋 **My Registration**\n'];
    lines.push(`📝 **In-game name:** ${userData.nickname}`);

    if (userData.tempUntil) {
        const expires = new Date(userData.tempUntil);
        const hoursLeft = (expires.getTime() - Date.now()) / (1000 * 60 * 60);
        lines.push('⏳ **Type:** Temporary (up to 3 days)');
        lines.push(`⏰ **Expires:** ${expires.toLocaleString('en-US')} (${hoursLeft > 0 ? `${hoursLeft.toFixed(1)}h left` : 'expired'})`);
    } else {
        lines.push('✅ **Type:** Permanent');
    }

    const pilotCount = userData.pilotIds ? userData.pilotIds.length : 0;
    lines.push(`✈️ **Linked pilots:** ${pilotCount}`);

    const lookup = lookupNickname(userData.nickname, db);
    if (lookup.found) {
        lines.push(`🔍 **Ranking:** ✅ ${lookup.serverName} (${lookup.clanName})`);
        lines.push(`🤝 **Allied clan:** ${lookup.inAlliedClan ? '✅ Yes' : '❌ No'}`);
        if (lookup.inAlliedClan === false) {
            lines.push('\nℹ️ Join an **allied clan** that appears in the ranking to keep your role.');
        }
    } else {
        lines.push('🔍 **Ranking:** ❌ Not found');
    }

    if (pilotCount > 0) {
        const pilotLines = await Promise.all(userData.pilotIds.map(async (pId) => {
            const m = await interaction.guild.members.fetch(pId).catch(() => null);
            return `• ${m ? m.user.tag : `<@${pId}>`}`;
        }));
        lines.push(`\n👥 **Pilots:**\n${pilotLines.join('\n')}`);
    }

    logEvent(`📋 ${interaction.user.tag} checked their own registration (${userData.nickname})`);
    return interaction.editReply(lines.join('\n'));
}
