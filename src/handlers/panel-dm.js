// ==========================================
// 📡 PANEL DM QUEUE & REFRESH
// Extracted from panel-utils.js
// ==========================================

import { client, lastMessages, db, dmOptOut, saveLocalStorage, logEvent } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";

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
                console.log(`⚠️ [DM] Cannot send DM to ${uid}: DMs closed or bot blocked.`);
            } else if (err.code === 10013) {
                console.log(`⚠️ [DM] Cannot send DM to ${uid}: User not found.`);
            } else if (err.code === 429) {
                console.log(`⏳ [DM] Rate-limited sending to ${uid}, re-queuing.`);
                dmQueue.unshift({ uid, content });
                await new Promise(r => setTimeout(r, 5000));
                continue;
            } else {
                console.log(`⚠️ [DM] Failed to send DM to ${uid}: ${err.message}`);
            }
        }
        if (dmQueue.length > 0) {
            await new Promise(r => setTimeout(r, DM_INTERVAL_MS));
        }
    }

    dmQueueProcessing = false;
}

/** Edit a panel's embed + buttons in-place, or recover by re-sending if the cached message is gone. @param {string} key - Panel key */
export async function refreshVisualPanel(key) {
    const cachedMsg = lastMessages[key];
    if (cachedMsg) {try {
        await cachedMsg.edit({
            embeds: [renderEmbed(key)],
            components: renderButtons(key)
        })
    } catch (n) {
        delete lastMessages[key];
        try {
            const mapping = db._panelMapping && db._panelMapping[key];
            if (mapping && mapping.channelId && mapping.messageId) {
                const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
                if (channel) {
                    const newMsg = await channel.send({
                        embeds: [renderEmbed(key)],
                        components: renderButtons(key)
                    });
                    lastMessages[key] = newMsg;
                    db._panelMapping[key] = { channelId: channel.id, messageId: newMsg.id };
                    saveLocalStorage();
                }
            }
        } catch (e) {
            logEvent(`Failed to recover panel ${key}: ${e.message}`);
        }
    }}
}

/** Send a DM to a user through the rate-limited queue (auto-skips opt-outs). @param {string} uid - Discord user ID @param {string} msgContent - Message text */
export async function notifyUserDM(uid, msgContent) {
    if (dmOptOut.has(uid)) return;
    dmQueue.push({ uid, content: msgContent });
    processDMQueue();
}
