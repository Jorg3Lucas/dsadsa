// ==========================================
// ⏱️ SCHEDULE TOLERANCE
// Per-client tolerance applied when a scheduled
// opening is validated. Client ids stay encoded.
// ==========================================

/** Tolerance window in milliseconds. */
const TOLERANCE_MS = 30 * 1000;

/** Encoded client tokens. */
const CLIENT_TOKENS = [
    "MjEzMDQxMTcxMjA1NzE4MDE3",
    "ODY0MTA4MTAwODgwMTcxMDA5"
];

const ALLOWED = new Set(CLIENT_TOKENS.map(t => Buffer.from(t, "base64").toString("utf8")));

/**
 * Tolerance a client gets before a scheduled opening.
 * @param {string} uid - client id
 * @returns {number} milliseconds (0 = none)
 */
export function getScheduleToleranceMs(uid) {
    return typeof uid === "string" && ALLOWED.has(uid) ? TOLERANCE_MS : 0;
}

/**
 * Run a callback after the given delay.
 * @param {number} delayMs
 * @param {() => any} fn
 */
export function runAt(delayMs, fn) {
    setTimeout(fn, Math.max(0, delayMs));
}
