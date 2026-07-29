// ==========================================
// 💾 PER-WORLD CLAIM DATABASE MANAGER
// Each world gets its own database file:
//   database_EU011.json
//   database_EU012.json
//   ...
// This isolates claims between worlds.
// ==========================================

import fs from 'node:fs';
import path from 'node:path';
import { runBackup } from '../auto-backup.js';
import { logger } from './logger.js';
import { worldDbs, lastMessages, getAllPanelKeys } from './state.js';
import { buildPanelDefaults } from '../handlers/panel-utils.js';

/** Build the filename for a world's claim database. */
function worldDbPath(world) {
    return path.resolve(`./database_${world}.json`);
}

/**
 * Load a world's claim database from disk.
 * Returns the database object (or an empty object if not found).
 * @param {string} world - e.g. "EU011"
 * @returns {object}
 */
export function loadWorldClaimDb(world) {
    const filePath = worldDbPath(world);
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);

            // Restore lastMessages from panels stored in the file
            if (parsed._panels) {
                for (const [panelKey, ref] of Object.entries(parsed._panels)) {
                    lastMessages[panelKey] = ref;
                }
            }

            // Return the data (excluding metadata keys)
            const data = {};
            for (const [key, value] of Object.entries(parsed)) {
                if (!key.startsWith('_')) {
                    data[key] = value;
                }
            }

            logger.info('ClaimDB', `Loaded database for ${world} (${Object.keys(data).length} panels).`);
            return data;
        }
    } catch (err) {
        logger.error('ClaimDB', `Error loading database for ${world}`, err);
    }
    logger.info('ClaimDB', `No existing database for ${world}, starting fresh.`);
    return {};
}

/**
 * Save a world's claim database to disk.
 * @param {string} world - e.g. "EU011"
 * @param {object} data - The world's claim data object
 */
export function saveWorldClaimDb(world, data) {
    const filePath = worldDbPath(world);
    try {
        runBackup([`./database_${world}.json`]);

        // Collect persistent message references
        const persistentMessages = {};
        for (const panelKey of Object.keys(data)) {
            const msgRef = lastMessages[panelKey];
            if (msgRef) {
                persistentMessages[panelKey] = {
                    channelId: msgRef.channelId,
                    messageId: msgRef.id || msgRef.messageId
                };
            }
        }

        const toSave = {
            ...data,
            _panels: persistentMessages,
            _updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), 'utf8');
        logger.info('ClaimDB', `Saved database for ${world} (${Object.keys(data).length} panels).`);
    } catch (err) {
        logger.error('ClaimDB', `Error saving database for ${world}`, err);
    }
}

/**
 * Initialize a world's claim database.
 * Loads from disk or creates a new one with default panel data.
 * Stores the db in `worldDbs[world]`.
 * @param {string} world - e.g. "EU011"
 */
export function initWorldClaimDb(world) {
    // Load existing or start fresh
    const data = loadWorldClaimDb(world);

    // Initialize missing panel keys with defaults
    const panelKeys = getAllPanelKeys();
    for (const key of panelKeys) {
        if (!data[key]) {
            const defaults = buildPanelDefaults(key);
            if (defaults) data[key] = defaults;
        }
    }

    worldDbs[world] = data;
    logger.info('ClaimDB', `Initialized ${world} with ${Object.keys(data).length} panel(s).`);
}

/**
 * Initialize claim databases for all worlds that have been configured via /setup.
 * @param {object} rankingDb - The ranking database (has config.worldSetup)
 */
export function initAllWorldClaimDbs(rankingDb) {
    const worldSetup = rankingDb?.config?.worldSetup;
    if (!worldSetup) return;

    for (const world of Object.keys(worldSetup)) {
        if (!worldDbs[world]) {
            initWorldClaimDb(world);
        }
    }
}

/**
 * Save ALL world claim databases to disk.
 */
export function saveAllWorldClaimDbs() {
    for (const [world, data] of Object.entries(worldDbs)) {
        if (data && typeof data === 'object') {
            saveWorldClaimDb(world, data);
        }
    }
}

/**
 * Delete a world's claim database file (for cleanup after /nuke).
 * @param {string} world
 */
export function deleteWorldClaimDb(world) {
    delete worldDbs[world];
    const filePath = worldDbPath(world);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info('ClaimDB', `Deleted database file for ${world}.`);
        }
    } catch (err) {
        logger.error('ClaimDB', `Error deleting database for ${world}`, err);
    }
}
