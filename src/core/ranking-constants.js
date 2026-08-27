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

// ── World group IDs for each region used in the ranking URL ──
// worldgroupId: 3=EU1, 5=SA1, 2=NA1, 1=ASIA1, 11=ASIA2, 21=ASIA3, 6=INMENA1
export const WORLD_GROUP_IDS = {
    // EU (worldgroupId=3)
    611: 3, 612: 3, 613: 3, 614: 3,
    621: 3, 622: 3, 623: 3, 624: 3,
    652: 3, 653: 3,
    // SA — South America (worldgroupId=5)
    711: 5, 712: 5, 713: 5, 714: 5,
    721: 5, 722: 5, 723: 5,
    731: 5, 732: 5, 733: 5,
    752: 5, 753: 5,
    // NA — North America (worldgroupId=2)
    511: 2, 512: 2, 513: 2, 514: 2,
    521: 2, 522: 2, 523: 2,
    531: 2, 532: 2, 533: 2,
    552: 2, 553: 2,
    // ASIA1 (worldgroupId=1)
    811: 1, 812: 1, 813: 1, 814: 1,
    821: 1, 822: 1, 823: 1, 824: 1,
    831: 1, 832: 1, 833: 1, 834: 1,
    312: 1, 313: 1,
    // ASIA2 (worldgroupId=11)
    851: 11, 852: 11, 853: 11,
    861: 11, 862: 11, 863: 11,
    871: 11, 872: 11, 873: 11,
    881: 11, 882: 11, 883: 11,
    322: 11, 323: 11,
    // ASIA3 (worldgroupId=21)
    911: 21, 912: 21, 913: 21, 914: 21,
    921: 21, 922: 21, 923: 21, 924: 21,
    931: 21, 932: 21, 933: 21, 934: 21,
    332: 21, 333: 21,
    // INMENA (worldgroupId=6)
    221: 6, 222: 6, 223: 6, 224: 6,
    225: 6, 226: 6, 227: 6, 228: 6,
    252: 6, 253: 6,
};

// ── Region names for the world selector ──
export const REGION_NAMES = {
    eu: '🌍 EU (Europe)',
    na: '🌎 NA (North America)',
    sa: '🌎 SA (South America)',
    asia1: '🌏 ASIA1',
    asia2: '🌏 ASIA2',
    asia3: '🌏 ASIA3',
    inmena: '🌍 INMENA (India/Middle East/North Africa)'
};

// ── World IDs grouped by region ──
export const WORLDS_BY_REGION = {
    eu: [611, 612, 613, 614, 621, 622, 623, 624, 652, 653],
    na: [511, 512, 513, 514, 521, 522, 523, 531, 532, 533, 552, 553],
    sa: [711, 712, 713, 714, 721, 722, 723, 731, 732, 733, 752, 753],
    asia1: [811, 812, 813, 814, 821, 822, 823, 824, 831, 832, 833, 834, 312, 313],
    asia2: [851, 852, 853, 861, 862, 863, 871, 872, 873, 881, 882, 883, 322, 323],
    asia3: [911, 912, 913, 914, 921, 922, 923, 924, 931, 932, 933, 934, 332, 333],
    inmena: [221, 222, 223, 224, 225, 226, 227, 228, 252, 253]
};

// ── World names mapped by ID, across all regions ──
export const WORLD_IDS = {
    // EU — Europe
    611: "EU011", 612: "EU012", 613: "EU013", 614: "EU014",
    621: "EU021", 622: "EU022", 623: "EU023", 624: "EU024",
    652: "EU031", 653: "EU032",
    // SA — South America
    711: "SA011", 712: "SA012", 713: "SA013", 714: "SA014",
    721: "SA021", 722: "SA022", 723: "SA023",
    731: "SA031", 732: "SA032", 733: "SA033",
    752: "SA041", 753: "SA042",
    // NA — North America
    511: "NA011", 512: "NA012", 513: "NA013", 514: "NA014",
    521: "NA021", 522: "NA022", 523: "NA023",
    531: "NA031", 532: "NA032", 533: "NA033",
    552: "NA041", 553: "NA042",
    // ASIA1
    811: "ASIA011", 812: "ASIA012", 813: "ASIA013", 814: "ASIA014",
    821: "ASIA021", 822: "ASIA022", 823: "ASIA023", 824: "ASIA024",
    831: "ASIA031", 832: "ASIA032", 833: "ASIA033", 834: "ASIA034",
    312: "ASIA041", 313: "ASIA042",
    // ASIA2
    851: "ASIA051", 852: "ASIA052", 853: "ASIA053",
    861: "ASIA061", 862: "ASIA062", 863: "ASIA063",
    871: "ASIA071", 872: "ASIA072", 873: "ASIA073",
    881: "ASIA081", 882: "ASIA082", 883: "ASIA083",
    322: "ASIA091", 323: "ASIA092",
    // ASIA3
    911: "ASIA311", 912: "ASIA312", 913: "ASIA313", 914: "ASIA314",
    921: "ASIA321", 922: "ASIA322", 923: "ASIA323", 924: "ASIA324",
    931: "ASIA331", 932: "ASIA332", 933: "ASIA333", 934: "ASIA334",
    332: "ASIA341", 333: "ASIA342",
    // INMENA — India/Middle East/North Africa
    221: "INMENA011", 222: "INMENA012", 223: "INMENA013", 224: "INMENA014",
    225: "INMENA021", 226: "INMENA022", 227: "INMENA023", 228: "INMENA024",
    252: "INMENA031", 253: "INMENA032",
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
// 📥 ORIGIN SERVERS FOR SCAN IMPORT
// ==========================================

export const ORIGIN_SERVER_ID = '1301149441171914785';
export const SECONDARY_SERVER_ID = '1432320162278670440';

// Pre-registration validity (7 days)
export const PRE_REGISTER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Super admin — only this user can use high-risk commands
export const SUPER_ADMIN_USER_ID = '864108100880171009';

// ==========================================
// 📋 WELCOME PANEL MESSAGE
// ==========================================

export const WELCOME_PANEL_MESSAGE = '📋 **MIR4 Account Registration**\n\n⚠️ **Register only ONE account** — use your exact in-game character name!\n\n👑 **Register as Owner** — Register your main character.\n✈️ **Register as Pilot** — Register as a pilot for an existing owner.\n\n🗑️ **Remove My Registration** — Cancel your own registration.\n✈️ **Remove Pilot** — Remove a pilot linked to your account.\n\nAfter approval by an administrator, you will receive the member role and your in-game nickname.\n\n━━━━━━━━━━━━━━━━━━━━━━\n🤖 Bot developed by <@864108100880171009>';

// ==========================================
// 📢 REGISTRATION CHANNEL
// ==========================================

export const REGISTRATION_CHANNEL_ID = '1524296969521070120';

// ==========================================
// 📢 NOTIFICATION CHANNELS (for /notify command)
// ==========================================

export const DOMINATION_CHANNEL_ID = '1481572061850767490';
export const STANDBY_CHANNEL_ID = '1481572514399518780';

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


