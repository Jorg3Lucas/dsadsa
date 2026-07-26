// ==========================================
// 📝 REGISTRATION PANEL — Beautiful Embed + Buttons
// A fixed channel panel where users can register,
// manage pilots, view their info, and sync.
// ==========================================

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { getMsg } from '../core/lang.js';
import { CLAN_ROLES, confirmationCache, DISCORD_SERVER_ID } from '../core/ranking-constants.js';
import { getLocalRankingCache, findClosestNicknameInCache, cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';
import { applyImmediateRoleWithCache, applyClanRoleOnly } from '../core/ranking-role.js';
import { noop } from '../core/config.js';
import { runDailySynchronization } from '../core/ranking-sync-engine.js';
import { client } from '../core/state.js';
import { logger } from '../core/logger.js';

// ── Pending pilot registration requests (ownerId -> { pilotId, pilotName, timestamp }) ──
export const pilotRequests = {};

// ── Configuration ──
const REG_PANEL_CUSTOM_ID = 'reg_panel';
const BUTTON_IDS = {
    register: 'reg_register',
    registerPilot: 'reg_registerpilot',
    removePilot: 'reg_removepilot',
    sync: 'reg_sync',
    help: 'reg_help'
};

// ── Deployed message tracking ──
let regPanelMessage = null;
let regPanelChannelId = null;

// ==========================================
// 🎨 EMBED BUILDER
// ==========================================

/** Build the beautiful registration panel embed. @param {object} rankingDb - The ranking database */
export function buildRegPanelEmbed(rankingDb) {
    const registeredCount = Object.values(rankingDb.users || {}).filter(
        u => u && (u.registeredAt || u.manual === true)
    ).length;

    const embed = new EmbedBuilder()
        .setTitle('📝 Character Registration')
        .setColor('#5865F2')
        .setDescription(
            'Welcome to the **Character Registration System**! Link your in-game character to unlock clan roles, manage pilots, and more.\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━'
        )
        .addFields(
            {
                name: '📋 How It Works',
                value: [
                    '**1.** Click **📝 Register** and type your exact in-game nickname.',
                    '**2.** The bot auto-detects your clan from the ranking and assigns the role.',
                    '**3.** Want to be a pilot for someone? Use **✈️ Register as Pilot** button!',
                    '**4.** Your nickname and role stay synced automatically every day at **22:00 BRT**.'
                ].join('\n'),
                inline: false
            },
            {
                name: '👥 Registered Members',
                value: `**${registeredCount}** players are currently registered.`,
                inline: true
            },
            {
                name: '🏷️ Available Clans',
                value: Object.keys(CLAN_ROLES).join(' • ') || 'None configured',
                inline: true
            }
        )
        .setFooter({
            text: 'Use the buttons below to manage your account',
            iconURL: client?.user?.displayAvatarURL()
        })
        .setTimestamp();

    return embed;
}

// ==========================================
// 📦 PANEL DEPLOYMENT
// ==========================================

/** Post or update the registration panel in the configured channel. @param {import('discord.js').TextChannel} channel @param {object} rankingDb */
export async function deployRegistrationPanel(channel, rankingDb) {
    const embed = buildRegPanelEmbed(rankingDb);
    const components = buildRegPanelButtons(false);

    try {
        if (regPanelMessage) {
            // Update existing message
            regPanelMessage = await regPanelMessage.edit({
                embeds: [embed],
                components
            }).catch(() => null);
        }

        if (!regPanelMessage) {
            // Send new message
            regPanelMessage = await channel.send({
                embeds: [embed],
                components
            });
            regPanelChannelId = channel.id;
        }

        logger.info('Registration', `Panel deployed in #${channel.name}`);
        return regPanelMessage;
    } catch (err) {
        logger.error('Registration', 'Failed to deploy registration panel', err);
        return null;
    }
}

/** Refresh the registration panel embed (e.g. after a registration). @param {object} rankingDb */
export async function refreshRegPanel(rankingDb) {
    if (!regPanelMessage) return;
    const embed = buildRegPanelEmbed(rankingDb);
    try {
        regPanelMessage = await regPanelMessage.edit({ embeds: [embed] }).catch(() => null);
    } catch {
        regPanelMessage = null;
    }
}

/** Build the action row buttons for the registration panel. @param {boolean} [disableAll=false] */
function buildRegPanelButtons(disableAll = false) {
    const s = disableAll ? ButtonStyle.Secondary : ButtonStyle.Primary;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.register)
            .setEmoji('📝')
            .setLabel('Register')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.registerPilot)
            .setEmoji('✈️')
            .setLabel('Register as Pilot')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disableAll)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.removePilot)
            .setEmoji('🗑️')
            .setLabel('Remove Pilot')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.sync)
            .setEmoji('🔄')
            .setLabel('Force Sync')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.help)
            .setEmoji('❓')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll)
    );

    return [row1, row2];
}

