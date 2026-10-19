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
 * Re-emit the Member role's channel permission overwrites so Discord clients
 * re-evaluate which channels the role unlocks.
 *
 * Why this exists: channel visibility is computed on the CLIENT from the
 * member's roles plus the guild's channel overwrites. When a role is granted
 * through the REST API, Discord dispatches GUILD_MEMBER_UPDATE, but a member
 * whose client has not yet cached the (sometimes just-created) role/overwrites
 * keeps the new channels hidden until an admin removes and re-adds the role by
 * hand — exactly the "channels only appear after a manual re-add" symptom.
 * Re-applying the role's CURRENT overwrites re-emits CHANNEL_UPDATE for those
 * channels, forcing every affected client to recompute immediately. Calls are
 * throttled per guild (CHANNEL_REFRESH_MIN_INTERVAL_MS) — pass `{ force: true }`
 * to bypass the throttle.
 *
 * Only channels that actually carry an overwrite for the Member role are
 * touched, and only their existing overwrites are re-applied — NO permission is
 * changed. Best-effort: failures are logged and never block the role grant.
 *
 * @param {object} guild - The Discord guild (may be null/partial)
 * @param {Function} [logEvent] - Bot log sink
 * @returns {Promise<number>} How many channels were refreshed
 */
export async function refreshRoleChannelAccess(guild, logEvent, options = {}) {
    // Throttle: a burst of grants (manual registration, approvals, scans) used to
    // re-emit every channel overwrite once per member. Refreshing at most once per
    // interval per guild keeps the channel list accurate without flooding the API.
    const minInterval = Number.isFinite(options.minIntervalMs)
        ? Math.max(0, options.minIntervalMs)
        : CHANNEL_REFRESH_MIN_INTERVAL_MS;
    const guildKey = guild?.id || 'global';
    const now = Date.now();
    if (options.force !== true && minInterval > 0 && now - (lastChannelRefreshAt.get(guildKey) || 0) < minInterval) {
        return 0;
    }
    lastChannelRefreshAt.set(guildKey, now);

    const targets = [];
    try {
        const channels = guild?.channels?.cache;
        if (!channels?.values) return 0;
        for (const channel of channels.values()) {
            if (!channel?.permissionOverwrites?.cache?.has?.(MEMBER_ROLE_ID)) continue;
            if (typeof channel.permissionOverwrites.set !== 'function') continue;
            targets.push(channel);
        }
    } catch (error) {
        logEvent?.(`⚠️ [Role] Could not inspect channel overwrites: ${error?.message || error}`);
        return 0;
    }

    if (targets.length === 0) return 0;

    let refreshed = 0;
    for (const channel of targets) {
        try {
            // Re-apply the channel's CURRENT overwrites untouched — the goal is to
            // trigger CHANNEL_UPDATE, not to change any permission.
            const payload = channel.permissionOverwrites.cache.map((overwrite) =>
                typeof overwrite?.toJSON === 'function' ? overwrite.toJSON() : overwrite
            );
            await channel.permissionOverwrites.set(payload);
            refreshed++;
        } catch (error) {
            logEvent?.(`⚠️ [Role] Could not refresh channel access on #${channel?.name || channel?.id}: ${describeRoleError(error, null, guild)}`);
        }
    }

    if (refreshed > 0) {
        logEvent?.(`🔄 [Role] Re-emitted channel access on ${refreshed} channel(s) so the member role's channels appear immediately`);
    }
    return refreshed;
}

// ==========================================
// 🔁 HUMAN-LIKE ROLE RE-APPLY (Discord client cache workaround)
// ==========================================
// Some members keep the role on their profile but never see the channels it
// unlocks: their Discord client cached the channel list from before the grant
// and never recomputed it. Removing and re-adding the role by hand always fixes
// it, because the second GUILD_MEMBER_UPDATE carries the role in a state the
// client already knows how to resolve. This helper replays that human action:
// role off, short pause, role back on. It is best-effort and NEVER leaves the
// member without the role — the re-add is retried and, when it still fails, the
// caller is told so an admin can fix it manually.

export const ROLE_REAPPLY_DELAY_MS = 800;

