// ==========================================
// 🩺 PANEL RECOVERY WATCHDOG
// ==========================================
// Guarantees that every claim panel keeps flowing. A panel whose render has
// not been accepted by Discord for STALE_PANEL_MS (1h) is escalated:
//   1. delete the stale panel message and re-send it in the same channel;
//   2. if that fails, delete and recreate the whole channel and resend
//      every panel that belongs to it.
// A heartbeat force-refreshes idle panels so a silently broken panel is
// detected instead of just sitting there unnoticed.

import { client, db, lastMessages, saveLocalStorage, logEvent } from "../core/state.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { CLAIM_CATEGORIES, findClaimCategory } from "../core/server-structure.js";
import { noop } from "../core/config.js";
import { logger } from "../core/logger.js";
import {
    refreshVisualPanel,
    recoverPanelMessage,
    markPanelHealthy,
    getPanelHealth,
    notifyUserDM
} from "./panel-dm.js";
import { SUPER_ADMIN_USER_ID } from "../core/ranking-constants.js";

// A panel that has not refreshed successfully for this long is escalated.
const STALE_PANEL_MS = 60 * 60 * 1000;        // 1h
// How often the watchdog runs and how old a panel may get before we poke it.
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;   // 5m
const HEARTBEAT_AGE_MS = 10 * 60 * 1000;      // 10m
// Don't hammer a panel that keeps failing recovery.
const RECOVERY_COOLDOWN_MS = 30 * 60 * 1000;  // 30m

const lastRecoveryAttempt = new Map();

/**
 * Map a panel key to its claim category + channel definition.
 * Returns null for keys that are not claim panels (so the watchdog only ever
 * touches the panels it owns).
 * @param {string} panelKey
 * @returns {{categoryDef: object, channelDef: object}|null}
 */
export function findChannelDefForPanel(panelKey) {
    for (const categoryDef of CLAIM_CATEGORIES) {
        const channelDef = categoryDef.channels.find(
            c => Array.isArray(c.panels) && c.panels.includes(panelKey)
        );
        if (channelDef) return { categoryDef, channelDef };
    }
    return null;
}

/**
 * Escalation step 2: delete the panel's channel and recreate it with fresh
 * panel messages. Returns true when the panel was re-sent successfully.
 * @param {string} key - Panel key
 * @param {string} guildId
 */
export async function recreateChannelForPanel(key, guildId) {
    const found = findChannelDefForPanel(key);
    if (!found) return false;

    const guild = guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first();
    if (!guild) return false;

    const { categoryDef, channelDef } = found;
    const category = findClaimCategory(guild, categoryDef);
    if (!category) {
        logEvent(`♻️ Panel recovery: category "${categoryDef.name}" not found — cannot recreate channel for ${key}.`);
        return false;
    }

    // Find an existing channel by pretty name, legacy name, or logical key.
    const inCategory = guild.channels.cache.filter(c => c.parentId === category.id && c.type === 0);
    const existing = inCategory.find(c => c.name === channelDef.name)
        || (channelDef.legacyName ? inCategory.find(c => c.name === channelDef.legacyName) : null)
        || (channelDef.key ? inCategory.find(c => c.name === channelDef.key) : null);

    if (existing) {
        for (const pk of channelDef.panels) {
            delete lastMessages[pk];
            if (db._panelMapping) delete db._panelMapping[pk];
        }
        await existing.delete().catch(noop);
    }

    const overwrites = category.permissionOverwrites?.cache?.map(o => o) || [];
    const newChannel = await guild.channels.create({
        name: channelDef.name,
        type: 0, // GuildText
        parent: category.id,
        permissionOverwrites: overwrites
    }).catch(err => {
        logger.error('Panel', `Failed to recreate channel ${channelDef.name}`, err);
        return null;
    });
    if (!newChannel) return false;

    if (!db._panelMapping) db._panelMapping = {};
    let allOk = true;
    for (const pk of channelDef.panels) {
        if (!db[pk]) continue;
        let sent = null;
        try {
            sent = await newChannel.send({
                embeds: [renderEmbed(pk)],
                components: renderButtons(pk)
            });
        } catch (err) {
            logger.warn('Panel', `Failed to re-send panel ${pk} after channel recreation`, err);
        }
        if (sent) {
            lastMessages[pk] = sent;
            db._panelMapping[pk] = { channelId: newChannel.id, messageId: sent.id };
            markPanelHealthy(pk);
        } else {
            allOk = false;
        }
    }

    saveLocalStorage();
    logEvent(`♻️ Panel recovery: recreated channel #${channelDef.name} in "${categoryDef.name}" (${allOk ? 'all panels resent' : 'some panels failed'}).`);
    return allOk && !!db._panelMapping[key];
}

/** Warn the super admin about an automatic recovery (best effort). */
async function notifySuperAdmin(key, stage) {
    if (!SUPER_ADMIN_USER_ID) return;
    await notifyUserDM(
        SUPER_ADMIN_USER_ID,
        `⚠️ **[Panel Recovery]** O painel \`${key}\` ficou mais de 1h sem atualizar.\nAção automática: ${stage}.`
    ).catch(noop);
}

/**
 * One pass over every claim panel: heartbeat idle panels, then escalate any
 * panel that has been stale for over an hour.
 * @param {string} [guildId]
 */
export async function runPanelHealthCheck(guildId) {
    const now = Date.now();

    for (const key in db) {
        try {
            if (!db[key] || key.startsWith("_")) continue;
            // Only claim panels are monitored (registration/approval panels are static).
            if (!findChannelDefForPanel(key)) continue;

            let health = getPanelHealth(key);
            if (!health) {
                // First time we see this panel: trust it so a restart doesn't
                // immediately trigger an escalation.
                markPanelHealthy(key);
                health = now;
            }

            // Heartbeat: refresh if it has been a while so a broken panel is caught.
            if (now - health > HEARTBEAT_AGE_MS) {
                await refreshVisualPanel(key);
                health = getPanelHealth(key);
            }

            if (now - health <= STALE_PANEL_MS) continue;

            const lastAttempt = lastRecoveryAttempt.get(key) || 0;
            if (now - lastAttempt < RECOVERY_COOLDOWN_MS) continue;
            lastRecoveryAttempt.set(key, now);

            logEvent(`⚠️ Panel ${key} has not refreshed for over 1h — starting recovery.`);

            let stage = "mensagem do painel reenviada";
            let ok = await recoverPanelMessage(key);

            if (!ok) {
                stage = "canal apagado e recriado";
                ok = await recreateChannelForPanel(key, guildId);
            }
            if (!ok) {
                stage = "falhou (mensagem e canal)";
                logEvent(`❌ Panel recovery failed for ${key} (message and channel).`);
            }

            await notifySuperAdmin(key, stage);
        } catch (err) {
            // Never let one bad panel abort the whole health pass.
            logger.error('Panel', `Health check failed for ${key}`, err);
        }
    }
}

/**
 * Start the periodic panel watchdog. Safe to call once after channel setup.
 * @param {string} [guildId]
 */
export function startPanelWatchdog(guildId) {
    const tick = () => runPanelHealthCheck(guildId).catch(
        err => logger.error('Panel', 'Health check failed', err)
    );
    setInterval(tick, WATCHDOG_INTERVAL_MS);
    // First pass shortly after boot, once the channels are ready.
    setTimeout(tick, 60_000);
    logEvent('🩺 Panel watchdog started (heartbeat 5m, stale threshold 1h).');
}
