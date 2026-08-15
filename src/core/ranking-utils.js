// ==========================================
// 🛠️ SHARED UTILITIES
// ==========================================
import { getMsg } from '../lang/lang.js';
import { assignClanRole } from './clan-roles.js';

/**
 * Assign the membership role to a verified player.
 * The fixed member role was removed from the server — clan roles are now the
 * only member marker (no temporary role).
 */
export async function assignMemberRole(targetMember, db, logEvent) {
    const assigned = await assignClanRole(targetMember, db, logEvent);
    logEvent(getMsg('ranking.logs.roleAdded', { clan: assigned ? 'Clan' : '—', username: targetMember.user.username }));
}

/**
 * Build the nickname for a registered player.
 * No server prefix is added — members keep their plain in-game name.
 *
 * Examples:
 *   buildPrefixedNickname('PlayerOne', db)          → 'PlayerOne'
 *   buildPrefixedNickname('PlayerOne', db, 'Pilot') → 'PlayerOne - Pilot'
 *
 * @param {string} nickname - The base in-game character name (or owner nickname for pilots)
 * @param {object} db - Kept for API compatibility (unused)
 * @param {string} [suffix=''] - Optional suffix like 'Pilot'
 * @returns {string} The nickname
 */
export function buildPrefixedNickname(nickname, db, suffix = '') {
    return suffix ? `${nickname} - ${suffix}` : nickname;
}
