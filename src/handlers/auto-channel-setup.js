// ==========================================
// 🏗️ AUTO CHANNEL SETUP
// Reads per-world floor channels from the
// ranking database (created by /setup) and
// deploys panel embeds into each channel.
// ==========================================

import { db, lastMessages, saveLocalStorage, setCurrentWorld } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { initWorldClaimDb } from "../core/claim-db-manager.js";

let _setupDone = false;

// ── Expected channel names and their panels ──
// Used to find existing channels and re-deploy embeds.
const FLOOR_CHANNEL_DEFS = [
    { name: '🔸┃7F-sp7',    panels: ['7peak'] },
    { name: '🔹┃7F-ms7',    panels: ['7squarenormal', '7squareantidemon'] },
    { name: '🔸┃8F-sp8',    panels: ['8peak'] },
    { name: '🔹┃8F-ms8',    panels: ['8squarenormal', '8squareantidemon'] },
    { name: '🔸┃9F-sp9',    panels: ['9peak'] },
    { name: '🔹┃9F-ms9',    panels: ['9squarenormal', '9squareantidemon'] },
    { name: '🔸┃10F-sp10',  panels: ['10peak'] },
    { name: '🔹┃10F-ms10',  panels: ['10squarenormal', '10squareantidemon'] },
    { name: '🔸┃11F-sp11',  panels: ['11peak', '11goblin'] },
    { name: '🔹┃11F-ms11',  panels: ['11squareleaders', '11squareevents', '11squareantidemon', '11msgoblin'] },
    { name: '🔸┃12F-sp12',  panels: ['12peak', '12randomevent', '12goblin'] },
    { name: '🔹┃12F-ms12',  panels: ['12squareleaders', '12squareevents', '12squareantidemon', '12msgoblin'] },
    { name: '🌀┃summons',    panels: ['summon'] }
];

// ==========================================
// 🚀 MAIN SETUP ENTRY POINT
// ==========================================

/**
 * Deploy panel embeds into floor channels inside each world's Claims category.
 *
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {object} [rankingDb] - The ranking database with worldSetup config
 */
export async function setupAllChannels(client, guildId, rankingDb) {
    if (_setupDone) {
        console.log("ℹ️ [Auto Setup] Already completed this session, skipping.");
        return;
    }

    const guild = guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first();
    if (!guild) {
        console.error("❌ [Auto Setup] Guild not found.");
        return;
    }

    console.log("🏗️ [Auto Setup] Starting channel setup...");

    // Clear stale lastMessages globally (they'll be re-populated per-world below)
    for (const key in lastMessages) delete lastMessages[key];

    // ── Collect per-world Claims category IDs from ranking db ──
    const worldClaimsCats = [];

    if (rankingDb?.config?.worldSetup) {
        for (const [world, config] of Object.entries(rankingDb.config.worldSetup)) {
            if (config.claimsCategoryId) {
                worldClaimsCats.push({
                    world,
                    categoryId: config.claimsCategoryId
                });
            }
        }
    }

    if (worldClaimsCats.length === 0) {
        console.log("ℹ️ [Auto Setup] No per-world Claims categories found in ranking DB. Nothing to do.");
        _setupDone = true;
        return;
    }

    console.log(`🏗️ [Auto Setup] Found ${worldClaimsCats.length} world Claims categories.`);

    for (const wc of worldClaimsCats) {
        const category = guild.channels.cache.get(wc.categoryId);
        if (!category) {
            console.error(`❌ [Auto Setup] Claims category for ${wc.world} (${wc.categoryId}) not found.`);
            continue;
        }
        if (category.type !== 4) {
            console.error(`❌ [Auto Setup] Claims category for ${wc.world} is not a category.`);
            continue;
        }

        console.log(`📋 [Auto Setup] Processing ${wc.world} Claims...`);

        // ── Ensure this world's claim database is initialized ──
        initWorldClaimDb(wc.world);
        setCurrentWorld(wc.world);

        // Clear stale panel mapping for this world
        db._panelMapping = {};

        // ── Delete existing floor channels in this category ──
        const existingChannels = guild.channels.cache.filter(
            ch => ch.parentId === wc.categoryId && ch.type === 0
        );
        for (const [, channel] of existingChannels) {
            try {
                await channel.delete();
                console.log(`🗑️ [Auto Setup] Deleted #${channel.name} in ${wc.world} Claims.`);
            } catch (err) {
                console.error(`❌ [Auto Setup] Failed to delete #${channel.name}: ${err.message}`);
            }
        }

        // ── Re-create floor channels with panel embeds ──
        for (const chDef of FLOOR_CHANNEL_DEFS) {
            let newChannel;
            try {
                newChannel = await guild.channels.create({
                    name: chDef.name,
                    type: 0,
                    parent: wc.categoryId
                });
                console.log(`✅ [Auto Setup] Created #${chDef.name} in ${wc.world} Claims.`);
            } catch (err) {
                console.error(`❌ [Auto Setup] Failed to create #${chDef.name}: ${err.message}`);
                continue;
            }

            // ── Send panel messages ──
            for (const panelKey of chDef.panels) {
                if (!db[panelKey]) {
                    console.warn(`⚠️ [Auto Setup] Panel ${panelKey} not in DB for ${wc.world}, skipping.`);
                    continue;
                }
                try {
                    const sent = await newChannel.send({
                        embeds: [renderEmbed(panelKey)],
                        components: renderButtons(panelKey)
                    });
                    lastMessages[panelKey] = sent;
                    if (!db._panelMapping) db._panelMapping = {};
                    db._panelMapping[panelKey] = {
                        channelId: newChannel.id,
                        messageId: sent.id
                    };
                    console.log(`📋 [Auto Setup] Panel ${panelKey} sent to #${chDef.name} (${wc.world}).`);
                } catch (err) {
                    console.error(`❌ [Auto Setup] Failed to send ${panelKey} in #${chDef.name}: ${err.message}`);
                }
            }
        }

        // Save this world's database
        saveLocalStorage();
        setCurrentWorld(null);
    }

    saveLocalStorage();
    _setupDone = true;
    console.log("✅ [Auto Setup] All channels created and panels deployed.");
}
