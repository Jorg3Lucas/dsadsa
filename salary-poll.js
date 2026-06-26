// ==========================================
// 📊 SALARY POLL SYSTEM
// Weekly poll for members to choose salary composition
// Monday 12:30 BRT — open poll
// Wednesday 13:00 BRT — close poll & export to Google Sheets
// ==========================================

import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { google } from "googleapis";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { getMsg } from "./lang.js";
import { client, saveLocalStorage, logEvent, rankingDb } from "./state.js";
import { getLocalTime } from "./time-utils.js";
import { runBackup } from "./auto-backup.js";

// ─── File paths ──────────────────────────────

const SALARY_DB_PATH = path.resolve("./salary-poll-db.json");
const GOOGLE_CREDENTIALS_PATH = path.resolve("./google_credentials.json");

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

// ─── State ───────────────────────────────────

let salaryState = {
    channelId: null,
    spreadsheetId: null,
    messageId: null,
    currentWeek: "",
    status: "idle", // "idle" | "open" | "closed"
    pollOpenedAt: null,
    pollClosesAt: null,
    votes: {} // { discordUserId: { yellowPercent, purplePercent, dsPercent, userName, updatedAt } }
};

// ─── Voting session cache ────────────────────

let voteSessionCache = {}; // { userId: { yellowPercent: null, purplePercent: null } }


// ─── Save / Load ─────────────────────────────

export function saveSalaryState() {
    try {
        // Backup before overwriting
        runBackup(["./salary-poll-db.json"]);

        fs.writeFileSync(SALARY_DB_PATH, JSON.stringify(salaryState, null, 2));
    } catch (err) {
        console.error("❌ [Salary Poll] Error saving state:", err.message);
    }
}

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
            console.log("✅ [Salary Poll] State loaded successfully.");
        } else {
            console.log("📝 [Salary Poll] New state file created.");
            saveSalaryState();
        }
    } catch (err) {
        console.error("❌ [Salary Poll] Error loading state:", err.message);
    }
}

export function setSalaryChannelId(channelId) {
    salaryState.channelId = channelId;
    saveSalaryState();
}

export function setSalarySpreadsheetId(spreadsheetId) {
    salaryState.spreadsheetId = spreadsheetId;
    saveSalaryState();
}

// ─── Helpers ─────────────────────────────────