// Same member touched again within this window (a sync right after a manual
// approval, for example) skips the extra role writes — the client already got
// the nudge and Discord would only be re-sent the same update.
export const ROLE_REAPPLY_DEBOUNCE_MS = 30000;
// At most one channel-overwrite re-emit per guild in this window.
export const CHANNEL_REFRESH_MIN_INTERVAL_MS = 15000;

const lastRoleReapplyAt = new Map(); // memberId -> timestamp
const lastChannelRefreshAt = new Map(); // guildId -> timestamp

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reset the in-memory throttles (tests / long-running diagnostics). */
export function clearRoleRefreshThrottles() {
    lastRoleReapplyAt.clear();
    lastChannelRefreshAt.clear();
}

/**
 * Remove and immediately re-add the Member role so the member's Discord client
 * recomputes which channels the role unlocks.
 *
 * Only runs when the member currently HAS the role. Failures removing the role
 * are harmless (the role stays). Failures re-adding it are retried once; when
 * both attempts fail the member is left without the role, so the failure is
 * reported as `ok: false, roleRemoved: true` and logged loudly.
 *
 * @param {object} targetMember - The GuildMember whose role should be re-applied
 * @param {Function} [logEvent] - Bot log sink
 * @param {{delayMs?: number, debounceMs?: number, assumeHasRole?: boolean}} [options] -
 *   `delayMs`/`debounceMs` override the pauses (tests); `assumeHasRole` skips the
 *   cache check for callers that just granted the role (a stale cache entry must
 *   not cancel the nudge)
 * @returns {Promise<{ok: boolean, skipped?: boolean, reason?: string, error?: Error, roleRemoved?: boolean}>}
 */
export async function reapplyMemberRole(targetMember, logEvent, options = {}) {
    if (!targetMember?.roles?.add || !targetMember?.roles?.remove) {
        return { ok: false, reason: 'member not available' };
    }
    const hasRole = options.assumeHasRole === true || targetMember.roles.cache?.has?.(MEMBER_ROLE_ID);
    if (!hasRole) {
        return { ok: false, reason: 'member does not have the Member role' };
    }

    const label = targetMember.user?.tag || targetMember.id;
    const delay = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : ROLE_REAPPLY_DELAY_MS;

    const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : ROLE_REAPPLY_DEBOUNCE_MS;
    const memberKey = targetMember.id || label;
    const now = Date.now();
    if (debounceMs > 0 && now - (lastRoleReapplyAt.get(memberKey) || 0) < debounceMs) {
        return { ok: true, skipped: true };
    }
    lastRoleReapplyAt.set(memberKey, now);

    try {
        await sleep(delay);
        await targetMember.roles.remove(MEMBER_ROLE_ID);
    } catch (error) {
        // The role is still on the member — nothing was lost, just no refresh.
        const reason = describeRoleError(error, targetMember);
        logEvent?.(`⚠️ [Role] Could not re-apply the Member role to ${label} (remove refused) — ${reason}`);
        return { ok: false, reason, error };
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await sleep(delay);
            await targetMember.roles.add(MEMBER_ROLE_ID);
            if (attempt > 1) {
                logEvent?.(`🔁 [Role] Re-added the Member role to ${label} on retry — client cache refreshed`);
            }
            return { ok: true };
        } catch (error) {
            if (attempt === 2) {
                const reason = describeRoleError(error, targetMember);
                logEvent?.(`❌ [Role] FAILED to re-add the Member role to ${label} after removing it — ${reason}. Give the role manually, then run /forcesync.`);
                return { ok: false, reason, error, roleRemoved: true };
            }
        }
    }

    return { ok: false, reason: 'could not re-add the Member role' };
}