// ==========================================
// 🖱️ BUTTON HANDLER
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
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Already Registered')
            .setColor('#FEE75C')
            .setDescription(
                `You are already registered as **${userData.nickname}**.\n\n` +
                'Re-registering will update your nickname. Continue?'
            )
            .setFooter({ text: 'Click Cancel to keep your current registration' });

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

        // Cache the confirmation (timestamp-based expiry check)
        confirmationCache[`${interaction.user.id}-reregister`] = {};

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
                new EmbedBuilder()
                    .setTitle('❌ You Are Already Registered')
                    .setColor('#ED4245')
                    .setDescription(
                        'You are already registered as a character owner (**' + userData.nickname + '**).\n\n' +
                        'If you want to be a pilot for someone else, ask the owner to use `/pilot @user` command to add you.'
                    )
            ],
            flags: 64
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('reg_pilot_modal')
        .setTitle('✈️ Register as Pilot');

    const ownNicknameInput = new TextInputBuilder()
        .setCustomId('reg_pilot_nickname')
        .setLabel('Your Character Name (in-game)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., MyCharacter')
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    const ownerNicknameInput = new TextInputBuilder()
        .setCustomId('reg_pilot_owner')
        .setLabel('Owner Character Name (who you pilot for)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., xVraeL')
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(ownNicknameInput),
        new ActionRowBuilder().addComponents(ownerNicknameInput)
    );

    return interaction.showModal(modal);
}

