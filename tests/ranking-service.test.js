import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/ranking-cache.js', () => ({
    findAllNicknameMatchesInCache: vi.fn(),
    findTopNicknamesInCache: vi.fn(),
    getLocalRankingCache: vi.fn(),
    cleanNickname: vi.fn((name) => name)
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    WORLD_IDS: { 611: 'EU011', 612: 'EU012' }
}));

import { lookupNickname } from '../src/core/ranking-service.js';
import { findAllNicknameMatchesInCache, findTopNicknamesInCache, getLocalRankingCache } from '../src/core/ranking-cache.js';

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

    beforeEach(() => vi.clearAllMocks());

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
});
