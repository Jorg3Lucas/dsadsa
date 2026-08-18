import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    REGISTRATION_CHANNEL_ID,
    DOMINATION_CHANNEL_ID,
    STANDBY_CHANNEL_ID,
    adminChannelId
} from '../core/ranking-constants.js';
import { deferUpdateSafe } from '../core/interaction-utils.js';

// ==========================================
// 📧 NOTIFY COMMAND HANDLERS
// ==========================================

// In-memory store for pending notification confirmations
const pendingNotifications = {};

// ── Conservative DM pacing — Discord anti-spam safe ──
// Discord flags bots that mass-DM (this bot was quarantined once for it).
// Pacing is the primary mitigation: batches of 20 members every 3s (admin
// choice). The campaign/day caps are DISABLED so a /notify run reaches
// every eligible member and several campaigns per day are allowed. To
// re-enable a volume guard, set a finite number (e.g. 200) below.
export const DM_BATCH_SIZE = 20;                 // members per batch
export const DM_BATCH_PAUSE_MS = 3000;           // delay between batches
export const DM_CAMPAIGN_CAP = Number.MAX_SAFE_INTEGER; // no per-campaign limit (call everyone)
export const DM_DAY_CAP = Number.MAX_SAFE_INTEGER;      // no daily limit (several campaigns/day)

function buildCapNotice(skipped) {
    return `\n\n🛑 **Campanha limitada pelo teto de segurança do bot** (máx. ${DM_CAMPAIGN_CAP} DMs por campanha).\n**${skipped} membros** ficaram de fora — rode o /notify novamente em outro momento para notificá-los.`;
}

// Rolling 24h DM budget (module-level; resets on process restart).
let dmBudget = { count: 0, windowStart: Date.now() };

export function resetDmBudgetForTests() {
    dmBudget = { count: 0, windowStart: Date.now() };
}

/**
 * Send DMs to a list of members in small parallel batches with long pauses
 * and hard volume caps. Stops early when a cap is hit and reports how many
 * members were skipped.
 * Returns { sent, failed, skipped }.
 */
export async function sendDmsToMembers(members, getMessageFn, logEvent, options = {}) {
    const batchSize = Math.max(1, options.batchSize ?? DM_BATCH_SIZE);
    const pauseMs = options.pauseMs ?? DM_BATCH_PAUSE_MS;
    const campaignCap = options.campaignCap ?? DM_CAMPAIGN_CAP;
    const dayCap = options.dayCap ?? DM_DAY_CAP;

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const total = members.length;

    // Roll the 24h window if it has expired.
    const now = Date.now();
    if (now - dmBudget.windowStart >= 24 * 60 * 60 * 1000) {
        dmBudget = { count: 0, windowStart: now };
    }

    for (let i = 0; i < total; ) {
        const processed = sent + failed;
        // Campaign cap counts every ATTEMPT (sent + failed) — each is an API
        // request Discord sees; the daily budget counts only SUCCESSES.
        const budgetLeft = Math.min(campaignCap - processed, dayCap - dmBudget.count);
        if (budgetLeft <= 0) {
            skipped += total - processed;
            break;
        }

        const batch = members.slice(i, i + batchSize);
        const active = batch.slice(0, budgetLeft);
        // Advance by the members actually consumed (active.length >= 1) so a
        // budget-truncated batch never silently skips the remaining members.
        i += active.length;

        const batchResults = await Promise.all(
            active.map(async (member) => {
                try {
                    const msg = getMessageFn(member);
                    await member.send(msg);
                    return { member, success: true };
                } catch (error) {
                    return { member, success: false, error };
                }
            })
        );

        for (const { member, success, error } of batchResults) {
            if (success) {
                sent++;
                dmBudget.count++;
                logEvent(`✅ DM sent to ${member.user.tag} (${member.id}) — ${sent}/${total}`);
            } else {
                failed++;
                logEvent(`❌ DM failed for ${member.user.tag} (${member.id}) — ${error.message}`);
            }
        }

        if (sent + failed >= campaignCap || dmBudget.count >= dayCap) {
            skipped += total - (sent + failed);
            break;
        }

        if (sent + failed < total) {
            await new Promise(r => setTimeout(r, pauseMs));
        }
    }

    return { sent, failed, skipped };
}

/**
 * Handles the /notify slash command — opens a select menu with notification options.
 */
