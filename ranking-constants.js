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


