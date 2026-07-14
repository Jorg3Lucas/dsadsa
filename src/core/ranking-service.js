// ==========================================
// 🔍 RANKING LOOKUP SERVICE
// ==========================================
// Centralized service for looking up nicknames in the ranking cache
// with automatic fuzzy matching and allied clan verification.

import { WORLD_IDS } from './ranking-constants.js';
import {
    findNicknameInCache,
    findClosestNicknameInCache,
    getLocalRankingCache
} from './ranking-cache.js';

function checkAlliedClan(cacheHit, db) {
    const worldAlliedClans = db.config?.alliedClans?.[cacheHit.worldId];
    return !!(worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === cacheHit.clanName.toLowerCase()));
}

function buildResult(cacheHit, db, extraFields = {}) {
    const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;
    return {
        found: true,
        worldId: cacheHit.worldId,
        nickname: cacheHit.nickname,
        clanName: cacheHit.clanName,
        serverName,
        inAlliedClan: checkAlliedClan(cacheHit, db),
        ...extraFields
    };
}

export function lookupNickname(nickname, db, cache) {
    if (!cache) {
        cache = getLocalRankingCache();
    }
    if (!cache) return { found: false };

    const exactHit = findNicknameInCache(nickname, cache);
    if (exactHit) {
        return buildResult(exactHit, db, { exactMatch: true, fuzzySuggestion: null });
    }

    const fuzzyHit = findClosestNicknameInCache(nickname, cache);
    if (fuzzyHit && fuzzyHit.nickname.toLowerCase() !== nickname.toLowerCase()) {
        return buildResult(fuzzyHit, db, {
            exactMatch: false,
            fuzzySuggestion: fuzzyHit.nickname
        });
    }

    return { found: false };
}