/** Handle the pilot registration modal submission. */
export async function handleRegPilotModal(interaction, rankingDb, saveLocalStorage, logEvent) {
    const pilotName = interaction.fields.getTextInputValue('reg_pilot_nickname').trim().normalize('NFC');
    const ownerName = interaction.fields.getTextInputValue('reg_pilot_owner').trim().normalize('NFC');

    // ── Find the owner in the database ──
    let ownerId = null;
    let ownerData = null;

    for (const [uid, data] of Object.entries(rankingDb.users || {})) {
        if (data.nickname?.trim().normalize('NFC').toLowerCase() === ownerName.toLowerCase()) {
            ownerId = uid;
            ownerData = data;
            break;
        }
    }

    if (!ownerId || !ownerData) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Owner Not Found')
                    .setColor('#ED4245')
                    .setDescription(
                        `No registered user found with the character name **${ownerName}**.\n\n` +
                        'Make sure you typed the name exactly as they registered it. ' +
                        'Ask the owner to check their character name (it must match exactly what they registered).'
                    )
            ],
            flags: 64
        });
    }

    // ── Check if owner has room for more pilots ──
    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Owner Pilot Limit Reached')
                    .setColor('#ED4245')
                    .setDescription(
                        `**${ownerData.nickname}** already has the maximum of **4 pilots**.\n\n` +
                        'Ask them to remove a pilot first before adding you.'
                    )
            ],
            flags: 64
        });
    }

    // ── Check if already linked ──
    if (ownerData.pilotIds.includes(interaction.user.id)) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Already a Pilot')
                    .setColor('#ED4245')
                    .setDescription(
                        `You are already linked as a pilot for **${ownerData.nickname}**.`
                    )
            ],
            flags: 64
        });
    }

    // ── Check for pending request ──
    const existingKey = Object.keys(pilotRequests).find(k =>
        k.startsWith(`${ownerId}_`) && pilotRequests[k].pilotId === interaction.user.id
    );
    if (existingKey) {
        const age = Date.now() - pilotRequests[existingKey].timestamp;
        if (age < 300000) { // 5 minutes
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⏳ Pending Request')
                        .setColor('#FEE75C')
                        .setDescription(
                            'You already have a pending pilot request for **' + ownerData.nickname + '**.\n\n' +
                            'Please wait for the owner to respond, or try again later if the request expires.'
                        )
                ],
                flags: 64
            });
        }
        // Expired, remove it
        delete pilotRequests[existingKey];
    }

    // ── Store the pending request ──
    const requestKey = `${ownerId}_${interaction.user.id}_${Date.now()}`;
    pilotRequests[requestKey] = {
        ownerId,
        ownerNick: ownerData.nickname,
        pilotId: interaction.user.id,
        pilotName,
        pilotTag: interaction.user.tag,
        timestamp: Date.now()
    };

    // ── Send DM to the owner for approval ──
    const ownerMember = await interaction.guild?.members.fetch(ownerId).catch(() => null);
    const ownerUser = ownerMember?.user || await client.users.fetch(ownerId).catch(() => null);

    if (!ownerUser) {
        delete pilotRequests[requestKey];
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Cannot Send Request')
                    .setColor('#ED4245')
                    .setDescription(
                        'Could not send the pilot request to **' + ownerData.nickname + '**.\n\n' +
                        'The owner may have left the server or has DMs disabled.'
                    )
            ],
            flags: 64
        });
    }

    try {
        const dmEmbed = new EmbedBuilder()
            .setTitle('✈️ Pilot Request')
            .setColor('#5865F2')
            .setDescription(
                `**${interaction.user.tag}** wants to be your pilot!`
            )
            .addFields(
                { name: '👤 Pilot Discord', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
                { name: '🎮 Pilot Character', value: `**${pilotName}**`, inline: true },
                { name: '🎮 Your Character', value: `**${ownerData.nickname}**`, inline: true }
            )
            .setFooter({ text: 'This request expires in 5 minutes' })
            .setTimestamp();

        const dmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`reg_pilot_approve_${requestKey}`)
                .setLabel('✅ Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`reg_pilot_reject_${requestKey}`)
                .setLabel('❌ Reject')
                .setStyle(ButtonStyle.Danger)
        );

        await ownerUser.send({ embeds: [dmEmbed], components: [dmRow] });

        logEvent(`✈️ Pilot request sent: ${interaction.user.tag} → ${ownerData.nickname} (${ownerId})`);

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Request Sent!')
                    .setColor('#57F287')
                    .setDescription(
                        `Your pilot request has been sent to **${ownerData.nickname}**!\n\n` +
                        'They will receive a DM with your request. Once they approve, you will be linked as their pilot.'
                    )
            ],
            flags: 64
        });
    } catch (err) {
        delete pilotRequests[requestKey];
        logger.error('Registration', 'Failed to send pilot request DM', err);
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Cannot Send Request')
                    .setColor('#ED4245')
                    .setDescription(
                        'Could not send the pilot request to **' + ownerData.nickname + '**.\n\n' +
                        'The owner may have DMs disabled. Ask them to enable DMs or use `/pilot @user` to add you directly.'
                    )
            ],
            flags: 64
        });
    }
}

