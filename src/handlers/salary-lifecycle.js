// ==========================================
// 📊 SALARY — Poll Lifecycle
// Open / Close / Reset / Cron
// Extracted from salary-poll.js
// ==========================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import cron from "node-cron";
import { client, logEvent } from "../core/state.js";
import { getSalaryState, saveSalaryState, getCurrentWeekKey, getFormattedWeekRange, clearBotMessagesInSalaryChannel } from "./salary-state.js";
import { exportVotesToSheets } from "./salary-sheets.js";
import { postSalaryReport } from "./salary-report.js";

const TIMEZONE = "America/Sao_Paulo";

// ─── Poll Embed ──────────────────────────────

function buildPollEmbed() {
    const state = getSalaryState();
    const isOpen = state.status === "open";
    const weekRange = getFormattedWeekRange();
    const voteCount = Object.keys(state.votes).length;
    const yellowCounts = { 0: 0, 25: 0, 50: 0, 75: 0, 100: 0 };
    const purpleCounts = { 0: 0, 25: 0, 50: 0, 75: 0, 100: 0 };
    let totalYellow = 0, totalPurple = 0;

    for (const v of Object.values(state.votes)) {
        if (yellowCounts[v.yellowPercent] !== undefined) yellowCounts[v.yellowPercent]++;
        if (purpleCounts[v.purplePercent] !== undefined) purpleCounts[v.purplePercent]++;
        totalYellow += v.yellowPercent;
        totalPurple += v.purplePercent;
    }
    const avgYellow = voteCount > 0 ? (totalYellow / voteCount) : 0;
    const avgPurple = voteCount > 0 ? (totalPurple / voteCount) : 0;
    const avgDS = 100 - avgYellow - avgPurple;

    const bar = (pct, maxLen = 15) => {
        const filled = Math.round((pct / 100) * maxLen);
        return "█".repeat(filled) + "░".repeat(maxLen - filled);
    };

    const embed = new EmbedBuilder()
        .setTitle("📊 Weekly Salary Poll")
        .setColor(isOpen ? "#57F287" : "#2b2d31")
        .setDescription(
            `**Week:** ${weekRange}\n` +
            `**Status:** ${isOpen ? "🟢 Open" : "🔴 Closed"}\n` +
            `**Voters:** ${voteCount} member(s)\n\n` +
            (isOpen
                ? `⏰ **Open until:** Wednesday 13:00 (BRT)\n\n` +
                  `Click the button below to choose your salary composition!\n` +
                  `You can change your vote as many times as you want until closing.\n\n` +
                  `📌 **Remember:** The total (%) of stones + DS must be **100%**`
                : `🗳️ **Poll closed** — Results saved to spreadsheet.`)
        )
        .setTimestamp();

    if (voteCount > 0) {
        embed.addFields(
            { name: `🎨 Yellow Stones (Avg: ${avgYellow.toFixed(0)}%)`, value: `\`${bar(avgYellow)}\` \`${avgYellow.toFixed(0)}%\``, inline: false },
            { name: `🟣 Purple Stones (Avg: ${avgPurple.toFixed(0)}%)`, value: `\`${bar(avgPurple)}\` \`${avgPurple.toFixed(0)}%\``, inline: false },
            { name: `⚪ Darksteel (Avg: ${avgDS.toFixed(0)}%)`, value: `\`${bar(avgDS)}\` \`${avgDS.toFixed(0)}%\``, inline: false }
        );
    }
    return embed;
}

function buildPollActions() {
    const state = getSalaryState();
    if (state.status !== "open") return [];
    const voteBtn = new ButtonBuilder()
        .setCustomId("salary_vote").setLabel("✏️ Vote / Change Vote")
        .setStyle(ButtonStyle.Primary).setEmoji("🗳️");
    return [new ActionRowBuilder().addComponents(voteBtn)];
}

// ─── Create or Update Poll Message ───────────

/** Create or update the salary poll embed in the configured channel. @param {boolean} [pingEveryone=false] - Whether to @everyone @returns {Promise<boolean>} Success */
export async function createOrUpdatePollMessage(pingEveryone = false) {
    const state = getSalaryState();
    if (!state.channelId) {
        console.log("❌ [Salary] No channel configured.");
        return false;
    }
    try {
        const channel = await client.channels.fetch(state.channelId).catch(() => null);
        if (!channel) { console.error("❌ [Salary] Channel not found."); return false; }
        const embed = buildPollEmbed();
        const components = buildPollActions();
        if (state.messageId) {
            try {
                const existingMsg = await channel.messages.fetch(state.messageId).catch(() => null);
                if (existingMsg) { await existingMsg.edit({ embeds: [embed], components }); return true; }
            } catch (e) { /* message gone — send new */ }
        }
        const msg = await channel.send({ ...(pingEveryone ? { content: "@everyone" } : {}), embeds: [embed], components });
        const s = getSalaryState();
        s.messageId = msg.id;
        saveSalaryState();
        return true;
    } catch (err) {
        console.error("❌ [Salary] Error creating/updating poll:", err.message);
        return false;
    }
}

// ─── Open Poll ───────────────────────────────

