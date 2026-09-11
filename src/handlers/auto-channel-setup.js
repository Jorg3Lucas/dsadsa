// ==========================================
// 🏗️ AUTO CHANNEL SETUP
// Deletes all channels in floor categories and
// recreates them with panel embeds on boot.
// Categories are matched by explicit ID first, then by
// name, then by legacy ID (upgrade fallback).
// ==========================================

import { db, lastMessages, saveLocalStorage } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { CLAIM_CATEGORIES, findClaimCategory } from "../core/server-structure.js";

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

    for (const catDef of CLAIM_CATEGORIES) {
        const category = findClaimCategory(guild, catDef);
        if (!category) {
            console.error(`❌ [Auto Setup] Category ${catDef.name} not found.`);
            continue;
        }
        // Verify it's actually a category channel (type 4)
        if (category.type !== 4) {
            console.error(`❌ [Auto Setup] ${catDef.name} is not a category (type=${category.type}). Use a valid category ID.`);
            continue;
        }
        // Rename the category to the pretty name only when it was NOT matched by
        // its explicit ID (a category matched by id keeps its current name).
        if (!catDef.id && category.name !== catDef.name) {
            await category.setName(catDef.name, "🏗️ [Auto Setup] renamed category").catch(() => {});
        }

        // ── Delete all existing text channels in this category ──
        const existingChannels = guild.channels.cache.filter(
            ch => ch.parentId === category.id && ch.type === 0
        );
        for (const [, channel] of existingChannels) {
            try {
                await channel.delete();
                console.log(`🗑️ [Auto Setup] Deleted channel #${channel.name} in ${catDef.name}.`);
            } catch (err) {
                console.error(`❌ [Auto Setup] Failed to delete #${channel.name}: ${err.message}`);
            }
        }

        // ── Create new channels (inheriting the category's permission overwrites) ──
        const categoryOverwrites = category.permissionOverwrites?.cache?.map(ow => ow) || [];
        for (const chanDef of catDef.channels) {
            let newChannel;
            try {
                newChannel = await guild.channels.create({
                    name: chanDef.name,
                    type: 0, // GuildText
                    parent: category.id,
                    permissionOverwrites: categoryOverwrites
                });
                console.log(`✅ [Auto Setup] Created #${chanDef.name} in ${catDef.name}.`);
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
