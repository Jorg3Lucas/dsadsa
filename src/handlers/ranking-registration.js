import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { WORLD_IDS, pendingRegistrations, adminChannelId } from '../core/ranking-constants.js';
import { lookupNickname, lookupTopNicknames } from '../core/ranking-service.js';

// ==========================================
// 👑 OWNER REGISTRATION MODAL HANDLER
// ==========================================
// Extracted from ranking-handlers.js to fix fuzzy auto-correction
// (nickname is never silently replaced — fuzzy match is only informational)

export async function handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};
    await interaction.deferReply({ flags: 64 });

    const nickname = interaction.fields.getTextInputValue('owner_nickname').trim().normalize('NFC');

    const existingUser = Object.entries(db.users).find(([id, data]) =>
        data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === nickname.toLowerCase()
    );
    if (existingUser) {
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but name already taken by user ${existingUser[0]}`);
        return interaction.editReply('❌ This character name is already registered by another user.');
    }

    const userId = interaction.user.id;

    // Look up nickname in ranking cache using centralized service
    const lookup = lookupNickname(nickname, db);

    // Get top suggestions for the select menu
    const topSuggestions = lookupTopNicknames(nickname, db, null, 2);
    const hasSuggestions = topSuggestions.some(s => s.nickname.toLowerCase() !== nickname.toLowerCase());

    // Always use the user's original nickname — no auto-correction
    pendingRegistrations[userId] = { nickname, timestamp: Date.now(), selectedNickname: nickname };

    if (!adminChannelId) {
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but admin channel not configured`);
        delete pendingRegistrations[userId];
        return interaction.editReply('❌ Admin approval channel not configured. Use !setadminchannel first.');
    }

    const adminChannel = interaction.guild.channels.cache.get(adminChannelId);
    if (!adminChannel) {
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but admin channel ${adminChannelId} not found`);
        delete pendingRegistrations[userId];
        return interaction.editReply('❌ Admin approval channel not found. Contact an administrator.');
    }

    let rankingStatus = '❌ Not found in ranking';
    let alliedClanStatus = '❌ Not in allied clan';
    let fuzzyNote = '';

    if (lookup.found) {
        rankingStatus = `✅ Found — ${lookup.serverName} (${lookup.clanName})`;

        if (!lookup.exactMatch && lookup.fuzzySuggestion) {
            fuzzyNote = `\n🔍 **Fuzzy suggestion:** "${nickname}" → "${lookup.fuzzySuggestion}"`;
            logEvent(`👑 ${interaction.user.tag} — fuzzy suggestion: "${nickname}" → "${lookup.fuzzySuggestion}" (${lookup.serverName})`);
        }

        if (lookup.inAlliedClan) {
            alliedClanStatus = '✅ Yes — Allied clan';
        }
    }

    const isMissingRankingOrAllied = !lookup.found || !lookup.inAlliedClan;

    // Build nickname select menu if there are suggestions
    let nicknameSelect = null;
    if (hasSuggestions) {
        const selectOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel(`📝 As typed: ${nickname.substring(0, 80)}`)
                .setValue(nickname)
                .setDescription('Use the nickname exactly as typed')
                .setDefault(true),
            ...topSuggestions
                .filter(s => s.nickname.toLowerCase() !== nickname.toLowerCase())
                .slice(0, 2)
                .map(s => new StringSelectMenuOptionBuilder()
                    .setLabel(`🔍 ${s.nickname.substring(0, 80)} (${s.serverName})`)
                    .setValue(s.nickname)
                    .setDescription(s.inAlliedClan ? `✅ Allied clan - ${s.clanName}` : `❌ Not allied - ${s.clanName}`)
                )
        ];

        nicknameSelect = new StringSelectMenuBuilder()
            .setCustomId(`select_reg_nickname_${userId}`)
            .setPlaceholder('Select which nickname to save (optional)')
            .addOptions(selectOptions);
    }

    const approveButtons = [
        new ButtonBuilder().setCustomId(`approve_owner_${userId}-yes`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
    ];

    if (isMissingRankingOrAllied) {
        approveButtons.push(
            new ButtonBuilder().setCustomId(`approve_owner_${userId}-temp`).setLabel('⏳ Approve Temporarily (3 days)').setStyle(ButtonStyle.Primary)
        );
    }

    approveButtons.push(
        new ButtonBuilder().setCustomId(`approve_owner_${userId}-no`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
    );

    const adminMsg = await adminChannel.send({
        content: `👑 **New Owner Registration**\n\n👤 **User:** ${interaction.user.toString()} (${interaction.user.tag})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${nickname}${fuzzyNote}\n🔍 **Ranking:** ${rankingStatus}${fuzzyNote}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}\n${hasSuggestions ? '\n📌 Use the **dropdown below** to select a different nickname before approving.' : ''}`,
        components: [
            ...(hasSuggestions ? [new ActionRowBuilder().addComponents(nicknameSelect)] : []),
            new ActionRowBuilder().addComponents(approveButtons)
        ]
    });

    pendingRegistrations[userId].channelId = adminChannel.id;
    pendingRegistrations[userId].messageId = adminMsg.id;
    pendingRegistrations[userId].selectedNickname = nickname;
    saveLocalStorage(); // Persist pending registration to survive bot restarts

    logEvent(`👑 ${interaction.user.tag} submitted owner registration for "${nickname}" — awaiting admin approval`);
    return interaction.editReply('✅ **Registration sent for approval!** An administrator will review it shortly.');
}

// ── Select Menu: Admin chooses nickname for registration ──
export async function handleSelectRegistrationNickname(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferUpdate();

    const userId = interaction.customId.replace('select_reg_nickname_', '');
    const selectedNick = interaction.values[0];
    const pending = pendingRegistrations[userId];

    if (!pending) {
        await interaction.followUp({ content: '⌛ This registration has expired or was already processed.', flags: 64 });
        return;
    }

    pending.selectedNickname = selectedNick;
    saveLocalStorage();

    const originalMsg = interaction.message.content;
    const updatedContent = originalMsg.includes('📌 Selected')
        ? originalMsg.replace(/📌 Selected: .+/, `📌 Selected: **${selectedNick}**`)
        : `${originalMsg}\n📌 Selected: **${selectedNick}**`;

    await interaction.editReply({
        content: updatedContent.substring(0, 1900),
        components: interaction.message.components
    }).catch(() => {});

    logEvent(`📌 Admin selected nickname "${selectedNick}" for registration ${userId} (was "${pending.nickname}")`);
}
