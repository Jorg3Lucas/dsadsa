// ==========================================
// 🛠️ SHARED UTILITIES
// ==========================================
import { PermissionFlagsBits } from 'discord.js';
import { MEMBER_ROLE_ID, WORLD_IDS, SERVER_MERGES } from './ranking-constants.js';
import { getMsg } from '../lang/lang.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';

// ==========================================
// 🎭 MEMBER ROLE ASSIGNMENT
// ==========================================
// `roles.add()` REJECTS when Discord refuses the change (missing permission,
// role/member hierarchy, deleted role...). Swallowing that rejection with
// `.catch(() => {})` and then logging "role added" anyway is why an approved
// member can stay without the role in the server while the bot logs say it was
// granted. These helpers report the real Discord error so the failing reason is
// visible in the logs and to the admin who clicked the button.

/** Safe read of GuildMember#manageable (its getter throws if the bot member is unavailable). */
function isUnmanageable(member) {
    try {
        return member?.manageable === false;
    } catch {
        return false;
    }
}

/** Safe read of Role#editable (its getter throws when the bot member is unavailable). */
function isRoleNotEditable(guild) {
    try {
        return guild?.roles?.cache?.get?.(MEMBER_ROLE_ID)?.editable === false;
    } catch {
        return false;
    }
}

/**
 * Turn a failed role mutation into a human-readable reason.
 *
 * Discord only lets a bot manage a member when the BOT's highest role sits above
 * that member's highest role, and only lets it hand out roles that sit below the
 * bot's highest role. Those two hierarchy rules are the usual cause of the
 * "approved but never received the role" reports: everyone else works, but the
 * members who already wear a role at/above the bot's top role (staff, owners,
 * founders) are silently rejected with error 50013.
 *
 * @param {Error} error - Rejection from roles.add()/roles.remove()
 * @param {object} targetMember - The GuildMember the bot tried to edit
 * @param {object} [guild] - The guild (for hierarchy details)
 * @returns {string}
 */
export function describeRoleError(error, targetMember, guild = null) {
    const code = error?.code ?? error?.rawError?.code ?? null;
    const me = guild?.members?.me ?? null;

    switch (code) {
        case 50013: // Missing Permissions
            if (isUnmanageable(targetMember)) {
                return `Missing Permissions (50013): this member's highest role is at or above the bot's highest role, so Discord does not allow the bot to manage them. Move the bot's role above "Member" (or give the role manually).`;
            }
            if (isRoleNotEditable(guild)) {
                return `Missing Permissions (50013): the Member role is above the bot's highest role. Drag the bot's role ABOVE the Member role in Server Settings → Roles.`;
            }
            if (me && typeof me.permissions?.has === 'function' && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return 'Missing Permissions (50013): the bot is missing the "Manage Roles" permission.';
            }
            return 'Missing Permissions (50013): check that the bot has "Manage Roles" and a role above the Member role.';
        case 10011: // Unknown Role
            return `Unknown Role (10011): the Member role ID (${MEMBER_ROLE_ID}) no longer exists in this server — the role was deleted or replaced.`;
        case 10007:
            return 'Unknown Member (10007): the user is no longer in the server.';
        case 10013:
            return 'Unknown User (10013).';
        default:
            return error?.message || String(error);
    }
}

/**
 * Assign the general member role to a verified player and REPORT the outcome.
 *
 * Returns `{ ok: true }` when the member already had the role, when Discord
 * accepted the change, and `{ ok: false, reason }` (with the Discord error code
 * explained in plain language) when the change was refused — so the caller can
 * tell the admin instead of silently claiming success.
 *
 * @param {object} targetMember - The GuildMember to give the role to
 * @param {Function} [logEvent] - Bot log sink
 * @param {object} [guild] - Guild used for hierarchy diagnostics
 * @returns {Promise<{ok: boolean, alreadyHad?: boolean, reason?: string, error?: Error}>}
 */
export async function assignMemberRole(targetMember, logEvent, guild = null) {
    if (!targetMember?.roles) return { ok: false, reason: 'member not available' };
    if (targetMember.roles.cache.has(MEMBER_ROLE_ID)) return { ok: true, alreadyHad: true };

    try {
        await targetMember.roles.add(MEMBER_ROLE_ID);
    } catch (error) {
        const reason = describeRoleError(error, targetMember, guild ?? targetMember.guild ?? null);
        logEvent?.(`❌ [Role] Failed to add the Member role to ${targetMember.user?.tag || targetMember.id} — ${reason}`);
        return { ok: false, reason, error };
    }

    // Log the REAL role name (not a hardcoded "Member"): if the role id ever
    // points to a renamed/recreated role, the log shows exactly what was granted.
    const roleCache = (guild ?? targetMember.guild)?.roles?.cache ?? null;
    const roleName = roleCache?.get?.(MEMBER_ROLE_ID)?.name || 'Member';
    logEvent?.(getMsg('ranking.logs.roleAdded', { clan: roleName, username: targetMember.user.username }));
    return { ok: true, alreadyHad: false };
}

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

