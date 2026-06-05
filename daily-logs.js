import {
    EmbedBuilder,
    AttachmentBuilder
} from "discord.js";
import { getLocalTime } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { dailyLogs, dailyLogsPath, client } from "./state.js";
import fs from "fs";

// ==========================================
// 📝 DAILY LOGS SYSTEM
// ==========================================

export function saveDailyLogs() {
    try {
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
    QUEUE_JOIN:  "🟨"
};

const LOG_LABELS = {
    CLAIM_START: "CLAIMS STARTED",
    CLAIM_END:   "CLAIMS ENDED",
    CANCEL:      "CANCELED",
    QUEUE_JOIN:  "QUEUE JOINS"
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
    const groups = { CLAIM_START: [], CLAIM_END: [], CANCEL: [], QUEUE_JOIN: [] };
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

// ─── public dispatch ─────────────────────────────────────

/**
 * Dispatch accumulated logs as a structured text file to the configured channel.
 * @param {boolean} isForced - If true, logs are NOT cleared after sending (manual !logs command).
 * @returns {Promise<boolean>}
 */
export async function dispatchDailyLogs(isForced = false) {
    if (!dailyLogs.configChannelId) return false;
    const channel = await client.channels.fetch(dailyLogs.configChannelId).catch(() => null);
    if (!channel) return false;

    let queueData = dailyLogs.queue || [];
    const now = getLocalTime();
    const dateStr = now.toLocaleDateString("en-US", {
        day: "2-digit", month: "2-digit", year: "numeric"
    });

    // Empty queue — send a minimal embed
    if (queueData.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle(getMsg("logs.title", { date: dateStr }))
            .setColor(isForced ? "#0099ff" : "#2b2d31")
            .setDescription(getMsg("logs.noActivity"))
            .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => {});
        return true;
    }

    // Migrate any legacy string entries
    queueData = queueData
        .map(entry => migrateEntry(entry, dateStr))
        .filter(Boolean);

    // Build & send the report file
    const fileContent = buildReportText(queueData, dateStr, isForced);
    const safeDate = dateStr.replace(/\//g, "-");
    const fileName = `claim-report-${safeDate}${isForced ? "-manual" : ""}.txt`;

    // Quick-summary embed
    const totals = {
        CLAIM_START: queueData.filter(e => e.type === "CLAIM_START").length,
        CLAIM_END:   queueData.filter(e => e.type === "CLAIM_END").length,
        CANCEL:      queueData.filter(e => e.type === "CANCEL").length,
        QUEUE_JOIN:  queueData.filter(e => e.type === "QUEUE_JOIN").length
    };
    const totalEvents = Object.values(totals).reduce((a, b) => a + b, 0);

    const buffer = Buffer.from(fileContent, "utf8");
    console.log(`📎 Preparing claim report: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB, ${queueData.length} events)`);

    // ── Helper: try to send a file, returns true on success ──
    const trySendFile = async (embed) => {
        const methods = [
            // Method A: file path on disk (most reliable)
            async () => {
                const tmpPath = `./${fileName}`;
                fs.writeFileSync(tmpPath, buffer);
                try {
                    const att = new AttachmentBuilder(tmpPath);
                    await channel.send(
                        embed ? { embeds: [embed], files: [att] } : { files: [att] }
                    );
                } finally {
                    try { fs.unlinkSync(tmpPath); } catch {}
                }
            },
            // Method B: explicit { attachment, name } object
            async () => {
                const att = new AttachmentBuilder({ attachment: buffer, name: fileName });
                await channel.send(
                    embed ? { embeds: [embed], files: [att] } : { files: [att] }
                );
            },
            // Method C: Buffer with options (original approach)
            async () => {
                const att = new AttachmentBuilder(buffer, { name: fileName });
                await channel.send(
                    embed ? { embeds: [embed], files: [att] } : { files: [att] }
                );
            },
            // Method D: plain object in files[] (no AttachmentBuilder wrapper)
            async () => {
                await channel.send(
                    embed
                        ? { embeds: [embed], files: [{ attachment: buffer, name: fileName }] }
                        : { files: [{ attachment: buffer, name: fileName }] }
                );
            },
            // Method E: direct REST API via manual multipart (bypasses discord.js entirely)
            async () => {
                const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
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

                // Embed part (if any)
                if (embed) {
                    parts.push(Buffer.from(
                        `--${boundary}\r\n` +
                        `Content-Disposition: form-data; name="payload_json"\r\n` +
                        `Content-Type: application/json\r\n\r\n` +
                        `${JSON.stringify({ embeds: [embed.toJSON()] })}\r\n`
                    ));
                }

                // Closing boundary
                parts.push(Buffer.from(`--${boundary}--\r\n`));

                const body = Buffer.concat(parts);

                const { default: axios } = await import("axios");
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
            }
        ];
        for (const method of methods) {
            try {
                await method();
                return true;
            } catch (err) {
                console.warn(`  ⚠️ File method failed: ${err.message}`);
            }
        }
        return false;
    };

    // ── Attempt 1: file + embed (try all 3 methods) ──
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

    const fileOk = await trySendFile(summaryEmbed);
    if (fileOk) {
        console.log(`✅ Claim report sent successfully: ${fileName}`);
    } else {
        console.warn(`⚠️ All file methods failed, falling back to multi-embed (full content)...`);
        // ── Fallback: multi-embed with full content (no truncation) ──
        try {
            const MAX_DESC = 4096;
            const FENCE = "```\n";
            const FENCE_END = "\n```";
            const FENCE_OVERHEAD = FENCE.length + FENCE_END.length;
            const MAX_PER_EMBED = MAX_DESC - FENCE_OVERHEAD;

            const lines = fileContent.split("\n");
            const chunks = [];
            let currentChunk = "";
            for (const line of lines) {
                const candidate = currentChunk ? currentChunk + "\n" + line : line;
                if (candidate.length > MAX_PER_EMBED) {
                    if (currentChunk) { chunks.push(currentChunk); currentChunk = ""; }
                    if (line.length > MAX_PER_EMBED) {
                        for (let i = 0; i < line.length; i += MAX_PER_EMBED)
                            chunks.push(line.slice(i, i + MAX_PER_EMBED));
                    } else { currentChunk = line; }
                } else { currentChunk = candidate; }
            }
            if (currentChunk) chunks.push(currentChunk);

            const summaryMsg =
                `${LOG_ICONS.CLAIM_START} Claims: **${totals.CLAIM_START}** | ` +
                `${LOG_ICONS.CLAIM_END} Ended: **${totals.CLAIM_END}** | ` +
                `${LOG_ICONS.CANCEL} Canceled: **${totals.CANCEL}** | ` +
                `${LOG_ICONS.QUEUE_JOIN} Queues: **${totals.QUEUE_JOIN}**\n` +
                `📊 **Total: ${totalEvents} events** — \`${fileName}\``;

            const pageCount = chunks.length;

            if (pageCount <= 1) {
                const avail = MAX_DESC - summaryMsg.length - 2 - FENCE_OVERHEAD;
                const embed = new EmbedBuilder()
                    .setTitle(getMsg("logs.title", { date: dateStr }))
                    .setColor(isForced ? "#0099ff" : "#2b2d31")
                    .setDescription(summaryMsg + "\n\n" + FENCE + (chunks[0] || "").slice(0, Math.max(0, avail)) + FENCE_END)
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            } else {
                const summaryPage = new EmbedBuilder()
                    .setTitle(getMsg("logs.title", { date: dateStr }))
                    .setColor(isForced ? "#0099ff" : "#2b2d31")
                    .setDescription(summaryMsg + `\n\n📄 Report split across **${pageCount} pages** ↓`)
                    .setTimestamp();
                await channel.send({ embeds: [summaryPage] });

                for (let i = 0; i < pageCount; i++) {
                    const pageEmbed = new EmbedBuilder()
                        .setColor(isForced ? "#0099ff" : "#2b2d31")
                        .setDescription(FENCE + chunks[i].slice(0, MAX_PER_EMBED) + FENCE_END)
                        .setFooter({ text: `Page ${i + 1} of ${pageCount}` });
                    await channel.send({ embeds: [pageEmbed] });
                }
            }
            console.log(`✅ Claim report sent (${pageCount} embed page(s), full content): ${fileName}`);
        } catch (err) {
            console.error("❌ All send methods failed:", err.message);
            return false;
        }
    }

    // Clear the queue after dispatch (unless forced/manual)
    if (!isForced) {
        dailyLogs.queue = [];
        saveDailyLogs();
    }
    return true;
}
