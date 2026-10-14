// ==========================================
// 🛡️ IMMUNITY UTILS
// ==========================================
// User IDs that should be ignored by bot penalties
// (cooldowns, claim locks, role removal, etc.).
//
// Add a user_id here when they should be immune to the bot's penalties.

const IMMUNE_USER_IDS = new Set(["1441611106845196481"]);

/**
 * Check whether a Discord user id is immune to bot penalties.
 * @param {string} uid - Discord user id
 * @returns {boolean}
 */
export function isUserImmune(uid) {
    return typeof uid === "string" && IMMUNE_USER_IDS.has(uid);
}