async function openPoll() {
    const state = getSalaryState();
    const weekKey = getCurrentWeekKey();
    if (state.currentWeek === weekKey && state.status === "open") {
        console.log(`[Salary] Poll already open for week ${weekKey}`);
        return;
    }
    await clearBotMessagesInSalaryChannel();
    state.currentWeek = weekKey;
    state.votes = {};
    state.status = "open";
    state.pollOpenedAt = new Date().toISOString();
    state.messageId = null;
    const now = new Date();
    const wednesday = new Date(now);
    wednesday.setDate(wednesday.getDate() + ((3 - wednesday.getDay() + 7) % 7));
    wednesday.setHours(13, 0, 0, 0, 0);
    if (now.getDay() === 3 && now.getHours() < 13) {
        wednesday.setTime(now.getTime());
        wednesday.setHours(13, 0, 0, 0);
    }
    state.pollClosesAt = wednesday.toISOString();
    saveSalaryState();
    console.log(`📊 [Salary] Poll opened for week ${weekKey}. Closes at ${wednesday.toISOString()}`);
    await createOrUpdatePollMessage(true);
    logEvent(`Salary poll opened for week ${weekKey}`);
}

// ─── Close Poll ──────────────────────────────

async function closePoll() {
    const state = getSalaryState();
    if (state.status !== "open") { console.log("[Salary] No open poll to close."); return; }
    state.status = "closed";
    saveSalaryState();
    console.log(`📊 [Salary] Poll closed for week ${state.currentWeek}`);
    await createOrUpdatePollMessage();
    if ((state.spreadsheetId) && Object.keys(state.votes).length > 0) {
        await exportVotesToSheets();
    } else if (!state.spreadsheetId) {
        console.log("⚠️ [Salary] No spreadsheet ID. Skipping export.");
    } else {
        console.log("📭 [Salary] No votes recorded. Skipping export.");
    }
    logEvent(`Salary poll closed for week ${state.currentWeek}`);
}

// ─── Reset Votes to Default ─────────────────

async function resetVotesToDefault() {
    const state = getSalaryState();
    const voteCount = Object.keys(state.votes).length;
    if (voteCount === 0) { console.log("📭 [Salary] No votes to reset."); return; }
    const now = new Date().toISOString();
    for (const userId of Object.keys(state.votes)) {
        const vote = state.votes[userId];
        vote.yellowPercent = 0;
        vote.purplePercent = 0;
        vote.dsPercent = 100;
        vote.updatedAt = now;
    }
    saveSalaryState();
    console.log(`✅ [Salary] Reset ${voteCount} vote(s) to 100% DS / 0% stones.`);
    logEvent(`Salary votes reset to default (${voteCount} members)`);
}

// ─── Startup recovery ────────────────────────

async function checkAndRestorePollOnBoot() {
    const now = new Date();
    const day = now.getDay();
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    const mondayOpen = 12 * 60 + 30;
    const wednesdayClose = 13 * 60;
    let shouldBeOpen = false;
    if (day === 1 && currentTimeMinutes >= mondayOpen) shouldBeOpen = true;
    else if (day === 2) shouldBeOpen = true;
    else if (day === 3 && currentTimeMinutes < wednesdayClose) shouldBeOpen = true;
    const weekKey = getCurrentWeekKey();
    const state = getSalaryState();
    if (shouldBeOpen) {
        if (state.currentWeek !== weekKey || state.status !== "open") {
            console.log(`🔄 [Salary] Boot: Restoring poll for week ${weekKey}...`);
            await openPoll();
        } else {
            console.log(`🔄 [Salary] Boot: Poll already open, refreshing message.`);
            await createOrUpdatePollMessage();
        }
    } else if (state.status === "open") {
        if (day > 3 || (day === 3 && currentTimeMinutes >= wednesdayClose) || day === 0) {
            console.log(`🔄 [Salary] Boot: Closing expired poll...`);
            await closePoll();
        }
    }
}

// ─── Cron Scheduling ─────────────────────────

let cronTasks = [];

/** Initialize cron tasks for salary poll open/close/report/reset. Restores poll on boot. */
export function initSalaryCron() {
    cronTasks.forEach(task => task.stop());
    cronTasks = [];

    const openTask = cron.schedule("30 12 * * 1", async () => {
        console.log("⏰ [Salary] Cron: Opening poll...");
        await openPoll();
    }, { scheduled: true, timezone: TIMEZONE });
    cronTasks.push(openTask);

    const closeTask = cron.schedule("0 13 * * 3", async () => {
        console.log("⏰ [Salary] Cron: Closing poll...");
        await closePoll();
    }, { scheduled: true, timezone: TIMEZONE });
    cronTasks.push(closeTask);

    const reportTask = cron.schedule("0 16 * * 3", async () => {
        console.log("⏰ [Salary] Cron: Posting report...");
        await postSalaryReport();
    }, { scheduled: true, timezone: TIMEZONE });
    cronTasks.push(reportTask);

    const resetTask = cron.schedule("0 13 * * 5", async () => {
        console.log("⏰ [Salary] Cron: Resetting votes to default...");
        await resetVotesToDefault();
    }, { scheduled: true, timezone: TIMEZONE });
    cronTasks.push(resetTask);

    checkAndRestorePollOnBoot();
    console.log("📅 [Salary] Cron scheduling initialized.");
}