/** Normalize a name for comparison: lowercase, trim, strip decorative Unicode chars */
function normalizeName(name) {
    if (!name) return "";
    // Strip decorative/special Unicode character ranges commonly used in Discord/IGN names.
    // These blocks contain symbols, box-drawing, geometric shapes, dingbats, etc.
    // that should not interfere with name matching.
    // Preserves letters (including CJK/Hangul), digits, spaces, and basic ASCII punctuation.
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
    // Get the Monday of this week in Brazil time
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

function buildPollEmbed() {
    const isOpen = salaryState.status === "open";
    const weekRange = getFormattedWeekRange();

    // Count current votes summary
    const voteCount = Object.keys(salaryState.votes).length;
    
    // Aggregate stats
    const yellowCounts = { 0: 0, 25: 0, 50: 0, 75: 0, 100: 0 };
    const purpleCounts = { 0: 0, 25: 0, 50: 0, 75: 0, 100: 0 };
    let totalYellow = 0, totalPurple = 0;

    for (const v of Object.values(salaryState.votes)) {
        if (yellowCounts[v.yellowPercent] !== undefined) yellowCounts[v.yellowPercent]++;
        if (purpleCounts[v.purplePercent] !== undefined) purpleCounts[v.purplePercent]++;
        totalYellow += v.yellowPercent;
        totalPurple += v.purplePercent;
    }

    const avgYellow = voteCount > 0 ? (totalYellow / voteCount) : 0;
    const avgPurple = voteCount > 0 ? (totalPurple / voteCount) : 0;
    const avgDS = 100 - avgYellow - avgPurple;

    // Build bar visualization
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

    // Add stats when there are votes
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

function buildPollActions() {
    if (salaryState.status !== "open") return [];

    const voteBtn = new ButtonBuilder()
        .setCustomId("salary_vote")
        .setLabel("✏️ Vote / Change Vote")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🗳️");

    return [new ActionRowBuilder().addComponents(voteBtn)];
}

// ─── Create or Update Poll Message ───────────

export async function createOrUpdatePollMessage(pingEveryone = false) {
    if (!salaryState.channelId) {
        console.log("❌ [Salary Poll] No channel configured. Use !setsalary first.");
        return false;
    }

    try {
        const channel = await client.channels.fetch(salaryState.channelId).catch(() => null);
        if (!channel) {
            console.error("❌ [Salary Poll] Salary channel not found.");
            return false;
        }

        const embed = buildPollEmbed();
        const components = buildPollActions();

        if (salaryState.messageId) {
            // Try to edit existing message
            try {
                const existingMsg = await channel.messages.fetch(salaryState.messageId).catch(() => null);
                if (existingMsg) {
                    await existingMsg.edit({ embeds: [embed], components });
                    return true;
                }
            } catch (e) {
                // Message deleted or lost — send new one
            }
        }

        // Send new message (ping everyone only when requested, e.g. new poll week or !salarytest)
        const msg = await channel.send({ ...(pingEveryone ? { content: "@everyone" } : {}), embeds: [embed], components });
        salaryState.messageId = msg.id;
        saveSalaryState();
        return true;
    } catch (err) {
        console.error("❌ [Salary Poll] Error creating/updating poll message:", err.message);
        return false;
    }
}

// ─── Open Poll ───────────────────────────────

export async function openPoll() {
    const weekKey = getCurrentWeekKey();

    // Don't re-open if already open for this week
    if (salaryState.currentWeek === weekKey && salaryState.status === "open") {
        console.log(`[Salary Poll] Poll already open for week ${weekKey}`);
        return;
    }

    // Reset votes for new week
    salaryState.currentWeek = weekKey;
    salaryState.votes = {};
    salaryState.status = "open";
    salaryState.pollOpenedAt = new Date().toISOString();

    // Calculate poll close time: Wednesday 13:00 BRT
    const now = new Date();
    const wednesday = new Date(now);
    wednesday.setDate(wednesday.getDate() + ((3 - wednesday.getDay() + 7) % 7));
    wednesday.setHours(13, 0, 0, 0, 0);
    // If today is Wednesday but before 13:00, use today
    if (now.getDay() === 3 && now.getHours() < 13) {
        wednesday.setTime(now.getTime());
        wednesday.setHours(13, 0, 0, 0);
    }
    salaryState.pollClosesAt = wednesday.toISOString();

    saveSalaryState();
    console.log(`📊 [Salary Poll] Poll opened for week ${weekKey}. Closes at ${wednesday.toISOString()}`);

    await createOrUpdatePollMessage(true);
    logEvent(`Salary poll opened for week ${weekKey}`);
}

// ─── Close Poll ──────────────────────────────

export async function closePoll() {
    if (salaryState.status !== "open") {
        console.log("[Salary Poll] No open poll to close.");
        return;
    }

    salaryState.status = "closed";
    saveSalaryState();

    console.log(`📊 [Salary Poll] Poll closed for week ${salaryState.currentWeek}`);

    // Update the message to show closed state
    await createOrUpdatePollMessage();

    // Export to Google Sheets
    if ((salaryState.spreadsheetId || DEFAULT_SPREADSHEET_ID) && Object.keys(salaryState.votes).length > 0) {
        await exportVotesToSheets();
    } else if (!salaryState.spreadsheetId && !DEFAULT_SPREADSHEET_ID) {
        console.log("⚠️ [Salary Poll] No spreadsheet ID configured. Skipping export.");
    } else {
        console.log("📭 [Salary Poll] No votes recorded. Skipping export.");
    }

    logEvent(`Salary poll closed for week ${salaryState.currentWeek}`);
}

// ─── Google Sheets Integration ───────────────

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

export async function exportVotesToSheets() {
    const sheets = await getSheetsClient();
    if (!sheets) {
        console.error("❌ [Salary Poll] Cannot export — Sheets client unavailable.");
        return false;
    }

    const spreadsheetId = salaryState.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) {
        console.error("❌ [Salary Poll] No spreadsheet ID configured.");
        return false;
    }

    try {
        // 1. First, create/ensure a "Salary Poll" sheet exists for raw data
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

        // 2. Write raw poll data to "Salary Poll" sheet
        const headerRow = [
            ["Discord ID", "Discord Name", "% Yellow Stones", "% Purple Stones", "% Darksteel", "Vote Date"]
        ];

        const dataRows = Object.entries(salaryState.votes).map(([userId, vote]) => [
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

        console.log(`✅ [Salary Poll] Exported ${dataRows.length} votes to 'Salary Poll' sheet.`);

        // 3. Try to update the main payment sheet columns J, M, P
        // First, read existing data to find member rows
        await updateMainSheet(sheets, spreadsheetId);

        return true;
    } catch (err) {
        console.error("❌ [Salary Poll] Error exporting to sheets:", err.message);
        return false;
    }
}

async function updateMainSheet(sheets, spreadsheetId) {
    try {
        // Find the PLAYERS sheet specifically
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = sheetMetadata.data.sheets.find(
            s => s.properties.title === "PLAYERS"
        );
        if (!playersSheet) {
            console.log("⚠️ [Salary Poll] PLAYERS sheet not found. Cannot update.");
            return;
        }
        const sheetTitle = playersSheet.properties.title;

        // Read data starting from row 7 (rows 1-6 are headers)
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetTitle}!A7:P`
        });

        const rows = result.data.values;
        if (!rows || rows.length === 0) {
            console.log("⚠️ [Salary Poll] PLAYERS sheet has no data rows. Cannot update.");
            return;
        }

        // Build a lookup: map row numbers to vote data
        // Try matching by: rankedName (registered character) > Discord displayName (column B) > Discord ID
        const batchData = []; // { range, values }
        let updatedCount = 0;

        for (const [userId, vote] of Object.entries(salaryState.votes)) {
            const searchNames = [
                vote.rankedName ? normalizeName(vote.rankedName) : null,  // Registered character name (best match)
                normalizeName(vote.userName),                              // Discord display name
                userId                                                      // Discord user ID (fallback — exact match)
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
                const sheetRow = matchedRow + 7; // data starts at row 7, so offset by 7
                const matchedName = rows[matchedRow][1] || rows[matchedRow][0] || "?";
                batchData.push(
                    { range: `${sheetTitle}!J${sheetRow}`, values: [[vote.dsPercent]] },
                    { range: `${sheetTitle}!N${sheetRow}`, values: [[vote.yellowPercent]] },
                    { range: `${sheetTitle}!Q${sheetRow}`, values: [[vote.purplePercent]] }
                );
                updatedCount++;
                console.log(`✅ [Salary Poll] Matched ${vote.userName} → row ${sheetRow} (${matchedName}): J=${vote.dsPercent}%, N=${vote.yellowPercent}%, Q=${vote.purplePercent}%`);
            } else {
                console.log(`⚠️ [Salary Poll] Could not find ${vote.userName} in PLAYERS sheet. Searched for: ${searchNames.join(", ")}`);
            }
        }

        // Send all updates in a single batch API call
        if (batchData.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: "USER_ENTERED",
                    data: batchData
                }
            });
            console.log(`✅ [Salary Poll] PLAYERS sheet: updated ${updatedCount} member(s) (${batchData.length} cells written).`);
        }

        if (updatedCount < Object.keys(salaryState.votes).length) {
            console.log(`⚠️ [Salary Poll] ${Object.keys(salaryState.votes).length - updatedCount} member(s) could not be matched in PLAYERS sheet.`);
        }

    } catch (err) {
        console.error("❌ [Salary Poll] Error updating PLAYERS sheet:", err.message);
    }
}

// ─── Handle Vote Button ─────────────────────

export async function handleVoteButton(interaction) {
    if (salaryState.status !== "open") {
        return await interaction.reply({
            content: "❌ The poll is currently closed. Wait for next Monday at 12:30 (BRT)!",
            flags: 64
        }).catch(() => {});
    }

    const userId = interaction.user.id;
    // If user is a pilot, use owner's vote as current
    let currentVote = salaryState.votes[userId];
    if (!currentVote && rankingDb && rankingDb.users) {
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) {
                currentVote = salaryState.votes[uid] || null;
                break;
            }
        }
    }

    // Reset session cache
    voteSessionCache[userId] = {
        yellowPercent: currentVote ? currentVote.yellowPercent : null,
        purplePercent: currentVote ? currentVote.purplePercent : null
    };

    // Build percentage options for select menus
    const percentOptions = PERCENT_OPTIONS.map(p => ({
        label: p === 0 ? "0% — No stones" : `${p}%`,
        value: String(p),
        emoji: p === 0 ? "🚫" : p <= 50 ? "🔸" : "🔶"
    }));

    // Yellow stone select
    const yellowSelect = new StringSelectMenuBuilder()
        .setCustomId(`salary_yellow_${userId}`)
        .setPlaceholder("🎨 Choose % of Yellow Stones")
        .addOptions(percentOptions);

    // Purple stone select
    const purpleSelect = new StringSelectMenuBuilder()
        .setCustomId(`salary_purple_${userId}`)
        .setPlaceholder("🟣 Choose % of Purple Stones")
        .addOptions(percentOptions);

    // Confirm and Cancel buttons
    const confirmBtn = new ButtonBuilder()
        .setCustomId(`salary_confirm_${userId}`)
        .setLabel("✅ Confirm Vote")
        .setStyle(ButtonStyle.Success);

    const cancelBtn = new ButtonBuilder()
        .setCustomId(`salary_cancel_${userId}`)
        .setLabel("❌ Cancel")
        .setStyle(ButtonStyle.Secondary);

    // Build embed showing current selection
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
        flags: 64 // ephemeral
    }).catch(() => {});
}

// ─── Handle Select Menu ──────────────────────

export async function handleSalarySelect(interaction) {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const value = parseInt(interaction.values[0], 10);

    // Initialize session if needed
    if (!voteSessionCache[userId]) {
        voteSessionCache[userId] = { yellowPercent: null, purplePercent: null };
    }

    if (customId.startsWith("salary_yellow_")) {
        voteSessionCache[userId].yellowPercent = value;
    } else if (customId.startsWith("salary_purple_")) {
        voteSessionCache[userId].purplePercent = value;
    }

    // Calculate DS
    const yellowPct = voteSessionCache[userId].yellowPercent || 0;
    const purplePct = voteSessionCache[userId].purplePercent || 0;
    const dsPct = Math.max(0, 100 - yellowPct - purplePct);

    // Update the embed with current selections
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setFields(
            { name: "📌 Rules", value: "The total (%) of Yellow Stones + Purple Stones cannot exceed **100%**.\nThe remainder will be automatically converted to ⚪ **Darksteel**." }
        );

    // Find and update the description with current selections
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

export async function handleSalaryConfirm(interaction) {
    const userId = interaction.user.id;
    const session = voteSessionCache[userId];

    if (!session || session.yellowPercent === null || session.purplePercent === null) {
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

    // Determine the effective user — if voter is a pilot, use the owner's identity
    let effectiveUserId = userId;
    let effectiveName = interaction.member?.displayName || interaction.user.username;
    let rankedName = null;

    if (rankingDb && rankingDb.users) {
        // Check if this user is a pilot — find the owner
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
            // Pilot is voting — use owner's identity
            effectiveUserId = ownerId;
            effectiveName = ownerData.nickname || ownerData.characterName || effectiveName;
            rankedName = ownerData.nickname || ownerData.characterName || null;
        } else {
            // Regular user (not a pilot)
            const userData = rankingDb.users[userId];
            if (userData) {
                rankedName = userData.nickname || userData.characterName || null;
            }
        }
    }

    // Save vote under the effective user (owner if pilot, otherwise the voter)
    salaryState.votes[effectiveUserId] = {
        yellowPercent: session.yellowPercent,
        purplePercent: session.purplePercent,
        dsPercent: dsPercent,
        userName: effectiveName,
        rankedName: rankedName,
        updatedAt: new Date().toISOString()
    };

    saveSalaryState();

    // Clean up session
    delete voteSessionCache[userId];

    // Update the main poll message
    await createOrUpdatePollMessage();

    // Sync to Google Sheets in real-time (fire-and-forget, don't block interaction response)
    syncSingleVoteToSheet(effectiveUserId, salaryState.votes[effectiveUserId]).catch(() => {});

    // Reply success
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

    // Monday 12:30 BRT — Open poll
    const openTask = cron.schedule("30 12 * * 1", async () => {
        console.log("⏰ [Salary Poll] Cron: Opening poll (Monday 12:30 BRT)...");
        await openPoll();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(openTask);
    console.log("📅 [Salary Poll] Cron: Poll opens Monday 12:30 BRT");

    // Wednesday 13:00 BRT — Close poll
    const closeTask = cron.schedule("0 13 * * 3", async () => {
        console.log("⏰ [Salary Poll] Cron: Closing poll (Wednesday 13:00 BRT)...");
        await closePoll();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(closeTask);
    console.log("📅 [Salary Poll] Cron: Poll closes Wednesday 13:00 BRT");

    // Wednesday 16:00 BRT — Post salary report
    const reportTask = cron.schedule("0 16 * * 3", async () => {
        console.log("⏰ [Salary Poll] Cron: Posting salary report (Wednesday 16:00 BRT)...");
        await postSalaryReport();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(reportTask);
    console.log("📅 [Salary Poll] Cron: Salary report Wednesday 16:00 BRT");

    // Friday 13:00 BRT — Reset all votes to 100% Darksteel / 0% stones
    const resetTask = cron.schedule("0 13 * * 5", async () => {
        console.log("⏰ [Salary Poll] Cron: Resetting votes to default (Friday 13:00 BRT)...");
        await resetVotesToDefault();
    }, {
        scheduled: true,
        timezone: TIMEZONE
    });
    cronTasks.push(resetTask);
    console.log("📅 [Salary Poll] Cron: Votes reset to 100% DS Friday 13:00 BRT");

    // Also check on startup — if it's between Monday 12:30 and Wednesday 13:00, open the poll
    checkAndRestorePollOnBoot();

    console.log("📅 [Salary Poll] Cron scheduling initialized.");
}

// ─── Reset Votes to Default ─────────────────

/**
 * Resets all votes to 100% Darksteel and 0% for stones.
 * Runs automatically every Friday 13:00 BRT.
 */
export async function resetVotesToDefault() {
    const voteCount = Object.keys(salaryState.votes).length;
    if (voteCount === 0) {
        console.log("📭 [Salary Poll] No votes to reset.");
        return;
    }

    const now = new Date().toISOString();
    for (const userId of Object.keys(salaryState.votes)) {
        const vote = salaryState.votes[userId];
        vote.yellowPercent = 0;
        vote.purplePercent = 0;
        vote.dsPercent = 100;
        vote.updatedAt = now;
    }

    saveSalaryState();
    console.log(`✅ [Salary Poll] Reset ${voteCount} vote(s) to 100% Darksteel / 0% stones.`);
    logEvent(`Salary votes reset to default (${voteCount} members) — 100% DS`);
    // NOTE: exportVotesToSheets() NÃO é chamado aqui porque a planilha já foi exportada
    // na Quarta-feira (closePoll) com os dados CORRETOS. Esse reset é apenas para
    // preparar o estado local para a próxima enquete.
}


// ─── Startup recovery ────────────────────────

async function checkAndRestorePollOnBoot() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentTimeMinutes = hour * 60 + minute;

    const mondayOpen = 12 * 60 + 30;  // Monday 12:30
    const wednesdayClose = 13 * 60;   // Wednesday 13:00

    let shouldBeOpen = false;

    if (day === 1 && currentTimeMinutes >= mondayOpen) {
        // Monday after 12:30
        shouldBeOpen = true;
    } else if (day === 2) {
        // Tuesday — all day
        shouldBeOpen = true;
    } else if (day === 3 && currentTimeMinutes < wednesdayClose) {
        // Wednesday before 13:00
        shouldBeOpen = true;
    }

    const weekKey = getCurrentWeekKey();

    if (shouldBeOpen) {
        if (salaryState.currentWeek !== weekKey || salaryState.status !== "open") {
            console.log(`🔄 [Salary Poll] Boot: Restoring poll for week ${weekKey}...`);
            await openPoll();
        } else {
            console.log(`🔄 [Salary Poll] Boot: Poll already open for week ${weekKey}, refreshing message.`);
            await createOrUpdatePollMessage();
        }
    } else if (salaryState.status === "open") {
        // Poll should be closed (past Wednesday 13:00 or before Monday 12:30)
        if (day > 3 || (day === 3 && currentTimeMinutes >= wednesdayClose) || day === 0) {
            console.log(`🔄 [Salary Poll] Boot: Closing expired poll...`);
            await closePoll();
        }
    }
}

// ─── Real-time vote sync ─────────────────────

async function syncSingleVoteToSheet(userId, vote) {
    const spreadsheetId = salaryState.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) return;

    const sheets = await getSheetsClient();
    if (!sheets) return;

    try {
        // 1. Ensure "Salary Poll" sheet exists
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
            // Add header row to new sheet
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: "Salary Poll!A1:F1",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [["Discord ID", "Discord Name", "% Yellow Stones", "% Purple Stones", "% Darksteel", "Vote Date"]]
                }
            });
        }

        // 2. Update/insert user's row in "Salary Poll" sheet
        // Read existing data to find if user already has a row
        const existingData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "Salary Poll!A:A"
        });

        const existingRows = existingData.data.values || [];
        let userRow = -1;
        for (let i = 0; i < existingRows.length; i++) {
            if (existingRows[i][0] === userId) {
                userRow = i + 1; // 1-based
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
            // Update existing row
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Salary Poll!A${userRow}:F${userRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: rowData }
            });
        } else {
            // Append new row
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: "Salary Poll!A:F",
                valueInputOption: "USER_ENTERED",
                insertDataOption: "INSERT_ROWS",
                requestBody: { values: rowData }
            });
        }

        // 3. Update the main payment sheet (single user)
        await updateSingleUserInMainSheet(sheets, spreadsheetId, userId, vote);

        console.log(`✅ [Salary Poll] Real-time: synced ${vote.userName} to spreadsheet.`);
    } catch (err) {
        console.error(`❌ [Salary Poll] Real-time sync error for ${vote.userName}:`, err.message);
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

        // Read data starting from row 7 (column B has names)
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
            const rowName = normalizeName(rows[i][1] || ""); // Column B = index 1

            for (const searchName of searchNames) {
                if (rowName === searchName) {
                    const sheetRow = i + 7; // data starts at row 7
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

/**
 * Post organized salary report to the salary channel.
 * Reads PLAYERS sheet columns L (DS qty), N (Y qty), O (Y pts), Q (P qty), R (P pts)
 * and builds a formatted table with percentages + quantities + points.
 */
export async function postSalaryReport() {
    const channelId = salaryState.channelId;
    if (!channelId) {
        console.log("❌ [Salary Report] No channel configured.");
        return;
    }

    const voteEntries = Object.entries(salaryState.votes);
    if (voteEntries.length === 0) {
        console.log("📭 [Salary Report] No votes to report.");
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            await channel.send({ content: "📭 **Salary Report:** No votes recorded this week." }).catch(() => {});
        }
        return;
    }

    const spreadsheetId = salaryState.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) {
        console.log("❌ [Salary Report] No spreadsheet ID.");
        return;
    }

    const sheets = await getSheetsClient();
    if (!sheets) return;

    try {
        // Find PLAYERS sheet
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = sheetMetadata.data.sheets.find(
            s => s.properties.title === "PLAYERS"
        );
        if (!playersSheet) {
            console.log("⚠️ [Salary Report] PLAYERS sheet not found.");
            return;
        }
        const sheetTitle = playersSheet.properties.title;

        // Read columns B (name) through R — data starts at row 7
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetTitle}!B7:S`
        });

        const rows = result.data.values;
        if (!rows || rows.length === 0) {
            console.log("⚠️ [Salary Report] No data in PLAYERS sheet.");
            return;
        }

        // Column indices when reading from B7:R: B=0, C=1, ..., J=8, K=9, L=10, N=12, O=13, Q=15, R=16
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
                const rowName = normalizeName(rows[i][0] || ""); // Column B = index 0
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
                // Read percentages from spreadsheet columns (J=DS%, N=Yellow%, Q=Purple%)
                // with fallback to in-memory vote data (which is still correct at this point).
                // Column indices when reading from B7:S: B=0, J=8, N=12, Q=15
                reportData.push({
                    userId: userId,
                    name: row[0] || vote.userName,
                    dsPercent: row[8] !== undefined && row[8] !== null ? Number(row[8]) : vote.dsPercent,
                    dsQty: row[11] || "—",   // Column M
                    yellowPercent: row[12] !== undefined && row[12] !== null ? Number(row[12]) : vote.yellowPercent,
                    yellowQty: row[13] || "—", // Column O
                    yellowPts: row[14] || "—", // Column P
                    purplePercent: row[15] !== undefined && row[15] !== null ? Number(row[15]) : vote.purplePercent,
                    purpleQty: row[16] || "—", // Column R
                    purplePts: row[17] || "—", // Column S
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
            console.error("❌ [Salary Report] Channel not found.");
            return;
        }

        // Send a single message with a "Check Your Salary" button
        const reportEmbed = new EmbedBuilder()
            .setTitle("📊 Salary Report Ready!")
            .setColor("#57F287")
            .setDescription(
                `**Week:** ${weekRange}\n\n` +
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
            .setCustomId("salary_check")
            .setLabel("🔍 Check Your Salary")
            .setStyle(ButtonStyle.Primary);

        await channel.send({
            content: "@everyone",
            embeds: [reportEmbed],
            components: [new ActionRowBuilder().addComponents(checkBtn)]
        });

        console.log(`✅ [Salary Report] Posted report message with button for ${reportData.length} members (${unmatchedCount} unmatched).`);
        logEvent(`Salary report posted for week ${salaryState.currentWeek} (${reportData.length} members)`);

    } catch (err) {
        console.error("❌ [Salary Report] Error:", err.message);
    }
}

// ─── Shared: Build salary breakdown response ──

/**
 * Fetch salary data from spreadsheet and build an embed + refresh button.
 * Returns { embeds, components, content } or null if user didn't vote.
 */
async function buildSalaryBreakdownResponse(interaction) {
    const userId = interaction.user.id;
    const userVote = salaryState.votes[userId];

    // If user is a pilot, check owner's vote instead
    let checkUserId = userId;
    let checkVote = userVote;
    if (!checkVote && rankingDb && rankingDb.users) {
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) {
                checkUserId = uid;
                checkVote = salaryState.votes[uid] || null;
                break;
            }
        }
    }

    const finalVote = checkVote || userVote;
    if (!finalVote) return null;

    // Always fetch fresh data from the spreadsheet
    let userData = null;
    try {
        const spreadsheetId = salaryState.spreadsheetId || DEFAULT_SPREADSHEET_ID;
        if (!spreadsheetId) throw new Error("No spreadsheet ID");

        const sheets = await getSheetsClient();
        if (!sheets) throw new Error("No sheets client");

        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = meta.data.sheets.find(s => s.properties.title === "PLAYERS");
        if (!playersSheet) throw new Error("PLAYERS sheet not found");            const result = await sheets.spreadsheets.values.get({
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
                    // Read percentages from spreadsheet (columns J, N, Q) which were
                    // exported when the poll closed on Wednesday. Fall back to in-memory
                    // vote data if spreadsheet cells are empty.
                    // Column indices when reading from B7:S: B=0, J=8, N=12, Q=15
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
        console.error("❌ [Salary Check] Error fetching data from spreadsheet:", err.message);
    }

    // Fallback to vote-only data if spreadsheet fetch fails
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
        .setTitle("📊 Your Salary Breakdown")
        .setColor("#57F287")
        .setDescription(`**Week:** ${weekRange}\n**👤 ${playerName}**`)
        .addFields(
            { name: "⚪ Darksteel", value: `**${userData.dsPercent}%** — ${userData.dsQty}`, inline: true },
            { name: "🎨 Yellow Stones", value: `**${userData.yellowPercent}%** — ${userData.yellowQty} units | **${userData.yellowPts}** pts`, inline: true },
            { name: "🟣 Purple Stones", value: `**${userData.purplePercent}%** — ${userData.purpleQty} units | **${userData.purplePts}** pts`, inline: true }
        )
        .setFooter({ text: `Salary Report — ${weekRange}` })
        .setTimestamp();

    const refreshBtn = new ButtonBuilder()
        .setCustomId("salary_refresh")
        .setLabel("🔄 Refresh")
        .setStyle(ButtonStyle.Secondary);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(refreshBtn)],
        flags: 64
    };
}

