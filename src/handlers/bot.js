import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent } from "../core/state.js";
import { buildPanelDefaults, migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, migratePlantOreCooldown, migrateAntidemon9e10, removeMS1112Panels, processAutoRecoveryOnBoot, refreshVisualPanel } from "./panel-utils.js";
import { startTickInterval } from "./panel-tick.js";


// ==========================================
// 🚀 INITIALIZATION
// ==========================================

export function initClaimSystem(botClient, database, saveStorageFn, logEventFn, messagesTracker, skipRecovery = false) {
    initState({ client: botClient, db: database, saveLocalStorage: saveStorageFn, logEvent: logEventFn, lastMessages: messagesTracker });

    // Build all known panel keys and initialize if missing
    const allPanelKeys = [];

    defaultFloors.forEach(floor => {
        allPanelKeys.push(`${floor}peak`);
        if (floor !== "9" && floor !== "10") {
            allPanelKeys.push(`${floor}squareantidemon`);
        }
    });
    ["9", "10"].forEach(floor => allPanelKeys.push(`${floor}squareantidemon`));
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
    removeMS1112Panels();

    // Force-refresh all panels to fix any incorrect respawn timers on existing displays
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        refreshVisualPanel(key);
    }

    if (skipRecovery) {
        logEvent("Sub-system initialized (panel recovery skipped — will be rebuilt by auto-setup).");
        return;
    }

    return processAutoRecoveryOnBoot().then(() => {
        startTickInterval();
        logEvent("Sub-system initialized and panels auto-refreshed inside global Client.");
    });
}

// ==========================================
// 🔄 RE-EXPORTS (for index.js compatibility)
// ==========================================

export { handleClaimInteractions } from "./claim-handlers.js";