/** Handle pilot request approval from DM. */
export async function handleRegPilotApprove(interaction, rankingDb, saveLocalStorage, logEvent) {
    const requestKey = interaction.customId.replace('reg_pilot_approve_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⌛ Request Expired')
                    .setColor('#FEE75C')
                    .setDescription('This pilot request has expired or was already processed.')
            ],
            components: []
        });
    }

    // Verify the person responding is the actual owner
    if (interaction.user.id !== request.ownerId) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Not Your Request')
                    .setColor('#ED4245')
                    .setDescription('Only the account owner can approve this request.')
            ],
            components: []
        });
    }

    delete pilotRequests[requestKey];

    // ── Add pilot to owner's list ──
    const ownerData = rankingDb.users[request.ownerId];
    if (!ownerData) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Error')
                    .setColor('#ED4245')
                    .setDescription('Your account data could not be found. Please re-register.')
            ],
            components: []
        });
    }

    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Pilot Limit Reached')
                    .setColor('#ED4245')
                    .setDescription('You already have the maximum of **4 pilots**. Remove one first.')
            ],
            components: []
        });
    }

    if (ownerData.pilotIds.includes(request.pilotId)) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('ℹ️ Already Linked')
                    .setColor('#5865F2')
                    .setDescription('This user is already linked as your pilot.')
            ],
            components: []
        });
    }

    ownerData.pilotIds.push(request.pilotId);
    saveLocalStorage();

    // ── Update the pilot's nickname and roles ──
    if (interaction.guild) {
        const pilotMember = await interaction.guild.members.fetch(request.pilotId).catch(() => null);
        if (pilotMember) {
            await pilotMember.setNickname(`${request.ownerNick} - Pilot`).catch(noop);
            await applyImmediateRoleWithCache(interaction, pilotMember, request.ownerNick, request.ownerId).catch(noop);
        }
    } else {
        // We're in DMs, use configured DISCORD_SERVER_ID for reliable guild lookup
        const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
        if (guild) {
            const pilotMember = await guild.members.fetch(request.pilotId).catch(() => null);
            if (pilotMember) {
                await pilotMember.setNickname(`${request.ownerNick} - Pilot`).catch(noop);
                // We need a guild interaction for applyImmediateRoleWithCache, use a fallback
                for (const roleId of Object.values(CLAN_ROLES)) {
                    if (!pilotMember.roles.cache.has(roleId)) {
                        await pilotMember.roles.add(roleId).catch(noop);
                    }
                }
            }
        }
    }

    logEvent(`✈️ Pilot approved: ${request.pilotTag} (${request.pilotName}) → ${request.ownerNick}`);

    // ── Notify the pilot ──
    try {
        const pilotUser = await client.users.fetch(request.pilotId).catch(() => null);
        if (pilotUser) {
            await pilotUser.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Pilot Request Approved!')
                        .setColor('#57F287')
                        .setDescription(`**${request.ownerNick}** has approved you as their pilot! 🎉`)
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the DM embed ──
    return interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('✅ Pilot Approved!')
                .setColor('#57F287')
                .setDescription(`You approved **${request.pilotTag}** as your pilot for **${request.ownerNick}**.`)
                .setTimestamp()
        ],
        components: []
    });
}

/** Handle pilot request rejection from DM. */
export async function handleRegPilotReject(interaction, rankingDb, saveLocalStorage, logEvent) {
    const requestKey = interaction.customId.replace('reg_pilot_reject_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⌛ Request Expired')
                    .setColor('#FEE75C')
                    .setDescription('This pilot request has expired or was already processed.')
            ],
            components: []
        });
    }

    // Verify the person responding is the actual owner
    if (interaction.user.id !== request.ownerId) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Not Your Request')
                    .setColor('#ED4245')
                    .setDescription('Only the account owner can reject this request.')
            ],
            components: []
        });
    }

    delete pilotRequests[requestKey];

    logEvent(`✈️ Pilot request rejected: ${request.pilotTag} → ${request.ownerNick}`);

    // ── Notify the pilot ──
    try {
        const pilotUser = await client.users.fetch(request.pilotId).catch(() => null);
        if (pilotUser) {
            await pilotUser.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Pilot Request Rejected')
                        .setColor('#ED4245')
                        .setDescription(`**${request.ownerNick}** has declined your pilot request.`)
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the DM embed ──
    return interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('❌ Request Rejected')
                .setColor('#ED4245')
                .setDescription(`You rejected **${request.pilotTag}** as your pilot.`)
                .setTimestamp()
        ],
        components: []
    });
}

/** Clean up expired pilot requests (call periodically). */
export function cleanupExpiredPilotRequests() {
    const now = Date.now();
    for (const [key, request] of Object.entries(pilotRequests)) {
        if (now - request.timestamp > 300000) { // 5 minutes
            delete pilotRequests[key];
        }
    }
}

// Run cleanup every minute
setInterval(cleanupExpiredPilotRequests, 60000);

