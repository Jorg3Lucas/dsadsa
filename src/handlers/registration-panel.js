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
import { CLAN_ROLES, confirmationCache, DISCORD_SERVER_ID, ELDER_ROLE_ID, APPROVAL_CHANNEL_ID } from '../core/ranking-constants.js';
import { getLocalRankingCache, findClosestNicknameInCache, cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';
import { applyImmediateRoleWithCache, applyClanRoleOnly } from '../core/ranking-role.js';
import { noop } from '../core/config.js';
import { runDailySynchronization } from '../core/ranking-sync-engine.js';
import { client } from '../core/state.js';
import { logger } from '../core/logger.js';

// ── Pending pilot registration requests (ownerId -> { pilotId, pilotTag, timestamp }) ──
export const pilotRequests = {};

// ── Pending owner registration requests (userId -> { nickname, userTag, ... }) ──
export const pendingOwnerRegistrations = {};

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
                        'If you want to be a pilot for someone else, ask the owner to use the **🗑️ Remove Pilot** button to free up a slot first.'
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
export async function handleRegPilotModal(interaction, rankingDb, saveLocalStorage, logEvent) {
    const ownerName = interaction.fields.getTextInputValue('reg_pilot_owner_name').trim().normalize('NFC');

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
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Owner Not Found')
                    .setColor('#ED4245')
                    .setDescription(
                        `No registered user found with the character name **${ownerName}**.\n\n` +
                        'Make sure you typed the name exactly as they registered it. ' +
                        'Ask the owner to check their character name (it must match exactly what they registered).'
                    )
            ]
        });
    }

    // ── Check if owner has room for more pilots ──
    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Owner Pilot Limit Reached')
                    .setColor('#ED4245')
                    .setDescription(
                        `**${ownerData.nickname}** already has the maximum of **4 pilots**.\n\n` +
                        'Ask them to remove a pilot first before adding you.'
                    )
            ]
        });
    }

    // ── Check if already linked ──
    if (ownerData.pilotIds.includes(interaction.user.id)) {
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Already a Pilot')
                    .setColor('#ED4245')
                    .setDescription(
                        `You are already linked as a pilot for **${ownerData.nickname}**.`
                    )
            ]
        });
    }

    // ── Check for pending request ──
    const existingKey = Object.keys(pilotRequests).find(k =>
        k.startsWith(`${ownerId}_`) && pilotRequests[k].pilotId === interaction.user.id
    );
    if (existingKey) {
        const age = Date.now() - pilotRequests[existingKey].timestamp;
        if (age < 300000) { // 5 minutes
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⏳ Pending Request')
                        .setColor('#FEE75C')
                        .setDescription(
                            'You already have a pending pilot request for **' + ownerData.nickname + '**.\n\n' +
                            'Please wait for the owner to respond, or try again later if the request expires.'
                        )
                ]
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
        pilotTag: interaction.user.tag,
        timestamp: Date.now()
    };

    // ── Send DM to the owner for approval ──
    const ownerMember = await interaction.guild?.members.fetch(ownerId).catch(() => null);
    const ownerUser = ownerMember?.user || await client.users.fetch(ownerId).catch(() => null);

    if (!ownerUser) {
        delete pilotRequests[requestKey];
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Cannot Send Request')
                    .setColor('#ED4245')
                    .setDescription(
                        'Could not send the pilot request to **' + ownerData.nickname + '**.\n\n' +
                        'The owner may have left the server or has DMs disabled.'
                    )
            ]
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
                { name: '👤 Pilot', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
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

        logEvent(`✈️ Pilot request sent: ${interaction.user.tag} wants to pilot for ${ownerData.nickname} (${ownerId})`);

        // ── Send copy to approval channel (Elders/Admins can approve/reject too) ──
        try {
            const approvalChannel = await client.channels.fetch(APPROVAL_CHANNEL_ID).catch(() => null);
            if (approvalChannel) {
                const elderEmbed = new EmbedBuilder()
                    .setTitle('✈️ Pilot Request')
                    .setColor('#5865F2')
                    .setDescription(`**${interaction.user.tag}** wants to be a pilot for **${ownerData.nickname}**`)
                    .addFields(
                        { name: '👤 Pilot', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: '🎮 Owner', value: `**${ownerData.nickname}** (${ownerId})`, inline: true },
                        { name: '📬 Status', value: '⏳ Awaiting Elder/Admin approval', inline: false }
                    )
                    .setFooter({ text: 'Only Elders and Admins can approve/reject' })
                    .setTimestamp();

                const elderRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`reg_elder_approve_pilot_${requestKey}`)
                        .setEmoji('✅')
                        .setLabel('Approve')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`reg_elder_reject_pilot_${requestKey}`)
                        .setEmoji('❌')
                        .setLabel('Reject')
                        .setStyle(ButtonStyle.Danger)
                );

                await approvalChannel.send({ embeds: [elderEmbed], components: [elderRow] }).catch(noop);
            }
        } catch { /* ignore */ }

        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Request Sent!')
                    .setColor('#57F287')
                    .setDescription(
                        `Your pilot request has been sent to **${ownerData.nickname}**!\n\n` +
                        'They will receive a DM with your request. Once they approve, you will be linked as their pilot.'
                    )
            ]
        });
    } catch (err) {
        delete pilotRequests[requestKey];
        logger.error('Registration', 'Failed to send pilot request DM', err);
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Cannot Send Request')
                    .setColor('#ED4245')
                    .setDescription(
                        'Could not send the pilot request to **' + ownerData.nickname + '**.\n\n' +
                        'The owner may have DMs disabled. Ask them to enable DMs in server settings.'
                    )
            ]
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

    logEvent(`✈️ Pilot approved: ${request.pilotTag} → ${request.ownerNick}`);

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
setInterval(cleanupExpiredOwnerRegistrations, 60000);

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

    // ── Send to approval channel ──
    const channel = await client.channels.fetch(APPROVAL_CHANNEL_ID).catch(() => null);
    if (!channel) {
        delete pendingOwnerRegistrations[requestKey];
        return interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Error')
                    .setColor('#ED4245')
                    .setDescription('Could not send approval request. Please try again later.')
            ]
        });
    }

    const approveEmbed = new EmbedBuilder()
        .setTitle('📝 Registration Request')
        .setColor('#5865F2')
        .setDescription(`${interaction.user} wants to register!`)
        .addFields(
            { name: '👤 User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
            { name: '🎮 Character', value: `**${finalNickname}**`, inline: true },
            { name: '✏️ Original Input', value: nickname !== finalNickname ? `~~${nickname}~~` : 'Same', inline: true }
        )
        .setFooter({ text: 'Only Elders and Admins can approve/reject' })
        .setTimestamp();

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
            new EmbedBuilder()
                .setTitle('✅ Request Sent for Approval')
                .setColor('#57F287')
                .setDescription(
                    `Your registration request for **${finalNickname}** has been sent to the **Elders** for approval.\n\n` +
                    'You will be notified once it is approved or rejected.'
                )
                .setTimestamp()
        ]
    });
}

