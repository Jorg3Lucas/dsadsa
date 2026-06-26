// ==========================================
// 🔧 SHARED CONSTANTS
// Room/floor status strings, embed colors
// ==========================================

// ─── Room / Floor Status ───────────────────

/** Default free/available status */
export const STATUS_AVAILABLE = "\uD83D\uDFE2 Available";

/** Room is actively claimed by a player */
export const STATUS_CLAIMED = "\uD83D\uDD34 Claimed";

/** Grace period / open for claiming from queue */
export const STATUS_OPEN = "\uD83D\uDFE2 Open";

/** Boss killed label (without trailing space) — for startsWith checks */
export const STATUS_KILLED = "\uD83D\uDD34 Killed at";

/** Boss killed prefix (with trailing space) — for replace() and template literals */
export const STATUS_KILLED_PREFIX = "\uD83D\uDD34 Killed at ";

/** Respawn is about to happen any moment */
export const STATUS_ANY_MOMENT = "\uD83D\uDD34 Any moment...";

/** Respawn just happened (fresh) */
export const STATUS_NOW = "\uD83D\uDFE2 Now";

// ─── Embed Colors ──────────────────────────

/** Occupied floor — Discord Blurple */
export const COLOR_OCCUPIED = "#5865F2";

/** Floor has a queue — Discord Yellow */
export const COLOR_HAS_QUEUE = "#FEE75C";

/** Neutral / default state */
export const COLOR_DEFAULT = "#2b2d31";

/** Room is open / available — Discord Green */
export const COLOR_OPEN = "#57F287";

/** Forced / manual log dispatch */
export const COLOR_FORCED_LOGS = "#0099ff";

/** Event alert banner */
export const COLOR_EVENT_ALERT = "#ff6600";

/** Boss spawn alert banner */
export const COLOR_BOSS_ALERT = "#ff4444";
