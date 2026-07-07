// ==========================================
// 🏗️ MODULE-LEVEL STATE (Ranking only)
// ==========================================

export let client, rankingDb, saveLocalStorage, logEvent;

export function initState(opts) {
    client = opts.client;
    rankingDb = opts.rankingDb || null;
    saveLocalStorage = opts.saveLocalStorage;
    logEvent = opts.logEvent;
}