export async function handleNotifyCommand(interaction, db, saveLocalStorage, logEvent) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('notify_select_action')
        .setPlaceholder(getMsg('ranking.responses.notify.placeholder'))
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(getMsg('ranking.responses.notify.optionNoRole.label'))
                .setDescription(getMsg('ranking.responses.notify.optionNoRole.description'))
                .setValue('notify_no_role')
                .setEmoji('📧'),
            new StringSelectMenuOptionBuilder()
                .setLabel(getMsg('ranking.responses.notify.optionDomination.label'))
                .setDescription(getMsg('ranking.responses.notify.optionDomination.description'))
                .setValue('notify_domination')
                .setEmoji('⚔️'),
            new StringSelectMenuOptionBuilder()
                .setLabel(getMsg('ranking.responses.notify.optionStandby.label'))
                .setDescription(getMsg('ranking.responses.notify.optionStandby.description'))
                .setValue('notify_standby')
                .setEmoji('⏳')
        );

    const row = new ActionRowBuilder().addComponents(menu);

    return interaction.reply({
        content: getMsg('ranking.responses.notify.prompt'),
        components: [row],
        flags: 64
    });
}

/**
 * Handles the select menu choice — shows a confirmation step before sending.
 */
export async function handleNotifySelect(interaction, db, saveLocalStorage, logEvent) {
    const selected = interaction.values[0];        if (selected === 'notify_no_role') {
        pendingNotifications[interaction.user.id] = { type: 'no_role' };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('notify_confirm_no_role')
                .setLabel(getMsg('ranking.responses.notify.confirmBtn'))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('notify_cancel')
                .setLabel(getMsg('ranking.responses.notify.cancelBtn'))
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: getMsg('ranking.responses.notify.noRoleConfirm'),
            components: [row]
        });
    }

    if (selected === 'notify_domination') {
        pendingNotifications[interaction.user.id] = { type: 'domination' };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('notify_confirm_domination')
                .setLabel(getMsg('ranking.responses.notify.confirmBtn'))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('notify_cancel')
                .setLabel(getMsg('ranking.responses.notify.cancelBtn'))
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: getMsg('ranking.responses.notify.dominationConfirm'),
            components: [row]
        });
    }

    if (selected === 'notify_standby') {
        pendingNotifications[interaction.user.id] = { type: 'standby' };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('notify_confirm_standby')
                .setLabel(getMsg('ranking.responses.notify.confirmBtn'))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('notify_cancel')
                .setLabel(getMsg('ranking.responses.notify.cancelBtn'))
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: getMsg('ranking.responses.notify.standbyConfirm'),
            components: [row]
        });
    }
}

/**
 * Handles confirmation/cancel buttons from the notify flow.
 */
