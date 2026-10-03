// ==========================================
// 🎫 TICKET SYSTEM — Log Handlers
// Save ticket transcript and send to log channel
// Extracted from ticket-handlers.js
// ==========================================

import axios from "axios";
import fs from "fs";
import path from "path";
import { EmbedBuilder } from "discord.js";
import { dailyLogs } from "../core/state.js";
import { sendFileWithEmbed } from "../core/discord-utils.js";

const TICKET_LOGS_DIR = path.resolve("./ticket-logs");

/** Save ticket log: fetch messages, write to file, download attachments, send to log channel. @param {import('discord.js').TextChannel} channel @param {string|null} ticketOwnerId @returns {Promise<string|null>} */
export async function saveTicketLog(channel, ticketOwnerId) {
    try {
        if (!fs.existsSync(TICKET_LOGS_DIR)) { fs.mkdirSync(TICKET_LOGS_DIR, { recursive: true }); }

        const messages = [];
        let lastId = null;
        while (messages.length < 100) {
            const fetched = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
            if (!fetched || fetched.size === 0) break;
            messages.push(...fetched.values());
            lastId = fetched.last()?.id;
        }

        const lines = [];
        const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
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

        messages.reverse();
        for (const msg of messages) {
            const time = msg.createdAt.toLocaleString();
            const author = msg.author.bot ? `[BOT] ${msg.author.tag}` : msg.author.tag;
            let content = msg.content || "";
            if (content.length > 500) content = content.slice(0, 500) + "...";
            lines.push(`[${time}] ${author}`);
            if (content) { content.split("\n").forEach(line => lines.push(`  ${line}`)); }
            if (msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    const safeName = `${msg.id}-${att.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                    lines.push(`  📎 ${att.name} → (saved: ${path.basename(mediaDir)}/${safeName})`);
                });
            }
            lines.push("");
        }
        if (messages.length === 0) { lines.push("(no messages in this ticket)"); lines.push(""); }

        lines.push("─".repeat(50));
        lines.push(`📊 Total messages: ${messages.length}`);
        lines.push(`📁 Log generated: ${new Date().toISOString()}`);

        if (!fs.existsSync(mediaDir)) { fs.mkdirSync(mediaDir, { recursive: true }); }
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
                    } catch (dlErr) { console.error(`❌ [Tickets] Failed to download ${att.url}:`, dlErr.message); }
                }
            }
        }

        const fileName = `${channel.name}-${dateStr}.txt`;
        const filePath = path.join(TICKET_LOGS_DIR, fileName);
        if (totalAttachments > 0) { lines.push(`📎 Attachments saved: ${totalAttachments} files in ${path.basename(mediaDir)}/`); }
        fs.writeFileSync(filePath, lines.join("\n"), "utf8");
        console.log(`📝 Ticket log saved: ${filePath}${totalAttachments > 0 ? ` (${totalAttachments} attachments in ${path.basename(mediaDir)}/)` : ""}`);

        await sendLogToChannel(filePath, channel, messages.length, ticketOwnerId);
        return filePath;
    } catch (err) {
        console.error("❌ [Tickets] Error saving log:", err.message);
        return null;
    }
}

async function sendLogToChannel(filePath, channel, totalMessages, ticketOwnerId) {
    try {
        if (!dailyLogs.configChannelId) return;
        const client = channel.client;
        if (!client) return;
        const logChannel = await client.channels.fetch(dailyLogs.configChannelId).catch(() => null);
        if (!logChannel) return;

        const fileContent = fs.readFileSync(filePath, "utf8");
        const fileName = path.basename(filePath);
        const buffer = Buffer.from(fileContent, "utf8");
        console.log(`📎 Sending ticket log: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

        const summaryEmbed = new EmbedBuilder()
            .setColor(0x5865F2).setTitle("🎫 Ticket Closed")
            .addFields(
                { name: "Channel", value: `#${channel.name}`, inline: true },
                { name: "Category", value: channel.parent?.name || "N/A", inline: true },
                { name: "Messages", value: `${totalMessages}`, inline: true },
                { name: "Owner", value: ticketOwnerId ? `<@${ticketOwnerId}>` : "Unknown", inline: false }
            ).setTimestamp();
        await sendFileWithEmbed(logChannel.id, fileName, buffer, summaryEmbed, "Ticket log");
    } catch (err) { console.error("❌ [Tickets] Error sending log to channel:", err.message); }
}
