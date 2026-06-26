// ==========================================
// 💰 SALARY TEXT COMMANDS
// !setsalary, !salaryspreadsheet, !salaryexport,
// !salarytest, !salaryreport, !salarystatus
// ==========================================

import { EmbedBuilder as e } from "discord.js";
import { getMsg } from "../lang.js";
import { getLocalTime } from "../time-utils.js";
import {
    setSalaryChannelId,
    setSalarySpreadsheetId,
    createOrUpdatePollMessage,
    forceExportToSheets,
    postSalaryReport,
    getSalaryState
} from "../salary-poll.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export async function handleSalaryCommand(msg) {
    const lowerContent = msg.content.toLowerCase().trim();

    if ("!setsalary" === lowerContent) {
        return handleSetSalary(msg);
    }
    if (lowerContent.startsWith("!salaryspreadsheet")) {
        return handleSalarySpreadsheet(msg, lowerContent);
    }
    if (lowerContent.startsWith("!salaryexport")) {
        return handleSalaryExport(msg);
    }
    if ("!salarytest" === lowerContent) {
        return handleSalaryTest(msg);
    }
    if ("!salaryreport" === lowerContent) {
        return handleSalaryReport(msg);
    }
    if ("!salarystatus" === lowerContent) {
        return handleSalaryStatus(msg);
    }

    return false; // not handled
}

// ==========================================
// 📋 SET SALARY CHANNEL
// ==========================================

async function handleSetSalary(msg) {
    if (!msg.member.permissions.has("ManageGuild")) {
        return msg.reply({ content: getMsg("ranking.salary.setupError") }).catch(() => {});
    }
    setSalaryChannelId(msg.channel.id);
    await createOrUpdatePollMessage(true);
    return msg.reply({ content: getMsg("ranking.salary.setupSuccess") }).catch(() => {});
}

// ==========================================
// 📈 SET SALARY SPREADSHEET
// ==========================================

async function handleSalarySpreadsheet(msg, lowerContent) {
    if (!msg.member.permissions.has("ManageGuild")) {
        return msg.reply({ content: getMsg("ranking.salary.spreadsheetError") }).catch(() => {});
    }
    const idMatch = lowerContent.match(/!salaryspreadsheet\s+(\S+)/);
    if (!idMatch) {
        return msg.reply({ content: getMsg("ranking.salary.spreadsheetFormatError") }).catch(() => {});
    }
    setSalarySpreadsheetId(idMatch[1].trim());
    return msg.reply({ content: getMsg("ranking.salary.spreadsheetSuccess") }).catch(() => {});
}

// ==========================================
// 📤 SALARY EXPORT
// ==========================================

async function handleSalaryExport(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {});
    }
    const result = await forceExportToSheets();
    return msg.reply({ content: result.message }).catch(() => {});
}

// ==========================================
// 🧪 SALARY TEST
// ==========================================

async function handleSalaryTest(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {});
    }
    await createOrUpdatePollMessage(true);
    return msg.reply({ content: "✅ Salary poll message sent/updated!" }).catch(() => {});
}

// ==========================================
// 📊 SALARY REPORT
// ==========================================

async function handleSalaryReport(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {});
    }
    await postSalaryReport();
    return msg.reply({ content: "📊 Salary report posted in the salary channel!" }).catch(() => {});
}

// ==========================================
// 📊 SALARY STATUS
// ==========================================

async function handleSalaryStatus(msg) {
    const state = getSalaryState();
    const week = state.currentWeek || "—";
    const status = state.status === "open" ? "🟢 Open" : state.status === "closed" ? "🔴 Closed" : "⚪ Idle";
    const votes = Object.keys(state.votes).length;
    const channelId = state.channelId ? `<#${state.channelId}>` : "❌ Not configured";
    const spreadsheet = state.spreadsheetId || "Default (1ePa0...)";
    const messageId = state.messageId ? "✅ Posted" : "❌ No message";

    // Calculate next events (Brazil time)
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const now = getLocalTime();
    const day = now.getDay();
    const currMin = now.getHours() * 60 + now.getMinutes();

    let nextEvent = "";
    if (day <= 1 && (day < 1 || currMin < 12*60+30)) {
        nextEvent = "📅 Poll opens **Monday 12:30 BRT**";
    } else if (day < 3 || (day === 3 && currMin < 13*60)) {
        nextEvent = "📅 Poll closes **Wednesday 13:00 BRT**";
    } else if (day === 3 && currMin < 16*60) {
        nextEvent = "📅 Salary report **Wednesday 16:00 BRT**";
    } else {
        nextEvent = "📅 Next poll opens **Monday 12:30 BRT**";
    }

    return msg.reply({
        embeds: [new e()
            .setTitle("📊 Salary System Status")
            .setColor(status.includes("Open") ? "#57F287" : "#FEE75C")
            .addFields(
                { name: "📅 Week", value: week, inline: true },
                { name: "🟢 Status", value: status, inline: true },
                { name: "🗳️ Votes", value: String(votes), inline: true },
                { name: "💬 Channel", value: channelId, inline: true },
                { name: "📋 Message", value: messageId, inline: true },
                { name: "📈 Spreadsheet", value: spreadsheet, inline: true },
                { name: "⏰ Next", value: nextEvent, inline: false }
            )
            .setTimestamp()
        ]
    }).catch(() => {});
}
