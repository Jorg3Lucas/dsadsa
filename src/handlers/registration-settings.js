// ==========================================
// ⚙️ REGISTRATION — Pilot Management, Sync & Help
// Remove pilot (button + select), force sync, help
// Extracted from registration-panel.js
// ==========================================

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { CLAN_ROLES, confirmationCache } from '../core/ranking-constants.js';
import { noop } from '../core/config.js';
import { runDailySynchronization } from '../core/ranking-sync-engine.js';
import {
    regEmbed,
    CONFIRM_EXPIRY_MS
} from './registration-shared.js';
import { refreshRegPanel } from './registration-deploy.js';

// ==========================================
// 🗑️ REMOVE PILOT BUTTON
// ==========================================

/** Shows a select menu to remove a pilot. */
export async function handleRemovePilotButton(interaction, rankingDb) {
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
export async function handleSyncButton(interaction, rankingDb, saveLocalStorage, logEvent) {
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
export async function handleHelpButton(interaction) {
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
