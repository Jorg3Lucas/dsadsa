// ==========================================
// 🛡️ REGISTRATION — Elder/Admin Approvals
// Owner registration + pilot approvals/rejections from the approval channel
// Extracted from registration-panel.js
// ==========================================

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} from 'discord.js';
import { ELDER_ROLE_ID } from '../core/ranking-constants.js';
import { applyImmediateRoleWithCache } from '../core/ranking-role.js';
import { noop } from '../core/config.js';
import { client } from '../core/state.js';
import {
    pilotRequests,
    pendingOwnerRegistrations,
    saveRegistrationRequests,
    regEmbed
} from './registration-shared.js';

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

