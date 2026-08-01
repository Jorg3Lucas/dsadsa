// ==========================================
// 🖱️ REGISTRATION — Panel Actions & Owner Registration
// Button router, register flows (owner + pilot), re-register confirm, modal submit
// Extracted from registration-panel.js
// ==========================================

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { confirmationCache, APPROVAL_CHANNEL_ID } from '../core/ranking-constants.js';
import { getLocalRankingCache, findClosestNicknameInCache, cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';
import { client } from '../core/state.js';
import {
    pendingOwnerRegistrations,
    saveRegistrationRequests,
    regEmbed,
    BUTTON_IDS,
    CONFIRM_EXPIRY_MS
} from './registration-shared.js';
import { handleRemovePilotButton, handleSyncButton, handleHelpButton } from './registration-settings.js';

// ==========================================

/** Main entry point for registration panel buttons. @param {import('discord.js').ButtonInteraction} interaction @param {object} rankingDb @param {Function} saveLocalStorage @param {Function} logEvent */
export async function handleRegPanelButtons(interaction, rankingDb, saveLocalStorage, logEvent) {
    const customId = interaction.customId;

    switch (customId) {
        case BUTTON_IDS.register:
            return handleRegisterButton(interaction, rankingDb, saveLocalStorage, logEvent);
        case BUTTON_IDS.registerPilot:
            return handleRegisterPilotButton(interaction, rankingDb);
        case BUTTON_IDS.removePilot:
            return handleRemovePilotButton(interaction, rankingDb);
        case BUTTON_IDS.sync:
            return handleSyncButton(interaction, rankingDb, saveLocalStorage, logEvent);
        case BUTTON_IDS.help:
            return handleHelpButton(interaction);
        default:
            return null;
    }
}

// ==========================================
// 📝 REGISTER BUTTON
// ==========================================

/** Opens the registration modal. */
async function handleRegisterButton(interaction, rankingDb, saveLocalStorage, logEvent) {
    // Check if already registered
    const userData = rankingDb.users[interaction.user.id];
    const isRegistered = userData && (userData.registeredAt || userData.manual === true);

    if (isRegistered) {
        // Show a confirmation to re-register
        const embed = regEmbed(
            '⚠️ Already Registered',
            '#FEE75C',
            `You are already registered as **${userData.nickname}**.\n\n` +
            'Re-registering will update your nickname. Continue?',
            'Click Cancel to keep your current registration'
        );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('reg_confirm_reregister')
                .setLabel('✅ Yes, re-register')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('reg_cancel_reregister')
                .setLabel('❌ Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        // Cache the confirmation with timestamp (expires after 5 minutes)
        confirmationCache[`${interaction.user.id}-reregister`] = { timestamp: Date.now() };

        return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
    }

    return showRegisterModal(interaction, rankingDb, saveLocalStorage, logEvent);
}

/** Shows the register modal. */
async function showRegisterModal(interaction, rankingDb, saveLocalStorage, logEvent) {
    const modal = new ModalBuilder()
        .setCustomId('reg_modal')
        .setTitle('📝 Register Your Character');

    const nicknameInput = new TextInputBuilder()
        .setCustomId('reg_nickname')
        .setLabel('Character Name (Exactly as in-game)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., xVraeL')
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(nicknameInput));
    return interaction.showModal(modal);
}

// ==========================================
// ✈️ REGISTER AS PILOT BUTTON
// ==========================================

/** Opens a modal for a user to register themselves as a pilot for an owner. */
async function handleRegisterPilotButton(interaction, rankingDb) {
    // Check if the user is already registered (they can't be a pilot AND an owner)
    const userData = rankingDb.users[interaction.user.id];
    const isRegistered = userData && (userData.registeredAt || userData.manual === true);

    if (isRegistered) {
        return interaction.reply({
            embeds: [
                regEmbed(
                    '❌ You Are Already Registered',
                    '#ED4245',
                    'You are already registered as a character owner (**' + userData.nickname + '**).\n\n' +
                    'If you want to be a pilot for someone else, ask the owner to use the **🗑️ Remove Pilot** button to free up a slot first.',
                    '✈️ Character Registration System'
                )
            ],
            flags: 64
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('reg_pilot_modal')
        .setTitle('✈️ Register as Pilot');

    const ownerNameInput = new TextInputBuilder()
        .setCustomId('reg_pilot_owner_name')
        .setLabel("Owner's Character Name (who you pilot for)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., xVraeL')
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(ownerNameInput)
    );

    return interaction.showModal(modal);
}

/** Handle the pilot registration modal submission. */
// ==========================================
// 🔁 RE-REGISTER CONFIRM
// ==========================================

/** Handle re-register confirmation. */
export async function handleReRegisterConfirm(interaction, rankingDb, saveLocalStorage, logEvent) {
    const cacheKey = `${interaction.user.id}-reregister`;
    const cache = confirmationCache[cacheKey];
    if (!cache || (Date.now() - cache.timestamp > CONFIRM_EXPIRY_MS)) {
        delete confirmationCache[cacheKey];
        return interaction.update({ content: '⌛ This confirmation has expired.', components: [], flags: 64 });
    }
    delete confirmationCache[cacheKey];
    return showRegisterModal(interaction, rankingDb, saveLocalStorage, logEvent);
}

// ==========================================
// 📝 REGISTRATION MODAL SUBMIT
// ==========================================

/** Handle the registration modal submission. */
export async function handleRegModalSubmit(interaction, rankingDb, saveLocalStorage, logEvent) {
    const nickname = interaction.fields.getTextInputValue('reg_nickname').trim().normalize('NFC');

    // ── Duplicate check ──
    const duplicate = Object.entries(rankingDb.users || {}).find(
        ([id, data]) =>
            id !== interaction.user.id &&
            data.nickname?.trim().normalize('NFC').toLowerCase() === nickname.toLowerCase()
    );
    if (duplicate) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Registration Failed',
                    '#ED4245',
                    `**${nickname}** is already registered by another user.`,
                    '📝 Character Registration System'
                )
            ]
        });
    }

    // ── Fuzzy conflict detection ──
    let fuzzyConflict = null;
    let bestScore = 0;
    for (const [userId, data] of Object.entries(rankingDb.users || {})) {
        if (userId === interaction.user.id) continue;
        const existingNick = data.nickname?.trim().normalize('NFC');
        if (!existingNick) continue;
        const distance = levenshteinDistance(
            cleanNickname(nickname),
            cleanNickname(existingNick)
        );
        const maxLen = Math.max(nickname.length, existingNick.length);
        if (maxLen === 0) continue;
        const score = 1 - distance / maxLen;
        if (score > 0.7 && score > bestScore) {
            bestScore = score;
            fuzzyConflict = { existingNick: data.nickname };
        }
    }

    // ── Auto-correct via ranking cache ──
    const localCache = getLocalRankingCache() || {};
    const exactCache = Object.keys(localCache).find(
        k => k.normalize('NFC').toLowerCase() === nickname.toLowerCase()
    );
    let finalNickname = nickname;
    let wasAutoCorrected = false;

    if (!exactCache) {
        const fuzzyCache = findClosestNicknameInCache(nickname, localCache);
        if (fuzzyCache && fuzzyCache.nickname.toLowerCase() !== nickname.toLowerCase()) {
            finalNickname = fuzzyCache.nickname;
            wasAutoCorrected = true;
            logEvent(`🔍 User ${interaction.user.tag} — auto-corrected "${nickname}" → "${fuzzyCache.nickname}" via panel`);
        }
    }

    // ── Second duplicate check with corrected name ──
    if (wasAutoCorrected) {
        const correctedConflict = Object.entries(rankingDb.users || {}).find(
            ([id, data]) =>
                id !== interaction.user.id &&
                data.nickname?.trim().normalize('NFC').toLowerCase() === finalNickname.toLowerCase()
        );
        if (correctedConflict) {
            logEvent(`⚠️ User ${interaction.user.tag} — auto-correct blocked: "${nickname}" → "${finalNickname}" conflicts`);
            return interaction.editReply({
                embeds: [
                    regEmbed(
                        '❌ Registration Failed',
                        '#ED4245',
                        `**${nickname}** would be auto-corrected to **${finalNickname}**, ` +
                        'but that name is already registered.\n\nPlease contact an admin or use a different name.',
                        '📝 Character Registration System'
                    )
                ]
            });
        }
    }

    // ── Create pending registration request ──
    const requestKey = `${interaction.user.id}_${Date.now()}`;
    pendingOwnerRegistrations[requestKey] = {
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        nickname: finalNickname,
        originalNickname: nickname,
        wasAutoCorrected,
        fuzzyConflict,
        timestamp: Date.now()
    };
    saveRegistrationRequests();

    // ── Send to approval channel ──
    const channel = await client.channels.fetch(APPROVAL_CHANNEL_ID).catch(() => null);
    if (!channel) {
        delete pendingOwnerRegistrations[requestKey];
        saveRegistrationRequests();
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Error',
                    '#ED4245',
                    'Could not send approval request. Please try again later.',
                    '📝 Character Registration System'
                )
            ]
        });
    }

    const approveEmbed = regEmbed(
        '📝 Registration Request',
        '#5865F2',
        `**${interaction.user}** wants to register!\n\n` +
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        '⏳ Expires in 48 hours • 🛡️ Only Elders and Admins can approve/reject'
    )
        .addFields(
            { name: '👤 User', value: `**${interaction.user.tag}**\n\`${interaction.user.id}\``, inline: false },
            { name: '🎮 Character', value: `**${finalNickname}**`, inline: true },
            { name: '✏️ Original Input', value: nickname !== finalNickname ? `~~${nickname}~~` : 'Same', inline: true }
        );

    const approveRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`reg_elder_approve_owner_${requestKey}`)
            .setEmoji('✅')
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`reg_elder_reject_owner_${requestKey}`)
            .setEmoji('❌')
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [approveEmbed], components: [approveRow] });

    logEvent(`📝 Registration request sent for approval: ${interaction.user.tag} → ${finalNickname}`);

    return interaction.editReply({
        embeds: [
            regEmbed(
                '✅ Request Sent for Approval',
                '#57F287',
                `Your registration request for **${finalNickname}** has been sent to the **Elders** for approval.\n\n` +
                'This request expires in **48 hours**. You will be notified when it is approved or rejected.',
                '📝 Character Registration System'
            )
        ]
    });
}