// ==========================================
// ✅ ELDER APPROVE OWNER REGISTRATION
// ==========================================

/** Handle owner registration approval by an Elder/Admin from the approval channel. */
export async function handleRegElderApproveOwner(interaction, rankingDb, saveLocalStorage, logEvent) {
    // Check permissions
    const isElder = interaction.member?.roles.cache.has(ELDER_ROLE_ID);
    const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    if (!isElder && !isAdmin) {
        return interaction.reply({
            content: '❌ Only **Elders** and **Admins** can approve registration requests.',
            flags: 64
        });
    }

    const requestKey = interaction.customId.replace('reg_elder_approve_owner_', '');
    const request = pendingOwnerRegistrations[requestKey];

    if (!request) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⌛ Request Expired')
                    .setColor('#FEE75C')
                    .setDescription('This registration request has expired or was already processed.')
            ],
            components: []
        });
    }

    delete pendingOwnerRegistrations[requestKey];

    // ── Save user ──
    rankingDb.users[request.userId] = {
        ...rankingDb.users[request.userId],
        nickname: request.nickname,
        registeredAt: new Date().toISOString()
    };
    if (!rankingDb.users[request.userId].pilotIds) {
        rankingDb.users[request.userId].pilotIds = [];
    }
    saveLocalStorage();

    // ── Set nickname + role ──
    const guild = interaction.guild;
    if (guild) {
        const member = await guild.members.fetch(request.userId).catch(() => null);
        if (member) {
            await member.setNickname(request.nickname).catch(noop);
            await applyImmediateRoleWithCache(interaction, member, request.nickname, request.userId).catch(noop);
        }
    }

    logEvent(`✅ Registration approved by ${interaction.user.tag}: ${request.userTag} → ${request.nickname}`);

    // ── Notify the user ──
    try {
        const user = await client.users.fetch(request.userId).catch(() => null);
        if (user) {
            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Registration Approved!')
                        .setColor('#57F287')
                        .setDescription(`Your registration for **${request.nickname}** has been approved! 🎉`)
                        .setTimestamp()
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the approval message ──
    return interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('✅ Registration Approved')
                .setColor('#57F287')
                .setDescription(`Approved by ${interaction.user}.`)
                .addFields(
                    { name: '👤 User', value: `${request.userTag} (${request.userId})`, inline: false },
                    { name: '🎮 Character', value: `**${request.nickname}**`, inline: true }
                )
                .setTimestamp()
        ],
        components: []
    });
}

