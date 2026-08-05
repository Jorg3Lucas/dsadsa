// ==========================================
// 🔍 RANKING LOOKUP SERVICE
// ==========================================
// Centralized service for looking up nicknames in the ranking cache
// with automatic fuzzy matching and allied clan verification.

import { WORLD_IDS } from './ranking-constants.js';
import {
    findAllNicknameMatchesInCache,
    findTopNicknamesInCache,
    getLocalRankingCache,
    cleanNickname
} from './ranking-cache.js';

function checkAlliedClan(cacheHit, db) {
    const worldAlliedClans = db.config?.alliedClans?.[cacheHit.worldId];
    return !!(worldAlliedClans && worldAlliedClans.some(c => cleanNickname(c) === cleanNickname(cacheHit.clanName)));
}

/**
 * Among several candidate matches (same/similar nickname on different worlds),
 * prefer the one inside an allied clan. The same MIR4 character name can exist
 * on multiple servers, so without this preference a member could be resolved to
 * a non-allied clone on another world (e.g. an EU player matched to someone on
 * NA022) and wrongly lose their member role. Falls back to the first candidate
 * (best score / cache order) when no allied hit exists.
 */
function pickPreferredMatch(matches, db) {
    if (!matches || matches.length === 0) return null;
    return matches.find(m => checkAlliedClan(m, db)) || matches[0];
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

    // 1. Exact matches — prefer an allied-clan hit when the same name exists on several servers.
    const exactMatches = findAllNicknameMatchesInCache(nickname, cache);
    if (exactMatches.length > 0) {
        const chosen = pickPreferredMatch(exactMatches, db);
        return buildResult(chosen, db, { exactMatch: true, fuzzySuggestion: null });
    }

    // 2. Fuzzy match — among the closest candidates, prefer an allied-clan hit.
    //    NOTE: a fuzzy hit is only a guess, so consumers must never use it as
    //    the sole reason to remove a member role (see ranking-sync-engine.js).
    //    The candidate window is generous so an allied hit with a slightly lower
    //    raw score is not dropped (findTopNicknamesInCache computes all matches
    //    before slicing, so a bigger limit costs nothing).
    const fuzzyCandidates = findTopNicknamesInCache(nickname, cache, 10);
    if (fuzzyCandidates.length > 0) {
        const chosen = pickPreferredMatch(fuzzyCandidates, db);
        if (chosen && chosen.nickname.toLowerCase() !== nickname.toLowerCase()) {
            return buildResult(chosen, db, {
                exactMatch: false,
                fuzzySuggestion: chosen.nickname
            });
        }
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
        const inAlliedClan = !!(worldAlliedClans && worldAlliedClans.some(c => cleanNickname(c) === cleanNickname(match.clanName)));
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
