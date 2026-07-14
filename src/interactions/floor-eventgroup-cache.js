// ==========================================
// 🎯 FLOOR — Event Group Cache
// Shared summon cache between slide and ticket handlers
// ==========================================

/** Track event group summon ticket selections (uid → { panelId, event }) */
export const egSummonCache = new Map();
