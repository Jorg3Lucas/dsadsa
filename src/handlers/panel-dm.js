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

// In-flight guard: concurrent refreshes of the SAME panel (tick + button click)
// share one promise, so two recovery paths can never both decide the message is
// gone and post a fresh duplicate.
const pendingRefreshes = {};

/** Edit a panel's embed + buttons in-place, or recover by re-using the persisted panel message. @param {string} key - Panel key */
export async function refreshVisualPanel(key) {
    if (pendingRefreshes[key]) return pendingRefreshes[key];
    const run = doRefreshVisualPanel(key).finally(() => { delete pendingRefreshes[key]; });
    pendingRefreshes[key] = run;
    return run;
}

async function doRefreshVisualPanel(key) {
    const payload = {
        embeds: [renderEmbed(key)],
        components: renderButtons(key)
    };
    const cachedMsg = lastMessages[key];
    const mapping = db._panelMapping && db._panelMapping[key];

    // Fast path: the cached reference is a real Message → edit in place.
    if (cachedMsg && typeof cachedMsg.edit === 'function') {
        try {
            await cachedMsg.edit(payload);
            return;
        } catch {
            // Message may have been deleted — fall through to recovery.
        }
    }

    // Recovery: edit the EXISTING panel message (via the persisted mapping) so a
    // transient edit failure never leaves a duplicate behind. Only when that
    // message is truly gone do we post a fresh one and re-map.
    if (mapping && mapping.channelId) {
        try {
            const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
            if (!channel) return;

            if (mapping.messageId) {
                const existing = await channel.messages.fetch(mapping.messageId).catch(() => null);
                if (existing) {
                    await existing.edit(payload).catch(() => null);
                    lastMessages[key] = existing;
                    return;
                }
            }

            const newMsg = await channel.send(payload).catch(() => null);
            if (newMsg) {
                lastMessages[key] = newMsg;
                db._panelMapping[key] = { channelId: channel.id, messageId: newMsg.id };
                saveLocalStorage();
            }
        } catch (e) {
            logEvent(`Failed to recover panel ${key}: ${e.message}`);
        }
    }
    // No mapping → panel was never posted; nothing to refresh.
}

/** Send a DM to a user through the rate-limited queue (auto-skips opt-outs). @param {string} uid - Discord user ID @param {string} msgContent - Message text */
export async function notifyUserDM(uid, msgContent) {
    if (dmOptOut.has(uid)) return;
    dmQueue.push({ uid, content: msgContent });
    processDMQueue();
}
