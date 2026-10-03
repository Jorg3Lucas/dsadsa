// ==========================================
// 🎫 TICKET SYSTEM — Core
// State management, init, panel setup
// Extracted from ticket-system.js
// ==========================================

import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import fs from "fs";
import path from "path";
import { client } from "../core/state.js";
import { runBackup } from "../auto-backup.js";
import { noop } from "../core/config.js";

const ticketsPath = path.resolve("./tickets.json");
export const TICKET_CATEGORY_ID = "1519145795838808093";

export const STAFF_ROLE_ID = "1503934006431973488";
export const TICKET_CATEGORIES = [
    { label: "❓ Support", value: "support", description: "General help and questions" },
    { label: "⚠️ Report", value: "report", description: "Report a player or issue" },
    { label: "💡 Doubt", value: "doubt", description: "Ask a question about the game or rules" },
];

export let ticketPanelChannelId = null;
export let openTickets = {}; // userId -> channelId

// ── State persistence ──
function loadTicketState() {
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

// ── Init / Restore panel ──
/** Initialize ticket system: load state, restore panel, clean orphans. @param {object} client - Discord client */
export function initTicketSystem(client) {
    loadTicketState();
    if (ticketPanelChannelId) {
        const channel = client.channels.cache.get(ticketPanelChannelId);
        if (channel) {
            sendTicketPanel(channel);
            console.log(`🎫 Ticket panel restored in #${channel.name}.`);
        }
    }
    cleanupOrphanedTickets(client);
}

// ── Panel setup ──
/** Set up the ticket creation panel in a channel. @param {import('discord.js').TextChannel} channel */
export async function setupTicketPanel(channel) {
    ticketPanelChannelId = channel.id;
    saveTicketState();
    await sendTicketPanel(channel);
}

async function sendTicketPanel(channel) {
    try {
        const fetched = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        if (fetched) {
            const botPanels = fetched.filter(m => m.author.id === client.user.id && m.components.length > 0);
            for (const [, msg] of botPanels) {
                await msg.delete().catch(noop);
            }
        }
    } catch (e) { /* non-critical */ }

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

    await channel.send({ embeds: [embed], components: [row] }).catch(noop);
}

// ── Orphaned ticket cleanup ──
let orphanCleanupDone = false;

async function cleanupOrphanedTickets(client) {
    if (orphanCleanupDone) return;
    orphanCleanupDone = true;
    if (!TICKET_CATEGORY_ID) return;

    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    for (const [, guild] of client.guilds.cache) {
        const category = guild.channels.cache.get(TICKET_CATEGORY_ID);
        if (!category) continue;
        for (const [, channel] of guild.channels.cache) {
            if (channel.type === ChannelType.GuildText && channel.parentId === TICKET_CATEGORY_ID && channel.name.startsWith("ticket-")) {
                const isTracked = Object.values(openTickets).includes(channel.id);
                if (!isTracked) {
                    const channelAge = now - channel.createdTimestamp;
                    if (channelAge > ONE_HOUR_MS) {
                        await channel.delete("🧹 Cleanup — orphaned ticket channel on startup").catch(noop);
                    } else {
                        console.log(`⚠️ [Tickets] Orphaned ticket #${channel.name} is less than 1 hour old — preserving it.`);
                    }
                }
            }
        }
    }
}

export { saveTicketState };
