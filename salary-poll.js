// ==========================================
// 📊 SALARY POLL SYSTEM
// Weekly poll for members to choose salary composition
// Monday 12:30 BRT — open poll
// Wednesday 13:00 BRT — close poll & export to Google Sheets
//
// Multi-server: each in-game server (EU013, EU021) has its own
// independent salary state, channel, spreadsheet, and votes.
// ==========================================

import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { google } from "googleapis";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { getMsg } from "./lang.js";
import { client, saveLocalStorage, logEvent, rankingDb } from "./state.js";
import { getLocalTime } from "./time-utils.js";
import { getActiveServerIds, getServerDataFiles } from "./server-config.js";

// ─── Default spreadsheet ─────────────────────

const DEFAULT_SPREADSHEET_ID = "1ePa0Ws55-KrJpFUELebuPOJqfT8dfx1IJc1g9Dt8vPo";

// ─── Time zone ───────────────────────────────

const TIMEZONE = "America/Sao_Paulo"; // Brazil time (BRT, UTC-3)

// ─── Percentage options ──────────────────────

const PERCENT_OPTIONS = [0, 25, 50, 75, 100];

const STONE_EMOJIS = {
    yellow: "🎨",
    purple: "🟣"
};

// ─── Default state shape ─────────────────────

const DEFAULT_STATE = {
    channelId: null,
    spreadsheetId: null,
    messageId: null,
    currentWeek: "",
    status: "idle", // "idle" | "open" | "closed"
    pollOpenedAt: null,
    pollClosesAt: null,
    votes: {} // { discordUserId: { yellowPercent, purplePercent, dsPercent, userName, updatedAt } }
};

// ─── Per-server state map ────────────────────

let serverStates = {};

// ─── Voting session cache (per user, not per server) ────

let voteSessionCache = {}; // { userId: { yellowPercent: null, purplePercent: null, serverId: null } }

// ─── Save / Load per-server state ────────────

function getStatePath(serverId) {
    return getServerDataFiles(serverId).salaryDb;
}

export function getServerState(serverId) {
    if (!serverStates[serverId]) {
        serverStates[serverId] = { ...JSON.parse(JSON.stringify(DEFAULT_STATE)) };
    }
    return serverStates[serverId];
}

function saveServerState(serverId) {
    try {
        const statePath = getStatePath(serverId);
        fs.writeFileSync(statePath, JSON.stringify(serverStates[serverId], null, 2));
    } catch (err) {
        console.error(`❌ [Salary Poll] Error saving state for ${serverId}:`, err.message);
    }
}

function loadServerState(serverId) {
    try {
        const statePath = getStatePath(serverId);
        if (fs.existsSync(statePath)) {
            const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
            serverStates[serverId] = {
                channelId: data.channelId || null,
                spreadsheetId: data.spreadsheetId || null,
                messageId: data.messageId || null,
                currentWeek: data.currentWeek || "",
                status: data.status || "idle",
                pollOpenedAt: data.pollOpenedAt || null,
                pollClosesAt: data.pollClosesAt || null,
                votes: data.votes || {}
            };
            console.log(`✅ [Salary Poll] State loaded for ${serverId}.`);
        } else {
            serverStates[serverId] = { ...JSON.parse(JSON.stringify(DEFAULT_STATE)) };
            saveServerState(serverId);
            console.log(`📝 [Salary Poll] New state file created for ${serverId}.`);
        }
    } catch (err) {
        console.error(`❌ [Salary Poll] Error loading state for ${serverId}:`, err.message);
        serverStates[serverId] = { ...JSON.parse(JSON.stringify(DEFAULT_STATE)) };
    }
}

export function loadAllSalaryStates() {
    const serverIds = getActiveServerIds();
    if (serverIds.length === 0) {
        console.log("⚠️ [Salary Poll] No servers configured. Salary poll will not be available.");
        return;
    }
    for (const serverId of serverIds) {
        loadServerState(serverId);
    }
    console.log(`✅ [Salary Poll] Loaded states for ${serverIds.length} server(s).`);
}

// ─── Setters (per-server) ────────────────────

export function setSalaryChannelId(serverId, channelId) {
    const state = getServerState(serverId);
    state.channelId = channelId;
    saveServerState(serverId);
}

export function setSalarySpreadsheetId(serverId, spreadsheetId) {
    const state = getServerState(serverId);
    state.spreadsheetId = spreadsheetId;
    saveServerState(serverId);
}

// ─── Helpers ─────────────────────────────────

