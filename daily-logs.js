import axios from "axios";
import { EmbedBuilder } from "discord.js";
import { getLocalTime } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { dailyLogs, dailyLogsPath, client } from "./state.js";
import fs from "fs";
import { runBackup } from "./auto-backup.js";
import { getActiveServerIds, getServer } from "./server-config.js";

// ==========================================
// 📝 DAILY LOGS SYSTEM
// ==========================================

export function saveDailyLogs() {
    try {
        // Backup before overwriting
        runBackup(["./daily-logs.json"]);

        fs.writeFileSync(dailyLogsPath, JSON.stringify(dailyLogs, null, 2));
    } catch (err) {
        console.error("❌ Error saving daily logs:", err.message);
    }
}

/**
 * Push a structured log entry.
 * @param {"CLAIM_START"|"CLAIM_END"|"CANCEL"|"QUEUE_JOIN"} type
 * @param {string} user  - Display name of the user
 * @param {string} targetRoom - Room or floor description
 * @param {string} context    - Extra info (duration, reason, etc.)
 */
export function pushToDailyLogs(type, user, targetRoom, context = "") {
    const now = getLocalTime();
    const timeStr = now.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    dailyLogs.queue.push({
        type,
        user,
        targetRoom,
        context,
        timestamp: timeStr,
        date: now.toLocaleDateString("en-US", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        })
    });
    saveDailyLogs();
}

// ─── helpers ──────────────────────────────────────────────

const LOG_ICONS = {
    CLAIM_START: "🟢",
    CLAIM_END:   "🔴",
    CANCEL:      "🟠",
    QUEUE_JOIN:  "🟨",
    DEATH_MARK:  "💀"
};

const LOG_LABELS = {
    CLAIM_START: "CLAIMS STARTED",
    CLAIM_END:   "CLAIMS ENDED",
    CANCEL:      "CANCELED",
    QUEUE_JOIN:  "QUEUE JOINS",
    DEATH_MARK:  "DEATH MARKS"
};

const HR = "─".repeat(66);
const DHR = "═".repeat(66);

/**
 * Migrate a legacy string entry to the structured object format.
 * Falls back to a generic object if parsing fails.
 */
function migrateEntry(entry, dateStr) {
    if (typeof entry !== "string") return entry;

    // Old format: `[HH:MM:SS Berlin] PREFIX **User** at *Room* (Context)
    const match = entry.match(
        /^`\[([^\]]+?)(?:\s+Berlin)?\]`\s+.+?\s+\*\*(.+?)\*\*\s+at\s+\*(.+?)\*(?:\s+\((.+?)\))?/
    );
    if (match) {
        return {
            timestamp: match[1].trim(),
            user:       match[2],
            targetRoom: match[3],
            context:    match[4] || "",
            type:       "CLAIM_START",
            date:       dateStr
        };
    }
    // Last resort — wrap as a note
    return {
        timestamp: "--:--:--",
        user:       "Legacy",
        targetRoom: entry.slice(0, 200),
        context:    "",
        type:       "CLAIM_START",
        date:       dateStr
    };
}

/**
 * Build the full report text.
 */
