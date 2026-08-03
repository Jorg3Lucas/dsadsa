// ==========================================
// 🔧 CONSTANTS
// ==========================================

export const confirmationCache = {};

// Pending owner registrations awaiting admin approval
// key: userId, value: { nickname, channelId, messageId, timestamp }
export const pendingRegistrations = {};

// Pending pilot approvals awaiting owner approval via DM
// key: cacheKey, value: { ownerId, pilotId, pilotName, ownerNick, timestamp }
export const pendingPilotApprovals = {};

export let adminChannelId = null;

export function setAdminChannelId(id) {
    adminChannelId = id;
}

export const DISCORD_SERVER_ID = '1432320162278670440';

// ⚠️ LEGACY — the fixed member role was removed from the server. Clan roles
// (db.config.clanRoles) + the GoW Kids temp role are now the member markers.
// Kept only for historical reference / rollback.
export const MEMBER_ROLE_ID = '1503933709756141620';

// Roles that can approve/reject member registrations (in addition to Administrator)
export const APPROVER_ROLE_IDS = [
    '1481568277254639626',
    '1483532193987956817',
    '1500208456945106944',
    '1481568065081573467'
];

// 🌍 WORLDS TO SYNC — only EU11 (world 611)
// The scraper, lookups, allied-clan management and server display
// all derive from this map, so restricting it here limits the whole
// sync pipeline to the EU11 world only.
export const WORLD_IDS = {
    611: "EU011"
};

// ==========================================
// ⏳ PENDING REGISTRATION EXPIRY (24h)
// ==========================================

export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ==========================================
// 📥 SCAN SOURCE SERVER
// ==========================================
// The only Discord server this bot operates on (claim server).
// /scanimport harvests registrations from here.
export const SCAN_SERVER_ID = '1432320162278670440';

// Pre-registrations no longer expire by time — they are validated against the
// EU11 ranking on every sync. Not found in the ranking → removed immediately.
// (PRE_REGISTER_MAX_AGE_MS removed)

// Super admin — only this user can use high-risk commands
export const SUPER_ADMIN_USER_ID = '864108100880171009';

// Channels that must NEVER be deleted by the /nuke command
export const NUKE_PROTECTED_CHANNEL_IDS = [
    '1432320163033645136'
];

// ==========================================
// 📋 WELCOME PANEL MESSAGE
// ==========================================

export const WELCOME_PANEL_MESSAGE = '📋 **MIR4 Account Registration**\n\n⚠️ **Register only ONE account** — use your exact in-game character name!\n\nClick the buttons below to register your main account or as a pilot.\n\n👑 **Register as Owner** — Register your main character.\n✈️ **Register as Pilot** — Register as a pilot for an existing owner.\n\nAfter approval by an administrator, you will receive your **clan role** (and your in-game nickname). Temporary approvals receive the **GoW Kids** role until they join an allied clan.\n\n━━━━━━━━━━━━━━━━━━━━━━\n🤖 Bot developed by <@864108100880171009>';

// ==========================================
// 📢 REGISTRATION CHANNEL (for /listunregistered DMs)
// ==========================================
// Dynamic — the /setup command updates these when it (re)creates the channels.
// Defaults are kept as fallbacks until a /setup run persists new IDs.

export let REGISTRATION_CHANNEL_ID = '1524296969521070120';

export function setRegistrationChannelId(id) { REGISTRATION_CHANNEL_ID = id; }

/**
 * Load persisted channel IDs from db.config (saved by /setup).
 * Call this at boot after ensureConfig.
 */
export function loadChannelIdsFromConfig(config) {
    if (!config?.channelIds) return;
    if (config.channelIds.registration) setRegistrationChannelId(config.channelIds.registration);
    if (config.channelIds.approvals) setAdminChannelId(config.channelIds.approvals);
}

// ==========================================
// 🛠️ CONFIG INITIALIZATION HELPER
// ==========================================

/**
 * Ensures db.config and db.config.alliedClans exist.
 * Call this before accessing db.config properties.
 */
export function ensureConfig(db) {
    if (!db.config) db.config = {};
    if (!db.config.alliedClans) db.config.alliedClans = {};
}