/**
 * Sanity-check that the bot can actually hand out the Member role in `guild`.
 * Returns a list of problems (empty when everything is fine), so the startup
 * logs answer "why do some approved members never get the role?" up front.
 *
 * @param {object} guild - The Discord guild
 * @returns {string[]}
 */
export function checkMemberRolePermissions(guild) {
    const problems = [];
    const me = guild?.members?.me ?? null;
    const role = guild?.roles?.cache?.get?.(MEMBER_ROLE_ID) ?? null;

    if (!role) {
        problems.push(`The Member role (${MEMBER_ROLE_ID}) does not exist in this server — approved members can never receive it.`);
        return problems;
    }

    if (!me) {
        problems.push('Could not resolve the bot member in this server — role assignment cannot be validated.');
        return problems;
    }

    if (role.comparePositionTo(me.roles.highest) >= 0) {
        problems.push(`The Member role "${role.name}" (position ${role.position}) is at or above the bot's highest role "${me.roles.highest.name}" (position ${me.roles.highest.position}). Move the bot's role above the Member role.`);
    }

    if (typeof me.permissions?.has === 'function' && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        problems.push('The bot is missing the "Manage Roles" permission.');
    }

    return problems;
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
export function buildPrefixedNickname(nickname, db, suffix = '', precomputedLookup = null) {
    // Hot path: the sync engine already resolved this nickname against the ranking
    // cache for role management. Passing that lookup in avoids a second
    // getLocalRankingCache() (filesystem stat) + lookupNickname() per member.
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

// ==========================================
// 🏷️ NICKNAME NORMALIZATION (base name)
// ==========================================
// A Discord display name carries a server prefix ("EU011 - Name") and, for
// pilots, a " - Pilot" suffix, while the database stores the bare character
// name. The sync engine's pilot auto-link and anti-impostor checks compare the
// two, so BOTH sides must be reduced to the same base key — otherwise a
// prefixed nickname never matches the registered owner and impersonation goes
// undetected.

const PILOT_SUFFIX_RE = /\s+-\s+Pilot$/i;

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Built lazily and defensively: several tests mock ranking-constants.js with a
// partial surface, and Vitest throws when a mocked module lacks a named export,
// so each constant lookup is guarded independently.
function getServerNames() {
    const names = [];
    try {
        for (const n of Object.values(WORLD_IDS || {})) if (n) names.push(n);
    } catch { /* mocked partial module */ }
    try {
        for (const n of Object.keys(SERVER_MERGES || {})) if (n) names.push(n);
    } catch { /* mocked partial module */ }
    return [...new Set(names)].sort((a, b) => b.length - a.length);
}

let serverPrefixRe; // undefined = not built yet
function getServerPrefixRe() {
    if (serverPrefixRe !== undefined) return serverPrefixRe;
    const names = getServerNames();
    serverPrefixRe = names.length
        ? new RegExp(`^(?:${names.map(escapeRegExp).join('|')})\\s*[-–—]\\s*`)
        : null;
    return serverPrefixRe;
}

/** Drop the bot-assigned " - Pilot" suffix (case-insensitive). */
export function stripPilotSuffix(name) {
    return String(name ?? '').trim().normalize('NFC').replace(PILOT_SUFFIX_RE, '').trim();
}

/** Drop a leading known server prefix ("EU011 - ", "ASIA013 - ", ...). */
export function stripServerPrefix(name) {
    const n = String(name ?? '').trim().normalize('NFC');
    const re = getServerPrefixRe();
    return re ? n.replace(re, '') : n;
}

/**
 * Normalize a Discord display name to the base key used for database nicknames:
 * remove the pilot suffix and any known server prefix, then NFC + lowercase.
 * `baseNicknameKey('EU011 - PlayerOne - Pilot')` → `'playerone'`.
 */
export function baseNicknameKey(name) {
    return stripServerPrefix(stripPilotSuffix(name)).trim().normalize('NFC').toLowerCase();
}
