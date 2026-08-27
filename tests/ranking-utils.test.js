import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/ranking-cache.js', () => ({
    getLocalRankingCache: vi.fn(() => null)
}));

vi.mock('../src/core/ranking-service.js', () => ({
    lookupNickname: vi.fn()
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    MEMBER_ROLE_ID: '123',
    SERVER_MERGES: {
        'ASIA013': 'ASIA021', 'EU013': 'EU011', 'NA041': 'NA012'
    },
    resolveServerName: (name) => ({
        'ASIA013': 'ASIA021', 'EU013': 'EU011', 'NA041': 'NA012'
    }[name] || name)
}));

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key) => key)
}));

import { buildPrefixedNickname } from '../src/core/ranking-utils.js';
import { resolveServerName } from '../src/core/ranking-constants.js';
import { getLocalRankingCache } from '../src/core/ranking-cache.js';
import { lookupNickname } from '../src/core/ranking-service.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('buildPrefixedNickname', () => {
    const db = { config: {} };

    it('uses the precomputed lookup without re-fetching the cache or re-resolving', () => {
        const precomputed = { found: true, serverName: 'EU011' };
        const result = buildPrefixedNickname('PlayerOne', db, '', precomputed);
        expect(result).toBe('EU011 - PlayerOne');
        expect(getLocalRankingCache).not.toHaveBeenCalled();
        expect(lookupNickname).not.toHaveBeenCalled();
    });

    it('appends the Pilot suffix when requested', () => {
        const precomputed = { found: true, serverName: 'EU011' };
        const result = buildPrefixedNickname('PlayerOne', db, 'Pilot', precomputed);
        expect(result).toBe('EU011 - PlayerOne - Pilot');
    });

    it('falls back to no prefix when the precomputed lookup is not found', () => {
        const precomputed = { found: false };
        const result = buildPrefixedNickname('PlayerOne', db, '', precomputed);
        expect(result).toBe('PlayerOne');
    });

    it('performs a fresh lookup when no precomputed lookup is given (legacy path)', () => {
        getLocalRankingCache.mockReturnValue({ 611: {} });
        lookupNickname.mockReturnValue({ found: true, serverName: 'SA021' });
        const result = buildPrefixedNickname('PlayerOne', db);
        expect(result).toBe('SA021 - PlayerOne');
        expect(getLocalRankingCache).toHaveBeenCalledTimes(1);
        expect(lookupNickname).toHaveBeenCalledWith('PlayerOne', db, { 611: {} });
    });

    it('returns bare nickname when the cache is unavailable (legacy path)', () => {
        getLocalRankingCache.mockReturnValue(null);
        const result = buildPrefixedNickname('PlayerOne', db, 'Pilot');
        expect(result).toBe('PlayerOne - Pilot');
        expect(lookupNickname).not.toHaveBeenCalled();
    });
});

describe('resolveServerName', () => {
    it('returns the surviving server for an absorbed server', () => {
        expect(resolveServerName('ASIA013')).toBe('ASIA021');
        expect(resolveServerName('EU013')).toBe('EU011');
        expect(resolveServerName('NA041')).toBe('NA012');
    });

    it('returns the same name when the server is not merged', () => {
        expect(resolveServerName('EU011')).toBe('EU011');
        expect(resolveServerName('ASIA021')).toBe('ASIA021');
        expect(resolveServerName('NA011')).toBe('NA011');
    });

    it('returns the same name for unknown server names', () => {
        expect(resolveServerName('UNKNOWN')).toBe('UNKNOWN');
        expect(resolveServerName('')).toBe('');
    });
});