// ==========================================
// ❌ ELDER REJECT OWNER REGISTRATION
// ==========================================

/** Handle owner registration rejection by an Elder/Admin from the approval channel. */
export async function handleRegElderRejectOwner(interaction, rankingDb, saveLocalStorage, logEvent) {
    // Check permissions
    const isElder = interaction.member?.roles.cache.has(ELDER_ROLE_ID);
    const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    if (!isElder && !isAdmin) {
        return interaction.reply({
            content: '❌ Only **Elders** and **Admins** can reject registration requests.',
            flags: 64
        });
    }

    const requestKey = interaction.customId.replace('reg_elder_reject_owner_', '');
    const request = pendingOwnerRegistrations[requestKey];

    if (!request) {
        return interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('⌛ Request Expired')
                    .setColor('#FEE75C')
                    .setDescription('This registration request has expired or was already processed.')
            ],
            components: []
        });
    }

    delete pendingOwnerRegistrations[requestKey];

    logEvent(`❌ Registration rejected by ${interaction.user.tag}: ${request.userTag} → ${request.nickname}`);

    // ── Notify the user ──
    try {
        const user = await client.users.fetch(request.userId).catch(() => null);
        if (user) {
            await user.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Registration Rejected')
                        .setColor('#ED4245')
                        .setDescription(`Your registration for **${request.nickname}** has been rejected by the Elders.`)
                        .setTimestamp()
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the approval message ──
    return interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('❌ Registration Rejected')
                .setColor('#ED4245')
                .setDescription(`Rejected by ${interaction.user}.`)
                .addFields(
                    { name: '👤 User', value: `${request.userTag} (${request.userId})`, inline: false },
                    { name: '🎮 Character', value: `**${request.nickname}**`, inline: true }
                )
                .setTimestamp()
        ],
        components: []
    });
}

/** Clean up expired pending owner registrations (30 min expiry). */
export function cleanupExpiredOwnerRegistrations() {
    const now = Date.now();
    for (const [key, request] of Object.entries(pendingOwnerRegistrations)) {
        if (now - request.timestamp > 1800000) { // 30 minutes
            delete pendingOwnerRegistrations[key];
        }
    }
}

// ==========================================
// ✅ ELDER APPROVE PILOT
// ==========================================

