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
import { CLAN_ROLES, confirmationCache } from '../core/ranking-constants.js';
import { getLocalRankingCache, findClosestNicknameInCache, cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';
import { applyImmediateRoleWithCache, applyClanRoleOnly } from '../core/ranking-role.js';
import { noop } from '../core/config.js';
import { runDailySynchronization } from '../core/ranking-sync-engine.js';
import { client } from '../core/state.js';
import { logger } from '../core/logger.js';

// ── Configuration ──
const REG_PANEL_CUSTOM_ID = 'reg_panel';
const BUTTON_IDS = {
    register: 'reg_register',
    pilot: 'reg_pilot',
    removePilot: 'reg_removepilot',
    myInfo: 'reg_myinfo',
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
                    '**3.** Add up to **4 pilots** who can claim on your behalf.',
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
            .setCustomId(BUTTON_IDS.pilot)
            .setEmoji('👤')
            .setLabel('Add Pilot')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.removePilot)
            .setEmoji('🗑️')
            .setLabel('Remove Pilot')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disableAll)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.myInfo)
            .setEmoji('ℹ️')
            .setLabel('My Info')
            .setStyle(ButtonStyle.Secondary)
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
        case BUTTON_IDS.pilot:
            return handlePilotButton(interaction, rankingDb, saveLocalStorage);
        case BUTTON_IDS.removePilot:
            return handleRemovePilotButton(interaction, rankingDb);
        case BUTTON_IDS.myInfo:
            return handleMyInfoButton(interaction, rankingDb);
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
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Registration Failed')
                    .setColor('#ED4245')
                    .setDescription(`**${nickname}** is already registered by another user.`)
            ],
            flags: 64
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
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Registration Failed')
                        .setColor('#ED4245')
                        .setDescription(
                            `**${nickname}** would be auto-corrected to **${finalNickname}**, ` +
                            'but that name is already registered.\n\nPlease contact an admin or use a different name.'
                        )
                ],
                flags: 64
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

    await interaction.reply({ embeds: [successEmbed], flags: 64 });

    // ── Refresh the panel ──
    await refreshRegPanel(rankingDb);
}

// ==========================================
// 👤 PILOT BUTTON
// ==========================================

/** Opens a modal to add a pilot by Discord member ID. */
async function handlePilotButton(interaction, rankingDb, saveLocalStorage) {
    const userData = rankingDb.users[interaction.user.id];
    const isRegistered = userData && (userData.registeredAt || userData.manual === true);

    if (!isRegistered) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Not Registered')
                    .setColor('#ED4245')
                    .setDescription('You need to register first before adding a pilot.\n\nUse the **📝 Register** button above!')
            ],
            flags: 64
        });
    }

    if (!userData.pilotIds) userData.pilotIds = [];
    if (userData.pilotIds.length >= 4) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('❌ Pilot Limit Reached')
                    .setColor('#ED4245')
                    .setDescription('You already have **4 pilots** linked to your account.\nRemove one first before adding another.')
            ],
            flags: 64
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('👤 Add a Pilot')
        .setColor('#5865F2')
        .setDescription(
            `A pilot is another Discord member who can claim panels on your behalf.\n\n` +
            `**Your pilots:** ${userData.pilotIds.length}/4\n\n` +
            `To add a pilot, use the slash command:\n` +
            `➡️ **\`/pilot @user\`**\n\n` +
            `*Replace @user with the Discord member you want to add.*`
        )
        .setFooter({ text: 'Pilot limit: 4 per account' });

    return interaction.reply({ embeds: [embed], flags: 64 });
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
// ℹ️ MY INFO BUTTON
// ==========================================

/** Shows the user's registration info in a beautiful embed. */
async function handleMyInfoButton(interaction, rankingDb) {
    const userData = rankingDb.users[interaction.user.id];
    const isRegistered = userData && (userData.registeredAt || userData.manual === true);

    if (!isRegistered) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('ℹ️ My Info')
                    .setColor('#5865F2')
                    .setDescription("You are **not registered** yet.\n\nUse the **📝 Register** button above to get started!")
            ],
            flags: 64
        });
    }

    // Find clan from role
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    let currentClan = 'Unknown';
    if (member) {
        for (const [clanName, roleId] of Object.entries(CLAN_ROLES)) {
            if (member.roles.cache.has(roleId)) {
                currentClan = clanName;
                break;
            }
        }
    }

    // Pilot info
    let pilotInfo = 'None';
    if (userData.pilotIds && userData.pilotIds.length > 0) {
        const pilotNames = [];
        for (const pId of userData.pilotIds) {
            const pMember = await interaction.guild.members.fetch(pId).catch(() => null);
            pilotNames.push(pMember ? pMember.user.tag : `Unknown (${pId})`);
        }
        pilotInfo = `• ${pilotNames.join('\n• ')}`;
    }

    const registeredDate = userData.registeredAt
        ? new Date(userData.registeredAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        : 'N/A';

    const embed = new EmbedBuilder()
        .setTitle('ℹ️ My Registration Info')
        .setColor('#5865F2')
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
            { name: '👤 User', value: `${interaction.user.tag}`, inline: true },
            { name: '🎮 Character', value: `**${userData.nickname}**`, inline: true },
            { name: '🏷️ Current Clan', value: currentClan, inline: true },
            { name: '📅 Registered', value: registeredDate, inline: true },
            { name: '✈️ Pilots', value: `**${userData.pilotIds ? userData.pilotIds.length : 0}/4**`, inline: true },
            { name: '🔄 Last Sync', value: 'Daily at 22:00 BRT', inline: true }
        )
        .setFooter({ text: 'Use /pilot to add pilots to your account' })
        .setTimestamp();

    if (userData.pilotIds && userData.pilotIds.length > 0) {
        embed.addFields({ name: '👥 Linked Pilots', value: pilotInfo, inline: false });
    }

    return interaction.reply({ embeds: [embed], flags: 64 });
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
                name: '👤 Add Pilot',
                value: 'Add up to **4 pilots** — other Discord members who can claim panels on your behalf. Use `/pilot @user`.',
                inline: false
            },
            {
                name: '🗑️ Remove Pilot',
                value: 'Remove a pilot from your account. Their clan role will be revoked.',
                inline: false
            },
            {
                name: 'ℹ️ My Info',
                value: 'View your current registration details: character name, clan, pilots, and registration date.',
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
