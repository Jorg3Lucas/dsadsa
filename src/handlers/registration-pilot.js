// ==========================================
// ✈️ REGISTRATION — Pilot Request Lifecycle
// Pilot modal submission, owner approve/reject (DM), revoke
// Extracted from registration-panel.js
// ==========================================

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { CLAN_ROLES, DISCORD_SERVER_ID, APPROVAL_CHANNEL_ID } from '../core/ranking-constants.js';
import { applyImmediateRoleWithCache } from '../core/ranking-role.js';
import { noop } from '../core/config.js';
import { client } from '../core/state.js';
import { logger } from '../core/logger.js';
import {
    pilotRequests,
    saveRegistrationRequests,
    regEmbed
} from './registration-shared.js';

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

// ==========================================
// ✅ PILOT APPROVE (owner DM)
// ==========================================

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

// ==========================================
// ❌ PILOT REJECT (owner DM)
// ==========================================

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

