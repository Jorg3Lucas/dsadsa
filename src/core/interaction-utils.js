// ==========================================
// 🛡️ INTERACTION UTILITIES — expired-interaction resilience
// ==========================================
// Helpers to gracefully handle Discord interactions that expire (error 10062)
// or were already acknowledged before slow command handlers finish.

/** Pause between acknowledgement attempts (transient API hiccup). */
export const ACK_RETRY_DELAY_MS = 150;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * Acknowledge an interaction, tolerating ONE transient API failure.
 *
 * Why retry: a single non-10062 error (network blip, 5xx, rate-limit hiccup) used
 * to abort the whole handler, so the user saw "the application did not respond"
 * for an interaction that Discord would still have accepted. The retry is only
 * for errors that do not mean "gone": an expired interaction returns false
 * immediately, and an acknowledgement that actually landed (deferred/replied
 * became true) counts as success.
 *
 * @param {object} interaction - The interaction to acknowledge
 * @param {() => Promise<any>} ack - The acknowledgement call (deferReply/deferUpdate)
 * @param {string} label - Human-readable action name for the logs
 * @param {string} target - customId / commandName for the logs
 * @returns {Promise<boolean>} true when acknowledged, false when it is gone
 */
async function acknowledgeSafely(interaction, ack, label, target) {
    if (interaction.deferred || interaction.replied) return true;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await ack();
            return true;
        } catch (e) {
            if (isExpiredError(e)) {
                console.warn(`⚠️ [Interaction] Skipping ${target} — already expired (${e.message})`);
                return false;
            }
            // The ack may have landed even though the promise rejected.
            if (interaction.deferred || interaction.replied) return true;
            if (attempt === 2) {
                console.warn(`⚠️ [Interaction] ${label} failed for ${target} after retry: ${e.message}`);
                return false;
            }
            console.warn(`⚠️ [Interaction] ${label} failed for ${target} (${e.message}) — retrying once`);
            await sleep(ACK_RETRY_DELAY_MS);
        }
    }

    return false;
}

/**
 * Safely defer a command interaction. Returns true when the interaction was
 * deferred (or already acknowledged), false when it is already gone — in which
 * case the caller should skip the remaining work (there is no one to respond to).
 * Transient (non-expired) failures are retried once before giving up.
 *
 * @param {object} interaction - The interaction to defer
 * @param {number} [flags=64] - Message flags (64 = ephemeral)
 * @returns {Promise<boolean>}
 */
export async function deferReplySafe(interaction, flags = 64) {
    const target = interaction.customId || interaction.commandName || 'interaction';
    return acknowledgeSafely(interaction, () => interaction.deferReply({ flags }), 'deferReply', target);
}

/**
 * Safely defer a component (button/select menu) interaction update. Returns true
 * when acknowledged, false when the interaction is already gone — in which case
 * the caller should skip the remaining work. Transient (non-expired) failures
 * are retried once before giving up.
 *
 * @param {object} interaction - The component interaction to acknowledge
 * @returns {Promise<boolean>}
 */
export async function deferUpdateSafe(interaction) {
    const target = interaction.customId || 'component interaction';
    return acknowledgeSafely(interaction, () => interaction.deferUpdate(), 'deferUpdate', target);
}

/**
 * Safely edit a (deferred) interaction response. Returns the message or null on
 * failure — expired interactions (10062) are swallowed so long-running work such
 * as bulk DM loops is never aborted by a stale interaction.
 */
export async function editReplySafe(interaction, payload) {
    try {
        return await interaction.editReply(payload);
    } catch (e) {
        if (isExpiredError(e)) {
            console.warn(`⚠️ [Interaction] Skipping editReply on ${interaction.customId || interaction.commandName || 'interaction'} — already expired`);
        } else {
            console.warn(`⚠️ [Interaction] editReply failed: ${e.message}`);
        }
        return null;
    }
}
