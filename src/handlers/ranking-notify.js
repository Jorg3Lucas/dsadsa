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

// ==========================================
// 📧 NOTIFY COMMAND HANDLERS
// ==========================================

// In-memory store for pending notification confirmations
const pendingNotifications = {};

/**
 * Send DMs to a list of members with a 5-second delay between each.
 * Returns { sent, failed } counts.
 */
async function sendDmsToMembers(members, getMessageFn, logEvent) {
    let sent = 0;
    let failed = 0;
    const total = members.length;

    for (let i = 0; i < total; i++) {
        const member = members[i];
        try {
            const msg = getMessageFn(member);
            await member.send(msg);
            sent++;
            logEvent(`✅ DM sent to ${member.user.tag} (${member.id}) — ${sent}/${total}`);
        } catch (e) {
            failed++;
            logEvent(`❌ DM failed for ${member.user.tag} (${member.id}) — ${e.message}`);
        }
        if (i < total - 1) {
            await new Promise(r => setTimeout(r, 5000));
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
                .setLabel(getMsg('ranking.responses.notify.optionUnreg.label'))
                .setDescription(getMsg('ranking.responses.notify.optionUnreg.description'))
                .setValue('notify_unregistered')
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
    const selected = interaction.values[0];

    if (selected === 'notify_unregistered') {
        pendingNotifications[interaction.user.id] = { type: 'unregistered' };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('notify_confirm_unreg')
                .setLabel(getMsg('ranking.responses.notify.confirmBtn'))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('notify_cancel')
                .setLabel(getMsg('ranking.responses.notify.cancelBtn'))
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({
            content: getMsg('ranking.responses.notify.unregConfirm'),
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

    // ── Confirm: Notify unregistered members via DM ──
    if (customId === 'notify_confirm_unreg') {
        await interaction.deferUpdate();
        delete pendingNotifications[interaction.user.id];

        const allMembers = await interaction.guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply({ content: '❌ Could not fetch guild members.' });
        }

        const unregistered = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            if (!member.roles.cache.has(MEMBER_ROLE_ID)) continue;
            if (db.users[memberId] && (db.users[memberId].registeredAt || db.users[memberId].manual === true)) continue;
            unregistered.push(member);
        }

        if (unregistered.length === 0) {
            logEvent(`📧 Admin ${interaction.user.tag} tried to notify unregistered — none found`);
            return interaction.editReply({ content: '✅ **All members with the role are already registered!**' });
        }

        await interaction.editReply({
            content: getMsg('ranking.responses.notify.sendingDms', { count: unregistered.length })
        });

        logEvent(`📧 Admin ${interaction.user.tag} started notifying ${unregistered.length} unregistered members...`);

        const { sent, failed } = await sendDmsToMembers(
            unregistered,
            (member) => getMsg('ranking.responses.notify.unregDm', {
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
                    content: `📧 **Bulk DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total unregistered:** ${unregistered.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}\n🕐 **Finished:** ${new Date().toLocaleString('pt-BR')}`
                }).catch(() => {});
            }
        }

        return interaction.editReply({
            content: getMsg('ranking.responses.notify.unregResult', { sent, failed }),
            components: []
        });
    }

    // ── Confirm: Domination notification via DM ──
    if (customId === 'notify_confirm_domination') {
        await interaction.deferUpdate();
        delete pendingNotifications[interaction.user.id];

        // Collect all registered members still in the guild
        const allMembers = await interaction.guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply({ content: '❌ Could not fetch guild members.' });
        }

        const registeredMembers = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            // Only DM registered members (owners/pilots)
            if (db.users[memberId] && (db.users[memberId].registeredAt || db.users[memberId].manual === true)) {
                registeredMembers.push(member);
            }
        }

        if (registeredMembers.length === 0) {
            logEvent(`⚔️ Admin ${interaction.user.tag} tried to notify Domination — no registered members found`);
            return interaction.editReply({ content: '❌ **No registered members found to notify.**' });
        }

        await interaction.editReply({
            content: getMsg('ranking.responses.notify.sendingDms', { count: registeredMembers.length })
        });

        logEvent(`⚔️ Admin ${interaction.user.tag} started Domination DM to ${registeredMembers.length} members...`);

        const { sent, failed } = await sendDmsToMembers(
            registeredMembers,
            (member) => getMsg('ranking.responses.notify.dominationDm', {
                displayName: member.displayName,
                channelId: DOMINATION_CHANNEL_ID
            }),
            logEvent
        );

        logEvent(`⚔️ Admin ${interaction.user.tag} finished Domination DM — ${sent} sent, ${failed} failed`);

        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                await adminCh.send({
                    content: `⚔️ **Domination DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total registered:** ${registeredMembers.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}\n🕐 **Finished:** ${new Date().toLocaleString('pt-BR')}`
                }).catch(() => {});
            }
        }

        return interaction.editReply({
            content: getMsg('ranking.responses.notify.dominationResult', { sent, failed }),
            components: []
        });
    }

    // ── Confirm: Standby notification via DM ──
    if (customId === 'notify_confirm_standby') {
        await interaction.deferUpdate();
        delete pendingNotifications[interaction.user.id];

        // Collect all registered members still in the guild
        const allMembers = await interaction.guild.members.fetch().catch(() => null);
        if (!allMembers || allMembers.size === 0) {
            return interaction.editReply({ content: '❌ Could not fetch guild members.' });
        }

        const registeredMembers = [];
        for (const [memberId, member] of allMembers) {
            if (member.user.bot) continue;
            // Only DM registered members (owners/pilots)
            if (db.users[memberId] && (db.users[memberId].registeredAt || db.users[memberId].manual === true)) {
                registeredMembers.push(member);
            }
        }

        if (registeredMembers.length === 0) {
            logEvent(`⏳ Admin ${interaction.user.tag} tried to notify Standby — no registered members found`);
            return interaction.editReply({ content: '❌ **No registered members found to notify.**' });
        }

        await interaction.editReply({
            content: getMsg('ranking.responses.notify.sendingDms', { count: registeredMembers.length })
        });

        logEvent(`⏳ Admin ${interaction.user.tag} started Standby DM to ${registeredMembers.length} members...`);

        const { sent, failed } = await sendDmsToMembers(
            registeredMembers,
            (member) => getMsg('ranking.responses.notify.standbyDm', {
                displayName: member.displayName,
                channelId: STANDBY_CHANNEL_ID
            }),
            logEvent
        );

        logEvent(`⏳ Admin ${interaction.user.tag} finished Standby DM — ${sent} sent, ${failed} failed`);

        if (adminChannelId) {
            const adminCh = interaction.guild.channels.cache.get(adminChannelId);
            if (adminCh) {
                await adminCh.send({
                    content: `⏳ **Standby DM Report**\n\n👤 **Admin:** ${interaction.user.tag}\n📊 **Total registered:** ${registeredMembers.length}\n✉️ **DMs sent:** ${sent} ✅\n❌ **Failed:** ${failed}\n🕐 **Finished:** ${new Date().toLocaleString('pt-BR')}`
                }).catch(() => {});
            }
        }

        return interaction.editReply({
            content: getMsg('ranking.responses.notify.standbyResult', { sent, failed }),
            components: []
        });
    }
}
