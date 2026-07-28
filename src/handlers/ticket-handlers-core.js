// ==========================================
// 🎫 TICKET SYSTEM — Core Handlers
// Open ticket, category selection, close flow
// Extracted from ticket-handlers.js
// ==========================================

import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import { noop } from "../core/config.js";
import { STAFF_ROLE_ID, TICKET_CATEGORIES, TICKET_CATEGORY_ID, openTickets, saveTicketState } from "./ticket-core.js";
import { saveTicketLog } from "./ticket-handlers-logs.js";

/** Step 1: Show category selection dropdown to the user. */
export async function handleOpenTicket(interaction) {
    const uid = interaction.user.id;
    const guild = interaction.guild;
    if (openTickets[uid]) {
        const existingChannel = guild.channels.cache.get(openTickets[uid]);
        if (existingChannel) {
            return await interaction.reply({ content: `📩 You already have an open ticket: ${existingChannel}`, flags: 64 }).catch(noop);
        }
        delete openTickets[uid];
        saveTicketState();
    }
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("ticket_category").setPlaceholder("Select a category...").addOptions(TICKET_CATEGORIES)
    );
    return await interaction.reply({ content: "📋 **Please select a category for your ticket:**", components: [row], flags: 64 }).catch(noop);
}

/** Step 2: Create the ticket channel after category selection. */
export async function handleTicketCategory(interaction) {
    const uid = interaction.user.id;
    const guild = interaction.guild;
    const selectedCategory = interaction.values[0];
    const categoryLabel = TICKET_CATEGORIES.find(c => c.value === selectedCategory)?.label || "Support";
    await interaction.deferUpdate();
    try {
        const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "");
        const channelName = `ticket-${selectedCategory}-${safeName}`;
        const overwrites = [
            { id: guild.id, deny: ["ViewChannel"] },
            { id: uid, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"] },
        ];
        if (STAFF_ROLE_ID) {
            overwrites.push({ id: STAFF_ROLE_ID, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageChannels"] });
        }
        const ticketChannel = await guild.channels.create({
            name: channelName, type: ChannelType.GuildText,
            parent: TICKET_CATEGORY_ID || undefined,
            permissionOverwrites: overwrites,
            topic: `Ticket for ${interaction.user.tag} (${uid}) — ${categoryLabel}`,
        });
        openTickets[uid] = ticketChannel.id;
        saveTicketState();

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("ticket_add").setLabel("👤 Add Member").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("ticket_remove").setLabel("🚫 Remove Member").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Secondary)
        );
        const welcomeEmbed = {
            color: 0x57F287, title: `🎫 ${categoryLabel}`,
            description: `Welcome ${interaction.user}! A staff member will be with you shortly.\n\nPlease describe your issue in detail.`,
            fields: [
                { name: "User", value: interaction.user.tag, inline: true },
                { name: "Category", value: categoryLabel, inline: true },
                { name: "ID", value: uid, inline: true },
            ],
            timestamp: new Date().toISOString(),
        };
        await ticketChannel.send({ content: STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : "", embeds: [welcomeEmbed], components: [actionRow] });
        return await interaction.editReply({ content: `📩 Ticket created! ${ticketChannel}`, components: [] }).catch(noop);
    } catch (err) {
        console.error("❌ [Tickets] Error creating ticket:", err.message);
        return await interaction.editReply({ content: "❌ Failed to create ticket. Please try again later.", components: [] }).catch(noop);
    }
}

/** Show close confirmation prompt. */
export async function handleCloseTicket(interaction) {
    const uid = interaction.user.id;
    const channelId = interaction.channelId;
    const isStaff = interaction.member.permissions.has("ManageMessages") || (STAFF_ROLE_ID && interaction.member.roles.cache.has(STAFF_ROLE_ID));
    let ticketOwnerId = null;
    for (const [userId, chId] of Object.entries(openTickets)) { if (chId === channelId) { ticketOwnerId = userId; break; } }
    if (uid !== ticketOwnerId && !isStaff) { return await interaction.reply({ content: "❌ Only the ticket owner or staff can close this ticket.", flags: 64 }).catch(noop); }

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close_confirm").setLabel("✅ Yes, close ticket").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_close_cancel").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
    );
    return await interaction.reply({ content: "⚠️ Are you sure you want to close this ticket?", components: [confirmRow], flags: 64 }).catch(noop);
}

/** Confirm close — save log and delete channel. */
export async function handleCloseConfirm(interaction) {
    const channelId = interaction.channelId;
    const channel = interaction.channel;
    let ticketOwnerId = null;
    for (const [userId, chId] of Object.entries(openTickets)) { if (chId === channelId) { ticketOwnerId = userId; break; } }
    if (ticketOwnerId) { delete openTickets[ticketOwnerId]; saveTicketState(); }
    await interaction.deferUpdate().catch(noop);
    await saveTicketLog(channel, ticketOwnerId);
    await channel.delete("Ticket closed by user.").catch(noop);
}

/** Cancel close. */
export async function handleCloseCancel(interaction) {
    return await interaction.update({ content: "❌ Ticket close cancelled.", components: [] }).catch(noop);
}
