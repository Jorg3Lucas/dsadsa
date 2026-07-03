// ==========================================
// 🔧 CONSTANTS — Dynamic (loaded from server-config.js)
// ==========================================

import { getServerList, getServer, getConfig } from './server-config.js';

export let confirmationCache = {};

// ─── These are populated from server-config on module load ───

export let DISCORD_SERVER_ID = '';
export let CLAN_ROLES = {};

// All clan role IDs across all configured servers (deduplicated)
let _allRoleIds = new Set();

/**
 * Reload all server-specific constants from server-config.js.
 * Should be called after !setup changes are saved.
 */
export function reloadRankingConstants() {
    const config = getConfig();
    DISCORD_SERVER_ID = config.discordServerId || '';

    // Merge CLAN_ROLES from all configured servers
    const mergedRoles = {};
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
    }

    CLAN_ROLES = mergedRoles;

    console.log(`✅ [Ranking Constants] Reloaded: ${Object.keys(CLAN_ROLES).length} clan roles`);
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
        clanRoles: srv.clanRoles || {}
    };
}

