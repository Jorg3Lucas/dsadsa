// ==========================================
// 🎫 TICKET SYSTEM
// Button-based support ticket system.
// Creates private text channels for support,
// with open and close functionality.
// ==========================================

import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, EmbedBuilder } from "discord.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import { dailyLogs, client } from "./state.js";
import { runBackup } from "./auto-backup.js";
import { getLogsChannelIds } from "./daily-logs.js";
import { getActiveServerIds, getServer } from "./server-config.js";

const ticketsPath = path.resolve("./tickets.json");

// Resolve staff role ID from server config (first configured server)
function getStaffRoleId() {
    const serverIds = getActiveServerIds();
    for (const serverId of serverIds) {
        const server = getServer(serverId);
        if (server?.staffRoleId) return server.staffRoleId;
    }
    return null;
}

// Resolve ticket category ID from server config (first configured server)
function getTicketCategoryId() {
    const serverIds = getActiveServerIds();
    for (const serverId of serverIds) {
        const server = getServer(serverId);
        if (server?.channels?.ticketCategory) return server.channels.ticketCategory;
    }
    return null;
}

const TICKET_CATEGORIES = [
    { label: "❓ Support", value: "support", description: "General help and questions" },
    { label: "⚠️ Report", value: "report", description: "Report a player or issue" },
    { label: "💡 Doubt", value: "doubt", description: "Ask a question about the game or rules" },
];

let ticketPanelChannelId = null;
let openTickets = {}; // userId -> channelId

// ── State persistence ───────────────────────

export function loadTicketState() {
    try {
        if (fs.existsSync(ticketsPath)) {
            const data = JSON.parse(fs.readFileSync(ticketsPath, "utf8"));
            ticketPanelChannelId = data.panelChannelId || null;
            openTickets = data.openTickets || {};
            console.log("✅ Ticket state loaded successfully.");
        }
    } catch (e) {
        console.error("❌ [Tickets] Error loading state:", e.message);
    }
}

function saveTicketState() {
    try {
        runBackup(["./tickets.json"]);
        fs.writeFileSync(ticketsPath, JSON.stringify({
            panelChannelId: ticketPanelChannelId,
            openTickets
        }, null, 2));
    } catch (e) {
        console.error("❌ [Tickets] Error saving state:", e.message);
    }
}

// ── Init / Restore panel ────────────────────

export function initTicketSystem(client) {
    loadTicketState();

    // Restore ticket panel on startup if configured
    if (ticketPanelChannelId) {
        const channel = client.channels.cache.get(ticketPanelChannelId);
        if (channel) {
            sendTicketPanel(channel);
            console.log(`🎫 Ticket panel restored in #${channel.name}.`);
        }
    }

    // Clean up orphaned ticket channels (channels that exist but aren't tracked)
    cleanupOrphanedTickets(client);
}

// ── Panel setup ─────────────────────────────

export async function setupTicketPanel(channel) {
    ticketPanelChannelId = channel.id;
    saveTicketState();
    await sendTicketPanel(channel);
}

async function sendTicketPanel(channel) {
    // Remove previous bot panel messages in this channel to avoid duplicates
    try {
        const fetched = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        if (fetched) {
            const botPanels = fetched.filter(m => m.author.id === client.user.id && m.components.length > 0);
            for (const [, msg] of botPanels) {
                await msg.delete().catch(() => {});
            }
        }
    } catch (e) {
        // Non-critical — just send the new panel
    }

    const embed = {
        color: 0x5865F2,
        title: "🎫 Support Ticket",
        description: "Need help? Click the button below to open a support ticket. A private channel will be created for you and our staff team.",
        footer: { text: "Support Team" },
        timestamp: new Date().toISOString(),
    };

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket_open")
            .setLabel("🎫 Open Ticket")
            .setStyle(ButtonStyle.Primary)
    );

    await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
}

// ── Interaction router ──────────────────────

export function canHandleTicketInteraction(interaction) {
    const cid = interaction.customId;
    return cid === "ticket_open" ||
        cid === "ticket_category" ||
        cid === "ticket_add" ||
        cid === "ticket_add_select" ||
        cid === "ticket_remove" ||
        cid === "ticket_remove_select" ||
        cid === "ticket_close" ||
        cid === "ticket_close_confirm" ||
        cid === "ticket_close_cancel";
}