/** Normalize a name for comparison: lowercase, trim, strip decorative Unicode chars */
function normalizeName(name) {
    if (!name) return "";
    const decorative = /[\u2000-\u206F\u2100-\u27BF\u2B00-\u2BFF\u3000-\u303F\uFE30-\uFE6F\uFF00-\uFFEF\u30FB\u30FC]/g;
    return name
        .toLowerCase()
        .trim()
        .replace(decorative, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getCurrentWeekKey() {
    const now = getLocalTime();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, "0");
    const day = String(monday.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getFormattedWeekRange() {
    const now = getLocalTime();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    const fmt = (d) => d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" });
    return `${fmt(monday)} - ${fmt(sunday)}`;
}

function formatDate(date) {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

// ─── Build Poll Embed ────────────────────────

function buildPollEmbed(serverId) {
    const state = getServerState(serverId);
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
        .setTitle(`📊 Weekly Salary Poll — ${serverId.toUpperCase()}`)
        .setColor(isOpen ? "#57F287" : "#2b2d31")
        .setDescription(
            `**Week:** ${weekRange}\n` +
            `**Server:** ${serverId.toUpperCase()}\n` +
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
            {
                name: `🎨 Yellow Stones (Avg: ${avgYellow.toFixed(0)}%)`,
                value: `\`${bar(avgYellow)}\` \`${avgYellow.toFixed(0)}%\``,
                inline: false
            },
            {
                name: `🟣 Purple Stones (Avg: ${avgPurple.toFixed(0)}%)`,
                value: `\`${bar(avgPurple)}\` \`${avgPurple.toFixed(0)}%\``,
                inline: false
            },
            {
                name: `⚪ Darksteel (Avg: ${avgDS.toFixed(0)}%)`,
                value: `\`${bar(avgDS)}\` \`${avgDS.toFixed(0)}%\``,
                inline: false
            }
        );
    }

    return embed;
}

// ─── Build Actions ───────────────────────────

function buildPollActions(serverId) {
    const state = getServerState(serverId);
    if (state.status !== "open") return [];

    const voteBtn = new ButtonBuilder()
        .setCustomId(`${serverId}_salary_vote`)
        .setLabel("✏️ Vote / Change Vote")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🗳️");

    return [new ActionRowBuilder().addComponents(voteBtn)];
}

// ─── Create or Update Poll Message ───────────

export async function createOrUpdatePollMessage(serverId, pingEveryone = false) {
    const state = getServerState(serverId);
    if (!state.channelId) {
        console.log(`❌ [Salary Poll] No channel configured for ${serverId}. Use !setsalary first.`);
        return false;
    }

    try {
        const channel = await client.channels.fetch(state.channelId).catch(() => null);
        if (!channel) {
            console.error(`❌ [Salary Poll] Salary channel not found for ${serverId}.`);
            return false;
        }

        const embed = buildPollEmbed(serverId);
        const components = buildPollActions(serverId);

        if (state.messageId) {
            try {
                const existingMsg = await channel.messages.fetch(state.messageId).catch(() => null);
                if (existingMsg) {
                    await existingMsg.edit({ embeds: [embed], components });
                    return true;
                }
            } catch (e) {}
        }

        const msg = await channel.send({ ...(pingEveryone ? { content: "@everyone" } : {}), embeds: [embed], components });
        state.messageId = msg.id;
        saveServerState(serverId);
        return true;
    } catch (err) {
        console.error(`❌ [Salary Poll] Error creating/updating poll message for ${serverId}:`, err.message);
        return false;
    }
}

// ─── Open Poll ───────────────────────────────

export async function openPoll(serverId) {
    const state = getServerState(serverId);
    const weekKey = getCurrentWeekKey();

    if (state.currentWeek === weekKey && state.status === "open") {
        console.log(`[Salary Poll] Poll already open for ${serverId} week ${weekKey}`);
        return;
    }

    state.currentWeek = weekKey;
    state.votes = {};
    state.status = "open";
    state.pollOpenedAt = new Date().toISOString();

    const now = new Date();
    const wednesday = new Date(now);
    wednesday.setDate(wednesday.getDate() + ((3 - wednesday.getDay() + 7) % 7));
    wednesday.setHours(13, 0, 0, 0, 0);
    if (now.getDay() === 3 && now.getHours() < 13) {
        wednesday.setTime(now.getTime());
        wednesday.setHours(13, 0, 0, 0);
    }
    state.pollClosesAt = wednesday.toISOString();

    saveServerState(serverId);
    console.log(`📊 [Salary Poll] Poll opened for ${serverId} week ${weekKey}. Closes at ${wednesday.toISOString()}`);

    await createOrUpdatePollMessage(serverId, true);
    logEvent(`Salary poll opened for ${serverId} week ${weekKey}`);
}

// ─── Close Poll ──────────────────────────────

export async function closePoll(serverId) {
    const state = getServerState(serverId);
    if (state.status !== "open") {
        console.log(`[Salary Poll] No open poll to close for ${serverId}.`);
        return;
    }

    state.status = "closed";
    saveServerState(serverId);
    console.log(`📊 [Salary Poll] Poll closed for ${serverId} week ${state.currentWeek}`);

    await createOrUpdatePollMessage(serverId);

    if ((state.spreadsheetId || DEFAULT_SPREADSHEET_ID) && Object.keys(state.votes).length > 0) {
        await exportVotesToSheets(serverId);
    } else if (!state.spreadsheetId && !DEFAULT_SPREADSHEET_ID) {
        console.log(`⚠️ [Salary Poll] No spreadsheet ID configured for ${serverId}. Skipping export.`);
    } else {
        console.log(`📭 [Salary Poll] No votes recorded for ${serverId}. Skipping export.`);
    }

    logEvent(`Salary poll closed for ${serverId} week ${state.currentWeek}`);
}

// ─── Google Sheets Integration ───────────────

const GOOGLE_CREDENTIALS_PATH = path.resolve("./google_credentials.json");

async function getSheetsClient() {
    try {
        const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf8"));
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"]
        });
        const sheets = google.sheets({ version: "v4", auth });
        return sheets;
    } catch (err) {
        console.error("❌ [Salary Poll] Error creating Sheets client:", err.message);
        return null;
    }
}

export async function exportVotesToSheets(serverId) {
    const state = getServerState(serverId);
    const sheets = await getSheetsClient();
    if (!sheets) {
        console.error(`❌ [Salary Poll] Cannot export for ${serverId} — Sheets client unavailable.`);
        return false;
    }

    const spreadsheetId = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) {
        console.error(`❌ [Salary Poll] No spreadsheet ID for ${serverId}.`);
        return false;
    }

    try {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        let salarySheetExists = spreadsheet.data.sheets.some(
            s => s.properties.title === "Salary Poll"
        );

        if (!salarySheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: "Salary Poll" }
                        }
                    }]
                }
            });
        }

        const headerRow = [
            ["Discord ID", "Discord Name", "% Yellow Stones", "% Purple Stones", "% Darksteel", "Vote Date"]
        ];

        const dataRows = Object.entries(state.votes).map(([userId, vote]) => [
            userId,
            vote.userName,
            vote.yellowPercent,
            vote.purplePercent,
            vote.dsPercent,
            formatDate(vote.updatedAt)
        ]);

        const allRows = headerRow.concat(dataRows);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: "Salary Poll!A1:F",
            valueInputOption: "USER_ENTERED",
            requestBody: { values: allRows }
        });

        console.log(`✅ [Salary Poll] Exported ${dataRows.length} votes for ${serverId} to 'Salary Poll' sheet.`);

        await updateMainSheet(sheets, spreadsheetId, serverId);

        return true;
    } catch (err) {
        console.error(`❌ [Salary Poll] Error exporting to sheets for ${serverId}:`, err.message);
        return false;
    }
}

