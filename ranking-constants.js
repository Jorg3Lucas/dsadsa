// ==========================================
// 🔧 CONSTANTS
// ==========================================

export let confirmationCache = {};

export const DISCORD_SERVER_ID = '1432320162278670440';

export const CLAN_ROLES = {
    "浪人・AEON・": "1503933709756141620",
    "浪人・Kitty・": "1503933844909326478",
    "・URSUS・": "1503933886260969472",
    "浪人・OnëPH・": "1503933923132964915"
};

export const CLAN_POWER_ROLE = "1503934305922191450"; // 10F (400K+)
export const CLAN_POWER_THRESHOLD = 400000;

export const HOFGAMER_CLAN_URLS = {
    "浪人・AEON・": "https://www.hofgamer.com/clan/detail/?clan=%E6%B5%AA%E4%BA%BA%E3%83%BBAEON%E3%83%BB",
    "・URSUS・": "https://www.hofgamer.com/clan/detail/?clan=%E3%83%BBURSUS%E3%83%BB",
    "浪人・Kitty・": "https://www.hofgamer.com/clan/detail/?clan=%E6%B5%AA%E4%BA%BA%E3%83%BBKitty%E3%83%BB",
    "浪人・OnëPH・": "https://www.hofgamer.com/clan/detail/?clan=%E6%B5%AA%E4%BA%BA%E3%83%BBOn%C3%ABPH%E3%83%BB"
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
