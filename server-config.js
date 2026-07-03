// ==========================================
// ⚙️ SERVER CONFIGURATION MODULE
// Manages configuration for multiple in-game
// servers (EU013, EU021) within a single
// Discord server.
// ==========================================

import fs from 'fs';
import path from 'path';
// ─── File path ──────────────────────────────

const CONFIG_PATH = path.resolve('./server-config.json');

// ─── Default structure ──────────────────────

const DEFAULT_CONFIG = {
    discordServerId: '',
    servers: {}
};

const DEFAULT_SERVER = {
    id: '',
    name: '',
    enabled: true,
    rankingUrl: '',
    clanRoles: {},
    clanPowerRole: '',
    clanPowerThreshold: 400000,
    staffRoleId: '',
    hofgamerUrls: {},
    categories: {
        '7F': '',
        '8F': '',
        '9F': '',
        '10F': '',
        '11F': '',
        '12F': '',
        'Summons': ''
    },
    channels: {
        salaryPoll: '',
        logs: '',
        bossSpawn: '',
        event: '',
        ticketCategory: '',
        tempVoiceSource: ''
    }
};

// ─── In-memory state ────────────────────────

let config = { ...DEFAULT_CONFIG };

// ─── Load / Save ────────────────────────────

export function loadServerConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            config = {
                discordServerId: data.discordServerId || '',
                servers: {}
            };
            for (const [id, srv] of Object.entries(data.servers || {})) {
                config.servers[id] = {
                    ...JSON.parse(JSON.stringify(DEFAULT_SERVER)),
                    ...srv,
                    id
                };
            }
            console.log(`✅ [Server Config] Loaded ${Object.keys(config.servers).length} server(s).`);
        } else {
            console.log('📝 [Server Config] No config file found. Use !setup to configure.');
        }
    } catch (err) {
        console.error('❌ [Server Config] Error loading:', err.message);
    }
}

export function saveServerConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ [Server Config] Error saving:', err.message);
    }
}

// ─── Getters ─────────────────────────────────

export function getConfig() {
    return config;
}

export function getServerList() {
    return Object.values(config.servers)
        .filter(s => s.enabled)
        .map(s => ({ id: s.id, name: s.name }));
}

export function getServer(serverId) {
    return config.servers[serverId] || null;
}

export function getDiscordServerId() {
    return config.discordServerId || '';
}

// ─── Setters ─────────────────────────────────

export function setDiscordServerId(guildId) {
    config.discordServerId = guildId;
    saveServerConfig();
}

/**
 * Add a new in-game server configuration.
 */
export function addServer(serverId, name) {
    if (config.servers[serverId]) {
        return { success: false, message: `❌ Server "${serverId}" already exists.` };
    }
    config.servers[serverId] = {
        ...JSON.parse(JSON.stringify(DEFAULT_SERVER)),
        id: serverId,
        name: name || serverId.toUpperCase()
    };
    saveServerConfig();
    console.log(`✅ [Server Config] Added server: ${serverId}`);
    return { success: true, message: `✅ Server **${name || serverId}** added!` };
}

/**
 * Remove an in-game server configuration.
 */
export function removeServer(serverId) {
    if (!config.servers[serverId]) {
        return { success: false, message: `❌ Server "${serverId}" not found.` };
    }
    delete config.servers[serverId];
    saveServerConfig();
    console.log(`🗑️ [Server Config] Removed server: ${serverId}`);
    return { success: true, message: `🗑️ Server **${serverId}** removed.` };
}

/**
 * Set a configuration value for a server.
 * Supports nested keys like "categories.7F" or "clanRoles.ClanName".
 */
export function setServerConfig(serverId, key, value) {
    const server = config.servers[serverId];
    if (!server) {
        return { success: false, message: `❌ Server "${serverId}" not found.` };
    }

    // Handle nested keys like "categories.7F"
    const parts = key.split('.');
    let obj = server;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;

    saveServerConfig();
    return { success: true, message: `✅ **${server.name}**: \`${key}\` updated!` };
}

/**
 * Get per-server data file paths.
 * Returns file paths namespaced by server ID.
 */
export function getServerDataFiles(serverId) {
    const prefix = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
        claimDb: path.resolve(`./database_${prefix}.json`),
        rankingDb: path.resolve(`./database_ranking_${prefix}.json`),
        rankingCache: path.resolve(`./ranking_cache_${prefix}.json`),
        rankingLogs: path.resolve(`./ranking_logs_${prefix}.txt`),
        dailyLogs: path.resolve(`./daily-logs_${prefix}.json`),
        salaryDb: path.resolve(`./salary-poll-db_${prefix}.json`)
    };
}

/**
 * Get all active (enabled) server IDs.
 */
export function getActiveServerIds() {
    return Object.keys(config.servers).filter(id => config.servers[id].enabled);
}

export default {
    loadServerConfig,
    saveServerConfig,
    getConfig,
    getServerList,
    getServer,
    getDiscordServerId,
    setDiscordServerId,
    addServer,
    removeServer,
    setServerConfig,
    getServerDataFiles,
    getActiveServerIds
};
