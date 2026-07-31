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
import fs from 'fs';
import path from 'path';
import { getMsg } from '../core/lang.js';
import { CLAN_ROLES, confirmationCache, DISCORD_SERVER_ID, ELDER_ROLE_ID, APPROVAL_CHANNEL_ID } from '../core/ranking-constants.js';
import { getLocalRankingCache, findClosestNicknameInCache, cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';
import { applyImmediateRoleWithCache, applyClanRoleOnly } from '../core/ranking-role.js';
import { noop } from '../core/config.js';
import { runBackup } from '../auto-backup.js';
import { runDailySynchronization } from '../core/ranking-sync-engine.js';
import { client } from '../core/state.js';
import { logger } from '../core/logger.js';

// ── Pending pilot registration requests (ownerId -> { pilotId, pilotTag, timestamp }) ──
export const pilotRequests = {};

// ── Pending owner registration requests (userId -> { nickname, userTag, ... }) ──
export const pendingOwnerRegistrations = {};

// ── Persistence ──
const REGISTRATION_REQUESTS_PATH = path.resolve('./registration-requests.json');
const REQUEST_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

/** Save pilot and owner registration requests to disk. */
function saveRegistrationRequests() {
    try {
        const data = { pilotRequests, pendingOwnerRegistrations };
        runBackup(['./registration-requests.json']);
        fs.writeFileSync(REGISTRATION_REQUESTS_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        logger.error('Registration', 'Error saving registration requests', err);
    }
}

/** Load pilot and owner registration requests from disk. Cleans up already-expired entries. */
export function loadRegistrationRequests() {
    try {
        if (!fs.existsSync(REGISTRATION_REQUESTS_PATH)) return;
        const raw = fs.readFileSync(REGISTRATION_REQUESTS_PATH, 'utf8');
        const data = JSON.parse(raw);
        const now = Date.now();

        // Clean expired and restore valid
        if (data.pilotRequests) {
            for (const [key, req] of Object.entries(data.pilotRequests)) {
                if (now - req.timestamp <= REQUEST_EXPIRY_MS) {
                    pilotRequests[key] = req;
                }
            }
        }
        if (data.pendingOwnerRegistrations) {
            for (const [key, req] of Object.entries(data.pendingOwnerRegistrations)) {
                if (now - req.timestamp <= REQUEST_EXPIRY_MS) {
                    pendingOwnerRegistrations[key] = req;
                }
            }
        }

        logger.info('Registration', `Loaded ${Object.keys(pilotRequests).length} pilot request(s) and ${Object.keys(pendingOwnerRegistrations).length} owner registration request(s) from disk.`);
    } catch (err) {
        logger.error('Registration', 'Error loading registration requests', err);
    }
}

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

// ── Fixed-message embed titles (used to recover existing messages after a restart) ──
const WELCOME_EMBED_TITLE = '👋 Welcome to the Server!';
const REG_PANEL_EMBED_TITLE = '🎮 Character Registration System';

// ==========================================
// 🎨 EMBED BUILDER
// ==========================================

/** Build a branded embed consistent with the registration panel: colored bar, separator-ready description, footer with bot avatar + timestamp. @param {string} title @param {string} color @param {string} description @param {string} [footerText] @returns {import('discord.js').EmbedBuilder} */
function regEmbed(title, color, description, footerText) {
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(description)
        .setFooter({
            text: footerText || 'Character Registration System',
            iconURL: client?.user?.displayAvatarURL()
        })
        .setTimestamp();
}

/** Build the beautiful registration panel embed. Shows live server stats, clan distribution and clear steps. @param {object} rankingDb - The ranking database */
export function buildRegPanelEmbed(rankingDb) {
    const users = rankingDb.users || {};
    const registered = Object.values(users).filter(
        u => u && (u.registeredAt || u.manual === true)
    );
    const registeredCount = registered.length;

    // ── Live stats ──
    const pilotCount = registered.reduce((acc, u) => acc + (Array.isArray(u.pilotIds) ? u.pilotIds.length : 0), 0);
    const pendingApprovals = Object.keys(pendingOwnerRegistrations).length + Object.keys(pilotRequests).length;

    // ── Clan distribution (clanManual override first, then local ranking cache) ──
    const localCache = getLocalRankingCache() || {};
    const cleanedCache = new Map(Object.keys(localCache).map(k => [cleanNickname(k), k]));
    const clanCounts = {};
    for (const u of registered) {
        let clan = null;
        if (u.clanManual) {
            clan = u.clanManual;
        } else if (u.nickname) {
            const cleanedNick = cleanNickname(u.nickname);
            const exactKey = cleanedCache.get(cleanedNick);
            clan = exactKey ? localCache[exactKey] : null;
        }
        if (clan) clanCounts[clan] = (clanCounts[clan] || 0) + 1;
    }
    const clanDistribution = Object.entries(clanCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6)
        .map(([clan, count]) => `▸ **${count}** — ${clan}`)
        .join('\n') || 'No registered members yet.';

    const embed = regEmbed(
        REG_PANEL_EMBED_TITLE,
        '#5865F2',
        'Welcome! Link your **in-game character** to unlock your clan role and manage pilots.\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        'Click a button below to manage your account'
    )
        .addFields(
            {
                name: '📊 Server Stats',
                value: [
                    `👥 **${registeredCount}** registered member(s)`,
                    `✈️ **${pilotCount}** linked pilot(s)`,
                    `⏳ **${pendingApprovals}** pending approval(s)`
                ].join('\n'),
                inline: false
            },
            {
                name: '📋 How It Works',
                value: [
                    '**1.** Click **📝 Register** and type your exact in-game nickname.',
                    '**2.** The bot auto-detects your clan from the official ranking and assigns the role.',
                    '**3.** Want to pilot for someone? Use **✈️ Register as Pilot** (up to **4 pilots** per owner).',
                    '**4.** Roles & nicknames sync automatically every day at **22:00 BRT**.'
                ].join('\n'),
                inline: false
            },
            {
                name: '🏛️ Clan Distribution',
                value: clanDistribution,
                inline: true
            },
            {
                name: '🏷️ Available Clans',
                value: Object.keys(CLAN_ROLES).join(' • ') || 'None configured',
                inline: true
            }
        )
    return embed;
}

// ==========================================
// 📦 PANEL DEPLOYMENT
// ==========================================

/**
 * Try to recover an already-deployed fixed bot message (welcome/panel) in a channel
 * by scanning recent bot-authored messages for a matching embed title.
 * Returns the message if found, otherwise null.
 * @param {import('discord.js').TextChannel} channel
 * @param {string} embedTitle
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function findExistingFixedMessage(channel, embedTitle) {
    try {
        const botId = client.user?.id;
        if (!botId) return null;
        const messages = await channel.messages.fetch({ limit: 100 });
        return messages.find(
            m => m.author?.id === botId && m.embeds?.[0]?.title === embedTitle
        ) || null;
    } catch {
        return null;
    }
}

/** Best-effort cleanup of older duplicate fixed messages (welcome/panel) left by previous restarts. @param {import('discord.js').TextChannel} channel @param {string} embedTitle @param {import('discord.js').Message} keep */
async function cleanupOldFixedMessages(channel, embedTitle, keep) {
    try {
        const botId = client.user?.id;
        if (!botId) return;
        const messages = await channel.messages.fetch({ limit: 100 });
        const stale = messages.filter(
            m => m.id !== keep.id && m.author?.id === botId && m.embeds?.[0]?.title === embedTitle
        );
        for (const msg of stale.values()) {
            await msg.delete().catch(noop);
        }
    } catch {
        // Ignore — cleanup is best-effort
    }
}

/** Post or update the registration panel in the configured channel. @param {import('discord.js').TextChannel} channel @param {object} rankingDb */
export async function deployRegistrationPanel(channel, rankingDb) {
    const embed = buildRegPanelEmbed(rankingDb);
    const components = buildRegPanelButtons(false);

    try {
        if (!regPanelMessage) {
            // Recover the previously deployed panel after a restart (avoid duplicates)
            regPanelMessage = await findExistingFixedMessage(channel, REG_PANEL_EMBED_TITLE);
            if (regPanelMessage) {
                regPanelChannelId = channel.id;
                await cleanupOldFixedMessages(channel, REG_PANEL_EMBED_TITLE, regPanelMessage);
            }
        }

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

/** Refresh the registration panel embed (e.g. after a registration). Always re-attaches the action buttons so they are never lost. @param {object} rankingDb */
export async function refreshRegPanel(rankingDb) {
    if (!regPanelMessage) return;
    const embed = buildRegPanelEmbed(rankingDb);
    const components = buildRegPanelButtons(false);
    try {
        regPanelMessage = await regPanelMessage.edit({ embeds: [embed], components }).catch(() => null);
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
                regEmbed(
                    '❌ Owner Not Found',
                    '#ED4245',
                    `No registered user found with the character name **${ownerName}**.\n\n` +
                    'Make sure you typed the name exactly as they registered it. ' +
                    'Ask the owner to check their character name (it must match exactly what they registered).',
                    '✈️ Character Registration System'
                )
            ]
        });
    }

    // ── Check if owner has room for more pilots ──
    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Owner Pilot Limit Reached',
                    '#ED4245',
                    `**${ownerData.nickname}** already has the maximum of **4 pilots**.\n\n` +
                    'Ask them to remove a pilot first before adding you.',
                    '✈️ Character Registration System'
                )
            ]
        });
    }

    // ── Check if already linked ──
    if (ownerData.pilotIds.includes(interaction.user.id)) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Already a Pilot',
                    '#ED4245',
                    `You are already linked as a pilot for **${ownerData.nickname}**.`,
                    '✈️ Character Registration System'
                )
            ]
        });
    }

    // ── Check for pending request ──
    const existingKey = Object.keys(pilotRequests).find(k =>
        k.startsWith(`${ownerId}_`) && pilotRequests[k].pilotId === interaction.user.id
    );
    if (existingKey) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '⏳ Pending Request',
                    '#FEE75C',
                    'You already have a pending pilot request for **' + ownerData.nickname + '**.\n\n' +
                    'This request expires in **48 hours**. Please wait for the owner to respond, or contact an Elder if needed.',
                    '✈️ Character Registration System'
                )
            ]
        });
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
    saveRegistrationRequests();

    // ── Send DM to the owner for approval ──
    const ownerMember = await interaction.guild?.members.fetch(ownerId).catch(() => null);
    const ownerUser = ownerMember?.user || await client.users.fetch(ownerId).catch(() => null);

    if (!ownerUser) {
        delete pilotRequests[requestKey];
        saveRegistrationRequests();
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Cannot Send Request',
                    '#ED4245',
                    'Could not send the pilot request to **' + ownerData.nickname + '**.\n\n' +
                    'The owner may have left the server or has DMs disabled.',
                    '✈️ Character Registration System'
                )
            ]
        });
    }

    try {
        const dmEmbed = regEmbed(
            '✈️ Pilot Request',
            '#5865F2',
            `**${interaction.user.tag}** wants to be your pilot!\n\n` +
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '⏳ This request expires in 48 hours'
        )
            .addFields(
                { name: '👤 Pilot', value: `**${interaction.user.tag}**\n\`${interaction.user.id}\``, inline: false },
                { name: '🎮 Your Character', value: `**${ownerData.nickname}**`, inline: true }
            );

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
                const elderEmbed = regEmbed(
                    '✈️ Pilot Request',
                    '#5865F2',
                    `**${interaction.user.tag}** wants to be a pilot for **${ownerData.nickname}**\n\n` +
                    '━━━━━━━━━━━━━━━━━━━━━━━━',
                    '🛡️ Only Elders and Admins can approve/reject'
                )
                    .addFields(
                        { name: '👤 Pilot', value: `**${interaction.user.tag}**\n\`${interaction.user.id}\``, inline: true },
                        { name: '👑 Owner', value: `**${ownerData.nickname}**\n\`${ownerId}\``, inline: true },
                        { name: '📬 Status', value: '⏳ **Awaiting Elder/Admin approval**', inline: false }
                    );

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
                regEmbed(
                    '✅ Request Sent!',
                    '#57F287',
                    `Your pilot request has been sent to **${ownerData.nickname}**!\n\n` +
                    'They will receive a DM with your request. Once they approve, you will be linked as their pilot.',
                    '✈️ Character Registration System'
                )
            ]
        });
    } catch (err) {
        delete pilotRequests[requestKey];
        saveRegistrationRequests();
        logger.error('Registration', 'Failed to send pilot request DM', err);
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Cannot Send Request',
                    '#ED4245',
                    'Could not send the pilot request to **' + ownerData.nickname + '**.\n\n' +
                    'The owner may have DMs disabled. Ask them to enable DMs in server settings.',
                    '✈️ Character Registration System'
                )
            ]
        });
    }
}

