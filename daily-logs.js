// ==========================================
// 📝 DAILY LOGS SYSTEM
// Per-guild: each guild has its own log state,
// stored in data/daily-logs_{guildId}.json
// ==========================================

import axios from "axios";
import { EmbedBuilder } from "discord.js";
import { getLocalTime } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { getGuildState, getClient, getTimezone } from "./state.js";

// ==========================================
// 📝 DAILY LOGS — Guild-aware helpers
// ==========================================

/**
 * Push a structured log entry for a specific guild.
 */
export function pushToDailyLogs(guildId, type, user, targetRoom, context = "") {
  const state = getGuildState(guildId);
  if (!state) return;
  const { dailyLogs, saveDailyLogs, timezone } = state;

  const now = getLocalTime(timezone);
  const timeStr = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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
      year: "numeric",
    }),
  });
  saveDailyLogs();
}

// ─── Constants ──────────────────────────────

const LOG_ICONS = {
  CLAIM_START: "🟢",
  CLAIM_END: "🔴",
  CANCEL: "🟠",
  QUEUE_JOIN: "🟨",
  DEATH_MARK: "💀",
};

const LOG_LABELS = {
  CLAIM_START: "CLAIMS STARTED",
  CLAIM_END: "CLAIMS ENDED",
  CANCEL: "CANCELED",
  QUEUE_JOIN: "QUEUE JOINS",
  DEATH_MARK: "DEATH MARKS",
};

const HR = "─".repeat(66);
const DHR = "═".repeat(66);

// ─── Helpers ────────────────────────────────

function migrateEntry(entry, dateStr) {
  if (typeof entry !== "string") return entry;

  const match = entry.match(
    /^`\[([^\]]+?)(?:\s+Berlin)?\]`\s+.+?\s+\*\*(.+?)\*\*\s+at\s+\*(.+?)\*(?:\s+\((.+?)\))?/,
  );
  if (match) {
    return {
      timestamp: match[1].trim(),
      user: match[2],
      targetRoom: match[3],
      context: match[4] || "",
      type: "CLAIM_START",
      date: dateStr,
    };
  }
  return {
    timestamp: "--:--:--",
    user: "Legacy",
    targetRoom: entry.slice(0, 200),
    context: "",
    type: "CLAIM_START",
    date: dateStr,
  };
}

function buildReportText(queueData, dateStr, isForced) {
  const groups = {
    CLAIM_START: [],
    CLAIM_END: [],
    CANCEL: [],
    QUEUE_JOIN: [],
    DEATH_MARK: [],
  };
  for (const entry of queueData) {
    const type = entry.type && groups[entry.type] ? entry.type : "CLAIM_START";
    groups[type].push(entry);
  }

  const totals = {
    CLAIM_START: groups.CLAIM_START.length,
    CLAIM_END: groups.CLAIM_END.length,
    CANCEL: groups.CANCEL.length,
    QUEUE_JOIN: groups.QUEUE_JOIN.length,
  };
  const totalEvents = Object.values(totals).reduce((a, b) => a + b, 0);

  const lines = [];

  const title = `${isForced ? "⚡ MANUAL " : ""}CLAIM REPORT — ${dateStr}`;
  const padRight = Math.max(0, 64 - title.length);
  lines.push(`╔${DHR}╗`);
  lines.push(`║  ${title}${" ".repeat(padRight)}║`);
  lines.push(`╚${DHR}╝`);
  lines.push("");

  lines.push(
    "  ┌───  S U M M A R Y  ─────────────────────────────────────────────────┐",
  );
  lines.push(
    `  │  ${LOG_ICONS.CLAIM_START} Claims Started:  ${String(totals.CLAIM_START).padStart(3)}                                      │`,
  );
  lines.push(
    `  │  ${LOG_ICONS.CLAIM_END} Claims Ended:    ${String(totals.CLAIM_END).padStart(3)}                                      │`,
  );
  lines.push(
    `  │  ${LOG_ICONS.CANCEL} Canceled:        ${String(totals.CANCEL).padStart(3)}                                      │`,
  );
  lines.push(
    `  │  ${LOG_ICONS.QUEUE_JOIN} Queue Joined:     ${String(totals.QUEUE_JOIN).padStart(3)}                                      │`,
  );
  lines.push(
    "  │  ───────────────────────────────────────────────────────────          │",
  );
  lines.push(
    `  │  📊 Total Events:     ${String(totalEvents).padStart(3)}                                      │`,
  );
  lines.push(
    "  └───────────────────────────────────────────────────────────────────────┘",
  );
  lines.push("");

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
      const ts = entry.timestamp || "--:--:--";
      const usr = entry.user || "Unknown";
      const loc = entry.targetRoom || "Unknown";
      const ctx = entry.context || "";

      lines.push(`  [${ts}]  ${usr}  →  ${loc}`);
      if (ctx) lines.push(`  ├  ${ctx}`);
      lines.push("");
    }
  }

  lines.push(`  ${DHR}`);
  const nowStr = getLocalTime("Europe/Berlin").toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  lines.push(`  Report generated at ${nowStr} Berlin time`);

  return lines.join("\n");
}