export async function handleNotifyButton(interaction, db, saveLocalStorage, logEvent) {
    const customId = interaction.customId;

    // ── Cancel ──
    if (customId === 'notify_cancel') {
        delete pendingNotifications[interaction.user.id];
        return interaction.update({
            content: getMsg('ranking.responses.notify.cancelled'),
            components: []
        });
    }

    // ── Confirm: Notify no-role members via DM ──
    if (customId === 'notify_confirm_no_role') {
        if (!await deferUpdateSafe(interaction)) return;
        delete pendingNotifications[interaction.user.id];

        const allMembers = await interaction.guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply({ content: '❌ Could not fetch guild members.' });
        }

        const noRole = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            // Notify members with NO roles at all on the server
            if (member.roles.cache.size > 0) continue;
            noRole.push(member);
        }

        if (noRole.length === 0) {
            logEvent(`📧 Admin ${interaction.user.tag} tried to notify no-role members — none found`);
            return interaction.editReply({ content: '✅ **All members already have at least one role!**' });
        }

        await interaction.editReply({
            content: getMsg('ranking.responses.notify.sendingDms', { count: noRole.length })
        });

        logEvent(`📧 Admin ${interaction.user.tag} started notifying ${noRole.length} members with no roles...`);

        const { sent, failed, skipped } = await sendDmsToMembers(
            noRole,
            (member) => getMsg('ranking.responses.notify.noRoleDm', {
                displayName: member.displayName,
                channelId: REGISTRATION_CHANNEL_ID
            }),
            logEvent
        );

        logEvent(`📧 Admin ${interaction.user.tag} finished — ${sent} sent, ${failed} failed${skipped > 0 ? `, ${skipped} skipped (safety cap)` : ''}`);

        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                await adminCh.send({
                    content: `📧 **Bulk DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total no-role members:** ${noRole.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}${skipped > 0 ? `\n🛑 **Skipped (safety cap):** ${skipped}` : ''}\n🕐 **Finished:** ${new Date().toLocaleString('pt-BR')}`
                }).catch(() => {});
            }
        }

        let noRoleResult = getMsg('ranking.responses.notify.noRoleResult', { sent, failed });
        if (skipped > 0) {
            noRoleResult += buildCapNotice(skipped);
        }

        return interaction.editReply({
            content: noRoleResult,
            components: []
        });
    }

    // ── Confirm: Domination notification via DM ──
    if (customId === 'notify_confirm_domination') {
        if (!await deferUpdateSafe(interaction)) return;
        delete pendingNotifications[interaction.user.id];

        // Collect all guild members with the member role
        const allMembers = await interaction.guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply({ content: '❌ Could not fetch guild members.' });
        }

        const memberRoleMembers = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            // Only DM members who have the MEMBER_ROLE_ID role
            if (member.roles.cache.has(MEMBER_ROLE_ID)) {
                memberRoleMembers.push(member);
            }
        }

        if (memberRoleMembers.length === 0) {
            logEvent(`⚔️ Admin ${interaction.user.tag} tried to notify Domination — no members with member role found`);
            return interaction.editReply({ content: '❌ **No members with the member role found to notify.**' });
        }

        await interaction.editReply({
            content: getMsg('ranking.responses.notify.sendingDms', { count: memberRoleMembers.length })
        });

        logEvent(`⚔️ Admin ${interaction.user.tag} started Domination DM to ${memberRoleMembers.length} members with member role...`);

        const { sent, failed, skipped } = await sendDmsToMembers(
            memberRoleMembers,
            (member) => getMsg('ranking.responses.notify.dominationDm', {
                displayName: member.displayName,
                channelId: DOMINATION_CHANNEL_ID
            }),
            logEvent
        );

        logEvent(`⚔️ Admin ${interaction.user.tag} finished Domination DM — ${sent} sent, ${failed} failed${skipped > 0 ? `, ${skipped} skipped (safety cap)` : ''}`);

        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                await adminCh.send({
                    content: `⚔️ **Domination DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total with member role:** ${memberRoleMembers.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}${skipped > 0 ? `\n🛑 **Skipped (safety cap):** ${skipped}` : ''}\n🕐 **Finished:** ${new Date().toLocaleString('pt-BR')}`
                }).catch(() => {});
            }
        }

        let dominationResult = getMsg('ranking.responses.notify.dominationResult', { sent, failed });
        if (skipped > 0) {
            dominationResult += buildCapNotice(skipped);
        }

        return interaction.editReply({
            content: dominationResult,
            components: []
        });
    }

    // ── Confirm: Standby notification via DM ──
    if (customId === 'notify_confirm_standby') {
        if (!await deferUpdateSafe(interaction)) return;
        delete pendingNotifications[interaction.user.id];

        // Collect all guild members with the member role
        const allMembers = await interaction.guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply({ content: '❌ Could not fetch guild members.' });
        }

        const memberRoleMembers = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            // Only DM members who have the MEMBER_ROLE_ID role
            if (member.roles.cache.has(MEMBER_ROLE_ID)) {
                memberRoleMembers.push(member);
            }
        }

        if (memberRoleMembers.length === 0) {
            logEvent(`⏳ Admin ${interaction.user.tag} tried to notify Standby — no members with member role found`);
            return interaction.editReply({ content: '❌ **No members with the member role found to notify.**' });
        }

        await interaction.editReply({
            content: getMsg('ranking.responses.notify.sendingDms', { count: memberRoleMembers.length })
        });

        logEvent(`⏳ Admin ${interaction.user.tag} started Standby DM to ${memberRoleMembers.length} members with member role...`);

        const { sent, failed, skipped } = await sendDmsToMembers(
            memberRoleMembers,
            (member) => getMsg('ranking.responses.notify.standbyDm', {
                displayName: member.displayName,
                channelId: STANDBY_CHANNEL_ID
            }),
            logEvent
        );

        logEvent(`⏳ Admin ${interaction.user.tag} finished Standby DM — ${sent} sent, ${failed} failed${skipped > 0 ? `, ${skipped} skipped (safety cap)` : ''}`);

        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                await adminCh.send({
                    content: `⏳ **Standby DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total with member role:** ${memberRoleMembers.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}${skipped > 0 ? `\n🛑 **Skipped (safety cap):** ${skipped}` : ''}\n🕐 **Finished:** ${new Date().toLocaleString('pt-BR')}`
                }).catch(() => {});
            }
        }

        let standbyResult = getMsg('ranking.responses.notify.standbyResult', { sent, failed });
        if (skipped > 0) {
            standbyResult += buildCapNotice(skipped);
        }

        return interaction.editReply({
            content: standbyResult,
            components: []
        });
    }
}
