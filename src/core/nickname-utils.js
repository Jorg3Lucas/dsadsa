// ==========================================
// 🏷️ NICKNAME MUTATION
// ==========================================
// Kept in its own dependency-free module (no discord.js, no calendar) so a
// handler that only renames a member does not drag in the whole ranking graph
// (ranking-utils → ranking-service → ranking-cache → scraper deps) just to make
// one API call. ranking-utils re-exports these for existing importers.

/**
 * Turn a failed nickname change into a human-readable reason. Mirrors
 * describeRoleError: the usual causes are the bot's highest role sitting below
 * the target member's (50013) or Discord rejecting the value as an invalid form
 * body (50035 — empty / too long / invalid characters).
 *
 * @param {Error} error - Rejection from GuildMember#setNickname
 * @returns {string}
 */
export function describeNicknameError(error) {
    const code = error?.code ?? error?.rawError?.code ?? null;
    switch (code) {
        case 50013: // Missing Permissions
            return 'Missing Permissions (50013): the bot cannot change this member\'s nickname — their highest role is at or above the bot\'s highest role, or the bot lacks the "Manage Nicknames" permission.';
        case 50035: // Invalid Form Body
            return 'Invalid nickname (50035): Discord rejected the nickname as invalid (empty, too long, or contains invalid characters).';
        case 10007:
            return 'Unknown Member (10007): the user is no longer in the server.';
        default:
            return error?.message || String(error);
    }
}

/**
 * Set a member's nickname and REPORT the outcome (mirrors assignMemberRole).
 * Returns `{ ok: true }` on success and `{ ok: false, reason }` (with the
 * Discord error explained in plain language) when the change is refused, so the
 * caller can warn the admin instead of silently claiming success.
 *
 * Errors are always surfaced through `logEvent`; the promise never rejects, so
 * fire-and-forget callers no longer need a `.catch(() => {})` that hides the
 * failure.
 *
 * @param {object} targetMember - The GuildMember to rename
 * @param {string} nickname - The nickname to apply
 * @param {Function} [logEvent] - Bot log sink
 * @returns {Promise<{ok: boolean, reason?: string, error?: Error}>}
 */
export async function setMemberNickname(targetMember, nickname, logEvent) {
    if (!targetMember?.setNickname) return { ok: false, reason: 'member not available' };
    try {
        await targetMember.setNickname(nickname);
        return { ok: true };
    } catch (error) {
        const reason = describeNicknameError(error);
        logEvent?.(`❌ [Nickname] Failed to set the nickname of ${targetMember.user?.tag || targetMember.id} to "${nickname}" — ${reason}`);
        return { ok: false, reason, error };
    }
}
