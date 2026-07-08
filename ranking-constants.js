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

export const DISCORD_SERVER_ID = '1481566364631044119';

export const MEMBER_ROLE_ID = '1481568299966926879';

// Roles that can approve/reject member registrations (in addition to Administrator)
export const APPROVER_ROLE_IDS = [
    '1481568277254639626',
    '1483532193987956817',
    '1500208456945106944',
    '1481568065081573467'
];

export const WORLD_IDS = {
    611: "EU011",
    612: "EU012",
    613: "EU013",
    614: "EU014",
    621: "EU021",
    622: "EU022",
    623: "EU023",
    624: "EU024",
    652: "EU031",
    653: "BEU031"
};

// ==========================================
// ⏳ PENDING REGISTRATION EXPIRY (24h)
// ==========================================

export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ==========================================
// 📥 ORIGIN SERVERS FOR SCAN IMPORT
// ==========================================

export const ORIGIN_SERVER_ID = '1301149441171914785';
export const SECONDARY_SERVER_ID = '1432320162278670440';

// Pre-registration validity (7 days)
export const PRE_REGISTER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Remove pending registrations older than 24h */
export function cleanExpiredPendingRegistrations() {
    const now = Date.now();

    for (const [userId, pending] of Object.entries(pendingRegistrations)) {
        if (pending.timestamp && (now - pending.timestamp > PENDING_MAX_AGE_MS)) {
            delete pendingRegistrations[userId];
        }
    }

    for (const [pilotUserId, pending] of Object.entries(pendingPilotApprovals)) {
        if (pending.timestamp && (now - pending.timestamp > PENDING_MAX_AGE_MS)) {
            delete pendingPilotApprovals[pilotUserId];
        }
    }
}

// ==========================================
// 📋 WELCOME PANEL MESSAGE
// ==========================================

export const WELCOME_PANEL_MESSAGE = '📋 **MIR4 Account Registration**\n\n⚠️ **Register only ONE account** — use your exact in-game character name!\n\nClick the buttons below to register your main account or as a pilot.\n\n👑 **Register as Owner** — Register your main character.\n✈️ **Register as Pilot** — Register as a pilot for an existing owner.\n\nAfter approval by an administrator, you will receive the member role and your in-game nickname.';


