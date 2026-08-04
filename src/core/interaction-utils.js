// ==========================================
// 🛡️ INTERACTION UTILITIES — expired-interaction resilience
// ==========================================
// Helpers to gracefully handle Discord interactions that expire (error 10062)
// or were already acknowledged before slow command handlers finish.

/**
 * Detect an expired / already-acknowledged Discord interaction error (code 10062).
 */
export function isExpiredError(error) {
    if (!error) return false;
    if (typeof error.code === 'number' && error.code === 10062) return true;
    const msg = typeof error.message === 'string' ? error.message : String(error);
    return msg.includes('Unknown interaction') || msg.includes('10062');
}

/**
 * Safely defer an interaction. Returns true when the interaction was deferred
 * (or already acknowledged), false when it is already gone — in which case the
 * caller should skip the remaining work (there is no one to respond to).
 * Note: any acknowledgment failure (expired interaction or transient API error)
 * returns false, so callers abort the handler in both cases.
 */
export async function deferReplySafe(interaction, flags = 64) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferReply({ flags });
        return true;
    } catch (e) {
        if (isExpiredError(e)) {
            console.warn(`⚠️ [Interaction] Skipping ${interaction.customId || interaction.commandName || 'interaction'} — already expired (${e.message})`);
        } else {
            console.warn(`⚠️ [Interaction] deferReply failed: ${e.message}`);
        }
        return false;
    }
}

/**
 * Safely defer a component (button/select menu) interaction update. Returns true
 * when acknowledged, false when the interaction is already gone — in which case
 * the caller should skip the remaining work.
 * Note: any acknowledgment failure (expired interaction or transient API error)
 * returns false, so callers abort the handler in both cases.
 */
export async function deferUpdateSafe(interaction) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferUpdate();
        return true;
    } catch (e) {
        if (isExpiredError(e)) {
            console.warn(`⚠️ [Interaction] Skipping ${interaction.customId || 'component interaction'} — already expired (${e.message})`);
        } else {
            console.warn(`⚠️ [Interaction] deferUpdate failed: ${e.message}`);
        }
        return false;
    }
}
