// ==========================================
// 📈 RUNTIME METRICS
// ==========================================
// Small, dependency-free counters for the things that are invisible from the
// logs until it is too late: REST rate limits and unhandled promise
// rejections. Both are surfaced by /stats and the rejection counter can
// escalate to a controlled restart (see index.js) instead of degrading
// silently.
//
// Everything here is process-local and in-memory on purpose: it is diagnostic
// data, not state that must survive a restart.

// ── REST rate limits ──
let rateLimitCount = 0;
let lastRateLimit = null; // { route, method, global, timeToReset, at }

/**
 * Record one REST rate limit hit (from the client's `rateLimited` event).
 * @param {{route?: string, method?: string, global?: boolean, retryAfter?: number, timeToReset?: number}} [info]
 */
export function recordRateLimit(info = {}) {
    rateLimitCount++;
    // @discordjs/rest calls it `retryAfter`; other emitters use timeToReset/timeout.
    const retryAfter = [info.retryAfter, info.timeToReset, info.timeout].find((v) => Number.isFinite(v));
    lastRateLimit = {
        route: info.route ?? null,
        method: info.method ?? null,
        global: info.global === true,
        retryAfter: retryAfter ?? null,
        at: Date.now()
    };
    return lastRateLimit;
}

// ── Unhandled rejections ──
// A single unhandled rejection is normal noise (a closed DM channel, a
// transient API error). A BURST of them means something systemic is broken, and
// the process is better off restarted by PM2 with a clean session — the same
// reasoning as the gateway watchdog. The window+threshold keep a restart from
// flapping on isolated errors.
export const REJECTION_WINDOW_MS = 60 * 1000;
export const REJECTION_ESCALATION_THRESHOLD = 20;

let unhandledRejectionCount = 0;
const rejectionTimestamps = [];

/**
 * Record one unhandled rejection and report whether the recent burst crossed
 * the escalation threshold.
 *
 * @param {number} [now] - Injectable clock (tests)
 * @returns {boolean} true when the process should be restarted
 */
export function recordUnhandledRejection(now = Date.now()) {
    unhandledRejectionCount++;
    rejectionTimestamps.push(now);
    // Drop timestamps that fell out of the rolling window
    while (rejectionTimestamps.length > 0 && now - rejectionTimestamps[0] > REJECTION_WINDOW_MS) {
        rejectionTimestamps.shift();
    }
    return rejectionTimestamps.length >= REJECTION_ESCALATION_THRESHOLD;
}

// ── Last synchronization run ──
// Timing/volume of the most recent sync. Without this, "the sync feels slow"
// is guesswork: /stats reports the real duration and how many members and role
// writes it took, so a regression shows up before it becomes an outage.
let lastSync = null;

/**
 * Record the outcome of a synchronization run.
 * @param {{durationMs?: number, members?: number, roleWrites?: number}} [info]
 */
export function recordSyncRun(info = {}) {
    lastSync = {
        at: Date.now(),
        durationMs: Number.isFinite(info.durationMs) ? info.durationMs : null,
        members: Number.isFinite(info.members) ? info.members : null,
        roleWrites: Number.isFinite(info.roleWrites) ? info.roleWrites : null
    };
    return lastSync;
}

/**
 * Snapshot of the runtime counters for /stats and diagnostics.
 * @param {number} [now] - Injectable clock (tests)
 */
export function getRuntimeMetrics(now = Date.now()) {
    return {
        rateLimitCount,
        lastRateLimit,
        unhandledRejectionCount,
        recentUnhandledRejections: rejectionTimestamps.filter((t) => now - t <= REJECTION_WINDOW_MS).length,
        lastSync
    };
}

/** Test helper: clear every counter back to a clean process start. */
export function resetRuntimeMetrics() {
    rateLimitCount = 0;
    lastRateLimit = null;
    unhandledRejectionCount = 0;
    rejectionTimestamps.length = 0;
    lastSync = null;
}