/** Handle pilot request approval from DM. */
export async function handleRegPilotApprove(interaction, rankingDb, saveLocalStorage, logEvent) {
    // Acknowledge immediately — the flow below (member fetch, role changes, DM notify)
    // can exceed Discord's 3-second interaction window and cause error 10062.
    await interaction.deferUpdate().catch(noop);

    const requestKey = interaction.customId.replace('reg_pilot_approve_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '⌛ Request Expired',
                    '#FEE75C',
                    'This pilot request has expired or was already processed.',
                    '✈️ Character Registration System'
                )
            ],
            components: []
        });
    }

    // Verify the person responding is the actual owner
    if (interaction.user.id !== request.ownerId) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Not Your Request',
                    '#ED4245',
                    'Only the account owner can approve this request.',
                    '✈️ Character Registration System'
                )
            ],
            components: []
        });
    }

    delete pilotRequests[requestKey];
    saveRegistrationRequests();

    // ── Add pilot to owner's list ──
    const ownerData = rankingDb.users[request.ownerId];
    if (!ownerData) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Error',
                    '#ED4245',
                    'Your account data could not be found. Please re-register.',
                    '✈️ Character Registration System'
                )
            ],
            components: []
        });
    }

    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Pilot Limit Reached',
                    '#ED4245',
                    'You already have the maximum of **4 pilots**. Remove one first.',
                    '✈️ Character Registration System'
                )
            ],
            components: []
        });
    }

    if (ownerData.pilotIds.includes(request.pilotId)) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    'ℹ️ Already Linked',
                    '#5865F2',
                    'This user is already linked as your pilot.',
                    '✈️ Character Registration System'
                )
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
                    regEmbed(
                        '✅ Pilot Request Approved!',
                        '#57F287',
                        `**${request.ownerNick}** has approved you as their pilot! 🎉`,
                        '✈️ Character Registration System'
                    )
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the DM embed ──
    return interaction.editReply({
        embeds: [
            regEmbed(
                '✅ Pilot Approved!',
                '#57F287',
                `You approved **${request.pilotTag}** as your pilot for **${request.ownerNick}**.\n\n` +
                '━━━━━━━━━━━━━━━━━━━━━━━━',
                '✈️ Character Registration System'
            )
        ],
        components: []
    });
}

