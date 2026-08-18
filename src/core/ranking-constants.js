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

export const MEMBER_ROLE_ID = '1503933709756141620';

// Roles that can approve/reject member registrations (in addition to Administrator)
export const APPROVER_ROLE_IDS = [
    '1481568277254639626',
    '1483532193987956817',
    '1500208456945106944',
    '1481568065081573467'
];

// ── World group ID for the single configured server (NA42) ──
// worldgroupId: 2=NA1 (used in the ranking URL)
export const WORLD_GROUP_IDS = {
    553: 2,
};

// ── Single-server mode: only NA42 (world 553) is synced/operated ──
export const WORLD_IDS = {
    553: "NA42",
};

// ==========================================
// 🔍 NICKNAME SUGGESTIONS (fuzzy dropdowns)
// ==========================================

// How many fuzzy nickname suggestions to show when registering / correcting
// a registration. Allied-clan candidates are ranked first (see
// lookupTopNicknames), so a larger list means the correct character is
// much less likely to be missed (e.g. "Dinizメ" allied vs "Diniz メ" elsewhere).
export const MAX_NICKNAME_SUGGESTIONS = 6;

// ==========================================
// ⏳ PENDING REGISTRATION EXPIRY (24h)
// ==========================================

export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ==========================================
// ⏳ OUT-OF-ALLIED-CLAN GRACE PERIOD (72h)
// ==========================================

// How long a member keeps their role after being detected outside an allied
// clan (or missing from the ranking) during the daily sync. Mir4 players often
// leave the clan temporarily — or get moved to non-registered clans for events —
// and can't rejoin until the weekly server reset, so an immediate role strip is
// too aggressive. The countdown is tracked per person
// (db.roleNotify[memberId].outOfAlliedSince) and resets the moment the member
// is found back in an allied clan.
export const OUT_OF_ALLIED_GRACE_MS = 72 * 60 * 60 * 1000; // 72 hours

// ==========================================
// 📥 ORIGIN SERVERS FOR SCAN IMPORT
// ==========================================

export const ORIGIN_SERVER_ID = '1301149441171914785';
export const SECONDARY_SERVER_ID = '1432320162278670440';

// Pre-registration validity (7 days)
export const PRE_REGISTER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Super admin — only this user can use high-risk commands
export const SUPER_ADMIN_USER_ID = '1496662868802928811';

// ==========================================
// 📋 WELCOME PANEL MESSAGE
// ==========================================

export const WELCOME_PANEL_MESSAGE = '📋 **MIR4 Account Registration**\n\n⚠️ **Register only ONE account** — use your exact in-game character name!\n\n👑 **Register as Owner** — Register your main character.\n✈️ **Register as Pilot** — Register as a pilot for an existing owner.\n\n🗑️ **Remove My Registration** — Cancel your own registration.\n✈️ **Remove Pilot** — Remove a pilot linked to your account.\n\nAfter approval by an administrator, you will receive the member role and your in-game nickname.\n\n━━━━━━━━━━━━━━━━━━━━━━\n🤖 Bot developed by <@1496662868802928811>';

// ==========================================
// 📢 REGISTRATION CHANNEL
// ==========================================

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
