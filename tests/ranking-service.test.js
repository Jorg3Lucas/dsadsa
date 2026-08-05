import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/ranking-cache.js', () => ({
    findAllNicknameMatchesInCache: vi.fn(),
    findTopNicknamesInCache: vi.fn(),
    getLocalRankingCache: vi.fn(),
    cleanNickname: vi.fn((name) => name),
    // Default: very far apart → fuzzy clan fallback rejects (no false positives).
    levenshteinDistance: vi.fn(() => 99)
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    WORLD_IDS: { 611: 'EU011', 612: 'EU012' },
    MAX_NICKNAME_SUGGESTIONS: 6
}));

import { lookupNickname, lookupTopNicknames, isAlliedClanName } from '../src/core/ranking-service.js';
import { findAllNicknameMatchesInCache, findTopNicknamesInCache, getLocalRankingCache, levenshteinDistance } from '../src/core/ranking-cache.js';

describe('lookupNickname', () => {
    const mockDb = {
        config: {
            alliedClans: { 611: ['ToxicFamily', 'GearsofWar'] }
        }
    };

    const mockCache = {
        611: { PlayerOne: 'ToxicFamily' },
        612: { PlayerTwo: 'RandomClan' }
    };

    // resetAllMocks restores each mock's factory implementation (e.g.
    // levenshteinDistance => 99), preventing mockReturnValue leaks between tests.
    beforeEach(() => vi.resetAllMocks());

    it('returns found=false when no cache available', () => {
        getLocalRankingCache.mockReturnValue(null);
        const result = lookupNickname('PlayerOne', mockDb);
        expect(result).toEqual({ found: false });
    });

    it('finds exact match and checks allied clan', () => {
        findAllNicknameMatchesInCache.mockReturnValue([{ worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily' }]);
        const result = lookupNickname('PlayerOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(true);
        expect(result.serverName).toBe('EU011');
        expect(result.inAlliedClan).toBe(true);
        expect(result.fuzzySuggestion).toBeNull();
    });

    it('detects non-allied clan', () => {
        findAllNicknameMatchesInCache.mockReturnValue([{ worldId: '612', nickname: 'PlayerTwo', clanName: 'RandomClan' }]);
        const result = lookupNickname('PlayerTwo', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.serverName).toBe('EU012');
        expect(result.inAlliedClan).toBe(false);
    });

    it('prefers the allied-clan hit when the same name exists on multiple servers', () => {
        // Same character name on NA022 (non-allied clan) AND EU011 (allied clan).
        // Previously the first hit in cache order could win — e.g. resolving an EU
        // member to the NA022 clone and wrongly reporting "not in allied clan".
        findAllNicknameMatchesInCache.mockReturnValue([
            { worldId: '612', nickname: 'PlayerOne', clanName: 'RandomClan' },
            { worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily' }
        ]);
        const result = lookupNickname('PlayerOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(true);
        expect(result.worldId).toBe('611');
        expect(result.serverName).toBe('EU011');
        expect(result.inAlliedClan).toBe(true);
    });

    it('falls back to the first exact hit when no exact match is in an allied clan', () => {
        findAllNicknameMatchesInCache.mockReturnValue([
            { worldId: '612', nickname: 'PlayerOne', clanName: 'RandomClan' },
            { worldId: '611', nickname: 'PlayerOne', clanName: 'OtherClan' }
        ]);
        const result = lookupNickname('PlayerOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.worldId).toBe('612');
        expect(result.inAlliedClan).toBe(false);
    });

    it('returns fuzzy suggestion when exact fails and fuzzy succeeds', () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        findTopNicknamesInCache.mockReturnValue([{ worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily', score: 0.85 }]);
        const result = lookupNickname('PlayrOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(false);
        expect(result.fuzzySuggestion).toBe('PlayerOne');
    });

    it('prefers an allied-clan candidate among fuzzy matches even with a lower score', () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        findTopNicknamesInCache.mockReturnValue([
            { worldId: '612', nickname: 'PlayrTwo', clanName: 'RandomClan', score: 0.9 },
            { worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily', score: 0.8 }
        ]);
        const result = lookupNickname('PlayrOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(false);
        expect(result.worldId).toBe('611');
        expect(result.serverName).toBe('EU011');
        expect(result.inAlliedClan).toBe(true);
        expect(result.fuzzySuggestion).toBe('PlayerOne');
    });

    it('returns not found when both exact and fuzzy fail', () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        findTopNicknamesInCache.mockReturnValue([]);
        const result = lookupNickname('UnknownPlayer', mockDb, mockCache);
        expect(result.found).toBe(false);
    });

    it('passes pre-loaded cache to findAllNicknameMatchesInCache without calling getLocalRankingCache', () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        findTopNicknamesInCache.mockReturnValue([]);
        lookupNickname('Test', mockDb, mockCache);
        expect(findAllNicknameMatchesInCache).toHaveBeenCalledWith('Test', mockCache);
        expect(getLocalRankingCache).not.toHaveBeenCalled();
    });

    it('handles db without config gracefully', () => {
        findAllNicknameMatchesInCache.mockReturnValue([{ worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily' }]);
        const result = lookupNickname('PlayerOne', {}, mockCache);
        expect(result.found).toBe(true);
        expect(result.inAlliedClan).toBe(false);
    });

    it('treats decorated clan variants as allied (e.g. "GearsofWar战争" ≈ "GearsofWar")', () => {
        // Dinizメ case: forum shows the clan with a CJK decoration, config has the
        // exact forum spelling of the clan family. Tolerant comparison must accept it.
        findAllNicknameMatchesInCache.mockReturnValue([{ worldId: '611', nickname: 'Dinizメ', clanName: 'GearsofWar战争' }]);
        const dbWithVariant = { config: { alliedClans: { 611: ['GearsofWar シ'] } } };
        levenshteinDistance.mockReturnValue(2); // dist('gearsofwarシ','gearsofwar战争') ~ 2/14 → 86%
        const result = lookupNickname('Dinizメ', dbWithVariant, mockCache);
        expect(result.found).toBe(true);
        expect(result.inAlliedClan).toBe(true);
    });

    it('does NOT treat genuinely different clans as allied', () => {
        findAllNicknameMatchesInCache.mockReturnValue([{ worldId: '611', nickname: 'PlayerOne', clanName: 'HellRaisers' }]);
        const result = lookupNickname('PlayerOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.inAlliedClan).toBe(false);
    });

    it('rejects a clan that shares length but diverges at the start (shared-prefix guard)', () => {
        findAllNicknameMatchesInCache.mockReturnValue([{ worldId: '611', nickname: 'PlayerOne', clanName: 'BattleCats' }]);
        levenshteinDistance.mockReturnValue(2); // high similarity, but prefix differs
        const result = lookupNickname('PlayerOne', { config: { alliedClans: { 611: ['CastleCats'] } } }, mockCache);
        expect(result.found).toBe(true);
        expect(result.inAlliedClan).toBe(false);
    });

    it('isAlliedClanName: exact clean match wins without calling levenshteinDistance', () => {
        expect(isAlliedClanName('ToxicFamily', ['ToxicFamily', 'GearsofWar'])).toBe(true);
        expect(levenshteinDistance).not.toHaveBeenCalled();
    });

    it('lookupTopNicknames uses the same tolerant allied-clan check', () => {
        findTopNicknamesInCache.mockReturnValue([
            { worldId: '611', nickname: 'Dinizメ', clanName: 'GearsofWar战争', score: 1 },
            { worldId: '612', nickname: 'Other', clanName: 'RandomClan', score: 0.7 }
        ]);
        levenshteinDistance.mockReturnValue(2);
        const results = lookupTopNicknames('Dinizメ', { config: { alliedClans: { 611: ['GearsofWar シ'] } } }, mockCache, 5);
        expect(results[0].inAlliedClan).toBe(true);
        expect(results[1].inAlliedClan).toBe(false);
    });

    it('ranks allied-clan candidates FIRST in suggestions, even with a lower score', () => {
        // "Diniz メ" (gold-seller clan, non-allied) scores HIGHER by similarity, but
        // the allied "Dinizメ" (GearsofWar战争) must float to the top of the dropdown.
        findTopNicknamesInCache.mockReturnValue([
            { worldId: '612', nickname: 'Diniz メ', clanName: 'sellgold888', score: 0.95 },
            { worldId: '611', nickname: 'Dinizメ', clanName: 'GearsofWar战争', score: 0.85 }
        ]);
        levenshteinDistance.mockReturnValue(2);
        const results = lookupTopNicknames('Dinizメ', { config: { alliedClans: { 611: ['GearsofWar シ'] } } }, mockCache, 5);
        expect(results[0].nickname).toBe('Dinizメ');
        expect(results[0].inAlliedClan).toBe(true);
        expect(results[1].nickname).toBe('Diniz メ');
        expect(results[1].inAlliedClan).toBe(false);
    });

    it('prefers the allied variant when cleaned-equal names exist in the SAME world (Dinizメ vs Diniz メ)', () => {
        // Both entries clean to "dinizメ" in EU011: the member (GearsofWar战争) and a
        // different player (sellgold888). The lookup must pick the allied one.
        findAllNicknameMatchesInCache.mockReturnValue([
            { worldId: '611', nickname: 'Diniz メ', clanName: 'sellgold888' },
            { worldId: '611', nickname: 'Dinizメ', clanName: 'GearsofWar战争' }
        ]);
        levenshteinDistance.mockReturnValue(2);
        const dbWithVariant = { config: { alliedClans: { 611: ['GearsofWar シ'] } } };
        const result = lookupNickname('Dinizメ', dbWithVariant, mockCache);
        expect(result.found).toBe(true);
        expect(result.worldId).toBe('611');
        expect(result.nickname).toBe('Dinizメ');
        expect(result.inAlliedClan).toBe(true);
    });
});