// ─── Handle Salary Check Button (from report message) ─

export async function handleSalaryCheckButton(interaction) {
    const response = await buildSalaryBreakdownResponse(interaction);
    if (!response) {
        return await interaction.reply({
            content: "❌ You didn't vote in this week's salary poll. Wait for next **Monday 12:30 BRT** to participate!",
            flags: 64
        }).catch(() => {});
    }
    return await interaction.reply(response).catch(() => {});
}

// ─── Handle Salary Refresh Button (from ephemeral response) ─

export async function handleSalaryCheckRefresh(interaction) {
    // Only the original user can refresh their own breakdown
    const response = await buildSalaryBreakdownResponse(interaction);
    if (!response) {
        return await interaction.update({
            content: "❌ You didn't vote in this week's salary poll.",
            embeds: [],
            components: []
        }).catch(() => {});
    }
    return await interaction.update(response).catch(() => {});
}

// ─── Manual force-export ─────────────────────

export async function forceExportToSheets() {
    const sid = salaryState.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!sid) {
        return { success: false, message: "❌ No spreadsheet configured. Use !salaryspreadsheet <ID> first." };
    }
    if (Object.keys(salaryState.votes).length === 0) {
        return { success: false, message: "📭 No votes recorded to export." };
    }
    await exportVotesToSheets();
    return { success: true, message: `✅ Exported ${Object.keys(salaryState.votes).length} votes to the spreadsheet.` };
}

// ─── Expose state for other modules ──────────

export function getSalaryState() {
    return salaryState;
}
