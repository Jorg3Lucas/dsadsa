import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent } from "../core/state.js";
import { buildPanelDefaults, repairPanelShape, migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, migratePlantOreCooldown, migrateAntidemon9e10, migrateMS1112, migrateSPLegacyToUnified, migrateEventClaimConfig, migrateRemove7F, migrateRemoveSummonPanel } from "./panel-utils.js";
import { CLAIM_CATEGORIES } from "../core/server-structure.js";


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
    allPanelKeys.push("11goblin", "12goblin", "11msgoblin", "12msgoblin", "12summonmiddle");

    // Whatever a claim channel lists in server-structure.js must exist in the DB:
    // auto-setup skips a panel that is missing from it, so a panel added to a
    // channel would otherwise never be posted. Union the two lists (deduped
    // below) to keep that from happening again.
    for (const key of CLAIM_CATEGORIES.flatMap(cat => cat.channels.flatMap(ch => ch.panels || []))) {
        allPanelKeys.push(key);
    }

    // Deduplicate, initialize the missing ones and repair stored panels that
    // could not be rendered as they are (a panel that throws while rendering is
    // skipped by auto-setup, so it would never show up in its channel).
    let repaired = 0;
    for (const key of [...new Set(allPanelKeys)]) {
        if (!db[key]) {
            const defaults = buildPanelDefaults(key);
            if (defaults) db[key] = defaults;
        } else if (repairPanelShape(key)) {
            repaired++;
        }
    }
    if (repaired > 0) saveStorageFn();

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
