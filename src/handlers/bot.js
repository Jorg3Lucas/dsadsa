import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent } from "../core/state.js";
import { buildPanelDefaults, migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, migratePlantOreCooldown, migrateAntidemon9e10, migrateMS1112, migrateSPLegacyToUnified, migrateEventClaimConfig, migrateRemove7F, migrateRemoveSummonPanel } from "./panel-utils.js";


// ==========================================
// 🚀 INITIALIZATION
// ==========================================

export async function initClaimSystem(botClient, database, saveStorageFn, logEventFn, messagesTracker) {
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
    migrateEventClaimConfig();
    migrateRemove7F();
    migrateRemoveSummonPanel();

    // NOTE: no refresh/recovery here on purpose. index.js runs the channel
    // auto-setup right after this call, which clears the panel mappings and
    // RE-SENDS every panel from scratch. Force-refreshing here would race with
    // the channel deletion — an edit that fails on a channel being removed
    // could trigger a recovery that re-sends the panel into a different (old)
    // channel, leaving a duplicate panel behind. index.js starts the tick and
    // the panel watchdog afterwards, once the new channels exist.
    logEvent("Sub-system initialized (panels will be rebuilt by auto-setup).");
}

// ==========================================
// 🔄 RE-EXPORTS (for index.js compatibility)
// ==========================================

export { handleClaimInteractions } from "./claim-handlers.js";