export async function handleTicketInteraction(interaction) {
    const cid = interaction.customId;

    if (cid === "ticket_open") {
        return handleOpenTicket(interaction);
    }
    if (cid === "ticket_category") {
        return handleTicketCategory(interaction);
    }
    if (cid === "ticket_add") {
        return handleAddMember(interaction);
    }
    if (cid === "ticket_add_select") {
        return handleAddMemberSelect(interaction);
    }
    if (cid === "ticket_remove") {
        return handleRemoveMember(interaction);
    }
    if (cid === "ticket_remove_select") {
        return handleRemoveMemberSelect(interaction);
    }
    if (cid === "ticket_close") {
        return handleCloseTicket(interaction);
    }
    if (cid === "ticket_close_confirm") {
        return handleCloseConfirm(interaction);
    }
    if (cid === "ticket_close_cancel") {
        return handleCloseCancel(interaction);
    }

    return false;
}

// ── Open ticket (step 1: show category dropdown) ─

async function handleOpenTicket(interaction) {
    const uid = interaction.user.id;
    const guild = interaction.guild;

    // Check if user already has an open ticket
    if (openTickets[uid]) {
        const existingChannel = guild.channels.cache.get(openTickets[uid]);
        if (existingChannel) {
            return await interaction.reply({
                content: `📩 You already have an open ticket: ${existingChannel}`,
                flags: 64
            }).catch(() => {});
        }
        // Stale reference — clean up
        delete openTickets[uid];
        saveTicketState();
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("ticket_category")
            .setPlaceholder("Select a category...")
            .addOptions(TICKET_CATEGORIES)
    );

    return await interaction.reply({
        content: "📋 **Please select a category for your ticket:**",
        components: [row],
        flags: 64
    }).catch(() => {});
}

// ── Ticket category selected (step 2: create channel) ─

async function handleTicketCategory(interaction) {
    const uid = interaction.user.id;
    const guild = interaction.guild;
    const selectedCategory = interaction.values[0];
    const categoryLabel = TICKET_CATEGORIES.find(c => c.value === selectedCategory)?.label || "Support";

    await interaction.deferUpdate();

    try {
        const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "");
        const channelName = `ticket-${selectedCategory}-${safeName}`;

        // Build permission overwrites
        const overwrites = [
            { id: guild.id, deny: ["ViewChannel"] },
            {
                id: uid,
                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"],
            },
        ];

        const staffRoleId = getStaffRoleId();
        const ticketCategoryId = getTicketCategoryId();
        if (staffRoleId) {
            overwrites.push({
                id: staffRoleId,
                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageChannels"],
            });
        }

        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: ticketCategoryId || undefined,
            permissionOverwrites: overwrites,
            topic: `Ticket for ${interaction.user.tag} (${uid}) — ${categoryLabel}`,
        });

        openTickets[uid] = ticketChannel.id;
        saveTicketState();

        // Send welcome message in ticket with action buttons
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_add")
                .setLabel("👤 Add Member")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("ticket_remove")
                .setLabel("🚫 Remove Member")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("ticket_close")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Secondary)
        );

        const welcomeEmbed = {
            color: 0x57F287,
            title: `🎫 ${categoryLabel}`,
            description: `Welcome ${interaction.user}! A staff member will be with you shortly.\n\nPlease describe your issue in detail.`,
            fields: [
                { name: "User", value: interaction.user.tag, inline: true },
                { name: "Category", value: categoryLabel, inline: true },
                { name: "ID", value: uid, inline: true },
            ],
            timestamp: new Date().toISOString(),
        };

        await ticketChannel.send({
            content: staffRoleId ? `<@&${staffRoleId}>` : "",
            embeds: [welcomeEmbed],
            components: [actionRow]
        });

        return await interaction.editReply({
            content: `📩 Ticket created! ${ticketChannel}`,
            components: []
        }).catch(() => {});

    } catch (err) {
        console.error("❌ [Tickets] Error creating ticket:", err.message);
        return await interaction.editReply({
            content: "❌ Failed to create ticket. Please try again later.",
            components: []
        }).catch(() => {});
    }
}

// ── Add member to ticket (show user select) ──

async function handleAddMember(interaction) {
    const staffRoleId = getStaffRoleId();
    const isStaff = interaction.member.permissions.has("ManageMessages") ||
                    (staffRoleId && interaction.member.roles.cache.has(staffRoleId));

    if (!isStaff) {
        return await interaction.reply({
            content: "❌ Only staff can add members to this ticket.",
            flags: 64
        }).catch(() => {});
    }

    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("ticket_add_select")
            .setPlaceholder("Select a member to add...")
            .setMinValues(1)
            .setMaxValues(1)
    );

    return await interaction.reply({
        content: "👤 **Select a member to add to this ticket:**",
        components: [row],
        flags: 64
    }).catch(() => {});
}

// ── Add member selected ──────────────────────