/** Handle pilot approval by an Elder/Admin from the approval channel. */
export async function handleRegElderApprovePilot(interaction, rankingDb, saveLocalStorage, logEvent) {
    const isElder = interaction.member?.roles.cache.has(ELDER_ROLE_ID);
    const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    if (!isElder && !isAdmin) {
        return interaction.reply({
            content: '❌ Only **Elders** and **Admins** can approve pilot requests.',
            flags: 64
        });
    }

    const requestKey = interaction.customId.replace('reg_elder_approve_pilot_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('⌛ Request Expired')
                .setColor('#FEE75C')
                .setDescription('This pilot request has expired or was already processed.')
            ],
            components: []
        });
    }

    delete pilotRequests[requestKey];

    // ── Add pilot to owner's list ──
    const ownerData = rankingDb.users[request.ownerId];
    if (!ownerData) {
        return interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('❌ Error')
                .setColor('#ED4245')
                .setDescription('The owner account could not be found.')
            ],
            components: []
        });
    }

    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('❌ Pilot Limit Reached')
                .setColor('#ED4245')
                .setDescription('This owner already has the maximum of **4 pilots**.')
            ],
            components: []
        });
    }

    if (ownerData.pilotIds.includes(request.pilotId)) {
        return interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('ℹ️ Already Linked')
                .setColor('#5865F2')
                .setDescription('This user is already linked as a pilot.')
            ],
            components: []
        });
    }

    ownerData.pilotIds.push(request.pilotId);
    saveLocalStorage();

    // ── Update the pilot's nickname and roles ──
    const guild = interaction.guild;
    if (guild) {
        const pilotMember = await guild.members.fetch(request.pilotId).catch(() => null);
        if (pilotMember) {
            await pilotMember.setNickname(`${request.ownerNick} - Pilot`).catch(noop);
            await applyImmediateRoleWithCache(interaction, pilotMember, request.ownerNick, request.ownerId).catch(noop);
        }
    }

    logEvent(`✈️ Pilot approved by ${interaction.user.tag}: ${request.pilotTag} → ${request.ownerNick}`);

    // ── Notify the owner with revoke option ──
    try {
        const ownerUser = await client.users.fetch(request.ownerId).catch(() => null);
        if (ownerUser) {
            const revokeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`reg_pilot_revoke_${request.ownerId}_${request.pilotId}`)
                    .setEmoji('🗑️')
                    .setLabel('Revoke Pilot')
                    .setStyle(ButtonStyle.Danger)
            );
            await ownerUser.send({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Pilot Approved by Elders')
                    .setColor('#57F287')
                    .setDescription(`**${request.pilotTag}** has been approved as your pilot by ${interaction.user.tag}.`)
                    .addFields(
                        { name: '👤 Pilot', value: request.pilotTag, inline: true },
                        { name: '🎮 Character', value: request.ownerNick, inline: true },
                        { name: 'ℹ️', value: 'If you want to revoke this pilot, click the button below.', inline: false }
                    )
                    .setTimestamp()
                ],
                components: [revokeRow]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Notify the pilot ──
    try {
        const pilotUser = await client.users.fetch(request.pilotId).catch(() => null);
        if (pilotUser) {
            await pilotUser.send({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Pilot Request Approved!')
                    .setColor('#57F287')
                    .setDescription(`**${request.ownerNick}** has approved you as their pilot! 🎉`)
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the channel message ──
    return interaction.update({
        embeds: [new EmbedBuilder()
            .setTitle('✅ Pilot Approved')
            .setColor('#57F287')
            .setDescription(`Approved by ${interaction.user}.`)
            .addFields(
                { name: '👤 Pilot', value: request.pilotTag, inline: true },
                { name: '🎮 Owner', value: request.ownerNick, inline: true }
            )
            .setTimestamp()
        ],
        components: []
    });
}

// ==========================================
// ❌ ELDER REJECT PILOT
// ==========================================

/** Handle pilot rejection by an Elder/Admin from the approval channel. */
export async function handleRegElderRejectPilot(interaction, rankingDb, saveLocalStorage, logEvent) {
    const isElder = interaction.member?.roles.cache.has(ELDER_ROLE_ID);
    const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
    if (!isElder && !isAdmin) {
        return interaction.reply({
            content: '❌ Only **Elders** and **Admins** can reject pilot requests.',
            flags: 64
        });
    }

    const requestKey = interaction.customId.replace('reg_elder_reject_pilot_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('⌛ Request Expired')
                .setColor('#FEE75C')
                .setDescription('This pilot request has expired or was already processed.')
            ],
            components: []
        });
    }

    const ownerNick = request.ownerNick;
    delete pilotRequests[requestKey];

    logEvent(`✈️ Pilot request rejected by ${interaction.user.tag}: ${request.pilotTag} → ${ownerNick}`);

    // ── Notify the pilot ──
    try {
        const pilotUser = await client.users.fetch(request.pilotId).catch(() => null);
        if (pilotUser) {
            await pilotUser.send({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Pilot Request Rejected')
                    .setColor('#ED4245')
                    .setDescription(`Your pilot request for **${ownerNick}** has been rejected by the Elders.`)
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Notify the owner ──
    try {
        const ownerUser = await client.users.fetch(request.ownerId).catch(() => null);
        if (ownerUser) {
            await ownerUser.send({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Pilot Request Rejected')
                    .setColor('#ED4245')
                    .setDescription(`The pilot request from **${request.pilotTag}** has been rejected by the Elders.`)
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the channel message ──
    return interaction.update({
        embeds: [new EmbedBuilder()
            .setTitle('❌ Pilot Request Rejected')
            .setColor('#ED4245')
            .setDescription(`Rejected by ${interaction.user}.`)
            .addFields(
                { name: '👤 Pilot', value: request.pilotTag, inline: true },
                { name: '🎮 Owner', value: ownerNick, inline: true }
            )
            .setTimestamp()
        ],
        components: []
    });
}

// ==========================================
// 🗑️ REVOKE PILOT (from owner DM)
// ==========================================

/** Handle pilot revocation by the owner from DM (clicking Revoke button). */
export async function handleRegPilotRevoke(interaction, rankingDb, saveLocalStorage, logEvent) {
    const parts = interaction.customId.replace('reg_pilot_revoke_', '').split('_');
    const ownerId = parts[0];
    const pilotId = parts[1];

    // Verify the person clicking is the actual owner
    if (interaction.user.id !== ownerId) {
        return interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('❌ Not Your Account')
                .setColor('#ED4245')
                .setDescription('Only the account owner can revoke a pilot.')
            ],
            components: []
        });
    }

    const ownerData = rankingDb.users[ownerId];
    if (!ownerData || !ownerData.pilotIds || !ownerData.pilotIds.includes(pilotId)) {
        return interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('❌ Not Found')
                .setColor('#ED4245')
                .setDescription('This pilot is no longer linked to your account.')
            ],
            components: []
        });
    }

    ownerData.pilotIds = ownerData.pilotIds.filter(id => id !== pilotId);
    saveLocalStorage();

    // Clean up pilot's roles and nickname (may be in DM, use guild lookup)
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (guild) {
        const pilotMember = await guild.members.fetch(pilotId).catch(() => null);
        if (pilotMember) {
            for (const roleId of Object.values(CLAN_ROLES)) {
                if (pilotMember.roles.cache.has(roleId)) {
                    await pilotMember.roles.remove(roleId).catch(noop);
                }
            }
            await pilotMember.setNickname(pilotMember.user.username).catch(noop);
        }
    }

    logEvent(`✈️ Pilot revoked by owner: ${interaction.user.tag} revoked pilot ${pilotId}`);

    // ── Notify the pilot ──
    try {
        const pilotUser = await client.users.fetch(pilotId).catch(() => null);
        if (pilotUser) {
            await pilotUser.send({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Pilot Revoked')
                    .setColor('#ED4245')
                    .setDescription(`Your pilot role has been revoked by **${ownerData.nickname}**.`)
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the DM embed ──
    return interaction.update({
        embeds: [new EmbedBuilder()
            .setTitle('🗑️ Pilot Revoked')
            .setColor('#ED4245')
            .setDescription(`You have revoked that pilot from your account.`)
            .setTimestamp()
        ],
        components: []
    });
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
                value: 'Want to pilot for someone? Click the **✈️ Register as Pilot** button! Enter the owner\'s character name and they\'ll receive a DM to approve or reject your request.',
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
