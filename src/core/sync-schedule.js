// ==========================================
// ⏰ SYNC SCHEDULE — WHEN the daily sync runs
// ==========================================
// The daily ranking sync runs ONCE per day at a fixed wall-clock time in the
// bot's timezone. This module is the single source of truth for that schedule,
// so the cron (ranking-events.js) and the startup path (index.js) can never
// disagree about when the daily sync is due.
//
// Why this exists: the startup path used to run a full sync on EVERY restart
// (plus the cron), so a bot restarting several times a day scraped the ranking
// and re-evaluated every member several times a day. Now a restart only runs
// the sync when the most recent scheduled run was MISSED — i.e. the bot was
// offline at 20:00 BRT and that day's sync never happened. Restarting after a
// successful sync is a no-op.

/** Timezone the schedule (and the cron) is expressed in. */
export const SYNC_TIME_ZONE = 'America/Sao_Paulo';

/** Wall-clock hour of the daily sync, in SYNC_TIME_ZONE (24h). */
export const SYNC_HOUR = 20;

/** Wall-clock minute of the daily sync, in SYNC_TIME_ZONE. */
export const SYNC_MINUTE = 0;

/**
 * node-cron expression for the daily sync (5 fields: minute hour dom month dow).
 * Derived from the constants above so the cron and the catch-up logic below can
 * never drift apart.
 */
export const SYNC_CRON_EXPRESSION = `${SYNC_MINUTE} ${SYNC_HOUR} * * *`;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Offset (ms) between the given timezone's wall clock and UTC at `instant`:
 * `wallClock = instant + offset`. Computed through Intl so DST rules (past or
 * future) are honoured instead of a hardcoded UTC-3.
 */
function timeZoneOffsetMs(instant, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const parts = {};
    for (const { type, value } of formatter.formatToParts(instant)) parts[type] = value;
    const asUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second)
    );
    // formatToParts only carries whole seconds — floor the instant so the
    // sub-second remainder is not mistaken for an offset shift.
    return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time in `timeZone`
 * (e.g. 2026-10-13 20:00 America/Sao_Paulo → 2026-10-13T23:00:00Z).
 */
function zonedWallClockToInstant(year, month, day, hour, minute, timeZone) {
    const asUtc = Date.UTC(year, month - 1, day, hour, minute);
    // First guess uses the offset at that UTC instant; a DST transition near the
    // boundary would shift it, so re-check once with the offset at the result.
    let instant = asUtc - timeZoneOffsetMs(new Date(asUtc), timeZone);
    instant = asUtc - timeZoneOffsetMs(new Date(instant), timeZone);
    return new Date(instant);
}

/**
 * The most recent moment the daily sync was DUE (today's scheduled time, or
 * yesterday's when today's has not arrived yet). Callers compare a
 * last-successful-sync timestamp against it to decide whether the current daily
 * cycle still needs a run.
 *
 * @param {Date} [now]
 * @returns {Date}
 */
export function getScheduledSyncBoundary(now = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: SYNC_TIME_ZONE,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    const parts = {};
    for (const { type, value } of formatter.formatToParts(now)) parts[type] = value;

    let year = Number(parts.year);
    let month = Number(parts.month);
    let day = Number(parts.day);

    const minutesToday = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
    const scheduledMinutes = SYNC_HOUR * 60 + SYNC_MINUTE;
    if (minutesToday < scheduledMinutes) {
        // Today's scheduled time has not arrived → the last due moment was
        // yesterday's. Date.UTC arithmetic handles month/year rollover.
        const yesterday = new Date(Date.UTC(year, month - 1, day) - DAY_MS);
        year = yesterday.getUTCFullYear();
        month = yesterday.getUTCMonth() + 1;
        day = yesterday.getUTCDate();
    }

    return zonedWallClockToInstant(year, month, day, SYNC_HOUR, SYNC_MINUTE, SYNC_TIME_ZONE);
}

/**
 * True when the startup path must run a catch-up sync: no sync has completed
 * since the last scheduled time (the bot was offline when it was due, or it has
 * never synced). False when the current daily cycle already had a successful
 * sync — so ordinary restarts never trigger an extra sync.
 *
 * @param {string|number|Date|null|undefined} lastSyncAt timestamp of the last
 *   successful sync (db.config.lastSyncAt), or falsy when it never synced.
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldRunStartupSync(lastSyncAt, now = new Date()) {
    if (!lastSyncAt) return true;
    const lastMs = new Date(lastSyncAt).getTime();
    // Unparseable timestamp (corrupt DB field) → behave as "never synced" and
    // run the catch-up rather than silently skipping the day.
    if (Number.isNaN(lastMs)) return true;
    return lastMs < getScheduledSyncBoundary(now).getTime();
}
