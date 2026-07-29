// ==========================================
// 📡 PANEL DM QUEUE & REFRESH
// Extracted from panel-utils.js
// ==========================================

import { client, lastMessages, db, dmOptOut, saveLocalStorage, logEvent } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { logger } from "../core/logger.js";

// ── DM Rate-Limit Queue ───────────────────────────────
const dmQueue = [];
let dmQueueProcessing = false;
const DM_INTERVAL_MS = 1500;

async function processDMQueue() {
    if (dmQueueProcessing) return;
    dmQueueProcessing = true;

    while (dmQueue.length > 0) {
        const { uid, content } = dmQueue.shift();
        try {
            await (await client.users.fetch(uid)).send({ content });
        } catch (err) {
            if (err.code === 50007) {
                logger.warn('DM', `Cannot send DM to ${uid}: DMs closed or bot blocked.`);
            } else if (err.code === 10013) {
                logger.warn('DM', `Cannot send DM to ${uid}: User not found.`);
            } else if (err.code === 429) {
                logger.warn('DM', `Rate-limited sending to ${uid}, re-queuing.`);
                dmQueue.unshift({ uid, content });
                await new Promise(r => setTimeout(r, 5000));
                continue;
            } else {
                logger.error('DM', `Failed to send DM to ${uid}`, err);
            }
        }
        if (dmQueue.length > 0) {
            await new Promise(r => setTimeout(r, DM_INTERVAL_MS));
        }
    }

    dmQueueProcessing = false;
}

/**
 * Edit a panel's embed + buttons in-place, or recover by re-sending if the cached message is gone.
 * Uses db._panelMapping (which IS per-world via the Proxy) as the primary source of truth,
 * so it works correctly even when lastMessages has entries from a different world.
 * @param {string} key - Panel key
 */
export async function refreshVisualPanel(key) {
    // Primary source: per-world _panelMapping (works correctly across all worlds)
    const mapping = db._panelMapping?.[key];
    if (!mapping?.channelId || !mapping?.messageId) return;

    try {
        // Fetch the message from the correct channel
        const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
        if (!channel) return;
        const msg = await channel.messages.fetch(mapping.messageId).catch(() => null);
        if (msg) {
            await msg.edit({
                embeds: [renderEmbed(key)],
                components: renderButtons(key)
            });
            // Update lastMessages cache with the correct message
            lastMessages[key] = msg;
            return;
        }
        // Message was deleted — re-send
        const newMsg = await channel.send({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        });
        lastMessages[key] = newMsg;
        db._panelMapping[key] = { channelId: channel.id, messageId: newMsg.id };
        saveLocalStorage();
    } catch (e) {
        logEvent(`Failed to refresh panel ${key}: ${e.message}`);
    }
}

/** Send a DM to a user through the rate-limited queue (auto-skips opt-outs). @param {string} uid - Discord user ID @param {string} msgContent - Message text */
export async function notifyUserDM(uid, msgContent) {
    if (dmOptOut.has(uid)) return;
    dmQueue.push({ uid, content: msgContent });
    processDMQueue();
}
