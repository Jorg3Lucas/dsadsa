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

// Roles that can approve/reject member registrations (in addition to Administrator).
// Holding ANY of these roles is enough — the role's Discord permissions are
// irrelevant (the check is by role ID, not by permissions).
export const APPROVER_ROLE_IDS = [
    '1539146386593943622',
    '1538943125303726142',
    '1539146538557640745'
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
// 🔍 NICKNAME SUGGESTIONS (fuzzy dropdowns)
// ==========================================
// How many fuzzy nickname suggestions to show when registering / correcting a
// registration. Allied-clan candidates are ranked first (see lookupTopNicknames),
// so a larger list means the correct character is much less likely to be missed.
export const MAX_NICKNAME_SUGGESTIONS = 6;

// ==========================================
// 🔀 SERVER MERGE MAP
// ==========================================
// After a merge, players from absorbed servers appear on the surviving server's
// ranking. resolveServerName() maps the old server code to the surviving one.
export const SERVER_MERGES = {
    // ASIA1
    "ASIA013": "ASIA021",
    "ASIA014": "ASIA022",
    "ASIA024": "ASIA023",
    "ASIA041": "ASIA031",
    // ASIA2
    "ASIA082": "ASIA051",
    "ASIA071": "ASIA052",
    "ASIA072": "ASIA061",
    "ASIA073": "ASIA062",
    "ASIA091": "ASIA063",
    // ASIA3
    "ASIA314": "ASIA311",
    "ASIA324": "ASIA313",
    "ASIA341": "ASIA312",
    // NA1
    "NA041": "NA012",
    "NA033": "NA031",
    // EU1
    "EU013": "EU011",
    "EU023": "EU021",
    "EU031": "EU022",
    "EU014": "EU024",
    // SA1
    "SA041": "SA013",
    "SA014": "SA023",
    "SA033": "SA031",
    // INMENA1
    "INMENA012": "INMENA011",
    "INMENA014": "INMENA013",
    "INMENA022": "INMENA021",
    "INMENA024": "INMENA023",
};

/**
 * Resolve a possibly-absorbed server name to its surviving server.
 * Returns the input unchanged if it is not a merged server.
 */
export function resolveServerName(name) {
    return SERVER_MERGES[name] || name;
}

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


