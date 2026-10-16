// ==========================================
// 🏗️ AUTO CHANNEL SETUP
// Deletes all channels in floor categories and
// recreates them with panel embeds on boot.
// Categories are matched by explicit ID first, then by
// name, then by legacy ID (upgrade fallback).
// ==========================================

import { db, lastMessages, saveLocalStorage } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { markPanelHealthy } from "./panel-dm.js";
import { CLAIM_CATEGORIES, findClaimCategory } from "../core/server-structure.js";

let _setupDone = false;

// Panels are sent right after the channels were deleted and recreated, which is
// when Discord throttles us the most: retry a transient failure (429/timeout) a
// few times so a claim channel is never left without one of its panels.
const PANEL_SEND_ATTEMPTS = 3;
const PANEL_SEND_RETRY_MS = 2000;

/**
 * Send a panel message, retrying transient failures.
 * @param {import('discord.js').TextChannel} channel
 * @param {string} panelKey
 * @returns {Promise<object|null>} The sent message, or null after the last attempt
 */
async function sendPanelWithRetry(channel, panelKey) {
    for (let attempt = 1; attempt <= PANEL_SEND_ATTEMPTS; attempt++) {
        try {
            return await channel.send({
                embeds: [renderEmbed(panelKey)],
                components: renderButtons(panelKey)
            });
        } catch (err) {
            if (attempt === PANEL_SEND_ATTEMPTS) {
                console.error(`❌ [Auto Setup] Failed to send ${panelKey} in #${channel.name} after ${attempt} attempts: ${err.message}`);
                return null;
            }
            console.warn(`⚠️ [Auto Setup] Sending ${panelKey} in #${channel.name} failed (attempt ${attempt}/${PANEL_SEND_ATTEMPTS}), retrying...`);
            await new Promise(r => setTimeout(r, PANEL_SEND_RETRY_MS * attempt));
        }
    }
    return null;
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

    console.log("🏗️ [Auto Setup] Starting channel setup...");

    // Clear stale panel mapping so the panel watchdog never edits a message in a
    // channel that is about to be deleted (mappings are rebuilt below).
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
                    // initClaimSystem builds every panel listed by a claim channel,
                    // so this means the two lists disagree — shout about it.
                    console.error(`❌ [Auto Setup] Panel ${panelKey} is missing from the claim DB — not posted to #${chanDef.name}.`);
                    continue;
                }
                const sent = await sendPanelWithRetry(newChannel, panelKey);
                if (!sent) continue;
                lastMessages[panelKey] = sent;
                markPanelHealthy(panelKey);
                if (!db._panelMapping) db._panelMapping = {};
                db._panelMapping[panelKey] = {
                    channelId: newChannel.id,
                    messageId: sent.id
                };
                console.log(`📋 [Auto Setup] Panel ${panelKey} sent to #${chanDef.name}.`);
            }
        }
    }

    saveLocalStorage();
    _setupDone = true;
    console.log("✅ [Auto Setup] All channels created and panels deployed.");
}
