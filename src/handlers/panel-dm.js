// ==========================================
// 📡 PANEL DM QUEUE & REFRESH
// Extracted from panel-utils.js
// ==========================================

import { client, lastMessages, db, dmOptOut, saveLocalStorage, logEvent } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { logger } from "../core/logger.js";
import { noop } from "../core/config.js";

// ── DM Rate-Limit Queue ───────────────────────────────
const dmQueue = [];
let dmQueueProcessing = false;
const DM_INTERVAL_MS = 1500;

// ── Panel Health Tracking ─────────────────────────────
// Map of panelKey → timestamp (ms) of the last render that Discord accepted.
// In-memory only: on boot the panels are re-sent and re-seeded, so a missing
// entry just means "unknown" and is treated as healthy on first observation.
const panelHealth = new Map();

/** Record that a panel was rendered/published successfully. @param {string} key */
export function markPanelHealthy(key) {
    panelHealth.set(key, Date.now());
}

/** Last successful refresh timestamp (ms) for a panel, or 0 when unknown. @param {string} key */
export function getPanelHealth(key) {
    return panelHealth.get(key) || 0;
}

/** Forget a panel's health (e.g. it was deleted/reset). @param {string} key */
export function clearPanelHealth(key) {
    panelHealth.delete(key);
}

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
 * Error codes meaning the panel message (or its channel) is genuinely gone, so
 * re-sending is safe. Transient errors (rate limits, network, permissions) must
 * NOT re-send, otherwise a failed edit spawns duplicate panels.
 */
function isMessageGoneError(err) {
    const code = err?.code;
    return code === 10008 || code === 10003;
}

/**
 * Delete the stored panel message (best effort) and send a fresh one to the
 * mapped channel. Returns true on success.
 * @param {string} key - Panel key
 */
export async function recoverPanelMessage(key) {
    try {
        const mapping = db._panelMapping && db._panelMapping[key];
        const channelId = mapping && mapping.channelId;
        if (!channelId) return false;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return false;

        if (mapping.messageId) {
            const old = await channel.messages.fetch(mapping.messageId).catch(() => null);
            if (old) await old.delete().catch(noop);
        }

        const sent = await channel.send({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        }).catch((err) => {
            logger.warn('Panel', `Failed to re-send panel ${key}`, err);
            return null;
        });
        if (!sent) return false;

        lastMessages[key] = sent;
        db._panelMapping[key] = { channelId: channel.id, messageId: sent.id };
        markPanelHealthy(key);
        saveLocalStorage();
        return true;
    } catch (err) {
        logger.warn('Panel', `Failed to recover panel ${key}`, err);
        return false;
    }
}

/** Edit a panel's embed + buttons in-place, or recover by re-sending if the cached message is gone. @param {string} key - Panel key */
export async function refreshVisualPanel(key) {
    if (!lastMessages[key]) {
        // No cached message reference — recover through the persisted mapping.
        await recoverPanelMessage(key);
        return;
    }

    try {
        await lastMessages[key].edit({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        });
        markPanelHealthy(key);
    } catch (err) {
        if (isMessageGoneError(err)) {
            try {
                delete lastMessages[key];
                await recoverPanelMessage(key);
            } catch (e) {
                logEvent(`Failed to recover panel ${key}: ${e.message}`);
            }
        } else {
            // Transient failure (rate limit, network, permissions): keep the
            // existing message so we never duplicate it.
            logger.warn('Panel', `Failed to refresh ${key}: ${err?.message || err}`);
        }
    }
}

/** Send a DM to a user through the rate-limited queue (auto-skips opt-outs). @param {string} uid - Discord user ID @param {string} msgContent - Message text */
export async function notifyUserDM(uid, msgContent) {
    if (dmOptOut.has(uid)) return;
    dmQueue.push({ uid, content: msgContent });
    processDMQueue();
}
