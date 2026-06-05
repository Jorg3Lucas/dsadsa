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

    // ── Attempt 1: file + embed ──
    try {
        const attachment = new AttachmentBuilder(buffer, { name: fileName });
        const embed = new EmbedBuilder()
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
        await channel.send({ embeds: [embed], files: [attachment] });
        console.log(`✅ Claim report sent successfully: ${fileName}`);
    } catch (err1) {
        console.warn(`⚠️ File+embed failed (${err1.message}), trying file-only...`);
        // ── Attempt 2: file only (no embed) ──
        try {
            const attachment = new AttachmentBuilder(buffer, { name: fileName });
            await channel.send({ files: [attachment] });
            console.log(`✅ Claim report sent (file-only): ${fileName}`);
        } catch (err2) {
            console.warn(`⚠️ File-only also failed (${err2.message}), falling back to embed...`);
            // ── Attempt 3: embed only (inline text) ──
            try {
                const maxLines = 80;
                const lines = fileContent.split("\n");
                const truncated = lines.length > maxLines
                    ? lines.slice(0, maxLines).join("\n") + `\n\n... (${lines.length - maxLines} more lines truncated — ${fileName})`
                    : fileContent;
                const embed = new EmbedBuilder()
                    .setTitle(getMsg("logs.title", { date: dateStr }))
                    .setColor(isForced ? "#0099ff" : "#2b2d31")
                    .setDescription("```\n" + truncated.slice(0, 4080) + "\n```")
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
                console.log(`✅ Claim report sent (embed-only fallback): ${fileName}`);
            } catch (err3) {
                console.error("❌ All send methods failed:", err3.message);
                return false;
            }
        }
    }

    // Clear the queue after dispatch (unless forced/manual)
    if (!isForced) {
        dailyLogs.queue = [];
        saveDailyLogs();
    }
    return true;
}