// ─── Public dispatch ───────────────────────

/**
 * Dispatch accumulated logs for a specific guild.
 */
export async function dispatchDailyLogs(guildId, isForced = false) {
  const state = getGuildState(guildId);
  if (!state) return false;
  const { dailyLogs, saveDailyLogs, timezone } = state;
  const client = getClient();
  if (!client) return false;

  if (!dailyLogs.configChannelId) return false;
  const channel = await client.channels
    .fetch(dailyLogs.configChannelId)
    .catch(() => null);
  if (!channel) return false;

  let queueData = dailyLogs.queue || [];
  const now = getLocalTime(timezone);
  const dateStr = now.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  if (queueData.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle(getMsg("logs.title", { date: dateStr }))
      .setColor(isForced ? "#0099ff" : "#2b2d31")
      .setDescription(getMsg("logs.noActivity"))
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
    return true;
  }

  queueData = queueData.map((entry) => migrateEntry(entry, dateStr)).filter(Boolean);

  const fileContent = buildReportText(queueData, dateStr, isForced);
  const safeDate = dateStr.replace(/\//g, "-");
  const fileName = `claim-report-${safeDate}${isForced ? "-manual" : ""}.txt`;

  const totals = {
    CLAIM_START: queueData.filter((e) => e.type === "CLAIM_START").length,
    CLAIM_END: queueData.filter((e) => e.type === "CLAIM_END").length,
    CANCEL: queueData.filter((e) => e.type === "CANCEL").length,
    QUEUE_JOIN: queueData.filter((e) => e.type === "QUEUE_JOIN").length,
  };
  const totalEvents = Object.values(totals).reduce((a, b) => a + b, 0);

  const buffer = Buffer.from(fileContent, "utf8");
  console.log(
    `📎 [${guildId}] Preparing claim report: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB, ${queueData.length} events)`,
  );

  try {
    const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
    if (!token) throw new Error("No bot token found");

    const boundary = "----bufferBot" + Math.random().toString(36).slice(2);
    const parts = [];

    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files[0]"; filename="${fileName}"\r\n` +
          `Content-Type: text/plain; charset=utf-8\r\n\r\n`,
      ),
    );
    parts.push(buffer);
    parts.push(Buffer.from("\r\n"));

    const summaryEmbed = new EmbedBuilder()
      .setTitle(getMsg("logs.title", { date: dateStr }))
      .setColor(isForced ? "#0099ff" : "#2b2d31")
      .setDescription(
        `📄 **Full report attached** — \`${fileName}\`\n\n` +
          `🟢 Claims: **${totals.CLAIM_START}**\n` +
          `🔴 Ended: **${totals.CLAIM_END}**\n` +
          `🟠 Canceled: **${totals.CANCEL}**\n` +
          `🟨 Queues: **${totals.QUEUE_JOIN}**\n\n` +
          `📊 **Total: ${totalEvents} events**`,
      )
      .setTimestamp();

    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="payload_json"\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          `${JSON.stringify({ embeds: [summaryEmbed.toJSON()] })}\r\n`,
      ),
    );
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    await axios.post(
      `https://discord.com/api/v10/channels/${channel.id}/messages`,
      body,
      {
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(Buffer.byteLength(body)),
        },
        maxBodyLength: Infinity,
      },
    );
    console.log(`✅ [${guildId}] Claim report sent: ${fileName}`);
  } catch (err) {
    console.error(`❌ [${guildId}] Failed to send claim report:`, err.message);
    return false;
  }

  if (!isForced) {
    dailyLogs.queue = [];
    saveDailyLogs();
  }
  return true;
}