async function handleAddMemberSelect(interaction) {
    const targetMember = interaction.members.first();
    const channel = interaction.channel;

    if (!targetMember) {
        return await interaction.reply({
            content: "❌ Could not resolve the selected member.",
            flags: 64
        }).catch(() => {});
    }

    await interaction.deferUpdate();

    try {
        // Pass the GuildMember object directly so discord.js resolves the type correctly
        await channel.permissionOverwrites.create(targetMember, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
        });

        await interaction.editReply({
            content: `✅ <@${targetMember.id}> has been added to this ticket.`,
            components: []
        }).catch(() => {});

        // Notify in the channel
        await channel.send({ content: `👤 <@${targetMember.id}> was added to this ticket by ${interaction.user}.` }).catch(() => {});
    } catch (err) {
        console.error("❌ [Tickets] Error adding member:", err.message);
        await interaction.editReply({
            content: "❌ Failed to add member.",
            components: []
        }).catch(() => {});
    }
}

// ── Remove member from ticket (show user select) ──

async function handleRemoveMember(interaction) {
    const staffRoleId = getStaffRoleId();
    const isStaff = interaction.member.permissions.has("ManageMessages") ||
                    (staffRoleId && interaction.member.roles.cache.has(staffRoleId));

    if (!isStaff) {
        return await interaction.reply({
            content: "❌ Only staff can remove members from this ticket.",
            flags: 64
        }).catch(() => {});
    }

    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("ticket_remove_select")
            .setPlaceholder("Select a member to remove...")
            .setMinValues(1)
            .setMaxValues(1)
    );

    return await interaction.reply({
        content: "🚫 **Select a member to remove from this ticket:**",
        components: [row],
        flags: 64
    }).catch(() => {});
}

// ── Remove member selected ───────────────────

async function handleRemoveMemberSelect(interaction) {
    const targetMember = interaction.members.first();
    const channel = interaction.channel;
    const uid = interaction.user.id;

    if (!targetMember) {
        return await interaction.reply({
            content: "❌ Could not resolve the selected member.",
            flags: 64
        }).catch(() => {});
    }

    // Prevent removing the ticket owner
    let ticketOwnerId = null;
    for (const [userId, chId] of Object.entries(openTickets)) {
        if (chId === interaction.channelId) {
            ticketOwnerId = userId;
            break;
        }
    }

    if (targetMember.id === ticketOwnerId) {
        return await interaction.reply({
            content: "❌ Cannot remove the ticket owner from the ticket.",
            flags: 64
        }).catch(() => {});
    }

    const staffRoleId = getStaffRoleId();
    // Prevent removing staff role members
    if (staffRoleId && targetMember.roles.cache.has(staffRoleId)) {
        return await interaction.reply({
            content: "❌ Cannot remove staff members from the ticket.",
            flags: 64
        }).catch(() => {});
    }

    await interaction.deferUpdate();

    try {
        // Check if the member has a permission overwrite in this channel
        const existingOverwrite = channel.permissionOverwrites.cache.get(targetMember.id);
        if (!existingOverwrite) {
            return await interaction.editReply({
                content: `⚠️ <@${targetMember.id}> doesn't have any special permissions in this ticket.`,
                components: []
            }).catch(() => {});
        }

        // Delete the permission overwrite for this member
        await channel.permissionOverwrites.delete(targetMember.id);

        await interaction.editReply({
            content: `✅ <@${targetMember.id}> has been removed from this ticket.`,
            components: []
        }).catch(() => {});

        // Notify in the channel
        await channel.send({ content: `🚫 <@${targetMember.id}> was removed from this ticket by ${interaction.user}.` }).catch(() => {});
    } catch (err) {
        console.error("❌ [Tickets] Error removing member:", err.message);
        await interaction.editReply({
            content: "❌ Failed to remove member.",
            components: []
        }).catch(() => {});
    }
}

// ── Close ticket (confirmation) ──────────────

async function handleCloseTicket(interaction) {
    const uid = interaction.user.id;
    const channelId = interaction.channelId;
    const staffRoleId = getStaffRoleId();
    const isStaff = interaction.member.permissions.has("ManageMessages") ||
                    (staffRoleId && interaction.member.roles.cache.has(staffRoleId));

    // Find the ticket owner
    let ticketOwnerId = null;
    for (const [userId, chId] of Object.entries(openTickets)) {
        if (chId === channelId) {
            ticketOwnerId = userId;
            break;
        }
    }

    // Only allow ticket owner or staff to close
    if (uid !== ticketOwnerId && !isStaff) {
        return await interaction.reply({
            content: "❌ Only the ticket owner or staff can close this ticket.",
            flags: 64
        }).catch(() => {});
    }

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket_close_confirm")
            .setLabel("✅ Yes, close ticket")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("ticket_close_cancel")
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Secondary),
    );

    return await interaction.reply({
        content: "⚠️ Are you sure you want to close this ticket?",
        components: [confirmRow],
        flags: 64
    }).catch(() => {});
}

