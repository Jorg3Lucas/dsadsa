// ==========================================
// 🛠️ SHARED UTILITIES
// ==========================================
import { getMsg } from '../lang/lang.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';
import { assignClanRole, assignTempRole } from './clan-roles.js';

/**
 * Assign the membership role to a verified player.
 * The fixed member role was removed from the server — clan roles are now the
 * member marker, with the GoW Kids role as fallback for temp/unresolved users.
 */
export async function assignMemberRole(targetMember, db, logEvent) {
    const assigned = await assignClanRole(targetMember, db, logEvent);
    if (!assigned) {
        await assignTempRole(targetMember, db, null, logEvent);
    }
    logEvent(getMsg('ranking.logs.roleAdded', { clan: assigned ? 'Clan' : 'GoW Kids', username: targetMember.user.username }));
}

/**
 * Build a server-prefixed nickname for a registered player.
 * Looks up the player's character name in the ranking cache to find their server,
 * then prefixes the nickname with the server name.
 *
 * Examples:
 *   buildPrefixedNickname('PlayerOne', db)          → 'EU011 - PlayerOne'
 *   buildPrefixedNickname('PlayerOne', db, 'Pilot') → 'EU011 - PlayerOne - Pilot'
 *
 * If the player is not found in the ranking cache, returns the nickname without prefix.
 *
 * @param {string} nickname - The base in-game character name (or owner nickname for pilots)
 * @param {object} db - The database object (for allied clan config, etc.)
 * @param {string} [suffix=''] - Optional suffix like 'Pilot'
 * @returns {string} The prefixed nickname
 */
export function buildPrefixedNickname(nickname, db, suffix = '') {
    const cache = getLocalRankingCache();
    if (!cache) {
        return suffix ? `${nickname} - ${suffix}` : nickname;
    }

    const lookup = lookupNickname(nickname, db, cache);
    const prefix = lookup.found && lookup.serverName ? `${lookup.serverName} - ` : '';

    if (suffix) {
        return `${prefix}${nickname} - ${suffix}`;
    }
    return `${prefix}${nickname}`;
}
