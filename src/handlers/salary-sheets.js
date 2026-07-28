// ==========================================
// 📊 SALARY — Google Sheets Integration
// Export, Sync, Report helpers
// Extracted from salary-poll.js
// ==========================================

import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { getSalaryState, formatDate, normalizeName } from "./salary-state.js";

const GOOGLE_CREDENTIALS_PATH = path.resolve("./google_credentials.json");
const DEFAULT_SPREADSHEET_ID = "1ePa0Ws55-KrJpFUELebuPOJqfT8dfx1IJc1g9Dt8vPo";

// ─── Sheets Client ──────────────────────────

async function getSheetsClient() {
    try {
        const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf8"));
        const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
        return google.sheets({ version: "v4", auth });
    } catch (err) {
        console.error("❌ [Salary Sheets] Error creating client:", err.message);
        return null;
    }
}

// ─── Find Player Row Index ──────────────────

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

// ─── Export All Votes to Sheets ─────────────

/** Export all votes to the Salary Poll sheet and update PLAYERS. @returns {Promise<boolean>} Success */
export async function exportVotesToSheets() {
    const sheets = await getSheetsClient();
    if (!sheets) return false;

    const state = getSalaryState();
    const spreadsheetId = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) { console.error("❌ [Salary Sheets] No spreadsheet ID."); return false; }

    try {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetExists = spreadsheet.data.sheets.some(s => s.properties.title === "Salary Poll");
        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: "Salary Poll" } } }] } });
        }

        const headerRow = [["Discord ID", "Discord Name", "% Yellow Stones", "% Purple Stones", "% Darksteel", "Vote Date"]];
        const dataRows = Object.entries(state.votes).map(([userId, vote]) => [userId, vote.userName, vote.yellowPercent, vote.purplePercent, vote.dsPercent, formatDate(vote.updatedAt)]);
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: "Salary Poll!A1:F",
            valueInputOption: "USER_ENTERED",
            requestBody: { values: headerRow.concat(dataRows) }
        });
        console.log(`✅ [Salary Sheets] Exported ${dataRows.length} votes.`);
        await updateMainSheet(sheets, spreadsheetId);
        return true;
    } catch (err) {
        console.error("❌ [Salary Sheets] Export error:", err.message);
        return false;
    }
}

// ─── Update Main PLAYERS Sheet ──────────────

async function updateMainSheet(sheets, spreadsheetId) {
    try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = meta.data.sheets.find(s => s.properties.title === "PLAYERS");
        if (!playersSheet) { console.log("⚠️ [Salary Sheets] PLAYERS sheet not found."); return; }
        const title = playersSheet.properties.title;

        const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A7:P` });
        const rows = result.data.values;
        if (!rows || rows.length === 0) { console.log("⚠️ [Salary Sheets] PLAYERS has no data rows."); return; }

        const state = getSalaryState();
        const batchData = [];
        let updated = 0;

        for (const [userId, vote] of Object.entries(state.votes)) {
            const matchedRow = findPlayerRowIndex(rows, 1, vote, userId);
            if (matchedRow >= 0) {
                const sr = matchedRow + 7;
                batchData.push(
                    { range: `${title}!J${sr}`, values: [[vote.dsPercent]] },
                    { range: `${title}!N${sr}`, values: [[vote.yellowPercent]] },
                    { range: `${title}!Q${sr}`, values: [[vote.purplePercent]] }
                );
                updated++;
            } else {
                console.log(`⚠️ [Salary Sheets] Could not find ${vote.userName} in PLAYERS.`);
            }
        }
        if (batchData.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: batchData } });
            console.log(`✅ [Salary Sheets] Updated ${updated} member(s) in PLAYERS.`);
        }
    } catch (err) {
        console.error("❌ [Salary Sheets] Main sheet update error:", err.message);
    }
}

// ─── Sync Single Vote to Sheet (real-time) ──

/** Real-time sync a single vote to sheets (fire-and-forget). */
export async function syncSingleVoteToSheet(userId, vote) {
    const state = getSalaryState();
    const spreadsheetId = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!spreadsheetId) return;
    const sheets = await getSheetsClient();
    if (!sheets) return;

    try {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetExists = spreadsheet.data.sheets.some(s => s.properties.title === "Salary Poll");
        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: "Salary Poll" } } }] } });
            await sheets.spreadsheets.values.update({ spreadsheetId, range: "Salary Poll!A1:F1", valueInputOption: "USER_ENTERED", requestBody: { values: [["Discord ID", "Discord Name", "% Yellow Stones", "% Purple Stones", "% Darksteel", "Vote Date"]] } });
        }
        const existingData = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Salary Poll!A:A" });
        const existingRows = existingData.data.values || [];
        let userRow = -1;
        for (let i = 0; i < existingRows.length; i++) { if (existingRows[i][0] === userId) { userRow = i + 1; break; } }
        const rowData = [[userId, vote.userName, vote.yellowPercent, vote.purplePercent, vote.dsPercent, formatDate(vote.updatedAt)]];
        if (userRow > 0) {
            await sheets.spreadsheets.values.update({ spreadsheetId, range: `Salary Poll!A${userRow}:F${userRow}`, valueInputOption: "USER_ENTERED", requestBody: { values: rowData } });
        } else {
            await sheets.spreadsheets.values.append({ spreadsheetId, range: "Salary Poll!A:F", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: rowData } });
        }
        await updateSingleUserInMainSheet(sheets, spreadsheetId, userId, vote);
        console.log(`✅ [Salary Sheets] Real-time: synced ${vote.userName}.`);
    } catch (err) {
        console.error(`❌ [Salary Sheets] Real-time sync error:`, err.message);
    }
}

async function updateSingleUserInMainSheet(sheets, spreadsheetId, userId, vote) {
    try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const playersSheet = meta.data.sheets.find(s => s.properties.title === "PLAYERS");
        if (!playersSheet) return;
        const title = playersSheet.properties.title;
        const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A7:P` });
        const rows = result.data.values;
        if (!rows || rows.length === 0) return;
        const matchedRow = findPlayerRowIndex(rows, 1, vote, userId);
        if (matchedRow >= 0) {
            const sr = matchedRow + 7;
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: [{ range: `${title}!J${sr}`, values: [[vote.dsPercent]] }, { range: `${title}!N${sr}`, values: [[vote.yellowPercent]] }, { range: `${title}!Q${sr}`, values: [[vote.purplePercent]] }] } });
        }
    } catch (err) { /* silent */ }
}

// ─── Manual force-export ─────────────────────

/** Manual force-export of all votes. @returns {Promise<{success: boolean, message: string}>} */
export async function forceExportToSheets() {
    const state = getSalaryState();
    const sid = state.spreadsheetId || DEFAULT_SPREADSHEET_ID;
    if (!sid) return { success: false, message: "❌ No spreadsheet configured." };
    if (Object.keys(state.votes).length === 0) return { success: false, message: "📭 No votes recorded." };
    await exportVotesToSheets();
    return { success: true, message: `✅ Exported ${Object.keys(state.votes).length} votes to spreadsheet.` };
}
