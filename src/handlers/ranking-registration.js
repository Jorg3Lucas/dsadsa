import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { pendingRegistrations, adminChannelId, MAX_NICKNAME_SUGGESTIONS, resolveServerName } from '../core/ranking-constants.js';
import { lookupNickname, lookupTopNicknames, lookupNicknameWithSearch } from '../core/ranking-service.js';
import { findNicknameOwner } from '../core/ranking-dedup.js';
import { buildOwnerApprovalButtons } from './ranking-approvals.js';

// ==========================================
// 👑 OWNER REGISTRATION MODAL HANDLER
// ==========================================
// The user first confirms their EXACT character name via fuzzy suggestions (if any),
// then the request is sent to the admin channel for approval.

export async function handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};
    try {
        await interaction.deferReply({ flags: 64 });
    } catch (e) {
        // Interaction expired (10062) or already acknowledged — can't respond
        console.warn(`⚠️ [Registration] deferReply failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

    const nickname = interaction.fields.getTextInputValue('owner_nickname').trim().normalize('NFC');
    const userId = interaction.user.id;

    // ── Check if user already has a registration (can't register a second account) ──
    if (db.users[userId] && (db.users[userId].registeredAt || db.users[userId].manual === true)) {
        const existingNick = db.users[userId].nickname;
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but already registered as "${existingNick}" — rejected`);
        return interaction.editReply(`❌ **You are already registered!**\nYour account is already registered as **${existingNick}**.\n\nIf you need to update your nickname, contact an administrator.\nYou cannot register a second account.`);
    }

    const nicknameOwner = findNicknameOwner(db.users, nickname, userId);
    if (nicknameOwner) {
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but name already taken by user ${nicknameOwner.id}`);
        return interaction.editReply('❌ This character name is already registered by another user.');
    }

    // ── Fuzzy suggestions: let the USER pick the exact name before approval ──
    const topSuggestions = lookupTopNicknames(nickname, db, null, MAX_NICKNAME_SUGGESTIONS);
    const suggestions = topSuggestions.filter(s => s.nickname.toLowerCase() !== nickname.toLowerCase());

    if (suggestions.length > 0) {
        // Preserve any admin-panel reference from a previous submission so the
        // resubmission can UPDATE that panel instead of posting a duplicate.
        pendingRegistrations[userId] = {
            ...pendingRegistrations[userId],
            nickname,
            timestamp: Date.now(),
            selectedNickname: nickname,
            awaitingSelection: true
        };
        saveLocalStorage();

        const selectOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel(`📝 As typed: ${nickname.substring(0, 80)}`)
                .setValue(nickname)
                .setDescription('Use the nickname exactly as typed')
                .setDefault(true),
            ...suggestions.slice(0, MAX_NICKNAME_SUGGESTIONS).map(s => new StringSelectMenuOptionBuilder()
                .setLabel(`🔍 ${s.nickname.substring(0, 80)} (${s.serverName})`)
                .setValue(s.nickname)
                .setDescription(s.inAlliedClan ? `✅ Allied clan - ${s.clanName}` : `❌ Not allied - ${s.clanName}`)
            )
        ];

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`user_select_reg_nickname_${userId}`)
                .setPlaceholder('Select your EXACT character name')
                .addOptions(selectOptions)
        );

        logEvent(`🔍 ${interaction.user.tag} submitted registration "${nickname}" — ${suggestions.length} fuzzy suggestion(s) shown for user to confirm`);
        return interaction.editReply({
            content: `🔍 **We found similar names in the ranking.**\n\nSelect your **EXACT** character name below to improve accuracy. If none matches, choose **📝 As typed** and an admin will review it.`,
            components: [row]
        });
    }

    return submitOwnerRegistration(interaction, db, saveLocalStorage, logEvent, userId, nickname);
}

// ── User confirms the exact nickname from the fuzzy suggestions ──
export async function handleUserSelectRegistrationNickname(interaction, db, saveLocalStorage, logEvent) {
    try {
        await interaction.deferUpdate();
    } catch (e) {
        console.warn(`⚠️ [Registration] deferUpdate failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

    const userId = interaction.customId.replace('user_select_reg_nickname_', '');
    const selectedNick = interaction.values[0];

    // The menu is ephemeral, but its custom id carries the intended user: never
    // let a different account alter someone else's pending registration.
    if (interaction.user.id !== userId) {
        return interaction.editReply({ content: '❌ This registration menu belongs to another user.', components: [] }).catch(() => {});
    }

    const pending = pendingRegistrations[userId];

    if (!pending || !pending.awaitingSelection) {
        return interaction.editReply({ content: '⌛ This registration has expired or was already submitted.', components: [] }).catch(() => {});
    }

    const nicknameOwner = findNicknameOwner(db.users, selectedNick, userId);
    if (nicknameOwner) {
        logEvent(`❌ ${interaction.user.tag} selected "${selectedNick}" but the name is already registered by ${nicknameOwner.id}`);
        return interaction.editReply({
            content: `❌ **That character name is already registered by another user.**\nPick a different name from the menu below.`,
            components: interaction.message?.components || []
        }).catch(() => {});
    }

    delete pending.awaitingSelection;
    pending.selectedNickname = selectedNick;
    saveLocalStorage();

    logEvent(`🔍 ${interaction.user.tag} confirmed exact nickname "${selectedNick}" for registration (was "${pending.nickname}")`);
    return submitOwnerRegistration(interaction, db, saveLocalStorage, logEvent, userId, selectedNick);
}

