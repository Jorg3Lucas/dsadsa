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
import { noop, DISCORD_SERVER_ID } from "../core/config.js";
import { findTextChannel, TICKET_CATEGORY } from "../core/server-structure.js";

const ticketsPath = path.resolve("./tickets.json");
// Category the ticket channels are created under. Defined in server-structure.js
// (explicit ID, overridable with TICKET_CATEGORY_ID in .env).
export const TICKET_CATEGORY_ID = TICKET_CATEGORY.id;

// Staff role is configured via .env (STAFF_ROLE_ID). When unset, staff actions
// fall back to the Manage Messages permission check only.
export const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID?.trim() || null;
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
/**
 * Initialize ticket system: load state, rebuild the panel channel and restore
 * the ticket panel, keep the 📜 ticket-logs channel and open ticket-* rooms
 * untouched, then reconcile the open-ticket state (nothing is ever deleted).
 * @param {object} client - Discord client
 */
export async function initTicketSystem(client) {
    loadTicketState();
    const handledPanel = await setupTicketChannels(client, DISCORD_SERVER_ID);
    // Fallback: when the ticket category can't be resolved (missing ID or
    // permissions) fall back to the channel stored in tickets.json so the
    // panel is still restored.
    if (!handledPanel && ticketPanelChannelId) {
        const channel = client.channels.cache.get(ticketPanelChannelId);
        if (channel) {
            await sendTicketPanel(channel);
            console.log(`🎫 Ticket panel restored in #${channel.name}.`);
        }
    }
    await reconcileOpenTickets(client);
}

// ── Ticket channel setup ──
/**
 * Set up the ticket category on boot, mirroring the claim setup but without
 * losing history:
 *   • the PANEL channel (🎫 open-ticket) is rebuilt from scratch — deleted and
 *     recreated with fresh permissions — and gets the ticket panel posted;
 *   • the 📜 ticket-logs channel is only created when missing and is NEVER
 *     deleted or recreated, so the transcript history is preserved;
 *   • open `ticket-*` rooms are never touched.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {Promise<boolean>} true when the panel channel inside the category was handled
 */
export async function setupTicketChannels(client, guildId) {
    const guild = guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first();
    if (!guild) {
        console.error("❌ [Tickets] Guild not found — skipping ticket channel setup.");
        return false;
    }
    const category = guild.channels.cache.get(TICKET_CATEGORY_ID);
    if (!category || category.type !== ChannelType.GuildCategory) {
        console.error(`❌ [Tickets] Ticket category ${TICKET_CATEGORY_ID} not found (or not a category) — skipping ticket channel setup.`);
        return false;
    }

    const categoryOverwrites = category.permissionOverwrites?.cache?.map(ow => ow) || [];
    let handledPanel = false;

    for (const chanDef of TICKET_CATEGORY.channels) {
        let channel = findTextChannel(guild, category.id, chanDef);

        if (chanDef.panel) {
            // Remove a stale panel left in a previously configured channel
            // (e.g. after a manual `!ticket` run somewhere else).
            if (ticketPanelChannelId && ticketPanelChannelId !== channel?.id) {
                const previous = client.channels.cache.get(ticketPanelChannelId);
                if (previous) await deleteBotPanels(previous);
            }
            // Rebuild the panel channel fresh on every boot — like the claim
            // channels — so its permissions and panel are always current.
            // 📜 ticket-logs and open ticket-* rooms are never deleted.
            // Only recreate when the old channel was actually removed, so a
            // failed delete can't leave two #🎫 open-ticket channels behind.
            let removed = true;
            if (channel) {
                removed = await channel.delete("🎫 [Tickets] panel channel rebuilt on boot")
                    .then(() => true)
                    .catch(() => false);
            }
            if (removed) {
                try {
                    channel = await guild.channels.create({
                        name: chanDef.name,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites: categoryOverwrites
                    });
                    console.log(`✅ [Tickets] Created #${chanDef.name} in ${category.name}.`);
                } catch (err) {
                    console.error(`❌ [Tickets] Failed to create #${chanDef.name}: ${err.message}`);
                    continue;
                }
            } else {
                console.warn(`⚠️ [Tickets] Could not delete #${channel.name} — reusing it.`);
            }
            ticketPanelChannelId = channel.id;
            saveTicketState();
            await sendTicketPanel(channel);
            handledPanel = true;
            continue;
        }

        // Log / auxiliary channels: create only when missing, never delete or
        // recreate them (the transcript history must survive restarts).
        if (channel) {
            console.log(`ℹ️ [Tickets] #${channel.name} already exists — keeping it.`);
            continue;
        }
        try {
            channel = await guild.channels.create({
                name: chanDef.name,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: categoryOverwrites
            });
            console.log(`✅ [Tickets] Created #${chanDef.name} in ${category.name}.`);
        } catch (err) {
            console.error(`❌ [Tickets] Failed to create #${chanDef.name}: ${err.message}`);
        }
    }
    return handledPanel;
}