async function updateMainSheet(sheets, spreadsheetId, serverId) {
    const state = getServerState(serverId);
    try {
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = sheetMetadata.data.sheets.find(
            s => s.properties.title === "PLAYERS"
        );
        if (!playersSheet) {
            console.log(`⚠️ [Salary Poll] PLAYERS sheet not found for ${serverId}. Cannot update.`);
            return;
        }
        const sheetTitle = playersSheet.properties.title;

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetTitle}!A7:P`
        });

        const rows = result.data.values;
        if (!rows || rows.length === 0) {
            console.log(`⚠️ [Salary Poll] PLAYERS sheet has no data rows for ${serverId}. Cannot update.`);
            return;
        }

        const batchData = [];
        let updatedCount = 0;

        for (const [userId, vote] of Object.entries(state.votes)) {
            const searchNames = [
                vote.rankedName ? normalizeName(vote.rankedName) : null,
                normalizeName(vote.userName),
                userId
            ].filter(Boolean);

            let matchedRow = -1;

            for (let i = 0; i < rows.length; i++) {
                const rowName = normalizeName(rows[i][1] || ""); // Column B = index 1

                for (const searchName of searchNames) {
                    if (rowName === searchName) {
                        matchedRow = i;
                        break;
                    }
                }
                if (matchedRow >= 0) break;
            }

            if (matchedRow >= 0) {
                const sheetRow = matchedRow + 7;
                const matchedName = rows[matchedRow][1] || rows[matchedRow][0] || "?";
                batchData.push(
                    { range: `${sheetTitle}!J${sheetRow}`, values: [[vote.dsPercent]] },
                    { range: `${sheetTitle}!N${sheetRow}`, values: [[vote.yellowPercent]] },
                    { range: `${sheetTitle}!Q${sheetRow}`, values: [[vote.purplePercent]] }
                );
                updatedCount++;
                console.log(`✅ [Salary Poll] Matched ${vote.userName} → row ${sheetRow} (${matchedName}): J=${vote.dsPercent}%, N=${vote.yellowPercent}%, Q=${vote.purplePercent}%`);
            } else {
                console.log(`⚠️ [Salary Poll] Could not find ${vote.userName} in PLAYERS sheet for ${serverId}. Searched for: ${searchNames.join(", ")}`);
            }
        }

        if (batchData.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: "USER_ENTERED",
                    data: batchData
                }
            });
            console.log(`✅ [Salary Poll] PLAYERS sheet for ${serverId}: updated ${updatedCount} member(s) (${batchData.length} cells written).`);
        }

        if (updatedCount < Object.keys(state.votes).length) {
            console.log(`⚠️ [Salary Poll] ${Object.keys(state.votes).length - updatedCount} member(s) could not be matched in PLAYERS sheet for ${serverId}.`);
        }

    } catch (err) {
        console.error(`❌ [Salary Poll] Error updating PLAYERS sheet for ${serverId}:`, err.message);
    }
}

// ─── Handle Vote Button ─────────────────────

export async function handleVoteButton(interaction, serverId) {
    const state = getServerState(serverId);
    if (state.status !== "open") {
        return await interaction.reply({
            content: "❌ The poll is currently closed. Wait for next Monday at 12:30 (BRT)!",
            flags: 64
        }).catch(() => {});
    }

    const userId = interaction.user.id;
    let currentVote = state.votes[userId];
    if (!currentVote && rankingDb && rankingDb.users) {
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) {
                currentVote = state.votes[uid] || null;
                break;
            }
        }
    }

    voteSessionCache[userId] = {
        yellowPercent: currentVote ? currentVote.yellowPercent : null,
        purplePercent: currentVote ? currentVote.purplePercent : null,
        serverId: serverId
    };

    const percentOptions = PERCENT_OPTIONS.map(p => ({
        label: p === 0 ? "0% — No stones" : `${p}%`,
        value: String(p),
        emoji: p === 0 ? "🚫" : p <= 50 ? "🔸" : "🔶"
    }));

    const yellowSelect = new StringSelectMenuBuilder()
        .setCustomId(`${serverId}_salary_yellow_${userId}`)
        .setPlaceholder("🎨 Choose % of Yellow Stones")
        .addOptions(percentOptions);

    const purpleSelect = new StringSelectMenuBuilder()
        .setCustomId(`${serverId}_salary_purple_${userId}`)
        .setPlaceholder("🟣 Choose % of Purple Stones")
        .addOptions(percentOptions);

    const confirmBtn = new ButtonBuilder()
        .setCustomId(`${serverId}_salary_confirm_${userId}`)
        .setLabel("✅ Confirm Vote")
        .setStyle(ButtonStyle.Success);

    const cancelBtn = new ButtonBuilder()
        .setCustomId(`${serverId}_salary_cancel_${userId}`)
        .setLabel("❌ Cancel")
        .setStyle(ButtonStyle.Secondary);

    const session = voteSessionCache[userId];
    let embedDesc = "Choose the percentages for each stone type:";

    if (currentVote) {
        embedDesc += `\n\n**Your current vote:**\n` +
            `${STONE_EMOJIS.yellow} Yellow Stones: **${currentVote.yellowPercent}%**\n` +
            `${STONE_EMOJIS.purple} Purple Stones: **${currentVote.purplePercent}%**\n` +
            `⚪ Darksteel: **${currentVote.dsPercent}%**`;
    } else {
        embedDesc += "\n\n*You haven't voted this week yet.*";
    }

    const embed = new EmbedBuilder()
        .setTitle("🗳️ Your Salary Choice")
        .setColor("#FEE75C")
        .setDescription(embedDesc)
        .addFields(
            { name: "📌 Rules", value: "The total (%) of Yellow Stones + Purple Stones cannot exceed **100%**.\nThe remainder will be automatically converted to ⚪ **Darksteel**." }
        )
        .setTimestamp();

    return await interaction.reply({
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(yellowSelect),
            new ActionRowBuilder().addComponents(purpleSelect),
            new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)
        ],
        flags: 64
    }).catch(() => {});
}

// ─── Handle Select Menu ──────────────────────

export async function handleSalarySelect(interaction, serverId) {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const value = parseInt(interaction.values[0], 10);

    if (!voteSessionCache[userId] || voteSessionCache[userId].serverId !== serverId) {
        voteSessionCache[userId] = { yellowPercent: null, purplePercent: null, serverId: serverId };
    }

    if (customId.endsWith(`_salary_yellow_${userId}`) || customId.includes(`_salary_yellow_`)) {
        voteSessionCache[userId].yellowPercent = value;
    } else if (customId.includes(`_salary_purple_`)) {
        voteSessionCache[userId].purplePercent = value;
    }

    const yellowPct = voteSessionCache[userId].yellowPercent || 0;
    const purplePct = voteSessionCache[userId].purplePercent || 0;
    const dsPct = Math.max(0, 100 - yellowPct - purplePct);

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setFields(
            { name: "📌 Rules", value: "The total (%) of Yellow Stones + Purple Stones cannot exceed **100%**.\nThe remainder will be automatically converted to ⚪ **Darksteel**." }
        );

    let desc = `Choose the percentages for each stone type:\n\n` +
        `**Your current selection:**\n` +
        `${STONE_EMOJIS.yellow} Yellow Stones: **${yellowPct}%**\n` +
        `${STONE_EMOJIS.purple} Purple Stones: **${purplePct}%**\n` +
        `⚪ Darksteel: **${dsPct}%**\n\n` +
        (yellowPct + purplePct > 100
            ? "⚠️ **Warning:** The sum exceeds 100%! Adjust the values."
            : yellowPct + purplePct === 100
                ? "⚠️ **100% in stones** — You will not receive Darksteel this week."
                : (yellowPct > 0 || purplePct > 0)
                    ? `✅ **${dsPct}%** of your salary will be Darksteel.`
                    : "💡 You will receive **100% of your salary in Darksteel**.");

    embed.setDescription(desc);

    return await interaction.update({
        embeds: [embed],
        components: interaction.message.components
    }).catch(() => {});
}

// ─── Handle Confirm / Cancel ────────────────

export async function handleSalaryConfirm(interaction, serverId) {
    const state = getServerState(serverId);
    const userId = interaction.user.id;
    const session = voteSessionCache[userId];

    if (!session || session.yellowPercent === null || session.purplePercent === null || session.serverId !== serverId) {
        return await interaction.update({
            content: "❌ You need to select the percentages of both stones before confirming!",
            embeds: [],
            components: [],
            flags: 64
        }).catch(() => {});
    }

    const total = session.yellowPercent + session.purplePercent;
    if (total > 100) {
        return await interaction.update({
            content: `❌ The sum (${total}%) exceeds 100%! Adjust the values so Yellow Stones + Purple Stones ≤ 100%.`,
            embeds: [],
            components: [],
            flags: 64
        }).catch(() => {});
    }

    const dsPercent = 100 - total;

    let effectiveUserId = userId;
    let effectiveName = interaction.member?.displayName || interaction.user.username;
    let rankedName = null;

    if (rankingDb && rankingDb.users) {
        let ownerId = null;
        let ownerData = null;
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) {
                ownerId = uid;
                ownerData = data;
                break;
            }
        }

        if (ownerId && ownerData) {
            effectiveUserId = ownerId;
            effectiveName = ownerData.nickname || ownerData.characterName || effectiveName;
            rankedName = ownerData.nickname || ownerData.characterName || null;
        } else {
            const userData = rankingDb.users[userId];
            if (userData) {
                rankedName = userData.nickname || userData.characterName || null;
            }
        }
    }

    state.votes[effectiveUserId] = {
        yellowPercent: session.yellowPercent,
        purplePercent: session.purplePercent,
        dsPercent: dsPercent,
        userName: effectiveName,
        rankedName: rankedName,
        updatedAt: new Date().toISOString()
    };

    saveServerState(serverId);
    delete voteSessionCache[userId];

    await createOrUpdatePollMessage(serverId);

    syncSingleVoteToSheet(serverId, effectiveUserId, state.votes[effectiveUserId]).catch(() => {});

    const embed = new EmbedBuilder()
        .setTitle("✅ Vote Registered!")
        .setColor("#57F287")
        .setDescription(
            `**Your salary for the week** ${getFormattedWeekRange()}:\n\n` +
            `${STONE_EMOJIS.yellow} Yellow Stones: **${session.yellowPercent}%**\n` +
            `${STONE_EMOJIS.purple} Purple Stones: **${session.purplePercent}%**\n` +
            `⚪ Darksteel: **${dsPercent}%**\n\n` +
            `📝 You can change your vote until Wednesday 13:00 (BRT).`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [],
        flags: 64
    }).catch(() => {});
}

export async function handleSalaryCancel(interaction) {
    const userId = interaction.user.id;
    delete voteSessionCache[userId];

    return await interaction.update({
        content: "❌ Vote canceled. No changes were saved.",
        embeds: [],
        components: [],
        flags: 64
    }).catch(() => {});
}

// ─── Cron Scheduling ─────────────────────────

let cronTasks = [];

export function initSalaryCron() {
    // Clear existing tasks
    cronTasks.forEach(task => task.stop());
    cronTasks = [];

    const serverIds = getActiveServerIds();
    if (serverIds.length === 0) {
        console.log("⚠️ [Salary Poll] No servers configured, cron not started.");
        return;
    }

    // Monday 12:30 BRT — Open poll for ALL servers
    const openTask = cron.schedule("30 12 * * 1", async () => {
        console.log("⏰ [Salary Poll] Cron: Opening polls (Monday 12:30 BRT)...");
        for (const sid of serverIds) {
            try {
                await openPoll(sid);
            } catch (err) {
                console.error(`❌ [Salary Poll] Error opening poll for ${sid}:`, err.message);
            }
        }
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(openTask);
    console.log("📅 [Salary Poll] Cron: Polls open Monday 12:30 BRT");

    // Wednesday 13:00 BRT — Close poll for ALL servers
    const closeTask = cron.schedule("0 13 * * 3", async () => {
        console.log("⏰ [Salary Poll] Cron: Closing polls (Wednesday 13:00 BRT)...");
        for (const sid of serverIds) {
            try {
                await closePoll(sid);
            } catch (err) {
                console.error(`❌ [Salary Poll] Error closing poll for ${sid}:`, err.message);
            }
        }
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(closeTask);
    console.log("📅 [Salary Poll] Cron: Polls close Wednesday 13:00 BRT");

    // Wednesday 16:00 BRT — Post salary report for ALL servers
    const reportTask = cron.schedule("0 16 * * 3", async () => {
        console.log("⏰ [Salary Poll] Cron: Posting salary reports (Wednesday 16:00 BRT)...");
        for (const sid of serverIds) {
            try {
                await postSalaryReport(sid);
            } catch (err) {
                console.error(`❌ [Salary Poll] Error posting report for ${sid}:`, err.message);
            }
        }
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(reportTask);
    console.log("📅 [Salary Poll] Cron: Salary reports Wednesday 16:00 BRT");

    // Friday 13:00 BRT — Reset all votes to 100% Darksteel / 0% stones for ALL servers
    const resetTask = cron.schedule("0 13 * * 5", async () => {
        console.log("⏰ [Salary Poll] Cron: Resetting votes to default (Friday 13:00 BRT)...");
        for (const sid of serverIds) {
            try {
                await resetVotesToDefault(sid);
            } catch (err) {
                console.error(`❌ [Salary Poll] Error resetting votes for ${sid}:`, err.message);
            }
        }
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(resetTask);
    console.log("📅 [Salary Poll] Cron: Votes reset to 100% DS Friday 13:00 BRT");

    // Check and restore polls on boot for each server
    for (const sid of serverIds) {
        checkAndRestorePollOnBoot(sid).catch(err => {
            console.error(`❌ [Salary Poll] Boot recovery error for ${sid}:`, err.message);
        });
    }

    console.log(`📅 [Salary Poll] Cron scheduling initialized for ${serverIds.length} server(s).`);
}

// ─── Reset Votes to Default ─────────────────

export async function resetVotesToDefault(serverId) {
    const state = getServerState(serverId);
    const voteCount = Object.keys(state.votes).length;
    if (voteCount === 0) {
        console.log(`📭 [Salary Poll] No votes to reset for ${serverId}.`);
        return;
    }

    const now = new Date().toISOString();
    for (const userId of Object.keys(state.votes)) {
        const vote = state.votes[userId];
        vote.yellowPercent = 0;
        vote.purplePercent = 0;
        vote.dsPercent = 100;
        vote.updatedAt = now;
    }

    saveServerState(serverId);
    console.log(`✅ [Salary Poll] Reset ${voteCount} vote(s) for ${serverId} to 100% Darksteel / 0% stones.`);
    logEvent(`Salary votes reset to default for ${serverId} (${voteCount} members) — 100% DS`);
}

// ─── Startup recovery ────────────────────────

async function checkAndRestorePollOnBoot(serverId) {
    const state = getServerState(serverId);
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentTimeMinutes = hour * 60 + minute;

    const mondayOpen = 12 * 60 + 30;
    const wednesdayClose = 13 * 60;

    let shouldBeOpen = false;

    if (day === 1 && currentTimeMinutes >= mondayOpen) {
        shouldBeOpen = true;
    } else if (day === 2) {
        shouldBeOpen = true;
    } else if (day === 3 && currentTimeMinutes < wednesdayClose) {
        shouldBeOpen = true;
    }

    const weekKey = getCurrentWeekKey();

    if (shouldBeOpen) {
        if (state.currentWeek !== weekKey || state.status !== "open") {
            console.log(`🔄 [Salary Poll] Boot: Restoring poll for ${serverId} week ${weekKey}...`);
            await openPoll(serverId);
        } else {
            console.log(`🔄 [Salary Poll] Boot: Poll already open for ${serverId} week ${weekKey}, refreshing message.`);
            await createOrUpdatePollMessage(serverId);
        }
    } else if (state.status === "open") {
        if (day > 3 || (day === 3 && currentTimeMinutes >= wednesdayClose) || day === 0) {
            console.log(`🔄 [Salary Poll] Boot: Closing expired poll for ${serverId}...`);
            await closePoll(serverId);
        }
    }
}

// ─── Real-time vote sync ─────────────────────

async function syncSingleVoteToSheet(serverId, userId, vote) {
    const state = getServerState(serverId);
    const spreadsheetId = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) return;

    const sheets = await getSheetsClient();
    if (!sheets) return;

    try {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        let salarySheetExists = spreadsheet.data.sheets.some(
            s => s.properties.title === "Salary Poll"
        );

        if (!salarySheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: "Salary Poll" }
                        }
                    }]
                }
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: "Salary Poll!A1:F1",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [["Discord ID", "Discord Name", "% Yellow Stones", "% Purple Stones", "% Darksteel", "Vote Date"]]
                }
            });
        }

        const existingData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "Salary Poll!A:A"
        });

        const existingRows = existingData.data.values || [];
        let userRow = -1;
        for (let i = 0; i < existingRows.length; i++) {
            if (existingRows[i][0] === userId) {
                userRow = i + 1;
                break;
            }
        }

        const rowData = [[
            userId,
            vote.userName,
            vote.yellowPercent,
            vote.purplePercent,
            vote.dsPercent,
            formatDate(vote.updatedAt)
        ]];

        if (userRow > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Salary Poll!A${userRow}:F${userRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: rowData }
            });
        } else {
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: "Salary Poll!A:F",
                valueInputOption: "USER_ENTERED",
                insertDataOption: "INSERT_ROWS",
                requestBody: { values: rowData }
            });
        }

        await updateSingleUserInMainSheet(sheets, spreadsheetId, userId, vote);

        console.log(`✅ [Salary Poll] Real-time: synced ${vote.userName} to spreadsheet for ${serverId}.`);
    } catch (err) {
        console.error(`❌ [Salary Poll] Real-time sync error for ${serverId}/${vote.userName}:`, err.message);
    }
}

async function updateSingleUserInMainSheet(sheets, spreadsheetId, userId, vote) {
    try {
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = sheetMetadata.data.sheets.find(
            s => s.properties.title === "PLAYERS"
        );
        if (!playersSheet) {
            console.log("⚠️ [Salary Poll] Real-time: PLAYERS sheet not found.");
            return;
        }
        const sheetTitle = playersSheet.properties.title;

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetTitle}!A7:P`
        });

        const rows = result.data.values;
        if (!rows || rows.length === 0) return;

        const searchNames = [
            vote.rankedName ? normalizeName(vote.rankedName) : null,
            normalizeName(vote.userName),
            userId
        ].filter(Boolean);

        for (let i = 0; i < rows.length; i++) {
            const rowName = normalizeName(rows[i][1] || "");

            for (const searchName of searchNames) {
                if (rowName === searchName) {
                    const sheetRow = i + 7;
                    await sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId,
                        requestBody: {
                            valueInputOption: "USER_ENTERED",
                            data: [
                                { range: `${sheetTitle}!J${sheetRow}`, values: [[vote.dsPercent]] },
                                { range: `${sheetTitle}!N${sheetRow}`, values: [[vote.yellowPercent]] },
                                { range: `${sheetTitle}!Q${sheetRow}`, values: [[vote.purplePercent]] }
                            ]
                        }
                    });
                    console.log(`✅ [Salary Poll] Real-time: updated PLAYERS row ${sheetRow} for ${vote.userName}`);
                    return;
                }
            }
        }

        console.log(`⚠️ [Salary Poll] Real-time: could not find ${vote.userName} in PLAYERS sheet.`);
    } catch (err) {
        console.error(`❌ [Salary Poll] Real-time PLAYERS sheet error:`, err.message);
    }
}