/** Handle re-register confirmation. */
export async function handleReRegisterConfirm(interaction, rankingDb, saveLocalStorage, logEvent) {
    const cacheKey = `${interaction.user.id}-reregister`;
    if (!confirmationCache[cacheKey]) {
        return interaction.update({ content: '⌛ This confirmation has expired.', components: [], flags: 64 });
    }
    delete confirmationCache[cacheKey];
    return showRegisterModal(interaction, rankingDb, saveLocalStorage, logEvent);
}

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
                new EmbedBuilder()
                    .setTitle('❌ Registration Failed')
                    .setColor('#ED4245')
                    .setDescription(`**${nickname}** is already registered by another user.`)
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
                    new EmbedBuilder()
                        .setTitle('❌ Registration Failed')
                        .setColor('#ED4245')
                        .setDescription(
                            `**${nickname}** would be auto-corrected to **${finalNickname}**, ` +
                            'but that name is already registered.\n\nPlease contact an admin or use a different name.'
                        )
                ]
            });
        }
    }

    // ── Save user ──
    rankingDb.users[interaction.user.id] = {
        ...rankingDb.users[interaction.user.id],
        nickname: finalNickname,
        registeredAt: new Date().toISOString()
    };
    if (!rankingDb.users[interaction.user.id].pilotIds) {
        rankingDb.users[interaction.user.id].pilotIds = [];
    }
    saveLocalStorage();

    // ── Set nickname + role ──
    interaction.guild.members.fetch(interaction.user.id).then(async (member) => {
        if (member) {
            await member.setNickname(finalNickname).catch(noop);
            await applyImmediateRoleWithCache(interaction, member, finalNickname, interaction.user.id).catch(noop);
        }
    }).catch(noop);

    // ── Build response embed ──
    const successEmbed = new EmbedBuilder()
        .setTitle('✅ Registration Successful!')
        .setColor('#57F287')
        .setDescription(`Successfully linked to **${finalNickname}**.`)
        .setTimestamp();

    if (wasAutoCorrected) {
        successEmbed.addFields({
            name: '✏️ Auto-Corrected',
            value: `From: ~~${nickname}~~ → **${finalNickname}**`,
            inline: false
        });
    }
    if (fuzzyConflict) {
        successEmbed.addFields({
            name: '⚠️ Similar Name Detected',
            value: `**${nickname}** is very similar to **${fuzzyConflict.existingNick}** (another user).\nIf this was a mistake, contact an admin.`,
            inline: false
        });
    }

    await interaction.editReply({ embeds: [successEmbed] });

    // ── Refresh the panel ──
    await refreshRegPanel(rankingDb);
}

// ==========================================
// 🗑️ REMOVE PILOT BUTTON
// ==========================================

/** Shows a select menu to remove a pilot. */
async function handleRemovePilotButton(interaction, rankingDb) {
    const userData = rankingDb.users[interaction.user.id];
    const isRegistered = userData && (userData.registeredAt || userData.manual === true);

    if (!isRegistered || !userData.pilotIds || userData.pilotIds.length === 0) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ No Pilots Found')
                    .setColor('#ED4245')
                    .setDescription("You don't have any pilots linked to your account.")
            ],
            flags: 64
        });
    }

    const menuOptions = [];
    for (const pilotId of userData.pilotIds) {
        const memberObj = await interaction.guild.members.fetch(pilotId).catch(() => null);
        const pilotTag = memberObj ? memberObj.user.tag : `Unknown (${pilotId})`;
        const pilotNick = memberObj ? (memberObj.nickname || memberObj.user.username) : 'Unknown';

        menuOptions.push({
            label: pilotTag.substring(0, 100),
            description: `${pilotNick} — Click to remove`,
            value: pilotId
        });
    }

    const pilotMenu = new StringSelectMenuBuilder()
        .setCustomId('reg_select_pilot_remove')
        .setPlaceholder('Select a pilot to remove...')
        .addOptions(menuOptions);

    const row = new ActionRowBuilder().addComponents(pilotMenu);
    const cancelBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('reg_cancel_pilot_remove')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle('🗑️ Remove a Pilot')
                .setColor('#ED4245')
                .setDescription('Select a pilot to remove from your account:')
        ],
        components: [row, cancelBtn],
        flags: 64
    });
}

/** Handle pilot removal select menu. */
export async function handleRegRemovePilotSelect(interaction, rankingDb, saveLocalStorage) {
    const pilotToRemoveId = interaction.values[0];
    const userData = rankingDb.users[interaction.user.id];

    if (!userData || !userData.pilotIds || !userData.pilotIds.includes(pilotToRemoveId)) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Error')
                    .setColor('#ED4245')
                    .setDescription('This pilot is no longer linked to your account.')
            ],
            components: [],
            flags: 64
        });
    }

    userData.pilotIds = userData.pilotIds.filter(id => id !== pilotToRemoveId);
    saveLocalStorage();

    // Clean up pilot's roles and nickname
    interaction.guild.members.fetch(pilotToRemoveId).then(async (pilotMember) => {
        if (pilotMember) {
            for (const roleId of Object.values(CLAN_ROLES)) {
                if (pilotMember.roles.cache.has(roleId)) {
                    await pilotMember.roles.remove(roleId).catch(noop);
                }
            }
            await pilotMember.setNickname(pilotMember.user.username).catch(noop);
        }
    }).catch(noop);

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('✅ Pilot Removed')
                .setColor('#57F287')
                .setDescription('The pilot has been removed from your account.')
        ],
        components: [],
        flags: 64
    });

    await refreshRegPanel(rankingDb);
}

