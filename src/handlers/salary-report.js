// ==========================================
// 📊 SALARY — Report & Check
// Extracted from salary-poll.js
// ==========================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { client, logEvent, rankingDb } from "../core/state.js";
import { noop } from "../core/config.js";
import { getSalaryState, getFormattedWeekRange, normalizeName, clearBotMessagesInSalaryChannel } from "./salary-state.js";

const GOOGLE_CREDENTIALS_PATH = path.resolve("./google_credentials.json");
const DEFAULT_SPREADSHEET_ID = "1ePa0Ws55-KrJpFUELebuPOJqfT8dfx1IJc1g9Dt8vPo";

async function getSheetsClient() {
    try {
        const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf8"));
        const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
        return google.sheets({ version: "v4", auth });
    } catch (err) {
        console.error("❌ [Salary Report] Error creating client:", err.message);
        return null;
    }
}

function findPlayerRowIndex(rows, nameColIndex, vote, userId) {
    const searchNames = [
        vote.rankedName ? normalizeName(vote.rankedName) : null,
        normalizeName(vote.userName),
        userId
    ].filter(Boolean);
    for (let i = 0; i < rows.length; i++) {
        const rowName = normalizeName(rows[i][nameColIndex] || "");
        for (const sName of searchNames) {
            if (rowName === sName) return i;
        }
    }
    return -1;
}

// ─── Post Salary Report ─────────────────────

