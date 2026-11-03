import { WORLD_IDS, adminChannelId, resolveServerName } from './ranking-constants.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';
import { isWarLeaveActive } from './war-leave.js';

// ==========================================
// 💡 ALLIED CLAN SUGGESTIONS
// ==========================================
// When several registered members share the same clan and that clan is not in
// the allied list of its server, the bot suggests adding it instead of letting
// the 72h grace expire and stripping everyone's role one by one. The admin
// channel gets one notice per clan per week; /manage → 💡 Clan Suggestions lets
// an admin add them all with a single click.

/**
 * Default number of members a clan needs to be suggested: it is suggested once
 * it holds MORE than this many registered members. Configurable in the panel
 * (`db.config.clanSuggestionMinMembers`).
 */
export const ALLIED_CLAN_SUGGESTION_MIN_MEMBERS = 5;

/** Hard bounds for the configurable threshold. */
const MIN_SUGGESTION_THRESHOLD = 1;
const MAX_SUGGESTION_THRESHOLD = 50;

/**
 * Threshold currently in use: `db.config.clanSuggestionMinMembers` when set
 * (clamped to a sane range), otherwise the default.
 */
export function getAlliedClanSuggestionMinMembers(db) {
    const raw = Number(db?.config?.clanSuggestionMinMembers);
    if (!Number.isFinite(raw)) return ALLIED_CLAN_SUGGESTION_MIN_MEMBERS;
    return Math.min(MAX_SUGGESTION_THRESHOLD, Math.max(MIN_SUGGESTION_THRESHOLD, Math.floor(raw)));
}

/** Do not repeat the same suggestion in the admin channel more often than this. */
const NOTIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many suggestions per channel message (Discord message limit). */
const MAX_NOTIFIED_SUGGESTIONS = 10;

/** Stable throttle key for one clan of one server. */
export function alliedSuggestionKey(worldId, clanName) {
    return `${worldId}::${String(clanName || '').toLowerCase()}`;
}

/**
 * Registered members grouped by (server, clan) for clans that are NOT allied.
 *
 * Only exact ranking-cache matches count — a fuzzy hit can be a different
 * player with a similar name on another server, which must never make the bot
 * recommend allying a random clan. Registrations made through the forum search
 * are skipped too: their character is below the scraped ranking, so its clan is
 * only knowable through a live request per member.
 *
 * @returns {Array<{ worldId: string, worldName: string, clanName: string, count: number, memberIds: string[], key: string }>}
 */
export function findAlliedClanSuggestions(db, cache = getLocalRankingCache()) {
    if (!cache || !db?.users) return [];

    const groups = new Map();

    for (const [userId, data] of Object.entries(db.users)) {
        if (!data || !data.nickname) continue;
        // ManualForce registrations keep the role regardless of clan.
        if (data.manualPermanent) continue;
        // Members away for a war are already handled by the war-leave flow and
        // are often sitting in a clan of the enemy server.
        if (isWarLeaveActive(data)) continue;
        if (data.fromForumSearch) continue;

        const lookup = lookupNickname(data.nickname, db, cache);
        if (!lookup || !lookup.found) continue;
        if (lookup.exactMatch === false) continue; // fuzzy hit — not evidence
        if (lookup.inAlliedClan) continue;
        if (!lookup.worldId || !lookup.clanName) continue;

        const worldId = String(lookup.worldId);
        const key = alliedSuggestionKey(worldId, lookup.clanName);
        const group = groups.get(key) || {
            worldId,
            worldName: resolveServerName(WORLD_IDS[worldId] || `World ${worldId}`),
            clanName: lookup.clanName,
            memberIds: [],
            key
        };
        group.memberIds.push(userId);
        groups.set(key, group);
    }

    return [...groups.values()]
        .filter(group => group.memberIds.length > getAlliedClanSuggestionMinMembers(db))
        .map(group => ({ ...group, count: group.memberIds.length }))
        .sort((a, b) => b.count - a.count || a.worldName.localeCompare(b.worldName) || a.clanName.localeCompare(b.clanName));
}

/**
 * Post the current suggestions in the admin/approval channel.
 *
 * Throttled per clan (NOTIFY_INTERVAL_MS) so a weekly sync does not repeat the
 * same tip, and the throttle is dropped once the clan stops being a suggestion
 * (added as allied, or its members left). Returns how many suggestions were
 * announced.
 */
export async function notifyAlliedClanSuggestions(client, db, saveLocalStorage, logEvent, cache) {
    if (!client || !db) return 0;

    const channelId = db.config?.adminChannelId || adminChannelId;
    if (!channelId) return 0; // no admin channel configured — nothing to do

    const suggestions = findAlliedClanSuggestions(db, cache);

    // Nothing to suggest: keep the throttle map from growing forever.
    if (suggestions.length === 0) {
        if (db.config?.clanSuggestionNotified && Object.keys(db.config.clanSuggestionNotified).length > 0) {
            db.config.clanSuggestionNotified = {};
            saveLocalStorage();
        }
        return 0;
    }

    if (!db.config) db.config = {};
    if (!db.config.clanSuggestionNotified) db.config.clanSuggestionNotified = {};
    const notified = db.config.clanSuggestionNotified;

    const now = Date.now();
    const fresh = suggestions.filter(s => {
        const last = notified[s.key];
        if (!last) return true;
        const lastMs = new Date(last).getTime();
        return Number.isNaN(lastMs) || now - lastMs >= NOTIFY_INTERVAL_MS;
    });
    if (fresh.length === 0) return 0;

    const channel = client.channels?.cache?.get(channelId)
        || await client.channels?.fetch?.(channelId).catch(() => null);
    if (!channel || (channel.isTextBased && !channel.isTextBased())) return 0;

    const listed = fresh.slice(0, MAX_NOTIFIED_SUGGESTIONS);
    const lines = listed.map(s => `• 🌐 **${s.worldName}** — **${s.clanName}** — ${s.count} registered member(s)`);

    const content = `💡 **Allied clan suggestions**\n\n`
        + `These clans have more than ${getAlliedClanSuggestionMinMembers(db)} registered members but are **not** in the allied list of their server:\n\n`
        + `${lines.join('\n')}`
        + (fresh.length > listed.length ? `\n…and ${fresh.length - listed.length} more` : '')
        + `\n\n👉 \`/manage\` → **💡 Clan Suggestions** to add them in one click. The next sync restores the member role for everyone in them.`;

    try {
        await channel.send({ content });
    } catch (error) {
        logEvent(`⚠️ [Clan Suggestions] Could not post the suggestion in <#${channelId}>: ${error.message}`);
        return 0;
    }

    for (const s of listed) notified[s.key] = new Date().toISOString();

    // Drop throttles of clans that are no longer suggestions.
    const liveKeys = new Set(suggestions.map(s => s.key));
    for (const key of Object.keys(notified)) {
        if (!liveKeys.has(key)) delete notified[key];
    }

    saveLocalStorage();
    logEvent(`💡 [Clan Suggestions] ${listed.length} clan(s) suggested in <#${channelId}>: ${listed.map(s => `${s.clanName} (${s.count})`).join(', ')}`);
    return listed.length;
}
