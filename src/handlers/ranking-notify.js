import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    REGISTRATION_CHANNEL_ID,
    adminChannelId
} from '../core/ranking-constants.js';

// ==========================================
// 📧 NOTIFY COMMAND HANDLERS
// ==========================================

// In-memory store for pending notification confirmations
const pendingNotifications = {};

/**
 * Send DMs to a list of members in parallel batches.
 * Sends up to BATCH_SIZE members concurrently, with a brief delay between batches
 * to avoid hitting Discord's global rate limit.
 * Returns { sent, failed } counts.
 */
async function sendDmsToMembers(members, getMessageFn, logEvent) {
    let sent = 0;
    let failed = 0;
    const total = members.length;
    const BATCH_SIZE = 30;

    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = members.slice(i, i + BATCH_SIZE);

        // Send all members in this batch concurrently
        const batchResults = await Promise.all(
            batch.map(async (member) => {
                try {
                    const msg = getMessageFn(member);
                    await member.send(msg);
                    return { member, success: true };
                } catch (error) {
                    return { member, success: false, error };
                }
            })
        );

        // Report results for this batch
        for (const { member, success, error } of batchResults) {
            if (success) {
                sent++;
                logEvent(`✅ DM sent to ${member.user.tag} (${member.id}) — ${sent}/${total}`);
            } else {
                failed++;
                logEvent(`❌ DM failed for ${member.user.tag} (${member.id}) — ${error.message}`);
            }
        }

        // Brief delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < total) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return { sent, failed };
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
                .setEmoji('📧')
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
        await interaction.deferUpdate();
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

        const { sent, failed } = await sendDmsToMembers(
            noRole,
            (member) => getMsg('ranking.responses.notify.noRoleDm', {
                displayName: member.displayName,
                channelId: REGISTRATION_CHANNEL_ID
            }),
            logEvent
        );

        logEvent(`📧 Admin ${interaction.user.tag} finished — ${sent} sent, ${failed} failed`);

        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                await adminCh.send({
                    content: `📧 **Bulk DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total no-role members:** ${noRole.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}\n🕐 **Finished:** ${new Date().toLocaleString('pt-BR')}`
                }).catch(() => {});
            }
        }

        return interaction.editReply({
            content: getMsg('ranking.responses.notify.noRoleResult', { sent, failed }),
            components: []
        });
    }

    // Unknown button — ignore
    return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(() => {});
}
