// ==========================================
// 🔗 CLAIM DATA RESOLVER
// Maps interactions to per-server claim data
// using server-prefixed panel keys.
// ==========================================

import { getActiveServerIds, getServer } from './server-config.js';

// Re-export for convenience (used by panel-utils.js and others)
export { getActiveServerIds };

// ─── In-memory channel → server map ────────

let channelServerMap = null;

/**
 * Build a reverse map: Discord channel ID → in-game server ID
 * Uses server config categories and channels.
 */
function buildChannelServerMap() {
    const map = {};
    const serverIds = getActiveServerIds();
    for (const serverId of serverIds) {
        const server = getServer(serverId);
        if (!server) continue;
        // Map category IDs
        for (const [floorKey, catId] of Object.entries(server.categories || {})) {
            if (catId) map[catId] = serverId;
        }
        // Map channel IDs
        for (const [chanKey, chanId] of Object.entries(server.channels || {})) {
            if (chanId) map[chanId] = serverId;
        }
    }
    channelServerMap = map;
    return map;
}

/**
 * Get the in-game server ID for a given Discord channel/category ID.
 */
export function getServerIdFromChannel(channelId) {
    if (!channelServerMap) buildChannelServerMap();
    return channelServerMap[channelId] || null;
}

/**
 * Get the full prefixed DB key for a panel in a given server.
 * @param {string} serverId - e.g. "eu013"
 * @param {string} panelKey - e.g. "7peak"
 * @returns {string} e.g. "eu013_7peak"
 */
export function getKey(serverId, panelKey) {
    return `${serverId}_${panelKey}`;
}

/**
 * Resolve the full DB key from an interaction and raw panel key.
 * Determines the server from the interaction's channel (or its parent category).
 * @param {object} interaction - Discord interaction with channel info
 * @param {string} panelKey - e.g. "7peak"
 * @param {object} [db] - optional db to look up metadata
 * @returns {string} e.g. "eu013_7peak" or the original panelKey as fallback
 */
export function resolveDbKey(interaction, panelKey) {
    // Try interaction's own channel ID
    const channelId = interaction.channelId || interaction.channel?.id;
    if (channelId) {
        const serverId = getServerIdFromChannel(channelId);
        if (serverId) return getKey(serverId, panelKey);
    }
    // Try the channel's parent category
    const channel = interaction.channel;
    if (channel?.parentId) {
        const serverId = getServerIdFromChannel(channel.parentId);
        if (serverId) return getKey(serverId, panelKey);
    }
    // Fallback: use plain key (backward compatibility)
    return panelKey;
}

/**
 * Get all server-prefixed variants of a panel key.
 * @param {string} panelKey - e.g. "7peak"
 * @returns {string[]} e.g. ["eu013_7peak", "eu021_7peak"]
 */
export function getAllServerKeys(panelKey) {
    const serverIds = getActiveServerIds();
    if (serverIds.length === 0) return [panelKey]; // fallback
    return serverIds.map(sid => getKey(sid, panelKey));
}

/**
 * Returns all claim-relevant keys from db, both prefixed and non-prefixed
 * (excluding metadata keys starting with "_").
 * @param {object} db
 * @returns {string[]}
 */
export function getAllClaimKeys(db) {
    const keys = [];
    for (const key in db) {
        if (!db[key] || key.startsWith('_')) continue;
        keys.push(key);
    }
    return keys;
}

/**
 * Strip the server prefix from a panel key.
 * e.g. "eu013_7peak" → "7peak"
 * Returns the original key if no prefix found.
 */
export function stripPrefix(key) {
    const idx = key.indexOf('_');
    if (idx === -1) return key;
    // Only strip if it looks like a server prefix (lowercase alphanumeric)
    const possiblePrefix = key.substring(0, idx);
    if (/^[a-z][a-z0-9]*$/.test(possiblePrefix)) {
        return key.substring(idx + 1);
    }
    return key;
}

/**
 * Get the server prefix from a panel key.
 * e.g. "eu013_7peak" → "eu013"
 * Returns null if no prefix found.
 */
export function getServerPrefix(key) {
    const idx = key.indexOf('_');
    if (idx === -1) return null;
    const possiblePrefix = key.substring(0, idx);
    if (/^[a-z][a-z0-9]*$/.test(possiblePrefix)) {
        return possiblePrefix;
    }
    return null;
}

/**
 * Invalidate and rebuild the channel-server map (call after config changes).
 */
export function refreshChannelServerMap() {
    channelServerMap = null;
    buildChannelServerMap();
}
