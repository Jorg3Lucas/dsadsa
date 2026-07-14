import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/ranking-cache.js', () => ({
    findNicknameInCache: vi.fn(),
    findClosestNicknameInCache: vi.fn(),
    getLocalRankingCache: vi.fn()
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    WORLD_IDS: { 611: 'EU011', 612: 'EU012' }
}));

import { lookupNickname } from '../src/core/ranking-service.js';
import { findNicknameInCache, findClosestNicknameInCache, getLocalRankingCache } from '../src/core/ranking-cache.js';

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
        findNicknameInCache.mockReturnValue({ worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily' });
        const result = lookupNickname('PlayerOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(true);
        expect(result.serverName).toBe('EU011');
        expect(result.inAlliedClan).toBe(true);
        expect(result.fuzzySuggestion).toBeNull();
    });

    it('detects non-allied clan', () => {
        findNicknameInCache.mockReturnValue({ worldId: '612', nickname: 'PlayerTwo', clanName: 'RandomClan' });
        const result = lookupNickname('PlayerTwo', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.serverName).toBe('EU012');
        expect(result.inAlliedClan).toBe(false);
    });

    it('returns fuzzy suggestion when exact fails and fuzzy succeeds', () => {
        findNicknameInCache.mockReturnValue(null);
        findClosestNicknameInCache.mockReturnValue({ worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily', score: 0.85 });
        const result = lookupNickname('PlayrOne', mockDb, mockCache);
        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(false);
        expect(result.fuzzySuggestion).toBe('PlayerOne');
    });

    it('returns not found when both exact and fuzzy fail', () => {
        findNicknameInCache.mockReturnValue(null);
        findClosestNicknameInCache.mockReturnValue(null);
        const result = lookupNickname('UnknownPlayer', mockDb, mockCache);
        expect(result.found).toBe(false);
    });

    it('passes pre-loaded cache to findNicknameInCache without calling getLocalRankingCache', () => {
        findNicknameInCache.mockReturnValue(null);
        findClosestNicknameInCache.mockReturnValue(null);
        lookupNickname('Test', mockDb, mockCache);
        expect(findNicknameInCache).toHaveBeenCalledWith('Test', mockCache);
        expect(getLocalRankingCache).not.toHaveBeenCalled();
    });

    it('handles db without config gracefully', () => {
        findNicknameInCache.mockReturnValue({ worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily' });
        const result = lookupNickname('PlayerOne', {}, mockCache);
        expect(result.found).toBe(true);
        expect(result.inAlliedClan).toBe(false);
    });
});
