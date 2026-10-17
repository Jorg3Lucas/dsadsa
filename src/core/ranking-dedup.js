// ==========================================
// 🧹 DATABASE DUPLICATE DETECTION
// ==========================================
// A "duplicate" here is the same in-game character registered by more than one
// Discord account (alt accounts, re-registrations, impersonation). The database
// is keyed by Discord id, so duplicate ids are impossible — the collision is on
// the nickname, which is what /cleandb reports and (optionally) cleans up.
//
// Dependency-free on purpose: the whole module is pure data in/out so it can be
// unit-tested without discord.js, the ranking cache or any file system access.

/** Canonical comparison key for a stored nickname (bare character name). */
export function duplicateKey(nickname) {
    return String(nickname ?? '').trim().normalize('NFC').toLowerCase();
}

/** Manual registrations (admin-created or forced) outrank automatic ones. */
function isManual(data) {
    return !!(data?.manual || data?.manualPermanent);
}

function timestamp(value) {
    const ms = Date.parse(value);
    // A missing/unparseable registration date is treated as the NEWEST entry, so
    // any profile with a real date survives over one that never recorded when it
    // was registered.
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * Pick the profile to KEEP within a duplicate group. Rules, in order:
 *   1. manual / manualPermanent wins over an automatic registration;
 *   2. the profile with the most linked pilots wins (removing it would orphan them);
 *   3. the OLDEST registeredAt wins;
 *   4. smallest id wins — deterministic, so the report is stable between runs.
 */
function compareEntries(a, b) {
    const manualDiff = (isManual(b.data) ? 1 : 0) - (isManual(a.data) ? 1 : 0);
    if (manualDiff !== 0) return manualDiff;

    const pilotDiff = ((b.data?.pilotIds?.length) || 0) - ((a.data?.pilotIds?.length) || 0);
    if (pilotDiff !== 0) return pilotDiff;

    const timeDiff = timestamp(a.data?.registeredAt) - timestamp(b.data?.registeredAt);
    if (timeDiff !== 0) return timeDiff;

    return String(a.id).localeCompare(String(b.id));
}

/**
 * Find every nickname owned by 2+ Discord accounts.
 *
 * @param {object} users - `db.users`
 * @returns {Array<{key: string, nickname: string, winner: object, losers: object[], all: string[]}>}
 */
export function findDuplicateGroups(users) {
    const byKey = new Map();
    for (const [id, data] of Object.entries(users || {})) {
        const key = duplicateKey(data?.nickname);
        if (!key) continue; // profiles without a nickname can't collide
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ id, data });
    }

    const groups = [];
    for (const [key, entries] of byKey) {
        if (entries.length < 2) continue;
        const sorted = [...entries].sort(compareEntries);
        const [winner, ...losers] = sorted;
        groups.push({
            key,
            nickname: winner.data?.nickname ?? key,
            winner,
            losers,
            all: entries.map((entry) => entry.id)
        });
    }

    // Stable, human-friendly order for the report.
    groups.sort((a, b) => a.key.localeCompare(b.key));
    return groups;
}

/**
 * Find the account that already owns a nickname (case/whitespace insensitive).
 * @param {object} users - `db.users`
 * @param {string} nickname - Nickname to look up
 * @param {string|null} [exceptId] - Account to ignore (the one being (re)registered)
 * @returns {{id: string, data: object}|null}
 */
export function findNicknameOwner(users, nickname, exceptId = null) {
    const key = duplicateKey(nickname);
    if (!key) return null;
    for (const [id, data] of Object.entries(users || {})) {
        if (id === exceptId) continue;
        if (duplicateKey(data?.nickname) === key) return { id, data };
    }
    return null;
}

/**
 * Drop `memberId` from every owner's `pilotIds`. Used when the member stops being
 * a pilot (leaves the server, self-removes, is manually removed) — a stale id
 * otherwise keeps counting against the owner's pilot cap and blocks re-inviting
 * the same pilot ("already registered").
 *
 * @param {object} users - `db.users`
 * @param {string} memberId - Discord id of the pilot
 * @returns {string[]} Owners that referenced the member
 */
export function unlinkPilotLinks(users, memberId) {
    const unlinking = [];
    for (const [ownerId, data] of Object.entries(users || {})) {
        if (ownerId === memberId) continue;
        if (!Array.isArray(data?.pilotIds) || !data.pilotIds.includes(memberId)) continue;
        data.pilotIds = data.pilotIds.filter((id) => id !== memberId);
        unlinking.push(ownerId);
    }
    return unlinking;
}

/** Owners whose `pilotIds` still reference `memberId`. */
export function ownerReferences(users, memberId) {
    const owners = [];
    for (const [id, data] of Object.entries(users || {})) {
        if (id !== memberId && Array.isArray(data?.pilotIds) && data.pilotIds.includes(memberId)) {
            owners.push(id);
        }
    }
    return owners;
}

/**
 * Remove every duplicate loser from `users`, unlinking it from any owner that
 * referenced it as a pilot and dropping its pending role notes.
 *
 * Mutates `users` in place (the bot's in-memory db) and returns a report of what
 * was removed — the caller decides whether to persist.
 *
 * @param {object} users - `db.users`
 * @param {Array} groups - Output of findDuplicateGroups
 * @param {object} [roleNotify] - `db.roleNotify`
 * @returns {Array<{id: string, nickname: string, keptId: string, unlinkedFrom: string[]}>}
 */
export function applyDuplicateCleanup(users, groups, roleNotify = null) {
    const removed = [];
    for (const group of groups) {
        for (const loser of group.losers) {
            const unlinkedFrom = ownerReferences(users, loser.id);
            for (const ownerId of unlinkedFrom) {
                users[ownerId].pilotIds = users[ownerId].pilotIds.filter((pilotId) => pilotId !== loser.id);
            }
            delete users[loser.id];
            if (roleNotify && Object.prototype.hasOwnProperty.call(roleNotify, loser.id)) {
                delete roleNotify[loser.id];
            }
            removed.push({
                id: loser.id,
                nickname: loser.data?.nickname ?? group.key,
                keptId: group.winner.id,
                unlinkedFrom
            });
        }
    }
    return removed;
}
