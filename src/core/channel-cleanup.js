// ==========================================
// 🧹 CHANNEL CLEANUP HELPER
// ==========================================
// Deletes EVERY message in a text channel before fresh panels are posted,
// so channels never accumulate stale panels, duplicates or leftover chatter.
// Bulk-deletes recent messages in batches of 100 and individually deletes
// anything older than 14 days (which Discord forbids bulk-deleting).
// Requires MANAGE_MESSAGES on the bot; degrades gracefully without it.

const MS_14_DAYS = 14 * 24 * 60 * 60 * 1000;

/**
 * Completely clear a text channel.
 * @param {import('discord.js').TextChannel} channel
 * @param {Function} [logEvent]
 * @returns {Promise<number>} Number of messages deleted
 */
export async function clearChannelCompletely(channel, logEvent) {
    if (!channel || typeof channel.messages?.fetch !== 'function') return 0;

    let total = 0;
    try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
            if (!batch || batch.size === 0) break;

            const now = Date.now();
            const recent = batch.filter(m => now - m.createdTimestamp < MS_14_DAYS);
            const old = batch.filter(m => now - m.createdTimestamp >= MS_14_DAYS);

            let progress = 0;
            if (recent.size > 0) {
                const deleted = await channel.bulkDelete(recent, true).catch(() => 0);
                progress += deleted;
            }
            for (const msg of old.values()) {
                const ok = await msg.delete().then(() => true).catch(() => false);
                if (ok) progress++;
            }

            // Nothing could be deleted (e.g. missing MANAGE_MESSAGES) — stop to avoid a loop
            if (progress === 0) {
                if (logEvent) logEvent(`⚠️ [Channel Cleanup] Could not delete messages in #${channel.name} (missing MANAGE_MESSAGES permission?)`);
                break;
            }
            total += progress;
        }
    } catch (e) {
        if (logEvent) logEvent(`⚠️ [Channel Cleanup] Error clearing #${channel.name}: ${e.message}`);
    }

    if (logEvent && total > 0) logEvent(`🧹 [Channel Cleanup] Removed ${total} message(s) from #${channel.name}`);
    return total;
}

/**
 * Best-effort delete of a single message by ID — used to remove a panel's own
 * previously-mapped message before re-posting it, so a failed channel-wide
 * cleanup can never leave an old panel behind next to the new one.
 * @param {import('discord.js').TextChannel} channel
 * @param {string} messageId
 * @returns {Promise<boolean>} True when the message existed and was deleted
 */
export async function deleteMessageIfExists(channel, messageId) {
    if (!channel || !messageId || typeof channel.messages?.fetch !== 'function') return false;
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return false;
    return msg.delete().then(() => true).catch(() => false);
}
