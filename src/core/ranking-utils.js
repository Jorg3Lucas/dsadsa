// ==========================================
// 🛠️ SHARED UTILITIES
// ==========================================
import { MEMBER_ROLE_ID } from './ranking-constants.js';
import { getMsg } from '../lang/lang.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';

/**
 * Assign the general member role to a verified player
 */
export async function assignMemberRole(targetMember, logEvent) {
    if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
        await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: targetMember.user.username }));
    }
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
