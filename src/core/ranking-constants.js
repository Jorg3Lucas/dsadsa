// ==========================================
// 🔧 CONSTANTS
// ==========================================

import { DISCORD_SERVER_ID } from './config.js';

export { DISCORD_SERVER_ID };

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

// 👤 MEMBER ROLE — the ONLY role the bot manages for membership.
// Registered members validated against the EU21 ranking hold it; anyone who
// fails validation loses it. The bot NEVER creates / renames / deletes roles,
// so this role must already exist on the server (created by an admin).
// Clan roles (db.config.clanRoles) and the old "GoW Kids" temp role are no
// longer managed — they are ignored by lookups, sync and channel permissions.
export const MEMBER_ROLE_ID = '1539146461718122608';

// Roles that can approve/reject member registrations (in addition to Administrator)
export const APPROVER_ROLE_IDS = [
    '1481568277254639626',
    '1483532193987956817',
    '1500208456945106944',
    '1481568065081573467'
];

// 🌍 WORLDS TO SYNC — only EU21 (world 621)
// The scraper, lookups, allied-clan management and server display
// all derive from this map, so restricting it here limits the whole
// sync pipeline to the EU21 world only. Members are searched ONLY in
// this world's ranking — not found in EU21 → role/pre-reg removed.
export const WORLD_IDS = {
    621: "EU021"
};

// ==========================================
// ⏳ PENDING REGISTRATION EXPIRY (24h)
// ==========================================

export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ==========================================
// 📥 SCAN SOURCE SERVER
// ==========================================
// The only Discord server this bot operates on (claim server).
// Registrations from this server were harvested by the (removed) scanimport command.
export const SCAN_SERVER_ID = DISCORD_SERVER_ID;

// Pre-registrations no longer expire by time — they are validated against the
// EU21 ranking on every sync. Not found in the ranking → removed immediately.
// (PRE_REGISTER_MAX_AGE_MS removed)

// Super admin — only this user can use high-risk commands
export const SUPER_ADMIN_USER_ID = '864108100880171009';

// ==========================================
// 📋 WELCOME PANEL MESSAGE
// ==========================================

export const WELCOME_PANEL_MESSAGE = '📋 **MIR4 Account Registration**\n\n⚠️ **Register only ONE account** — use your exact in-game character name!\n\nClick the buttons below to register your main account or as a pilot.\n\n👑 **Register as Owner** — Register your main character.\n✈️ **Register as Pilot** — Register as a pilot for an existing owner.\n\nAfter approval by an administrator, you will receive the **member role** (and your in-game nickname). Temporary approvals hold it until they join an allied clan or expire.\n\n━━━━━━━━━━━━━━━━━━━━━━\n🤖 Bot developed by <@864108100880171009>';

// ==========================================
// 📢 REGISTRATION CHANNEL (for /listunregistered DMs)
// ==========================================
// Dynamic — persisted in db.config.channelIds when the channels are wired up.
// Defaults are kept as fallbacks until real IDs are persisted.

export let REGISTRATION_CHANNEL_ID = '1524296969521070120';

export function setRegistrationChannelId(id) { REGISTRATION_CHANNEL_ID = id; }

/**
 * Load persisted channel IDs from db.config.
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