/** Post the weekly salary report embed with 'Check Your Salary' button. */
export async function postSalaryReport() {
    const state = getSalaryState();
    const channelId = state.channelId;
    if (!channelId) { console.log("❌ [Salary Report] No channel configured."); return; }

    const voteEntries = Object.entries(state.votes);
    if (voteEntries.length === 0) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) await channel.send({ content: "📭 **Salary Report:** No votes recorded this week." }).catch(noop);
        return;
    }

    const spreadsheetId = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) { console.log("❌ [Salary Report] No spreadsheet ID."); return; }

    const sheets = await getSheetsClient();
    if (!sheets) return;

    try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = meta.data.sheets.find(s => s.properties.title === "PLAYERS");
        if (!playersSheet) { console.log("⚠️ [Salary Report] PLAYERS sheet not found."); return; }
        const title = playersSheet.properties.title;

        const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!B7:S` });
        const rows = result.data.values;
        if (!rows || rows.length === 0) { console.log("⚠️ [Salary Report] No data."); return; }

        const reportData = [];
        let unmatchedCount = 0;

        for (const [userId, vote] of voteEntries) {
            const matchedRow = findPlayerRowIndex(rows, 0, vote, userId);
            if (matchedRow >= 0) {
                const row = rows[matchedRow];
                reportData.push({
                    userId, name: row[0] || vote.userName,
                    dsPercent: row[8] !== undefined ? Number(row[8]) : vote.dsPercent, dsQty: row[11] || "—",
                    yellowPercent: row[12] !== undefined ? Number(row[12]) : vote.yellowPercent, yellowQty: row[13] || "—", yellowPts: row[14] || "—",
                    purplePercent: row[15] !== undefined ? Number(row[15]) : vote.purplePercent, purpleQty: row[16] || "—", purplePts: row[17] || "—",
                    matched: true
                });
            } else {
                reportData.push({ userId, name: vote.userName, dsPercent: vote.dsPercent, dsQty: "—", yellowPercent: vote.yellowPercent, yellowQty: "—", yellowPts: "—", purplePercent: vote.purplePercent, purpleQty: "—", purplePts: "—", matched: false });
                unmatchedCount++;
            }
        }

        const weekRange = getFormattedWeekRange();
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) { console.error("❌ [Salary Report] Channel not found."); return; }

        await clearBotMessagesInSalaryChannel();

        const reportEmbed = new EmbedBuilder()
            .setTitle("📊 Salary Report Ready!").setColor("#57F287")
            .setDescription(
                `**Week:** ${weekRange}\n\n` +
                `The salary composition has been calculated and saved to the spreadsheet.\n` +
                `**${reportData.length} member(s)** voted this week.\n\n` +
                (unmatchedCount > 0 ? `⚠️ *${unmatchedCount} member(s) could not be matched in the spreadsheet*\n\n` : ``) +
                `Click the button below to check your **personal salary breakdown!** 👇`
            ).setFooter({ text: `Salary Report — ${weekRange}` }).setTimestamp();

        const checkBtn = new ButtonBuilder()
            .setCustomId("salary_check").setLabel("🔍 Check Your Salary").setStyle(ButtonStyle.Primary);

        await channel.send({ content: "@everyone", embeds: [reportEmbed], components: [new ActionRowBuilder().addComponents(checkBtn)] });
        console.log(`✅ [Salary Report] Posted report for ${reportData.length} members (${unmatchedCount} unmatched).`);
        logEvent(`Salary report posted for week ${state.currentWeek} (${reportData.length} members)`);
    } catch (err) {
        console.error("❌ [Salary Report] Error:", err.message);
    }
}

// ─── Build Salary Breakdown Response ────────

async function buildSalaryBreakdownResponse(interaction) {
    const userId = interaction.user.id;
    const state = getSalaryState();
    let checkUserId = userId;
    let checkVote = state.votes[userId];

    if (!checkVote && rankingDb && rankingDb.users) {
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) {
                checkUserId = uid; checkVote = state.votes[uid] || null; break;
            }
        }
    }

    const finalVote = checkVote;
    if (!finalVote) return null;

    let userData = null;
    try {
        const spreadsheetId = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
        if (!spreadsheetId) throw new Error("No spreadsheet ID");
        const sheets = await getSheetsClient();
        if (!sheets) throw new Error("No sheets client");
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = meta.data.sheets.find(s => s.properties.title === "PLAYERS");
        if (!playersSheet) throw new Error("PLAYERS sheet not found");
        const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${playersSheet.properties.title}!B7:S` });
        const rows = result.data.values || [];
        const matchedRow = findPlayerRowIndex(rows, 0, finalVote, checkUserId);
        if (matchedRow >= 0) {
            const row = rows[matchedRow];
            userData = {
                name: row[0] || finalVote.userName,
                dsPercent: row[8] !== undefined ? Number(row[8]) : finalVote.dsPercent, dsQty: row[11] || "—",
                yellowPercent: row[12] !== undefined ? Number(row[12]) : finalVote.yellowPercent, yellowQty: row[13] || "—", yellowPts: row[14] || "—",
                purplePercent: row[15] !== undefined ? Number(row[15]) : finalVote.purplePercent, purpleQty: row[16] || "—", purplePts: row[17] || "—"
            };
        }
    } catch (err) { console.error("❌ [Salary Check] Error:", err.message); }

    if (!userData) {
        userData = { name: finalVote.userName, dsPercent: finalVote.dsPercent, dsQty: "—", yellowPercent: finalVote.yellowPercent, yellowQty: "—", yellowPts: "—", purplePercent: finalVote.purplePercent, purpleQty: "—", purplePts: "—" };
    }

    const weekRange = getFormattedWeekRange();
    const embed = new EmbedBuilder()
        .setTitle("📊 Your Salary Breakdown").setColor("#57F287")
        .setDescription(`**Week:** ${weekRange}\n**👤 ${userData.name}**`)
        .addFields(
            { name: "⚪ Darksteel", value: `**${userData.dsPercent}%** — ${userData.dsQty}`, inline: true },
            { name: "🎨 Yellow Stones", value: `**${userData.yellowPercent}%** — ${userData.yellowQty} units | **${userData.yellowPts}** pts`, inline: true },
            { name: "🟣 Purple Stones", value: `**${userData.purplePercent}%** — ${userData.purpleQty} units | **${userData.purplePts}** pts`, inline: true }
        ).setFooter({ text: `Salary Report — ${weekRange}` }).setTimestamp();

    const refreshBtn = new ButtonBuilder().setCustomId("salary_refresh").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(refreshBtn)], flags: 64 };
}

// ─── Handle Check / Refresh ─────────────────

/** Show personal salary breakdown when user clicks the check button. */
export async function handleSalaryCheckButton(interaction) {
    const response = await buildSalaryBreakdownResponse(interaction);
    if (!response) {
        return await interaction.reply({ content: "❌ You didn't vote in this week's salary poll.", flags: 64 }).catch(noop);
    }
    return await interaction.reply(response).catch(noop);
}

/** Refresh the personal salary breakdown embed. */
export async function handleSalaryCheckRefresh(interaction) {
    const response = await buildSalaryBreakdownResponse(interaction);
    if (!response) {
        return await interaction.update({ content: "❌ You didn't vote.", embeds: [], components: [] }).catch(noop);
    }
    return await interaction.update(response).catch(noop);
}
