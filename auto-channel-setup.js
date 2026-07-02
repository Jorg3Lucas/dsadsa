// ==========================================
// 🏗️ AUTO CHANNEL SETUP
// Deletes all channels in floor categories and
// recreates them with panel embeds on boot.
// Uses per-server category configuration from server-config.js
// ==========================================

import { db, lastMessages, saveLocalStorage } from "./state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { getActiveServerIds, getServer } from "./server-config.js";

// ── Static channel layout per floor type ──
// (Same for all in-game servers, only category IDs differ)
const FLOOR_CHANNEL_LAYOUT = {
    '7F': [
        { name: "🔸┃sp7", panels: ["7peak"] },
        { name: "🔹┃ms7", panels: ["7squarenormal", "7squareantidemon"] }
    ],
    '8F': [
        { name: "🔸┃sp8", panels: ["8peak"] },
        { name: "🔹┃ms8", panels: ["8squarenormal", "8squareantidemon"] }
    ],
    '9F': [
        { name: "🔸┃sp9", panels: ["9peak"] },
        { name: "🔹┃ms9", panels: ["9squarenormal", "9squareantidemon11", "9squareantidemon12"] }
    ],
    '10F': [
        { name: "🔸┃sp10", panels: ["10peak"] },
        { name: "🔹┃ms10", panels: ["10squarenormal", "10squareantidemon11", "10squareantidemon12"] }
    ],
    '11F': [
        { name: "🔸┃sp11", panels: ["11peak", "11goblin"] },
        { name: "🔹┃ms11", panels: ["11squareleaders", "11squareevents", "11squareantidemon", "11msgoblin"] }
    ],
    '12F': [
        { name: "🔸┃sp12", panels: ["12peak", "12randomevent", "12goblin"] },
        { name: "🔹┃ms12", panels: ["12squareleaders", "12squareevents", "12squareantidemon", "12msgoblin"] }
    ],
    'Summons': [
        { name: "🌀┃summons", panels: ["summon"] }
    ]
};

let _setupDone = false;

// ==========================================
// 🔧 BUILD CATEGORY CONFIG FROM SERVER CONFIG
// ==========================================

function buildCategoryConfig() {
    const config = {};
    const serverIds = getActiveServerIds();

    for (const serverId of serverIds) {
        const server = getServer(serverId);
        if (!server) continue;

        for (const [floorKey, catId] of Object.entries(server.categories || {})) {
            if (!catId) continue;

            const layout = FLOOR_CHANNEL_LAYOUT[floorKey];
            if (!layout) {
                console.warn(`⚠️ [Auto Setup] Unknown floor "${floorKey}" for server ${server.name}, skipping.`);
                continue;
            }

            // If the same category ID is used by another server, skip to avoid duplication
            if (config[catId]) {
                console.warn(`⚠️ [Auto Setup] Category ${catId} already configured (${config[catId].name}), skipping duplicate for ${server.name}/${floorKey}.`);
                continue;
            }

            config[catId] = {
                name: `${floorKey} (${server.name})`,
                channels: layout,
                serverId: serverId  // Store server ID for key prefixing
            };

            console.log(`📁 [Auto Setup] Server "${server.name}" → ${floorKey}: category ${catId}`);
        }
    }

    return config;
}

// ==========================================
// 🚀 MAIN SETUP ENTRY POINT
// ==========================================

export async function setupAllChannels(client, guildId) {
    if (_setupDone) {
        console.log("ℹ️ [Auto Setup] Already completed this session, skipping.");
        return;
    }

    const guild = guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first();
    if (!guild) {
        console.error("❌ [Auto Setup] Guild not found.");
        return;
    }

    const CATEGORY_CONFIG = buildCategoryConfig();
    if (Object.keys(CATEGORY_CONFIG).length === 0) {
        console.warn("⚠️ [Auto Setup] No categories configured. Use !setup to configure servers first.");
        return;
    }

    console.log(`🏗️ [Auto Setup] Starting channel setup for ${Object.keys(CATEGORY_CONFIG).length} categories...`);

    // Clear stale panel mapping so processAutoRecoveryOnBoot doesn't try to use old channels
    db._panelMapping = {};
    for (const key in lastMessages) delete lastMessages[key];

    for (const [catId, catConfig] of Object.entries(CATEGORY_CONFIG)) {
        const category = guild.channels.cache.get(catId);
        if (!category) {
            console.error(`❌ [Auto Setup] Category ${catConfig.name} (${catId}) not found.`);
            continue;
        }
        // Verify it's actually a category channel (type 4)
        if (category.type !== 4) {
            console.error(`❌ [Auto Setup] ${catConfig.name} (${catId}) is not a category (type=${category.type}). Use a valid category ID.`);
            continue;
        }
        
        // Determine which server this category belongs to
        const catServerId = catConfig.serverId || null;

        // ── Delete all existing text channels in this category ──
        const existingChannels = guild.channels.cache.filter(
            ch => ch.parentId === catId && ch.type === 0
        );
        for (const [, channel] of existingChannels) {
            try {
                await channel.delete();
                console.log(`🗑️ [Auto Setup] Deleted channel #${channel.name} in ${catConfig.name}.`);
            } catch (err) {
                console.error(`❌ [Auto Setup] Failed to delete #${channel.name}: ${err.message}`);
            }
        }

        // ── Create new channels ──
        for (const chanDef of catConfig.channels) {
            let newChannel;
            try {
                newChannel = await guild.channels.create({
                    name: chanDef.name,
                    type: 0, // GuildText
                    parent: catId,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone,
                            deny: ["SendMessages", "AddReactions"],
                            allow: ["ViewChannel", "ReadMessageHistory"]
                        }
                    ]
                });
                console.log(`✅ [Auto Setup] Created #${chanDef.name} in ${catConfig.name}.`);
            } catch (err) {
                console.error(`❌ [Auto Setup] Failed to create #${chanDef.name}: ${err.message}`);
                continue;
            }

            // ── Send panel messages ──
            for (const panelKey of chanDef.panels) {
                // Use server-prefixed key
                const fullKey = catServerId ? `${catServerId}_${panelKey}` : panelKey;
                if (!db[fullKey]) {
                    console.warn(`⚠️ [Auto Setup] Panel ${fullKey} not in DB, skipping.`);
                    continue;
                }
                try {
                    const sent = await newChannel.send({
                        embeds: [renderEmbed(fullKey)],
                        components: renderButtons(fullKey)
                    });
                    lastMessages[fullKey] = sent;
                    if (!db._panelMapping) db._panelMapping = {};
                    db._panelMapping[fullKey] = {
                        channelId: newChannel.id,
                        messageId: sent.id
                    };
                    // Store ALL instances for multi-server panel refresh support
                    if (!db._panelInstances) db._panelInstances = {};
                    if (!db._panelInstances[fullKey]) db._panelInstances[fullKey] = [];
                    db._panelInstances[fullKey].push({
                        channelId: newChannel.id,
                        messageId: sent.id
                    });
                    console.log(`📋 [Auto Setup] Panel ${fullKey} sent to #${chanDef.name} (instance #${db._panelInstances[fullKey].length}).`);
                } catch (err) {
                    console.error(`❌ [Auto Setup] Failed to send ${fullKey} in #${chanDef.name}: ${err.message}`);
                }
            }
        }
    }

    saveLocalStorage();
    _setupDone = true;
    console.log("✅ [Auto Setup] All channels created and panels deployed.");
}

