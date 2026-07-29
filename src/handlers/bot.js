import "dotenv/config";
import { defaultFloors, initState, loadPunishmentsFromDisk, db, logEvent, worldDbs, setCurrentWorld, getAllPanelKeys } from "../core/state.js";
import { buildPanelDefaults, migrateBossCooldowns, migrateNamesCleanEmojis, migrateLastKilledAt, migratePlantOreCooldown, migrateAntidemon9e10, migrateMS1112, migrateSPLegacyToUnified, processAutoRecoveryOnBoot, refreshVisualPanel } from "./panel-utils.js";
import { startTickInterval } from "./panel-tick.js";
import { initAllWorldClaimDbs } from "../core/claim-db-manager.js";


// ==========================================
// 🚀 INITIALIZATION
// ==========================================

export function initClaimSystem(botClient, database, saveStorageFn, logEventFn, messagesTracker, rankingDatabase, skipRecovery = false) {
    // Initialize state with the old-style single db for backward compat
    initState({ client: botClient, db: database, rankingDb: rankingDatabase || null, saveLocalStorage: saveStorageFn, logEvent: logEventFn, lastMessages: messagesTracker });

    // Initialize per-world claim databases from rankingDb config
    if (rankingDatabase) {
        initAllWorldClaimDbs(rankingDatabase);
    } else {
        // Fallback: initialize panels in the boot database
        setCurrentWorld('_boot');
        const allPanelKeys = getAllPanelKeys();
        for (const key of allPanelKeys) {
            if (!db[key]) {
                const defaults = buildPanelDefaults(key);
                if (defaults) db[key] = defaults;
            }
        }
        setCurrentWorld(null);
    }

    // Run migrations for each world (must set currentWorld so db Proxy routes correctly)
    loadPunishmentsFromDisk();
    for (const world of Object.keys(worldDbs)) {
        setCurrentWorld(world);
        migrateBossCooldowns();
        migrateNamesCleanEmojis();
        migrateLastKilledAt();
        migratePlantOreCooldown();
        migrateAntidemon9e10();
        migrateMS1112();
        migrateSPLegacyToUnified();
    }
    setCurrentWorld(null);

    // Force-refresh all panels via each world's db
    for (const [world, worldData] of Object.entries(worldDbs)) {
        if (!worldData || typeof worldData !== 'object') continue;
        setCurrentWorld(world);
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            refreshVisualPanel(key);
        }
    }
    setCurrentWorld(null);

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