// ─── Salary Report (Wednesday 16:00 BRT) ─────

export async function postSalaryReport(serverId) {
    const state = getServerState(serverId);
    const channelId = state.channelId;
    if (!channelId) {
        console.log(`❌ [Salary Report] No channel configured for ${serverId}.`);
        return;
    }

    const voteEntries = Object.entries(state.votes);
    if (voteEntries.length === 0) {
        console.log(`📭 [Salary Report] No votes to report for ${serverId}.`);
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            await channel.send({ content: `📭 **Salary Report (${serverId.toUpperCase()}):** No votes recorded this week.` }).catch(() => {});
        }
        return;
    }

    const spreadsheetId = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) {
        console.log(`❌ [Salary Report] No spreadsheet ID for ${serverId}.`);
        return;
    }

    const sheets = await getSheetsClient();
    if (!sheets) return;

    try {
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = sheetMetadata.data.sheets.find(
            s => s.properties.title === "PLAYERS"
        );
        if (!playersSheet) {
            console.log(`⚠️ [Salary Report] PLAYERS sheet not found for ${serverId}.`);
            return;
        }
        const sheetTitle = playersSheet.properties.title;

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetTitle}!B7:S`
        });

        const rows = result.data.values;
        if (!rows || rows.length === 0) {
            console.log(`⚠️ [Salary Report] No data in PLAYERS sheet for ${serverId}.`);
            return;
        }

        const reportData = [];
        let unmatchedCount = 0;

        for (const [userId, vote] of voteEntries) {
            const searchNames = [
                vote.rankedName ? normalizeName(vote.rankedName) : null,
                normalizeName(vote.userName),
                userId
            ].filter(Boolean);

            let matchedRow = -1;
            for (let i = 0; i < rows.length; i++) {
                const rowName = normalizeName(rows[i][0] || "");
                for (const sName of searchNames) {
                    if (rowName === sName) {
                        matchedRow = i;
                        break;
                    }
                }
                if (matchedRow >= 0) break;
            }

            if (matchedRow >= 0) {
                const row = rows[matchedRow];
                reportData.push({
                    userId: userId,
                    name: row[0] || vote.userName,
                    dsPercent: row[8] !== undefined && row[8] !== null ? Number(row[8]) : vote.dsPercent,
                    dsQty: row[11] || "—",
                    yellowPercent: row[12] !== undefined && row[12] !== null ? Number(row[12]) : vote.yellowPercent,
                    yellowQty: row[13] || "—",
                    yellowPts: row[14] || "—",
                    purplePercent: row[15] !== undefined && row[15] !== null ? Number(row[15]) : vote.purplePercent,
                    purpleQty: row[16] || "—",
                    purplePts: row[17] || "—",
                    matched: true
                });
            } else {
                reportData.push({
                    userId: userId,
                    name: vote.userName,
                    dsPercent: vote.dsPercent,
                    dsQty: "—",
                    yellowPercent: vote.yellowPercent,
                    yellowQty: "—",
                    yellowPts: "—",
                    purplePercent: vote.purplePercent,
                    purpleQty: "—",
                    purplePts: "—",
                    matched: false
                });
                unmatchedCount++;
            }
        }

        const weekRange = getFormattedWeekRange();

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            console.error(`❌ [Salary Report] Channel not found for ${serverId}.`);
            return;
        }

        const serverTag = serverId.toUpperCase();

        const reportEmbed = new EmbedBuilder()
            .setTitle(`📊 Salary Report Ready! — ${serverTag}`)
            .setColor("#57F287")
            .setDescription(
                `**Week:** ${weekRange}\n` +
                `**Server:** ${serverTag}\n\n` +
                `The salary composition has been calculated and saved to the spreadsheet.\n` +
                `**${reportData.length} member(s)** voted this week.\n\n` +
                (unmatchedCount > 0
                    ? `⚠️ *${unmatchedCount} member(s) could not be matched in the spreadsheet*\n\n`
                    : ``) +
                `Click the button below to check your **personal salary breakdown!** 👇`
            )
            .setFooter({ text: `Salary Report — ${weekRange}` })
            .setTimestamp();

        const checkBtn = new ButtonBuilder()
            .setCustomId(`${serverId}_salary_check`)
            .setLabel("🔍 Check Your Salary")
            .setStyle(ButtonStyle.Primary);

        await channel.send({
            content: "@everyone",
            embeds: [reportEmbed],
            components: [new ActionRowBuilder().addComponents(checkBtn)]
        });

        console.log(`✅ [Salary Report] Posted report for ${serverId} with ${reportData.length} members (${unmatchedCount} unmatched).`);
        logEvent(`Salary report posted for ${serverId} week ${state.currentWeek} (${reportData.length} members)`);

    } catch (err) {
        console.error(`❌ [Salary Report] Error for ${serverId}:`, err.message);
    }
}

// ─── Build salary breakdown response ─────────

async function buildSalaryBreakdownResponse(interaction, serverId) {
    const state = getServerState(serverId);
    const userId = interaction.user.id;
    const userVote = state.votes[userId];

    let checkUserId = userId;
    let checkVote = userVote;
    if (!checkVote && rankingDb && rankingDb.users) {
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) {
                checkUserId = uid;
                checkVote = state.votes[uid] || null;
                break;
            }
        }
    }

    const finalVote = checkVote || userVote;
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

        const result = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${playersSheet.properties.title}!B7:S`
        });

        const rows = result.data.values || [];
        const searchNames = [
            finalVote.rankedName ? normalizeName(finalVote.rankedName) : null,
            normalizeName(finalVote.userName),
            checkUserId
        ].filter(Boolean);

        for (let i = 0; i < rows.length; i++) {
            const rowName = normalizeName(rows[i][0] || "");
            for (const sName of searchNames) {
                if (rowName === sName) {
                    const row = rows[i];
                    userData = {
                        name: row[0] || finalVote.userName,
                        dsPercent: row[8] !== undefined && row[8] !== null ? Number(row[8]) : finalVote.dsPercent,
                        dsQty: row[11] || "—",
                        yellowPercent: row[12] !== undefined && row[12] !== null ? Number(row[12]) : finalVote.yellowPercent,
                        yellowQty: row[13] || "—",
                        yellowPts: row[14] || "—",
                        purplePercent: row[15] !== undefined && row[15] !== null ? Number(row[15]) : finalVote.purplePercent,
                        purpleQty: row[16] || "—",
                        purplePts: row[17] || "—"
                    };
                    break;
                }
            }
            if (userData) break;
        }
    } catch (err) {
        console.error(`❌ [Salary Check] Error fetching data from spreadsheet for ${serverId}:`, err.message);
    }

    if (!userData) {
        userData = {
            name: finalVote.userName,
            dsPercent: finalVote.dsPercent,
            dsQty: "—",
            yellowPercent: finalVote.yellowPercent,
            yellowQty: "—",
            yellowPts: "—",
            purplePercent: finalVote.purplePercent,
            purpleQty: "—",
            purplePts: "—"
        };
    }

    const weekRange = getFormattedWeekRange();
    const playerName = interaction.member?.displayName || userData.name;

    const embed = new EmbedBuilder()
        .setTitle(`📊 Your Salary Breakdown — ${serverId.toUpperCase()}`)
        .setColor("#57F287")
        .setDescription(`**Week:** ${weekRange}\n**Server:** ${serverId.toUpperCase()}\n**👤 ${playerName}**`)
        .addFields(
            { name: "⚪ Darksteel", value: `**${userData.dsPercent}%** — ${userData.dsQty}`, inline: true },
            { name: "🎨 Yellow Stones", value: `**${userData.yellowPercent}%** — ${userData.yellowQty} units | **${userData.yellowPts}** pts`, inline: true },
            { name: "🟣 Purple Stones", value: `**${userData.purplePercent}%** — ${userData.purpleQty} units | **${userData.purplePts}** pts`, inline: true }
        )
        .setFooter({ text: `Salary Report — ${weekRange}` })
        .setTimestamp();

    const refreshBtn = new ButtonBuilder()
        .setCustomId(`${serverId}_salary_refresh`)
        .setLabel("🔄 Refresh")
        .setStyle(ButtonStyle.Secondary);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(refreshBtn)],
        flags: 64
    };
}