function buildReportText(queueData, dateStr, isForced) {
    // Group entries by type
    const groups = { CLAIM_START: [], CLAIM_END: [], CANCEL: [], QUEUE_JOIN: [], DEATH_MARK: [] };
    for (const entry of queueData) {
        const type = entry.type && groups[entry.type] ? entry.type : "CLAIM_START";
        groups[type].push(entry);
    }

    const totals = {
        CLAIM_START: groups.CLAIM_START.length,
        CLAIM_END:   groups.CLAIM_END.length,
        CANCEL:      groups.CANCEL.length,
        QUEUE_JOIN:  groups.QUEUE_JOIN.length
    };
    const totalEvents = Object.values(totals).reduce((a, b) => a + b, 0);

    const lines = [];

    // ── Header ──
    const title = `${isForced ? "⚡ MANUAL " : ""}CLAIM REPORT — ${dateStr}`;
    const padRight = Math.max(0, 64 - title.length);
    lines.push(`╔${DHR}╗`);
    lines.push(`║  ${title}${" ".repeat(padRight)}║`);
    lines.push(`╚${DHR}╝`);
    lines.push("");

    // ── Summary table ──
    lines.push("  ┌───  S U M M A R Y  ─────────────────────────────────────────────────┐");
    lines.push(`  │  ${LOG_ICONS.CLAIM_START} Claims Started:  ${String(totals.CLAIM_START).padStart(3)}                                      │`);
    lines.push(`  │  ${LOG_ICONS.CLAIM_END} Claims Ended:    ${String(totals.CLAIM_END).padStart(3)}                                      │`);
    lines.push(`  │  ${LOG_ICONS.CANCEL} Canceled:        ${String(totals.CANCEL).padStart(3)}                                      │`);
    lines.push(`  │  ${LOG_ICONS.QUEUE_JOIN} Queue Joined:     ${String(totals.QUEUE_JOIN).padStart(3)}                                      │`);
    lines.push("  │  ───────────────────────────────────────────────────────────          │");
    lines.push(`  │  📊 Total Events:     ${String(totalEvents).padStart(3)}                                      │`);
    lines.push("  └───────────────────────────────────────────────────────────────────────┘");
    lines.push("");

    // ── Sections ──
    for (const [type, label] of Object.entries(LOG_LABELS)) {
        const icon = LOG_ICONS[type];
        const entries = groups[type];

        lines.push(`  ${icon}  ${label}`);
        lines.push(`  ${HR}`);

        if (entries.length === 0) {
            lines.push("  (no events)");
            lines.push("");
            continue;
        }

        for (const entry of entries) {
            const ts  = entry.timestamp || "--:--:--";
            const usr = entry.user       || "Unknown";
            const loc = entry.targetRoom || "Unknown";
            const ctx = entry.context    || "";

            lines.push(`  [${ts}]  ${usr}  →  ${loc}`);
            if (ctx) {
                lines.push(`  ├  ${ctx}`);
            }
            lines.push("");
        }
    }

    // ── Footer ──
    lines.push(`  ${DHR}`);
    const nowStr = getLocalTime().toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    lines.push(`  Report generated at ${nowStr} Berlin time`);

    return lines.join("\n");
}

// ══════════════════════════════════════════════════════
// 🔌 CHANNEL RESOLVERS (from server-config.js)
// ══════════════════════════════════════════════════════

/**
 * Get all configured daily-logs channel IDs from all active in-game servers.
 * Falls back to the legacy dailyLogs.configChannelId if no server config found.
 */
export function getLogsChannelIds() {
    const ids = [];
    const serverIds = getActiveServerIds();
    for (const serverId of serverIds) {
        const server = getServer(serverId);
        const channelId = server?.channels?.logs;
        if (channelId && !ids.includes(channelId)) {
            ids.push(channelId);
        }
    }
    // Fallback to legacy config
    if (ids.length === 0 && dailyLogs.configChannelId) {
        ids.push(dailyLogs.configChannelId);
    }
    return ids;
}

/**
 * Get all configured boss-spawn channel IDs from all active in-game servers.
 * Falls back to the legacy dailyLogs.bossSpawnChannelId.
 */
export function getBossSpawnChannelIds() {
    const ids = [];
    const serverIds = getActiveServerIds();
    for (const serverId of serverIds) {
        const server = getServer(serverId);
        const channelId = server?.channels?.bossSpawn;
        if (channelId && !ids.includes(channelId)) {
            ids.push(channelId);
        }
    }
    // Fallback to legacy config
    if (ids.length === 0 && dailyLogs.bossSpawnChannelId) {
        ids.push(dailyLogs.bossSpawnChannelId);
    }
    return ids;
}

/**
 * Get all configured event-alert channel IDs from all active in-game servers.
 * Falls back to the legacy dailyLogs.scheduledEventChannelId.
 */
