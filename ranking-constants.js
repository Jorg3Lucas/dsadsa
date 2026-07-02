// ==========================================
// 🔧 CONSTANTS — Dynamic (loaded from server-config.js)
// ==========================================

import { getServerList, getServer, getConfig } from './server-config.js';

export let confirmationCache = {};

// ─── These are populated from server-config on module load ───

export let DISCORD_SERVER_ID = '';
export let CLAN_ROLES = {};
export let CLAN_POWER_ROLE = '';
export let CLAN_POWER_THRESHOLD = 400000;
export let HOFGAMER_CLAN_URLS = {};

// All clan role IDs across all configured servers (deduplicated)
let _allRoleIds = new Set();

/**
 * Reload all server-specific constants from server-config.js.
 * Should be called after !setup changes are saved.
 */
export function reloadRankingConstants() {
    const config = getConfig();
    DISCORD_SERVER_ID = config.discordServerId || '';

    // Merge CLAN_ROLES and HOFGAMER_URLS from all configured servers
    const mergedRoles = {};
    const mergedUrls = {};
    _allRoleIds = new Set();

    for (const [srvId, srv] of Object.entries(config.servers || {})) {
        if (!srv.enabled) continue;

        // Merge clan roles
        if (srv.clanRoles) {
            for (const [clan, roleId] of Object.entries(srv.clanRoles)) {
                mergedRoles[clan] = roleId;
                _allRoleIds.add(roleId);
            }
        }

        // Merge HoFgamer URLs
        if (srv.hofgamerUrls) {
            for (const [clan, url] of Object.entries(srv.hofgamerUrls)) {
                mergedUrls[clan] = url;
            }
        }

        // Set power role from first server that has one configured
        if (!CLAN_POWER_ROLE && srv.clanPowerRole) {
            CLAN_POWER_ROLE = srv.clanPowerRole;
        }
        if (srv.clanPowerThreshold) {
            CLAN_POWER_THRESHOLD = srv.clanPowerThreshold;
        }
    }

    CLAN_ROLES = mergedRoles;
    HOFGAMER_CLAN_URLS = mergedUrls;

    console.log(`✅ [Ranking Constants] Reloaded: ${Object.keys(CLAN_ROLES).length} clan roles, ${Object.keys(HOFGAMER_CLAN_URLS).length} HoF URLs`);
}

/**
 * Get all unique role IDs from all configured servers.
 */
export function getAllClanRoleIds() {
    return [..._allRoleIds];
}

/**
 * Get the list of active server IDs for the sync engine.
 */
export function getActiveServers() {
    return getServerList();
}

/**
 * Get specific server config for ranking operations.
 */
export function getRankingServerConfig(serverId) {
    const srv = getServer(serverId);
    if (!srv || !srv.enabled) return null;
    return {
        id: srv.id,
        name: srv.name,
        rankingUrl: srv.rankingUrl || '',
        clanRoles: srv.clanRoles || {},
        clanPowerRole: srv.clanPowerRole || '',
        clanPowerThreshold: srv.clanPowerThreshold || 400000,
        hofgamerUrls: srv.hofgamerUrls || {}
    };
}


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