/** Handle pilot request rejection from DM. */
export async function handleRegPilotReject(interaction, rankingDb, saveLocalStorage, logEvent) {
    // Acknowledge immediately — the flow below (member fetch, DM notify)
    // can exceed Discord's 3-second interaction window and cause error 10062.
    await interaction.deferUpdate().catch(noop);

    const requestKey = interaction.customId.replace('reg_pilot_reject_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '⌛ Request Expired',
                    '#FEE75C',
                    'This pilot request has expired or was already processed.',
                    '✈️ Character Registration System'
                )
            ],
            components: []
        });
    }

    // Verify the person responding is the actual owner
    if (interaction.user.id !== request.ownerId) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Not Your Request',
                    '#ED4245',
                    'Only the account owner can reject this request.',
                    '✈️ Character Registration System'
                )
            ],
            components: []
        });
    }

    delete pilotRequests[requestKey];
    saveRegistrationRequests();

    logEvent(`✈️ Pilot request rejected: ${request.pilotTag} → ${request.ownerNick}`);

    // ── Notify the pilot ──
    try {
        const pilotUser = await client.users.fetch(request.pilotId).catch(() => null);
        if (pilotUser) {
            await pilotUser.send({
                embeds: [
                    regEmbed(
                        '❌ Pilot Request Rejected',
                        '#ED4245',
                        `**${request.ownerNick}** has declined your pilot request.`,
                        '✈️ Character Registration System'
                    )
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the DM embed ──
    return interaction.editReply({
        embeds: [
            regEmbed(
                '❌ Request Rejected',
                '#ED4245',
                `You rejected **${request.pilotTag}** as your pilot.\n\n` +
                '━━━━━━━━━━━━━━━━━━━━━━━━',
                '✈️ Character Registration System'
            )
        ],
        components: []
    });
}

/** Clean up expired pilot requests (call periodically). */
export function cleanupExpiredPilotRequests() {
    const now = Date.now();
    let changed = false;
    for (const [key, request] of Object.entries(pilotRequests)) {
        if (now - request.timestamp > REQUEST_EXPIRY_MS) {
            delete pilotRequests[key];
            changed = true;
        }
    }
    if (changed) saveRegistrationRequests();
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredPilotRequests, 300000);
setInterval(cleanupExpiredOwnerRegistrations, 300000);

const CONFIRM_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

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

    // Acknowledge immediately — the flow below (member fetch, role changes, DM notify)
    // can exceed Discord's 3-second interaction window and cause error 10062.
    await interaction.deferUpdate().catch(noop);

    const requestKey = interaction.customId.replace('reg_elder_approve_owner_', '');
    const request = pendingOwnerRegistrations[requestKey];

    if (!request) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '⌛ Request Expired',
                    '#FEE75C',
                    'This registration request has expired or was already processed.',
                    '📝 Character Registration System'
                )
            ],
            components: []
        });
    }

    delete pendingOwnerRegistrations[requestKey];
    saveRegistrationRequests();

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
                    regEmbed(
                        '✅ Registration Approved!',
                        '#57F287',
                        `Your registration for **${request.nickname}** has been approved! 🎉`,
                        '📝 Character Registration System'
                    )
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the approval message ──
    return interaction.editReply({
        embeds: [
            regEmbed(
                '✅ Registration Approved',
                '#57F287',
                `Approved by ${interaction.user}.\n\n` +
                '━━━━━━━━━━━━━━━━━━━━━━━━',
                '🛡️ Character Registration System'
            )
                .addFields(
                    { name: '👤 User', value: `**${request.userTag}**\n\`${request.userId}\``, inline: false },
                    { name: '🎮 Character', value: `**${request.nickname}**`, inline: true }
                )
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

    // Acknowledge immediately — the flow below (member fetch, DM notify)
    // can exceed Discord's 3-second interaction window and cause error 10062.
    await interaction.deferUpdate().catch(noop);

    const requestKey = interaction.customId.replace('reg_elder_reject_owner_', '');
    const request = pendingOwnerRegistrations[requestKey];

    if (!request) {
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '⌛ Request Expired',
                    '#FEE75C',
                    'This registration request has expired or was already processed.',
                    '📝 Character Registration System'
                )
            ],
            components: []
        });
    }

    delete pendingOwnerRegistrations[requestKey];
    saveRegistrationRequests();

    logEvent(`❌ Registration rejected by ${interaction.user.tag}: ${request.userTag} → ${request.nickname}`);

    // ── Notify the user ──
    try {
        const user = await client.users.fetch(request.userId).catch(() => null);
        if (user) {
            await user.send({
                embeds: [
                    regEmbed(
                        '❌ Registration Rejected',
                        '#ED4245',
                        `Your registration for **${request.nickname}** has been rejected by the Elders.`,
                        '📝 Character Registration System'
                    )
                ]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the approval message ──
    return interaction.editReply({
        embeds: [
            regEmbed(
                '❌ Registration Rejected',
                '#ED4245',
                `Rejected by ${interaction.user}.\n\n` +
                '━━━━━━━━━━━━━━━━━━━━━━━━',
                '🛡️ Character Registration System'
            )
                .addFields(
                    { name: '👤 User', value: `**${request.userTag}**\n\`${request.userId}\``, inline: false },
                    { name: '🎮 Character', value: `**${request.nickname}**`, inline: true }
                )
        ],
        components: []
    });
}

/** Clean up expired pending owner registrations (48h expiry). */
export function cleanupExpiredOwnerRegistrations() {
    const now = Date.now();
    let changed = false;
    for (const [key, request] of Object.entries(pendingOwnerRegistrations)) {
        if (now - request.timestamp > REQUEST_EXPIRY_MS) {
            delete pendingOwnerRegistrations[key];
            changed = true;
        }
    }
    if (changed) saveRegistrationRequests();
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

    // Acknowledge immediately — the flow below (member fetch, role changes, DM notify)
    // can exceed Discord's 3-second interaction window and cause error 10062.
    await interaction.deferUpdate().catch(noop);

    const requestKey = interaction.customId.replace('reg_elder_approve_pilot_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.editReply({
            embeds: [regEmbed(
                '⌛ Request Expired',
                '#FEE75C',
                'This pilot request has expired or was already processed.',
                '🛡️ Character Registration System'
            )],
            components: []
        });
    }

    delete pilotRequests[requestKey];
    saveRegistrationRequests();

    // ── Add pilot to owner's list ──
    const ownerData = rankingDb.users[request.ownerId];
    if (!ownerData) {
        return interaction.editReply({
            embeds: [regEmbed(
                '❌ Error',
                '#ED4245',
                'The owner account could not be found.',
                '🛡️ Character Registration System'
            )],
            components: []
        });
    }

    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.editReply({
            embeds: [regEmbed(
                '❌ Pilot Limit Reached',
                '#ED4245',
                'This owner already has the maximum of **4 pilots**.',
                '🛡️ Character Registration System'
            )],
            components: []
        });
    }

    if (ownerData.pilotIds.includes(request.pilotId)) {
        return interaction.editReply({
            embeds: [regEmbed(
                'ℹ️ Already Linked',
                '#5865F2',
                'This user is already linked as a pilot.',
                '🛡️ Character Registration System'
            )],
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
                embeds: [regEmbed(
                    '✅ Pilot Approved by Elders',
                    '#57F287',
                    `**${request.pilotTag}** has been approved as your pilot by ${interaction.user.tag}.\n\n` +
                    '━━━━━━━━━━━━━━━━━━━━━━━━',
                    '✈️ Character Registration System'
                )
                    .addFields(
                        { name: '👤 Pilot', value: `**${request.pilotTag}**`, inline: true },
                        { name: '🎮 Character', value: `**${request.ownerNick}**`, inline: true },
                        { name: 'ℹ️', value: 'If you want to revoke this pilot, click the button below.', inline: false }
                    )
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
                embeds: [regEmbed(
                    '✅ Pilot Request Approved!',
                    '#57F287',
                    `**${request.ownerNick}** has approved you as their pilot! 🎉`,
                    '✈️ Character Registration System'
                )]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the channel message ──
    return interaction.editReply({
        embeds: [regEmbed(
            '✅ Pilot Approved',
            '#57F287',
            `Approved by ${interaction.user}.\n\n` +
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '🛡️ Character Registration System'
        )
            .addFields(
                { name: '👤 Pilot', value: `**${request.pilotTag}**`, inline: true },
                { name: '👑 Owner', value: `**${request.ownerNick}**`, inline: true }
            )
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

    // Acknowledge immediately — the flow below (member fetch, DM notify)
    // can exceed Discord's 3-second interaction window and cause error 10062.
    await interaction.deferUpdate().catch(noop);

    const requestKey = interaction.customId.replace('reg_elder_reject_pilot_', '');
    const request = pilotRequests[requestKey];

    if (!request) {
        return interaction.editReply({
            embeds: [regEmbed(
                '⌛ Request Expired',
                '#FEE75C',
                'This pilot request has expired or was already processed.',
                '🛡️ Character Registration System'
            )],
            components: []
        });
    }

    const ownerNick = request.ownerNick;
    delete pilotRequests[requestKey];
    saveRegistrationRequests();

    logEvent(`✈️ Pilot request rejected by ${interaction.user.tag}: ${request.pilotTag} → ${ownerNick}`);

    // ── Notify the pilot ──
    try {
        const pilotUser = await client.users.fetch(request.pilotId).catch(() => null);
        if (pilotUser) {
            await pilotUser.send({
                embeds: [regEmbed(
                    '❌ Pilot Request Rejected',
                    '#ED4245',
                    `Your pilot request for **${ownerNick}** has been rejected by the Elders.`,
                    '✈️ Character Registration System'
                )]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Notify the owner ──
    try {
        const ownerUser = await client.users.fetch(request.ownerId).catch(() => null);
        if (ownerUser) {
            await ownerUser.send({
                embeds: [regEmbed(
                    '❌ Pilot Request Rejected',
                    '#ED4245',
                    `The pilot request from **${request.pilotTag}** has been rejected by the Elders.`,
                    '✈️ Character Registration System'
                )]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the channel message ──
    return interaction.editReply({
        embeds: [regEmbed(
            '❌ Pilot Request Rejected',
            '#ED4245',
            `Rejected by ${interaction.user}.\n\n` +
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '🛡️ Character Registration System'
        )
            .addFields(
                { name: '👤 Pilot', value: `**${request.pilotTag}**`, inline: true },
                { name: '👑 Owner', value: `**${ownerNick}**`, inline: true }
            )
        ],
        components: []
    });
}

// ==========================================
// 🗑️ REVOKE PILOT (from owner DM)
// ==========================================

/** Handle pilot revocation by the owner from DM (clicking Revoke button). */
export async function handleRegPilotRevoke(interaction, rankingDb, saveLocalStorage, logEvent) {
    // Acknowledge immediately — the flow below (member fetch, role changes, DM notify)
    // can exceed Discord's 3-second interaction window and cause error 10062.
    await interaction.deferUpdate().catch(noop);

    const parts = interaction.customId.replace('reg_pilot_revoke_', '').split('_');
    const ownerId = parts[0];
    const pilotId = parts[1];

    // Verify the person clicking is the actual owner
    if (interaction.user.id !== ownerId) {
        return interaction.editReply({
            embeds: [regEmbed(
                '❌ Not Your Account',
                '#ED4245',
                'Only the account owner can revoke a pilot.',
                '✈️ Character Registration System'
            )],
            components: []
        });
    }

    const ownerData = rankingDb.users[ownerId];
    if (!ownerData || !ownerData.pilotIds || !ownerData.pilotIds.includes(pilotId)) {
        return interaction.editReply({
            embeds: [regEmbed(
                '❌ Not Found',
                '#ED4245',
                'This pilot is no longer linked to your account.',
                '✈️ Character Registration System'
            )],
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
                embeds: [regEmbed(
                    '❌ Pilot Revoked',
                    '#ED4245',
                    `Your pilot role has been revoked by **${ownerData.nickname}**.`,
                    '✈️ Character Registration System'
                )]
            }).catch(noop);
        }
    } catch { /* ignore */ }

    // ── Update the DM embed ──
    return interaction.editReply({
        embeds: [regEmbed(
            '🗑️ Pilot Revoked',
            '#ED4245',
            `You have revoked that pilot from your account.\n\n` +
            '━━━━━━━━━━━━━━━━━━━━━━━━',
            '✈️ Character Registration System'
        )],
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
                regEmbed(
                    '❌ No Pilots Found',
                    '#ED4245',
                    "You don't have any pilots linked to your account.",
                    '🗑️ Character Registration System'
                )
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
            regEmbed(
                '🗑️ Remove a Pilot',
                '#ED4245',
                'Select a pilot to remove from your account:',
                '🗑️ Character Registration System'
            )
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
        return interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Error',
                    '#ED4245',
                    'This pilot is no longer linked to your account.',
                    '🗑️ Character Registration System'
                )
            ],
            components: [],
            flags: 64
        });
    }

    userData.pilotIds = userData.pilotIds.filter(id => id !== pilotToRemoveId);
    saveLocalStorage();

    // Clean up pilot's roles and nickname
    try {
        const pilotMember = await interaction.guild.members.fetch(pilotToRemoveId).catch(() => null);
        if (pilotMember) {
            for (const roleId of Object.values(CLAN_ROLES)) {
                if (pilotMember.roles.cache.has(roleId)) {
                    await pilotMember.roles.remove(roleId).catch(noop);
                }
            }
            await pilotMember.setNickname(pilotMember.user.username).catch(noop);
        }
    } catch { /* ignore */ }

    await interaction.editReply({
        embeds: [
            regEmbed(
                '✅ Pilot Removed',
                '#57F287',
                'The pilot has been removed from your account.',
                '🗑️ Character Registration System'
            )
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
                regEmbed(
                    '❌ Permission Denied',
                    '#ED4245',
                    'Only **Administrators** can trigger a force sync.',
                    '🔄 Character Registration System'
                )
            ],
            flags: 64
        });
    }

    const embed = regEmbed(
        '🔄 Force Synchronization',
        '#FEE75C',
        'This will force a **full synchronization** with the official MIR4 ranking portal.\n\n' +
        'All registered player data (nicknames, clans) will be updated according to the current ranking.\n\n' +
        '**Are you sure you want to proceed?**',
        '🔄 Character Registration System'
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

    confirmationCache[`${interaction.user.id}-sync`] = { db: rankingDb, saveLocalStorage, logEvent, timestamp: Date.now() };

    return interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

/** Execute the force sync. */
export async function handleRegSyncConfirm(interaction, rankingDb, saveLocalStorage, logEvent) {
    const cacheKey = `${interaction.user.id}-sync`;
    const cache = confirmationCache[cacheKey];
    if (!cache || (Date.now() - cache.timestamp > CONFIRM_EXPIRY_MS)) {
        delete confirmationCache[cacheKey];
        return interaction.update({
            embeds: [
                regEmbed(
                    '⌛ Expired',
                    '#FEE75C',
                    'This confirmation has expired. Please try again.',
                    '🔄 Character Registration System'
                )
            ],
            components: [],
            flags: 64
        });
    }
    delete confirmationCache[cacheKey];

    await interaction.update({
        embeds: [
            regEmbed(
                '🔄 Syncing...',
                '#5865F2',
                'Synchronizing with the official ranking portal. This may take a moment.',
                '🔄 Character Registration System'
            )
        ],
        components: [],
        flags: 64
    });

    try {
        await runDailySynchronization(interaction.client, rankingDb, saveLocalStorage, logEvent, true);
        await interaction.editReply({
            embeds: [
                regEmbed(
                    '✅ Sync Complete',
                    '#57F287',
                    'Force sync completed! Player data has been updated from the ranking portal.',
                    '🔄 Character Registration System'
                )
            ],
            flags: 64
        });
    } catch (err) {
        await interaction.editReply({
            embeds: [
                regEmbed(
                    '❌ Sync Failed',
                    '#ED4245',
                    `\`\`\`\n${(err.message || String(err)).slice(0, 1900)}\n\`\`\``,
                    '🔄 Character Registration System'
                )
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
    const embed = regEmbed(
        '❓ Help & Commands',
        '#5865F2',
        'Everything you need to know about the **Character Registration System**! 👇\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        '❓ Character Registration System'
    )
        .addFields(
            {
                name: '📝 Register',
                value: [
                    'Click **📝 Register** and type your **exact** in-game nickname.',
                    'The bot auto-detects your clan from the official ranking and assigns the role.',
                    '',
                    '> ⏳ Your request is sent to the **Elders** for approval (expires in **48 hours**).',
                    '> 🔔 You\'ll receive a DM once it\'s approved or rejected.'
                ].join('\n'),
                inline: false
            },
            {
                name: '✈️ Register as Pilot',
                value: [
                    'Play on behalf of an owner? Click **✈️ Register as Pilot** and type the **owner\'s** character name.',
                    '',
                    '> ⚠️ Maximum of **4 pilots** per owner.',
                    '> 📬 The owner receives a DM to **approve** or **reject** your request.',
                    '> ✅ Once approved, you get the owner\'s clan role and nickname.'
                ].join('\n'),
                inline: false
            },
            {
                name: '🗑️ Remove Pilot',
                value: [
                    'Remove a pilot from your account.',
                    'Their clan role and pilot nickname are revoked automatically.',
                    '',
                    '> ℹ️ Pilots can also be removed via the **Manage Players** system.'
                ].join('\n'),
                inline: false
            },
            {
                name: '🔄 Force Sync',
                value: '**Admin only.** Immediately re-syncs with the official MIR4 ranking to refresh all nicknames and roles.',
                inline: true
            },
            {
                name: '📌 Auto-Sync Schedule',
                value: 'The bot syncs automatically every day at **22:00 BRT** — nicknames, clans and roles update by themselves.',
                inline: true
            },
            {
                name: '❓ Quick Tips',
                value: [
                    '• Your in-game name must match **exactly** (accents and symbols included).',
                    '• Keep DMs open so the bot can notify you about approvals.',
                    '• Already registered? Click **📝 Register** again to update your nickname.',
                    '• Pilots are linked to an owner — a pilot cannot register a second character.'
                ].join('\n'),
                inline: false
            }
        )
        .setFooter({ text: 'Need more help? Contact a server administrator.' })
        .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: 64 });
}

// ==========================================
// 👋 WELCOME MESSAGE DEPLOYMENT
// ==========================================

// ── Deployed welcome message tracking ──
let welcomeMessage = null;

/** Build the fixed welcome embed posted in the welcome channel — consistent with the registration panel. */
export function buildWelcomeEmbed() {
    return regEmbed(
        WELCOME_EMBED_TITLE,
        '#5865F2',
        'Get your **in-game clan roles** and manage your characters below! 👇\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━'
    )
        .addFields(
            {
                name: '⚠️ Important',
                value: 'Your character **MUST** be visible in the official server ranking (Top 1000) for the bot to find you and assign roles.',
                inline: false
            },
            {
                name: '📌 How to get your roles automatically',
                value: [
                    '**1.** Click **📝 Register** and type your in-game name **exactly**.',
                    '**2.** Have pilots handling your characters? Use **✈️ Register as Pilot** (**up to 4 pilots** per owner).',
                    '**3.** Need to remove a pilot? Use **🗑️ Remove Pilot**.',
                    '**4.** Your request is approved by the **Elders** — you\'ll get a DM when it\'s done.'
                ].join('\n'),
                inline: false
            },
            {
                name: '🔄 Ranking Updates',
                value: 'The database cache and role assignments refresh automatically every day at **22:00 BRT**.',
                inline: false
            },
            {
                name: 'ℹ️ Need help?',
                value: 'Click the **❓ Help** button to see all commands and tips.',
                inline: false
            }
        );
}

/** Post or update the fixed welcome message in the configured channel. @param {import('discord.js').TextChannel} channel */
export async function deployWelcomeMessage(channel) {
    const embed = buildWelcomeEmbed();

    try {
        if (!welcomeMessage) {
            // Recover the previously deployed welcome message after a restart (avoid duplicates)
            welcomeMessage = await findExistingFixedMessage(channel, WELCOME_EMBED_TITLE);
            if (welcomeMessage) {
                await cleanupOldFixedMessages(channel, WELCOME_EMBED_TITLE, welcomeMessage);
            }
        }

        if (welcomeMessage) {
            // Update existing message
            welcomeMessage = await welcomeMessage.edit({ embeds: [embed] }).catch(() => null);
        }

        if (!welcomeMessage) {
            // Send new message
            welcomeMessage = await channel.send({ embeds: [embed] });
        }

        logger.info('Registration', `Welcome message deployed in #${channel.name}`);
        return welcomeMessage;
    } catch (err) {
        logger.error('Registration', 'Failed to deploy welcome message', err);
        return null;
    }
}

/** Configure the welcome channel and deploy the fixed welcome message. @param {import('discord.js').TextChannel} channel */
export async function setWelcomeChannel(channel) {
    welcomeMessage = null; // Force re-deploy
    await deployWelcomeMessage(channel);
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