export function getEventChannelIds() {
    const ids = [];
    const serverIds = getActiveServerIds();
    for (const serverId of serverIds) {
        const server = getServer(serverId);
        const channelId = server?.channels?.event;
        if (channelId && !ids.includes(channelId)) {
            ids.push(channelId);
        }
    }
    // Fallback to legacy config
    if (ids.length === 0 && dailyLogs.scheduledEventChannelId) {
        ids.push(dailyLogs.scheduledEventChannelId);
    }
    return ids;
}

// ══════════════════════════════════════════════════════
// 📤 DISPATCH TO ALL CONFIGURED CHANNELS
// ══════════════════════════════════════════════════════

// ─── public dispatch ─────────────────────────────────────

/**
 * Dispatch accumulated logs as a structured text file to ALL configured log channels.
 * @param {boolean} isForced - If true, logs are NOT cleared after sending (manual !logs command).
 * @returns {Promise<boolean>}
 */
export async function dispatchDailyLogs(isForced = false) {
    const channelIds = getLogsChannelIds();
    if (channelIds.length === 0) return false;

    let queueData = dailyLogs.queue || [];
    const now = getLocalTime();
    const dateStr = now.toLocaleDateString("en-US", {
        day: "2-digit", month: "2-digit", year: "numeric"
    });

    // Build the report once, send to all channels
    const fileContent = queueData.length > 0
        ? buildReportText(
            queueData.map(entry => migrateEntry(entry, dateStr)).filter(Boolean),
            dateStr,
            isForced
          )
        : null;

    const safeDate = dateStr.replace(/\//g, "-");
    const fileName = `claim-report-${safeDate}${isForced ? "-manual" : ""}.txt`;

    const totals = queueData.length > 0 ? {
        CLAIM_START: queueData.filter(e => e.type === "CLAIM_START").length,
        CLAIM_END:   queueData.filter(e => e.type === "CLAIM_END").length,
        CANCEL:      queueData.filter(e => e.type === "CANCEL").length,
        QUEUE_JOIN:  queueData.filter(e => e.type === "QUEUE_JOIN").length
    } : null;
    const totalEvents = totals ? Object.values(totals).reduce((a, b) => a + b, 0) : 0;

    const token = process.env.TOKEN || process.env.DISCORD_TOKEN;

    for (const channelId of channelIds) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            console.warn(`⚠️ [Daily Logs] Channel ${channelId} not found, skipping.`);
            continue;
        }

        // Empty queue — send a minimal embed
        if (queueData.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(getMsg("logs.title", { date: dateStr }))
                .setColor(isForced ? "#0099ff" : "#2b2d31")
                .setDescription(getMsg("logs.noActivity"))
                .setTimestamp();
            try {
                await channel.send({ embeds: [embed] }).catch(() => {});
            } catch (err) {
                console.error(`❌ [Daily Logs] Failed to send empty report to ${channelId}:`, err.message);
            }
            continue;
        }

        const buffer = Buffer.from(fileContent, "utf8");

        // ── Send via REST API multipart ──
        try {
            if (!token) throw new Error("No bot token found");

            const boundary = "----bufferBot" + Math.random().toString(36).slice(2);
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
                .setTitle(getMsg("logs.title", { date: dateStr }))
                .setColor(isForced ? "#0099ff" : "#2b2d31")
                .setDescription(
                    `📄 **Full report attached** — \`${fileName}\`\n\n` +
                    `🟢 Claims: **${totals.CLAIM_START}**\n` +
                    `🔴 Ended: **${totals.CLAIM_END}**\n` +
                    `🟠 Canceled: **${totals.CANCEL}**\n` +
                    `🟨 Queues: **${totals.QUEUE_JOIN}**\n\n` +
                    `📊 **Total: ${totalEvents} events**`
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
                `https://discord.com/api/v10/channels/${channel.id}/messages`,
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
            console.log(`✅ [Daily Logs] Report sent to #${channel.name}: ${fileName}`);
        } catch (err) {
            console.error(`❌ [Daily Logs] Failed to send report to ${channelId}:`, err.message);
        }
    }

    // Clear the queue after dispatch (unless forced/manual)
    if (!isForced) {
        dailyLogs.queue = [];
        saveDailyLogs();
    }
    return channelIds.length > 0;
}
