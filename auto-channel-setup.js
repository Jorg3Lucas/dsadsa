// ==========================================
// 🏗️ AUTO CHANNEL SETUP
// Deletes all channels in floor categories and
// recreates them with panel embeds on boot.
// ==========================================

import { db, lastMessages, saveLocalStorage } from "./state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";

// ── Category definitions ──
const CATEGORY_CONFIG = {
    "1499858717456334878": {
        name: "7F",
        channels: [
            { name: "🔸┃sp7", panels: ["7peak"] },
            { name: "🔹┃ms7", panels: ["7squarenormal", "7squareantidemon"] }
        ]
    },
    "1499858702814150758": {
        name: "8F",
        channels: [
            { name: "🔸┃sp8", panels: ["8peak"] },
            { name: "🔹┃ms8", panels: ["8squarenormal", "8squareantidemon"] }
        ]
    },
    "1499858660678041753": {
        name: "9F",
        channels: [
            { name: "🔸┃sp9", panels: ["9peak"] },
            { name: "🔹┃ms9", panels: ["9squarenormal", "9squareantidemon11", "9squareantidemon12"] }
        ]
    },
    "1499857572453421159": {
        name: "10F",
        channels: [
            { name: "🔸┃sp10", panels: ["10peak"] },
            { name: "🔹┃ms10", panels: ["10squarenormal", "10squareantidemon11", "10squareantidemon12"] }
        ]
    },
    "1511063558224613396": {
        name: "11F",
        channels: [
            { name: "🔸┃sp11", panels: ["11peak", "11goblin"] },
            { name: "🔹┃ms11", panels: ["11squareleaders", "11squareevents", "11squareantidemon", "11msgoblin"] }
        ]
    },
    "1511063661458751708": {
        name: "12F",
        channels: [
            { name: "🔸┃sp12", panels: ["12peak", "12randomevent", "12goblin"] },
            { name: "🔹┃ms12", panels: ["12squareleaders", "12squareevents", "12squareantidemon", "12msgoblin"] }
        ]
    },
    "1512360620127817898": {
        name: "Summons",
        channels: [
            { name: "🌀┃summons", panels: ["summon"] }
        ]
    }
};

let _setupDone = false;

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

    console.log("🏗️ [Auto Setup] Starting channel setup...");

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
                    parent: catId
                });
                console.log(`✅ [Auto Setup] Created #${chanDef.name} in ${catConfig.name}.`);
            } catch (err) {
                console.error(`❌ [Auto Setup] Failed to create #${chanDef.name}: ${err.message}`);
                continue;
            }

            // ── Send panel messages ──
            for (const panelKey of chanDef.panels) {
                if (!db[panelKey]) {
                    console.warn(`⚠️ [Auto Setup] Panel ${panelKey} not in DB, skipping.`);
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
                    console.log(`📋 [Auto Setup] Panel ${panelKey} sent to #${chanDef.name}.`);
                } catch (err) {
                    console.error(`❌ [Auto Setup] Failed to send ${panelKey} in #${chanDef.name}: ${err.message}`);
                }
            }
        }
    }

    saveLocalStorage();
    _setupDone = true;
    console.log("✅ [Auto Setup] All channels created and panels deployed.");
}