// ==========================================
// 🔄 SYNC BUTTON
// ==========================================

/** Initiate a force sync with confirmation. */
async function handleSyncButton(interaction, rankingDb, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Permission Denied')
                    .setColor('#ED4245')
                    .setDescription('Only **Administrators** can trigger a force sync.')
            ],
            flags: 64
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('🔄 Force Synchronization')
        .setColor('#FEE75C')
        .setDescription(
            'This will force a **full synchronization** with the official MIR4 ranking portal.\n\n' +
            'All registered player data (nicknames, clans) will be updated according to the current ranking.\n\n' +
            '**Are you sure you want to proceed?**'
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('reg_confirm_sync')
            .setLabel('✅ Yes, sync now')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('reg_cancel_sync')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    confirmationCache[`${interaction.user.id}-sync`] = { db: rankingDb, saveLocalStorage, logEvent };

    return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

/** Execute the force sync. */
export async function handleRegSyncConfirm(interaction, rankingDb, saveLocalStorage, logEvent) {
    const cacheKey = `${interaction.user.id}-sync`;
    if (!confirmationCache[cacheKey]) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⌛ Expired')
                    .setColor('#FEE75C')
                    .setDescription('This confirmation has expired. Please try again.')
            ],
            components: [],
            flags: 64
        });
    }
    delete confirmationCache[cacheKey];

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('🔄 Syncing...')
                .setColor('#5865F2')
                .setDescription('Synchronizing with the official ranking portal. This may take a moment.')
        ],
        components: [],
        flags: 64
    });

    try {
        await runDailySynchronization(interaction.client, rankingDb, saveLocalStorage, logEvent, true);
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Sync Complete')
                    .setColor('#57F287')
                    .setDescription('Force sync completed! Player data has been updated from the ranking portal.')
            ],
            flags: 64
        });
    } catch (err) {
        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Sync Failed')
                    .setColor('#ED4245')
                    .setDescription(`\`\`\`\n${(err.message || String(err)).slice(0, 1900)}\n\`\`\``)
            ],
            flags: 64
        });
    }

    await refreshRegPanel(rankingDb);
}

// ==========================================
// ❓ HELP BUTTON
// ==========================================

/** Shows a help embed with all available commands and info. */
async function handleHelpButton(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('❓ Help & Commands')
        .setColor('#5865F2')
        .setDescription('Here\'s everything you can do with the registration system:')
        .addFields(
            {
                name: '📝 Register',
                value: 'Link your in-game character nickname. The bot will auto-detect your clan from the ranking and assign the role.',
                inline: false
            },
            {
                name: '✈️ Register as Pilot',
                value: 'Want to pilot for someone? Click the **✈️ Register as Pilot** button! Enter your character name and the owner\'s name. The owner receives a DM to approve or reject.',
                inline: false
            },
            {
                name: '🗑️ Remove Pilot',
                value: 'Remove a pilot from your account. Their clan role will be revoked.',
                inline: false
            },
            {
                name: '🔄 Force Sync (Admin only)',
                value: 'Trigger an immediate synchronization with the official MIR4 ranking portal to update all nicknames and roles.',
                inline: false
            },
            {
                name: '📌 Auto-Sync Schedule',
                value: 'The bot automatically syncs every day at **22:00 BRT** — roles and nicknames update without any action needed.',
                inline: false
            }
        )
        .setFooter({ text: 'Need more help? Contact a server administrator.' })
        .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: 64 });
}

// ==========================================
// 🔧 UTILITY: Set registration channel
// ==========================================

/** Configure the registration panel channel. @param {import('discord.js').TextChannel} channel @param {object} rankingDb */
export async function setRegistrationChannel(channel, rankingDb) {
    regPanelChannelId = channel.id;
    regPanelMessage = null; // Force re-deploy
    await deployRegistrationPanel(channel, rankingDb);
}

/** Get the current registration panel channel ID. */
export function getRegPanelChannelId() {
    return regPanelChannelId;
}
