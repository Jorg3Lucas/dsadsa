// ==========================================
// 🛠️ SHARED UTILITIES
// ==========================================
import { getMsg } from '../lang/lang.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';
import { assignClanRole, assignTempRole } from './clan-roles.js';

/**
 * Assign the membership role to a verified player.
 * The bot manages a single fixed member role (MEMBER_ROLE_ID) and never
 * creates roles — registering users just get that role granted.
 */
export async function assignMemberRole(targetMember, db, logEvent) {
    const assigned = await assignClanRole(targetMember, db, logEvent);
    if (!assigned) {
        await assignTempRole(targetMember, db, null, logEvent);
    }
    logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: targetMember.user.username }));
}

/**
 * Find the registration that already uses a character name (case-insensitive,
 * NFC normalized) — optionally ignoring one user id.
 *
 * Used by every registration path (owner modal, nickname suggestions, admin
 * approval) so a name can never be claimed twice, including through the fuzzy
 * suggestion dropdowns (which bypass the check done on the typed name).
 *
 * @param {object} db
 * @param {string} nickname
 * @param {string|null} excludeUserId
 * @returns {[string, object]|null} [userId, userData] when taken
 */
export function findNicknameOwner(db, nickname, excludeUserId = null) {
    const target = String(nickname || '').trim().normalize('NFC').toLowerCase();
    if (!target) return null;
    for (const [id, data] of Object.entries(db?.users || {})) {
        if (id === excludeUserId) continue;
        if (!data || !data.nickname) continue;
        if (data.nickname.trim().normalize('NFC').toLowerCase() === target) return [id, data];
    }
    return null;
}

/**
 * Remove a user from every owner's `pilotIds` list.
 *
 * Pilot links are plain id arrays, so removing a member (leave / /manualremove)
 * used to leave ghost entries behind: they counted against the 4-pilot limit and
 * made the ex-pilot look "already linked" if they ever rejoined.
 *
 * @returns {number} number of links removed
 */
export function unlinkPilot(db, pilotId) {
    let removed = 0;
    for (const data of Object.values(db?.users || {})) {
        if (!data || !Array.isArray(data.pilotIds)) continue;
        const before = data.pilotIds.length;
        data.pilotIds = data.pilotIds.filter(id => id !== pilotId);
        removed += before - data.pilotIds.length;
    }
    return removed;
}

/**
 * Build a server-prefixed nickname for a registered player.
 * Looks up the player's character name in the ranking cache to find their server,
 * then prefixes the nickname with the server name.
 *
 * Examples:
 *   buildPrefixedNickname('PlayerOne', db)          → 'EU021 - PlayerOne'
 *   buildPrefixedNickname('PlayerOne', db, 'Pilot') → 'EU021 - PlayerOne - Pilot'
 *
 * If the player is not found in the ranking cache, returns the nickname without prefix.
 *
 * @param {string} nickname - The base in-game character name (or owner nickname for pilots)
 * @param {object} db - The database object (for allied clan config, etc.)
 * @param {string} [suffix=''] - Optional suffix like 'Pilot'
 * @returns {string} The prefixed nickname
 */
export function buildPrefixedNickname(nickname, db, suffix = '', precomputedLookup = null) {
    // Hot path: the sync engine already resolved this nickname against the ranking
    // cache for role management. Passing that lookup in avoids a second
    // getLocalRankingCache() + lookupNickname() per member.
    let lookup = precomputedLookup;
    if (!lookup) {
        const cache = getLocalRankingCache();
        if (!cache) {
            return suffix ? `${nickname} - ${suffix}` : nickname;
        }
        lookup = lookupNickname(nickname, db, cache);
    }
    const prefix = lookup.found && lookup.serverName ? `${lookup.serverName} - ` : '';

    if (suffix) {
        return `${prefix}${nickname} - ${suffix}`;
    }
    return `${prefix}${nickname}`;
}