/**
 * Assign the general member role to a verified player and REPORT the outcome.
 *
 * Returns `{ ok: true }` when the member already had the role, when Discord
 * accepted the change, and `{ ok: false, reason }` (with the Discord error code
 * explained in plain language) when the change was refused — so the caller can
 * tell the admin instead of silently claiming success.
 *
 * After the role is in place (granted OR already present) the role's channel
 * overwrites are re-emitted by default, so a member whose client missed the
 * original gateway update still sees the newly unlocked channels immediately
 * (see refreshRoleChannelAccess). Bulk callers that grant many roles in a loop
 * should pass `{ refreshChannels: false }` and call refreshRoleChannelAccess
 * once when they are done, instead of one channel update per member.
 *
 * When the role is newly granted (not `alreadyHad`) it is then removed and
 * re-added once — a human-like nudge that forces the member's own Discord client
 * to recompute the channels the role unlocks (see reapplyMemberRole). Bulk
 * callers that grant hundreds of roles in a row should pass
 * `{ reapplyRole: false }` so the extra role writes do not flood the API.
 *
 * @param {object} targetMember - The GuildMember to give the role to
 * @param {Function} [logEvent] - Bot log sink
 * @param {object} [guild] - Guild used for hierarchy diagnostics + channel refresh
 * @param {{refreshChannels?: boolean, reapplyRole?: boolean, reapplyDelayMs?: number}} [options]
 * @returns {Promise<{ok: boolean, alreadyHad?: boolean, reason?: string, error?: Error, channelsRefreshed?: number, reapplied?: boolean}>}
 */
export async function assignMemberRole(targetMember, logEvent, guild = null, options = {}) {
    const resolvedGuild = guild ?? targetMember?.guild ?? null;
    const refreshChannels = options.refreshChannels !== false;
    const reapplyRole = options.reapplyRole !== false;
    if (!targetMember?.roles) return { ok: false, reason: 'member not available' };

    if (targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
        // The member already has the role, so Discord will not re-dispatch a
        // member update. Refresh the channel overwrites anyway, so a client that
        // missed the original update still picks up the role's channels.
        const channelsRefreshed = refreshChannels
            ? await refreshRoleChannelAccess(resolvedGuild, logEvent)
            : 0;
        return { ok: true, alreadyHad: true, channelsRefreshed };
    }

    try {
        await targetMember.roles.add(MEMBER_ROLE_ID);
    } catch (error) {
        const reason = describeRoleError(error, targetMember, resolvedGuild);
        logEvent?.(`❌ [Role] Failed to add the Member role to ${targetMember.user?.tag || targetMember.id} — ${reason}`);
        return { ok: false, reason, error };
    }

    // Log the REAL role name (not a hardcoded "Member"): if the role id ever
    // points to a renamed/recreated role, the log shows exactly what was granted.
    const roleCache = resolvedGuild?.roles?.cache ?? null;
    const roleName = roleCache?.get?.(MEMBER_ROLE_ID)?.name || 'Member';
    logEvent?.(getMsg('ranking.logs.roleAdded', { clan: roleName, username: targetMember.user.username }));

    // Freshly granted role: nudge the member's client with the remove/re-add dance
    // BEFORE re-emitting the channel overwrites, so the last member update the
    // client receives already carries the role.
    let reapplied = false;
    if (reapplyRole) {
        const reapplyOutcome = await reapplyMemberRole(targetMember, logEvent, {
            delayMs: options.reapplyDelayMs,
            debounceMs: options.reapplyDebounceMs,
            assumeHasRole: true
        });
        // Only a role that was actually removed and could not be put back is a
        // failed grant — an unavailable member object or a refused removal leaves
        // the grant intact, so the caller must not report the role as missing.
        if (!reapplyOutcome.ok && reapplyOutcome.roleRemoved) {
            return { ok: false, reason: reapplyOutcome.reason, error: reapplyOutcome.error, alreadyHad: false, channelsRefreshed: 0 };
        }
        reapplied = reapplyOutcome.ok;
    }

    const channelsRefreshed = refreshChannels
        ? await refreshRoleChannelAccess(resolvedGuild, logEvent)
        : 0;

    return { ok: true, alreadyHad: false, channelsRefreshed, reapplied };
}

// Nickname mutation lives in its own dependency-free module (src/core/nickname-utils.js)
// and is re-exported here so existing `import { setMemberNickname } from
// '../core/ranking-utils.js'` callers keep working.
export { describeNicknameError, setMemberNickname } from './nickname-utils.js';

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