// ─── Handle Salary Check Button ──────────────

export async function handleSalaryCheckButton(interaction, serverId) {
    const response = await buildSalaryBreakdownResponse(interaction, serverId);
    if (!response) {
        return await interaction.reply({
            content: `❌ You didn't vote in ${serverId.toUpperCase()}'s salary poll. Wait for next **Monday 12:30 BRT** to participate!`,
            flags: 64
        }).catch(() => {});
    }
    return await interaction.reply(response).catch(() => {});
}

// ─── Handle Salary Refresh Button ────────────

export async function handleSalaryCheckRefresh(interaction, serverId) {
    const response = await buildSalaryBreakdownResponse(interaction, serverId);
    if (!response) {
        return await interaction.update({
            content: `❌ You didn't vote in ${serverId.toUpperCase()}'s salary poll.`,
            embeds: [],
            components: []
        }).catch(() => {});
    }
    return await interaction.update(response).catch(() => {});
}

// ─── Manual force-export ─────────────────────

export async function forceExportToSheets(serverId) {
    const state = getServerState(serverId);
    const sid = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!sid) {
        return { success: false, message: `❌ No spreadsheet configured for ${serverId}. Use !salaryspreadsheet first.` };
    }
    if (Object.keys(state.votes).length === 0) {
        return { success: false, message: `📭 No votes recorded for ${serverId} to export.` };
    }
    await exportVotesToSheets(serverId);
    return { success: true, message: `✅ Exported ${Object.keys(state.votes).length} votes for ${serverId} to the spreadsheet.` };
}

// ─── Expose state for other modules ──────────

export function getSalaryState(serverId) {
    return getServerState(serverId);
}
