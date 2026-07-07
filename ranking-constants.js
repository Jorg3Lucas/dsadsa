// ==========================================
// 🔧 CONSTANTS
// ==========================================

export const confirmationCache = {};

export const DISCORD_SERVER_ID = '1432320162278670440';

export const CLAN_ROLES = {
    "GearsofWar シ": "1503933709756141620",
    "GearsofWar79": "1503933709756141620",
    "GearsofWar ツ": "1503933844909326478",
    "・URSUS・": "1503933886260969472"
};

export const CLAN_POWER_ROLE = "1503934305922191450"; // 10F (400K+)
export const CLAN_POWER_THRESHOLD = 400000;

export const HOFGAMER_CLAN_URLS = {
    "GearsofWar シ": "https://www.hofgamer.com/clan/detail/?clan=GearsofWar%20%E3%82%B7",
    "GearsofWar79": "https://www.hofgamer.com/clan/detail/?clan=GearsofWar79",
    "・URSUS・": "https://www.hofgamer.com/clan/detail/?clan=%E3%83%BBURSUS%E3%83%BB",
    "GearsofWar ツ": "https://www.hofgamer.com/clan/detail/?clan=GearsofWar%20%E3%83%84"
};

// Normalize a name for fuzzy matching by stripping only decorative/symbol characters.
// Does NOT strip CJK characters that are part of the actual name (e.g. "すぐる", "黑暗").
export function normalizeForMatch(name) {
    return name
        .normalize('NFC')
        .toLowerCase()
        .replace(/[・•·‧｡､＠＃＄％＆＊＋＝＾￣＿]/g, '')
        .replace(/[\u00B7\u2219\u25CB\u25CF\u25C6\u25C7\u2605\u2606\u2726\u2733\u2734\u274B]/g, '')
        .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u2060]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