// ── Confirm close ────────────────────────────

async function handleCloseConfirm(interaction) {
    const channelId = interaction.channelId;
    const channel = interaction.channel;

    // Find and remove from open tickets
    let ticketOwnerId = null;
    for (const [userId, chId] of Object.entries(openTickets)) {
        if (chId === channelId) {
            ticketOwnerId = userId;
            break;
        }
    }

    if (ticketOwnerId) {
        delete openTickets[ticketOwnerId];
        saveTicketState();
    }

    await interaction.deferUpdate().catch(() => {});

    // Save ticket log before deleting
    await saveTicketLog(channel, ticketOwnerId);

    await channel.delete("Ticket closed by user.").catch(() => {});
}

// ── Save ticket log to file ──────────────────

const TICKET_LOGS_DIR = path.resolve("./ticket-logs");

async function saveTicketLog(channel, ticketOwnerId) {
    try {
        // Ensure logs directory exists
        if (!fs.existsSync(TICKET_LOGS_DIR)) {
            fs.mkdirSync(TICKET_LOGS_DIR, { recursive: true });
        }

        // Fetch last messages from the channel (max 100)
        const messages = [];
        let lastId = null;
        while (messages.length < 100) {
            const fetched = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
            if (!fetched || fetched.size === 0) break;
            messages.push(...fetched.values());
            lastId = fetched.last()?.id;
        }

        // Build log content
        const lines = [];
        const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

        // Media directory (declared early so the log-loop can reference it)
        const mediaDir = path.join(TICKET_LOGS_DIR, `${channel.name}-${dateStr}_attachments`);

        lines.push("╔═══════════════════════════════════════════════╗");
        lines.push("║         🎫 TICKET LOG                        ║");
        lines.push("╚═══════════════════════════════════════════════╝");
        lines.push("");
        lines.push(`Channel:  #${channel.name}`);
        lines.push(`Category: ${channel.parent?.name || "N/A"}`);
        lines.push(`Closed:   ${new Date().toLocaleString()}`);
        lines.push(`Owner ID: ${ticketOwnerId || "Unknown"}`);
        lines.push("");
        lines.push("─".repeat(50));
        lines.push("");

        // Messages in chronological order
        messages.reverse();

        for (const msg of messages) {
            const time = msg.createdAt.toLocaleString();
            const author = msg.author.bot ? `[BOT] ${msg.author.tag}` : msg.author.tag;
            let content = msg.content || "";

            // Truncate very long messages
            if (content.length > 500) content = content.slice(0, 500) + "...";

            lines.push(`[${time}] ${author}`);
            if (content) {
                content.split("\n").forEach(line => lines.push(`  ${line}`));
            }
            if (msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    const safeName = `${msg.id}-${att.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                    lines.push(`  📎 ${att.name} → (saved: ${path.basename(mediaDir)}/${safeName})`);
                });
            }
            lines.push("");
        }

        if (messages.length === 0) {
            lines.push("(no messages in this ticket)");
            lines.push("");
        }

        lines.push("─".repeat(50));
        lines.push(`📊 Total messages: ${messages.length}`);
        lines.push(`📁 Log generated: ${new Date().toISOString()}`);

        // Ensure attachments directory exists
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }

        let totalAttachments = 0;
        for (const msg of messages) {
            if (msg.attachments.size > 0) {
                for (const att of msg.attachments.values()) {
                    try {
                        const safeName = `${msg.id}-${att.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                        const attPath = path.join(mediaDir, safeName);
                        const response = await axios.get(att.url, { responseType: "arraybuffer" });
                        fs.writeFileSync(attPath, Buffer.from(response.data));
                        totalAttachments++;
                    } catch (dlErr) {
                        console.error(`❌ [Tickets] Failed to download ${att.url}:`, dlErr.message);
                    }
                }
            }
        }

        const fileName = `${channel.name}-${dateStr}.txt`;
        const filePath = path.join(TICKET_LOGS_DIR, fileName);

        // Add media summary to log footer
        if (totalAttachments > 0) {
            lines.push(`📎 Attachments saved: ${totalAttachments} files in ${path.basename(mediaDir)}/`);
        }

        fs.writeFileSync(filePath, lines.join("\n"), "utf8");
        console.log(`📝 Ticket log saved: ${filePath}${totalAttachments > 0 ? ` (${totalAttachments} attachments in ${path.basename(mediaDir)}/)` : ""}`);

        // Also send to the configured logs channel
        await sendLogToChannel(filePath, channel, messages.length, ticketOwnerId);

        return filePath;
    } catch (err) {
        console.error("❌ [Tickets] Error saving log:", err.message);
        return null;
    }
}

