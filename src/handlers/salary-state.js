// ==========================================
// 📊 SALARY — State Management
// Extracted from salary-poll.js
// ==========================================

/** @module SalaryState - Persistent state for salary poll system */

import fs from "fs";
import path from "path";
import { getLocalTime } from "../core/time-utils.js";
import { runBackup } from "../auto-backup.js";

// ─── File paths ──────────────────────────────

const SALARY_DB_PATH = path.resolve("./salary-poll-db.json");

// ─── State ───────────────────────────────────

let salaryState = {
    channelId: null,
    spreadsheetId: null,
    messageId: null,
    currentWeek: "",
    status: "idle",
    pollOpenedAt: null,
    pollClosesAt: null,
    votes: {}
};

// ─── Save / Load ─────────────────────────────

function saveSalaryState() {
    try {
        runBackup(["./salary-poll-db.json"]);
        fs.writeFileSync(SALARY_DB_PATH, JSON.stringify(salaryState, null, 2));
    } catch (err) {
        console.error("❌ [Salary] Error saving state:", err.message);
    }
}

/** Load salary state from disk, or create a fresh file if none exists. */
export function loadSalaryState() {
    try {
        if (fs.existsSync(SALARY_DB_PATH)) {
            const data = JSON.parse(fs.readFileSync(SALARY_DB_PATH, "utf8"));
            salaryState = {
                channelId: data.channelId || null,
                spreadsheetId: data.spreadsheetId || null,
                messageId: data.messageId || null,
                currentWeek: data.currentWeek || "",
                status: data.status || "idle",
                pollOpenedAt: data.pollOpenedAt || null,
                pollClosesAt: data.pollClosesAt || null,
                votes: data.votes || {}
            };
            console.log("✅ [Salary] State loaded successfully.");
        } else {
            console.log("📝 [Salary] New state file created.");
            saveSalaryState();
        }
    } catch (err) {
        console.error("❌ [Salary] Error loading state:", err.message);
    }
}

/** @param {string|null} channelId - Discord channel ID for salary poll messages */
export function setSalaryChannelId(channelId) {
    salaryState.channelId = channelId;
    saveSalaryState();
}

/** @param {string|null} spreadsheetId - Google Sheets ID for salary export */
export function setSalarySpreadsheetId(spreadsheetId) {
    salaryState.spreadsheetId = spreadsheetId;
    saveSalaryState();
}

/** @returns {object} The current salary state object (mutable reference) */
export function getSalaryState() {
    return salaryState;
}

/** Persist salary state to disk. Called automatically by mutation helpers. */
export { saveSalaryState };

// ─── Clear bot messages from salary channel ──

/**
 * Delete all bot messages in the configured salary channel.
 * Handles Discord's 14-day bulk-delete limit by falling back to individual deletion.
 */
export async function clearBotMessagesInSalaryChannel() {
    const { client } = await import("../core/state.js");
    const state = getSalaryState();
    if (!state.channelId) return;
    try {
        const channel = await client.channels.fetch(state.channelId).catch(() => null);
        if (!channel) return;
        let deletedCount = 0;
        let lastId = null;
        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) break;
            const botMessages = messages.filter(m => m.author.id === client.user.id);
            const msgIds = [...botMessages.keys()];
            if (msgIds.length > 0) {
                try {
                    await channel.bulkDelete(msgIds);
                    deletedCount += msgIds.length;
                } catch (bulkErr) {
                    for (const msgId of msgIds) {
                        try {
                            const msg = await channel.messages.fetch(msgId).catch(() => null);
                            if (msg) { await msg.delete(); deletedCount++; }
                        } catch (singleErr) { /* skip */ }
                    }
                }
            }
            if (messages.size < 100) break;
            lastId = messages.last().id;
        }
        if (deletedCount > 0) console.log(`🧹 [Salary] Cleaned up ${deletedCount} old bot message(s).`);
    } catch (err) {
        console.error("❌ [Salary] Error clearing messages:", err.message);
    }
}

// ─── Helpers ─────────────────────────────────

/**
 * Normalize a display name for comparison: lowercase, trim, strip decorative Unicode.
 * @param {string|null} name
 * @returns {string}
 */
export function normalizeName(name) {
    if (!name) return "";
    const decorative = /[\u2000-\u206F\u2100-\u27BF\u2B00-\u2BFF\u3000-\u303F\uFE30-\uFE6F\uFF00-\uFFEF\u30FB\u30FC]/g;
    return name
        .toLowerCase()
        .trim()
        .replace(decorative, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Get the ISO date (YYYY-MM-DD) of the current week's Monday.
 * @returns {string}
 */
export function getCurrentWeekKey() {
    const now = getLocalTime();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, "0");
    const day = String(monday.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Get a human-friendly "DD/MM - DD/MM" range for the current week.
 * @returns {string}
 */
export function getFormattedWeekRange() {
    const now = getLocalTime();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" });
    return `${fmt(monday)} - ${fmt(sunday)}`;
}

export function formatDate(date) {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
    });
}
