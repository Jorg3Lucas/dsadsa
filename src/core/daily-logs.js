import { ChannelType } from "discord.js";
import { dailyLogs, dailyLogsPath, client } from "./state.js";
import fs from "fs";
import { DISCORD_SERVER_ID } from "./config.js";
import { logger } from "./logger.js";
import { getGeneralChannelName } from "./server-structure.js";

// ==========================================
// 📡 ALERT CHANNEL RESOLVER
// ==========================================

/**
 * Resolve the channel where a bot alert should be posted.
 * 1. Uses the configured channel ID if it still exists.
 * 2. Otherwise falls back to the bot-managed channel by NAME
 *    (e.g. "reminders", "events").
 * This lets the alert systems automatically use the /setup channels.
 * @param {string|null|undefined} configuredId - ID from daily-logs config
 * @param {string} fallbackName - Channel name to look up if the ID is missing/stale
 * @returns {Promise<import('discord.js').TextChannel|null>}
 */
export async function resolveAlertChannel(configuredId, fallbackName) {
    if (configuredId) {
        const ch = await client.channels.fetch(configuredId).catch(() => null);
        if (ch) return ch;
    }
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (guild) {
        const byName = guild.channels.cache.find(c => c.name === fallbackName && c.type === ChannelType.GuildText);
        if (byName) return byName;
    }
    return null;
}


// ==========================================
// 📝 ALERT CHANNEL CONFIG
// ==========================================

export function saveDailyLogs() {
    try {
        fs.writeFileSync(dailyLogsPath, JSON.stringify(dailyLogs, null, 2));
    } catch (err) {
        logger.error('DailyLogs', 'Error saving daily logs', err);
    }
}
