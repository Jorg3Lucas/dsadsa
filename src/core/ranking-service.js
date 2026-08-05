// ==========================================
// 🔍 RANKING LOOKUP SERVICE
// ==========================================
// Centralized service for looking up nicknames in the ranking cache
// with automatic fuzzy matching and allied clan verification.

import { WORLD_IDS, MAX_NICKNAME_SUGGESTIONS } from './ranking-constants.js';
import {
    findAllNicknameMatchesInCache,
    findTopNicknamesInCache,
    getLocalRankingCache,
    cleanNickname,
    levenshteinDistance
} from './ranking-cache.js';

// Decoration tolerance for allied-clan comparison.
const ALLIED_CLAN_SIMILARITY = 0.8; // Levenshtein similarity threshold
const ALLIED_CLAN_MIN_LENGTH = 4;   // too-short names only match exactly
const ALLIED_CLAN_PREFIX = 3;       // shared-prefix guard against different clans

/**
 * Decoration-tolerant fallback for clan-name comparison.
 *
 * MIR4 clan names are usually a base name + decoration (e.g. "GearsofWar シ",
 * "GearsofWarツ", "GearsofWar战争", "ForWìn") and the forum spelling is
 * authoritative. Special characters, katakana, CJK and accents are unavoidable,
 * so after an exact (cleaned) comparison fails we accept a name that is VERY
 * similar (≥ 80% Levenshtein similarity) AND shares its first characters —
 * enough to treat "GearsofWar シ" and "GearsofWar战争" as the same clan family,
 * but not enough to match genuinely different clans (e.g. "ToxicFamily" vs
 * "HellRaisers" ~0% similarity).
 */
function isSimilarClan(a, b) {
    // Very short names are too ambiguous for fuzzy matching — require exact only.
    if (a.length < ALLIED_CLAN_MIN_LENGTH || b.length < ALLIED_CLAN_MIN_LENGTH) return false;
    // A different clan that merely starts similarly (e.g. "ToxicFamilyX" vs
    // "ToxicFamily") still passes here, but this blocks names that diverge early.
    if (a.slice(0, ALLIED_CLAN_PREFIX) !== b.slice(0, ALLIED_CLAN_PREFIX)) return false;
    const longer = a.length > b.length ? a : b;
    const similarity = 1 - (levenshteinDistance(a, b) / longer.length);
    return similarity >= ALLIED_CLAN_SIMILARITY;
}

/**
 * Check whether a clan name (as shown in the game-forum ranking) is one of the
 * configured allied clans of a world. Exact match first, then the
 * decoration-tolerant fallback (see isSimilarClan).
 */
export function isAlliedClanName(clanName, worldAlliedClans) {
    if (!worldAlliedClans || !clanName) return false;
    const clanClean = cleanNickname(clanName);
    return worldAlliedClans.some(c => {
        const configClean = cleanNickname(c);
        if (configClean === clanClean) return true;
        return isSimilarClan(configClean, clanClean);
    });
}

function checkAlliedClan(cacheHit, db) {
    return isAlliedClanName(cacheHit.clanName, db.config?.alliedClans?.[cacheHit.worldId]);
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

// ── Top N fuzzy matches (for suggestion dropdowns) ──
// Returns up to `limit` candidates, each with full info + score.
// Allied-clan candidates are ranked FIRST (before raw similarity), because
// the alliance's own characters are the most likely match for the typed name —
// e.g. "Dinizメ" (allied) must float above "Diniz メ" (a different player,
// gold-seller clan) even when the latter scores higher by string similarity.
export function lookupTopNicknames(nickname, db, cache, limit = MAX_NICKNAME_SUGGESTIONS) {
    if (!cache) {
        cache = getLocalRankingCache();
    }
    if (!cache) return [];

    // Fetch a wider pool BEFORE ranking by allied status, so an allied candidate
    // that scores slightly lower than non-allied homonyms is not sliced off first.
    // findTopNicknamesInCache computes all candidates before slicing, so a larger
    // pool costs nothing extra (only the slice differs).
    const poolSize = Math.max(MAX_NICKNAME_SUGGESTIONS * 3, limit * 3);
    const topMatches = findTopNicknamesInCache(nickname, cache, poolSize);

    const enriched = topMatches.map(match => {
        const serverName = WORLD_IDS[match.worldId] || `World ${match.worldId}`;
        const inAlliedClan = isAlliedClanName(match.clanName, db.config?.alliedClans?.[match.worldId]);
        return {
            worldId: match.worldId,
            nickname: match.nickname,
            clanName: match.clanName,
            serverName,
            inAlliedClan,
            score: match.score
        };
    });

    enriched.sort((a, b) => (b.inAlliedClan - a.inAlliedClan) || (b.score - a.score));

    return enriched.slice(0, limit);
}
