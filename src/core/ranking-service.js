// ==========================================
// 🔍 RANKING LOOKUP SERVICE
// ==========================================
// Centralized service for looking up nicknames in the ranking cache
// with automatic fuzzy matching and allied clan verification.

import { WORLD_IDS } from './ranking-constants.js';
import {
    findNicknameInCache,
    findClosestNicknameInCache,
    findTopNicknamesInCache,
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

// ── Top N fuzzy matches ──
// Returns up to `limit` candidates, each with full info + score.
export function lookupTopNicknames(nickname, db, cache, limit = 3) {
    if (!cache) {
        cache = getLocalRankingCache();
    }
    if (!cache) return [];

    const topMatches = findTopNicknamesInCache(nickname, cache, limit);

    return topMatches.map(match => {
        const serverName = WORLD_IDS[match.worldId] || `World ${match.worldId}`;
        const worldAlliedClans = db.config?.alliedClans?.[match.worldId];
        const inAlliedClan = !!(worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === match.clanName.toLowerCase()));
        return {
            worldId: match.worldId,
            nickname: match.nickname,
            clanName: match.clanName,
            serverName,
            inAlliedClan,
            score: match.score
        };
    });
}