// ── Ticket log channel ──
/**
 * Resolve the ticket transcript log channel (the 📜 ticket-logs channel inside
 * the ticket category). Returns null when it doesn't exist.
 * @param {import('discord.js').Client} client
 * @returns {import('discord.js').TextChannel|null}
 */
export function getTicketLogChannel(client) {
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (!guild) return null;
    const def = TICKET_CATEGORY.channels.find(c => c.key === "ticket-logs");
    return def ? findTextChannel(guild, TICKET_CATEGORY_ID, def) || null : null;
}

// ── Panel setup ──
/** Set up the ticket creation panel in a channel. @param {import('discord.js').TextChannel} channel */
export async function setupTicketPanel(channel) {
    ticketPanelChannelId = channel.id;
    saveTicketState();
    await sendTicketPanel(channel);
}

async function deleteBotPanels(channel) {
    try {
        const fetched = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        if (fetched) {
            const botPanels = fetched.filter(m => m.author.id === client.user.id && m.components.length > 0);
            for (const [, msg] of botPanels) {
                await msg.delete().catch(noop);
            }
        }
    } catch (e) { /* non-critical */ }
}

async function sendTicketPanel(channel) {
    await deleteBotPanels(channel);

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

// ── Open-ticket reconciliation ──
// Created tickets are NEVER deleted on restart. This only re-adopts channels
// that exist on Discord but are missing from tickets.json (e.g. after the
// state file was lost), recovering the owner id from the channel topic.
let stateReconciled = false;

// Names/keys the bot manages itself — never treated as ticket rooms.
const MANAGED_CHANNEL_NAMES = new Set(
    TICKET_CATEGORY.channels.flatMap(c => [c.name, c.legacyName, c.key].filter(Boolean))
);

/** Recover the owner id from a ticket channel topic (`Ticket for tag (uid) — cat`). */
function parseTicketOwnerFromTopic(topic) {
    if (!topic || typeof topic !== "string") return null;
    const match = topic.match(/\((\d{15,25})\)/);
    return match ? match[1] : null;
}

/**
 * Reconcile open tickets on boot: keep every existing ticket channel, and
 * re-adopt the ones missing from tickets.json so their owner can still close
 * them. Nothing is ever deleted.
 * @param {import('discord.js').Client} client
 */
export async function reconcileOpenTickets(client) {
    if (stateReconciled) return;
    stateReconciled = true;
    if (!TICKET_CATEGORY_ID) return;

    const tracked = new Set(Object.values(openTickets));
    let adopted = 0;

    for (const [, guild] of client.guilds.cache) {
        const category = guild.channels.cache.get(TICKET_CATEGORY_ID);
        if (!category) continue;
        for (const [, channel] of guild.channels.cache) {
            if (channel.type !== ChannelType.GuildText) continue;
            if (channel.parentId !== TICKET_CATEGORY_ID) continue;
            if (!channel.name.startsWith("ticket-")) continue;
            if (MANAGED_CHANNEL_NAMES.has(channel.name)) continue;
            if (tracked.has(channel.id)) continue;

            const ownerId = parseTicketOwnerFromTopic(channel.topic);
            if (ownerId && !openTickets[ownerId]) {
                openTickets[ownerId] = channel.id;
                tracked.add(channel.id);
                adopted++;
                console.log(`♻️ [Tickets] Re-adopted existing ticket #${channel.name} for owner ${ownerId} (kept, not deleted).`);
            } else {
                console.log(`ℹ️ [Tickets] Keeping existing ticket channel #${channel.name} (not deleted).`);
            }
        }
    }
    if (adopted > 0) saveTicketState();
}

export { saveTicketState };