// ── Send ticket log to the configured logs channel (via REST multipart like daily logs) ─

async function sendLogToChannel(filePath, channel, totalMessages, ticketOwnerId) {
    try {
        const channelIds = getLogsChannelIds();
        if (channelIds.length === 0) return;

        const botClient = channel.client;
        if (!botClient) return;

        // Send to all configured log channels
        for (const logChannelId of channelIds) {
            const logChannel = await botClient.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) {
                console.warn(`⚠️ [Tickets] Log channel ${logChannelId} not found, skipping.`);
                continue;
            }

            // Read file content
            const fileContent = fs.readFileSync(filePath, "utf8");
            const fileName = path.basename(filePath);
            const buffer = Buffer.from(fileContent, "utf8");

            console.log(`📎 Sending ticket log: ${fileName} to #${logChannel.name} (${(buffer.length / 1024).toFixed(1)} KB)`);

            const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
            if (!token) throw new Error("No bot token found");

            const boundary = "----ticketBot" + Math.random().toString(36).slice(2);
            const parts = [];

            // File part
            parts.push(Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="files[0]"; filename="${fileName}"\r\n` +
                `Content-Type: text/plain; charset=utf-8\r\n\r\n`
            ));
            parts.push(buffer);
            parts.push(Buffer.from("\r\n"));

            // Summary embed part
            const summaryEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("🎫 Ticket Closed")
                .addFields(
                    { name: "Channel", value: `#${channel.name}`, inline: true },
                    { name: "Category", value: channel.parent?.name || "N/A", inline: true },
                    { name: "Messages", value: `${totalMessages}`, inline: true },
                    { name: "Owner", value: ticketOwnerId ? `<@${ticketOwnerId}>` : "Unknown", inline: false }
                )
                .setTimestamp();

            parts.push(Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="payload_json"\r\n` +
                `Content-Type: application/json\r\n\r\n` +
                `${JSON.stringify({ embeds: [summaryEmbed.toJSON()] })}\r\n`
            ));
            parts.push(Buffer.from(`--${boundary}--\r\n`));

            const body = Buffer.concat(parts);

            await axios.post(
                `https://discord.com/api/v10/channels/${logChannel.id}/messages`,
                body,
                {
                    headers: {
                        Authorization: `Bot ${token}`,
                        "Content-Type": `multipart/form-data; boundary=${boundary}`,
                        "Content-Length": String(Buffer.byteLength(body))
                    },
                    maxBodyLength: Infinity
                }
            );

            console.log(`✅ Ticket log sent: ${fileName} -> #${logChannel.name}`);
        }
    } catch (err) {
        console.error("❌ [Tickets] Error sending log to channel:", err.message);
    }
}

// ── Cancel close ─────────────────────────────

async function handleCloseCancel(interaction) {
    return await interaction.update({
        content: "❌ Ticket close cancelled.",
        components: []
    }).catch(() => {});
}

// ── Cleanup orphaned tickets on startup ─────

let orphanCleanupDone = false;

async function cleanupOrphanedTickets(client) {
    // Only run once per bot session to avoid accidental deletion on reconnects
    if (orphanCleanupDone) return;
    orphanCleanupDone = true;

    const ticketCategoryId = getTicketCategoryId();
    if (!ticketCategoryId) return;

    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    for (const [, guild] of client.guilds.cache) {
        const category = guild.channels.cache.get(ticketCategoryId);
        if (!category) continue;

        for (const [, channel] of guild.channels.cache) {
            if (
                channel.type === ChannelType.GuildText &&
                channel.parentId === ticketCategoryId &&
                channel.name.startsWith("ticket-")
            ) {
                // Check if this channel is tracked
                const isTracked = Object.values(openTickets).includes(channel.id);

                if (!isTracked) {
                    // Safety guard: only delete channels older than 1 hour
                    // This prevents deleting tickets created moments before a bot restart
                    const channelAge = now - channel.createdTimestamp;
                    if (channelAge > ONE_HOUR_MS) {
                        await channel.delete("🧹 Cleanup — orphaned ticket channel on startup")
                            .catch(() => {});
                    } else {
                        console.log(`⚠️ [Tickets] Orphaned ticket #${channel.name} is less than 1 hour old — preserving it.`);
                    }
                }
            }
        }
    }
}