// ── Shared: create the pending registration and notify the admin channel ──
async function submitOwnerRegistration(interaction, db, saveLocalStorage, logEvent, userId, nickname) {
    // Final gate: the nickname must still be free (it may have been registered
    // by someone else while this user was choosing from the suggestions).
    const nicknameOwner = findNicknameOwner(db.users, nickname, userId);
    if (nicknameOwner) {
        // Keep the pending record (and the selection menu) so the user can retry
        // with another name instead of losing the whole submission.
        logEvent(`❌ ${interaction.user.tag} tried to submit "${nickname}" but the name is already registered by ${nicknameOwner.id}`);
        return interaction.editReply({
            content: '❌ **This character name is already registered by another user.**\n\nContact an administrator if you believe this is a mistake.',
            components: []
        });
    }

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

    const lookup = await lookupNicknameWithSearch(nickname, db);

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

    const panelContent = `👑 **New Owner Registration**\n\n👤 **User:** ${interaction.user.toString()} (${interaction.user.tag})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${nickname}${fuzzyNote}\n🔍 **Ranking:** ${rankingStatus}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`;
    const panelComponents = [buildOwnerApprovalButtons(userId, lookup.found && lookup.inAlliedClan)];

    // A user can submit again while a previous request is still pending. Reuse the
    // existing admin panel (edit in place) so the channel is never spammed with
    // duplicate approval messages for the same person; only send a new one when
    // the previous message no longer exists.
    const previous = pendingRegistrations[userId];
    let adminMsg = null;
    if (previous?.channelId === adminChannel.id && previous?.messageId) {
        const existingMsg = await adminChannel.messages.fetch(previous.messageId).catch(() => null);
        if (existingMsg) {
            adminMsg = await existingMsg.edit({ content: panelContent, components: panelComponents }).catch(() => null);
        }
    }
    const reusedPanel = !!adminMsg;
    if (!adminMsg) {
        adminMsg = await adminChannel.send({ content: panelContent, components: panelComponents });
    }

    pendingRegistrations[userId] = {
        nickname,
        timestamp: Date.now(),
        selectedNickname: nickname,
        channelId: adminChannel.id,
        messageId: adminMsg.id
    };
    saveLocalStorage();

    logEvent(`👑 ${interaction.user.tag} submitted owner registration for "${nickname}" — ${reusedPanel ? 'admin approval panel updated' : 'awaiting admin approval'}`);
    return interaction.editReply('✅ **Registration sent for approval!** An administrator will review it shortly.');
}
