import {
    EmbedBuilder as e
} from "discord.js";
import { getLocalTime, getContinentTime } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { dailyLogs, dailyLogsPath, client } from "./state.js";
import { getContinentLabel } from "./setup-config.js";
import o from "fs";

// ==========================================
// 📝 DAILY LOGS SYSTEM
// ==========================================

export function saveDailyLogs() {
    try {
        o.writeFileSync(dailyLogsPath, JSON.stringify(dailyLogs, null, 2));
    } catch (err) {
        console.error("❌ Error saving daily logs:", err.message);
    }
}

export function pushToDailyLogs(type, user, targetRoom, context = "") {
    let continentDate = getContinentTime();
    let timeStr = continentDate.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }),
        prefix = "📝",
        continentLabel = getContinentLabel();

    if ("CLAIM_START" === type) prefix = getMsg("logs.prefixes.start");
    if ("CLAIM_END" === type) prefix = getMsg("logs.prefixes.end");
    if ("CANCEL" === type) prefix = getMsg("logs.prefixes.cancel");
    if ("QUEUE_JOIN" === type) prefix = getMsg("logs.prefixes.queue");

    dailyLogs.queue.push(`\`[${timeStr} ${continentLabel}]\` ${prefix} **${user}** at *${targetRoom}* ${context ? `(${context})` : ""}`);
    saveDailyLogs();
}

export async function dispatchDailyLogs(isForced = !1) {
    if (!dailyLogs.configChannelId) return !1;
    let channel = await client.channels.fetch(dailyLogs.configChannelId).catch(() => null);
    if (!channel) return !1;

    let queueData = dailyLogs.queue || [],
        dateStr = getLocalTime().toLocaleDateString("en-US", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }),
        embed = new e().setTitle(getMsg("logs.title", {
            date: dateStr
        })).setColor(isForced ? "#0099ff" : "#2b2d31").setTimestamp();

    if (0 === queueData.length) {
        embed.setDescription(getMsg("logs.noActivity"));
        await channel.send({
            embeds: [embed]
        });
        return !0;
    }

    let buffer = "",
        processingFirst = !0;
    for (let logRow of queueData) {
        if ((buffer + logRow).length > 3900) {
            embed.setDescription(buffer);
            await channel.send({
                embeds: [embed]
            });
            buffer = "";
            processingFirst = !1;
        }
        buffer += logRow + "\n";
    }

    if (buffer) {
        let finalEmbed = processingFirst ? embed : new e().setColor(isForced ? "#0099ff" : "#2b2d31").setTimestamp();
        finalEmbed.setDescription(buffer);
        await channel.send({
            embeds: [finalEmbed]
        });
    }

    if (!isForced) {
        dailyLogs.queue = [];
        saveDailyLogs();
    }
    return !0;
}
