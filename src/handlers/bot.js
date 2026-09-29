import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent } from "../core/state.js";
import { buildPanelDefaults, migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, migratePlantOreCooldown, migrateAntidemon9e10, migrateMS1112, migrateSPLegacyToUnified, processAutoRecoveryOnBoot, refreshVisualPanel } from "./panel-utils.js";
import { startTickInterval } from "./panel-tick.js";


// ==========================================
// 🚀 INITIALIZATION
// ==========================================

export async function initClaimSystem(botClient, database, saveStorageFn, logEventFn, messagesTracker, skipRecovery = false) {
    initState({ client: botClient, db: database, saveLocalStorage: saveStorageFn, logEvent: logEventFn, lastMessages: messagesTracker });

    // Build all known panel keys and initialize if missing
    const allPanelKeys = [];

    defaultFloors.forEach(floor => {
        allPanelKeys.push(`${floor}peak`);
        allPanelKeys.push(`${floor}squarenormal`);
        if (floor !== "9" && floor !== "10") {
            allPanelKeys.push(`${floor}squareantidemon`);
        }
    });
    ["9", "10", "11", "12"].forEach(floor => allPanelKeys.push(`${floor}squareantidemon`));
    ["11", "12"].forEach(floor => {
        allPanelKeys.push(`${floor}peak`);
        allPanelKeys.push(`${floor}squareleaders`);
        allPanelKeys.push(`${floor}squareevents`);
    });
    allPanelKeys.push("12randomevent");
    allPanelKeys.push("11goblin", "12goblin", "11msgoblin", "12msgoblin");
    allPanelKeys.push("summon");

    // Deduplicate and initialize
    for (const key of [...new Set(allPanelKeys)]) {
        if (!db[key]) {
            const defaults = buildPanelDefaults(key);
            if (defaults) db[key] = defaults;
        }
    }

    loadPunishmentsFromDisk();

    migrateBossCooldowns();
    migrateNamesCleanEmojis();
    migrateLastKilledAt();
    migratePlantOreCooldown();
    migrateAntidemon9e10();
    migrateMS1112();
    migrateSPLegacyToUnified();

    if (skipRecovery) {
        // The channel auto-setup runs right after this call: it clears the panel
        // mappings and RE-SENDS every panel. Force-refreshing here would race
        // with the channel deletion — an edit that fails on a channel being
        // removed could trigger a recovery that re-sends the panel into a
        // different (old) channel, leaving a duplicate panel behind.
        logEvent("Sub-system initialized (panel recovery skipped — will be rebuilt by auto-setup).");
        return;
    }

    // Force-refresh all panels to fix any incorrect respawn timers on existing
    // displays. Awaited (and isolated per panel) so the edits finish before the
    // recovery pass and the tick start touching the same panels.
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        try {
            await refreshVisualPanel(key);
        } catch (err) {
            logEvent(`Failed to refresh panel ${key}: ${err.message}`);
        }
    }

    await processAutoRecoveryOnBoot();
    startTickInterval();
    logEvent("Sub-system initialized and panels auto-refreshed inside global Client.");
}

// ==========================================
// 🔄 RE-EXPORTS (for index.js compatibility)
// ==========================================

export { handleClaimInteractions } from "./claim-handlers.js";
