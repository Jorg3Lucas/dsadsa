// ==========================================
// 🎫 TICKET SYSTEM — Member Handlers
// Add/remove member from tickets
// Extracted from ticket-handlers.js
// ==========================================

import { ActionRowBuilder, UserSelectMenuBuilder } from "discord.js";
import { noop } from "../core/config.js";
import { STAFF_ROLE_ID, openTickets } from "./ticket-core.js";

/** Show member selection menu to add to ticket. */
export async function handleAddMember(interaction) {
    const isStaff = interaction.member.permissions.has("ManageMessages") || (STAFF_ROLE_ID && interaction.member.roles.cache.has(STAFF_ROLE_ID));
    if (!isStaff) { return await interaction.reply({ content: "❌ Only staff can add members to this ticket.", flags: 64 }).catch(noop); }
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("ticket_add_select").setPlaceholder("Select a member to add...").setMinValues(1).setMaxValues(1)
    );
    return await interaction.reply({ content: "👤 **Select a member to add to this ticket:**", components: [row], flags: 64 }).catch(noop);
}

/** Add selected member to ticket channel. */
export async function handleAddMemberSelect(interaction) {
    const targetMember = interaction.members.first();
    const channel = interaction.channel;
    if (!targetMember) { return await interaction.reply({ content: "❌ Could not resolve the selected member.", flags: 64 }).catch(noop); }
    await interaction.deferUpdate();
    try {
        await channel.permissionOverwrites.create(targetMember, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
        await interaction.editReply({ content: `✅ <@${targetMember.id}> has been added to this ticket.`, components: [] }).catch(noop);
        await channel.send({ content: `👤 <@${targetMember.id}> was added to this ticket by ${interaction.user}.` }).catch(noop);
    } catch (err) {
        console.error("❌ [Tickets] Error adding member:", err.message);
        await interaction.editReply({ content: "❌ Failed to add member.", components: [] }).catch(noop);
    }
}

/** Show member selection menu to remove from ticket. */
export async function handleRemoveMember(interaction) {
    const isStaff = interaction.member.permissions.has("ManageMessages") || (STAFF_ROLE_ID && interaction.member.roles.cache.has(STAFF_ROLE_ID));
    if (!isStaff) { return await interaction.reply({ content: "❌ Only staff can remove members from this ticket.", flags: 64 }).catch(noop); }
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId("ticket_remove_select").setPlaceholder("Select a member to remove...").setMinValues(1).setMaxValues(1)
    );
    return await interaction.reply({ content: "🚫 **Select a member to remove from this ticket:**", components: [row], flags: 64 }).catch(noop);
}

/** Remove selected member from ticket channel. */
export async function handleRemoveMemberSelect(interaction) {
    const targetMember = interaction.members.first();
    const channel = interaction.channel;
    if (!targetMember) { return await interaction.reply({ content: "❌ Could not resolve the selected member.", flags: 64 }).catch(noop); }

    let ticketOwnerId = null;
    for (const [userId, chId] of Object.entries(openTickets)) { if (chId === interaction.channelId) { ticketOwnerId = userId; break; } }
    if (targetMember.id === ticketOwnerId) { return await interaction.reply({ content: "❌ Cannot remove the ticket owner from the ticket.", flags: 64 }).catch(noop); }
    if (STAFF_ROLE_ID && targetMember.roles.cache.has(STAFF_ROLE_ID)) { return await interaction.reply({ content: "❌ Cannot remove staff members from the ticket.", flags: 64 }).catch(noop); }

    await interaction.deferUpdate();
    try {
        const existingOverwrite = channel.permissionOverwrites.cache.get(targetMember.id);
        if (!existingOverwrite) { return await interaction.editReply({ content: `⚠️ <@${targetMember.id}> doesn't have any special permissions in this ticket.`, components: [] }).catch(noop); }
        await channel.permissionOverwrites.delete(targetMember.id);
        await interaction.editReply({ content: `✅ <@${targetMember.id}> has been removed from this ticket.`, components: [] }).catch(noop);
        await channel.send({ content: `🚫 <@${targetMember.id}> was removed from this ticket by ${interaction.user}.` }).catch(noop);
    } catch (err) {
        console.error("❌ [Tickets] Error removing member:", err.message);
        await interaction.editReply({ content: "❌ Failed to remove member.", components: [] }).catch(noop);
    }
}
