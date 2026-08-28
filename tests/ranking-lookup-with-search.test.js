import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAxiosGet } = vi.hoisted(() => ({
    mockAxiosGet: vi.fn()
}));

vi.mock('axios', () => ({ default: { get: mockAxiosGet } }));

// Minimal cheerio mock: handles $('table tbody tr').each((i, el) => { $(el).find('td').eq(n).text() }
vi.mock('cheerio', () => ({
    load: (html) => {
        // Pre-parse all table rows into cell arrays
        const rows = [];
        const trRegex = /<tr>([\s\S]*?)<\/tr>/g;
        let m;
        while ((m = trRegex.exec(html)) !== null) {
            const cells = [];
            const tdRegex = /<td>([\s\S]*?)<\/td>/g;
            let t;
            while ((t = tdRegex.exec(m[1])) !== null) {
                cells.push(t[1].trim());
            }
            rows.push(cells);
        }

        const $ = (sel) => {
            // $('table tbody tr') — return row collection
            if (typeof sel === 'string') {
                return {
                    each: (cb) => {
                        rows.forEach((cells, i) => {
                            // el must support $(el).find('td')
                            const el = { _cells: cells };
                            cb(i, el);
                        });
                    }
                };
            }
            // $(el) where el is { _cells: [...] } — return element wrapper
            if (sel && sel._cells) {
                return {
                    find: () => ({
                        length: sel._cells.length,
                        eq: (n) => ({
                            text: () => sel._cells[n] || ''
                        })
                    })
                };
            }
            return { find: () => ({ length: 0, eq: () => ({ text: () => '' }) }) };
        };
        return $;
    }
}));

vi.mock('../src/core/ranking-cache.js', () => ({
    findAllNicknameMatchesInCache: vi.fn(() => []),
    findTopNicknamesInCache: vi.fn(() => []),
    getLocalRankingCache: vi.fn(() => null),
    cleanNickname: vi.fn((name) => (name || '').trim().normalize('NFKC').toLowerCase()
        .replace(/[|\[\](){}#\-–—:;\"'`~!@$%^&*_+=<>?/\\,•·●○.,«»‹›★☆♡♥▪▫・҉§¶†‡※◆◇■□▲△▼▽♠♣♥♦✧✦🎵]/g, '')
        .replace(/[\u2460-\u24FF]/g, '')
        .replace(/[\u25A0-\u25FF]/g, '')
        .replace(/[\u2600-\u26FF]/g, '')
        .replace(/[\u2700-\u27BF]/g, '')
        .replace(/[\u2B00-\u2BFF]/g, '')
        .replace(/[\u20DD-\u20E3]/g, '')
        .replace(/[\uFE00-\uFE0F]/g, '')
        .replace(/\p{Cf}+/gu, '')
        .replace(/\s+/g, '')),
    levenshteinDistance: vi.fn((a, b) => {
        if (a === b) return 0;
        return Math.max(a.length, b.length);
    })
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    WORLD_IDS: { 611: 'EU011', 612: 'EU012', 811: 'ASIA011' },
    MAX_NICKNAME_SUGGESTIONS: 6,
    resolveServerName: (name) => name
}));

import { lookupNicknameWithSearch } from '../src/core/ranking-service.js';
import {
    findAllNicknameMatchesInCache,
    findTopNicknamesInCache,
    getLocalRankingCache
} from '../src/core/ranking-cache.js';

// 5-column search result format: Rank, Character, Server(empty), Clan, Power
function forumSearchResult(character, clan, power = '100000') {
    return `<html><body><table><tbody>
        <tr><td>1500</td><td>${character}</td><td></td><td>${clan}</td><td>${power}</td></tr>
    </tbody></table></body></html>`;
}

const forumEmpty = '<html><body><table><tbody></tbody></table></body></html>';

describe('lookupNicknameWithSearch — priority: exact → forum → fuzzy', () => {
    const mockDb = {
        config: {
            alliedClans: {
                611: ['ToxicFamily', 'GearsofWar シ'],
                811: ['GearsofWar シ']
            }
        }
    };

    const mockCache = {
        611: { PlayerOne: 'ToxicFamily', GearsofWarMember: 'GearsofWar ③' },
        612: { PlayerTwo: 'RandomClan' }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        getLocalRankingCache.mockReturnValue(mockCache);
    });

    // ── Priority 1: Exact match in cache ──

    it('returns exact cache match immediately without searching forum', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([
            { worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily' }
        ]);

        const result = await lookupNicknameWithSearch('PlayerOne', mockDb, mockCache);

        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(true);
        expect(result.serverName).toBe('EU011');
        expect(result.inAlliedClan).toBe(true);
        expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    // ── Priority 2: Forum search (when no exact cache match) ──

    it('searches forum when exact cache match fails, and returns forum result', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        mockAxiosGet.mockResolvedValue({ data: forumSearchResult('MaloYツ', 'GearsofWar ③') });

        const result = await lookupNicknameWithSearch('MaloYツ', mockDb, mockCache);

        expect(result.found).toBe(true);
        expect(result.fromForumSearch).toBe(true);
        expect(result.nickname).toBe('MaloYツ');
        expect(result.clanName).toBe('GearsofWar ③');
        expect(mockAxiosGet).toHaveBeenCalled();
        expect(findTopNicknamesInCache).not.toHaveBeenCalled();
    });

    it('resolves worldId from clan name in cache when forum returns worldId=null', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        mockAxiosGet.mockResolvedValue({ data: forumSearchResult('MaloYツ', 'GearsofWar ③') });

        const result = await lookupNicknameWithSearch('MaloYツ', mockDb, mockCache);

        expect(result.found).toBe(true);
        // cleanNickname("GearsofWar ③") === cleanNickname("GearsofWar シ") → matches world 611
        expect(result.worldId).toBe('611');
        expect(result.serverName).toBe('EU011');
    });

    // ── Priority 3: Fuzzy match in cache (when forum also fails) ──

    it('falls back to fuzzy cache match when forum returns no results', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        mockAxiosGet.mockResolvedValue({ data: forumEmpty });
        findTopNicknamesInCache.mockReturnValue([
            { worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily', score: 0.85 }
        ]);

        const result = await lookupNicknameWithSearch('PlayrOne', mockDb, mockCache);

        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(false);
        expect(result.fuzzySuggestion).toBe('PlayerOne');
        expect(mockAxiosGet).toHaveBeenCalled();
        expect(findTopNicknamesInCache).toHaveBeenCalled();
    });

    it('returns not found when all three sources fail', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        mockAxiosGet.mockResolvedValue({ data: forumEmpty });
        findTopNicknamesInCache.mockReturnValue([]);

        const result = await lookupNicknameWithSearch('UnknownPlayer', mockDb, mockCache);

        expect(result.found).toBe(false);
        expect(mockAxiosGet).toHaveBeenCalled();
        expect(findTopNicknamesInCache).toHaveBeenCalled();
    });

    // ── Forum error handling ──

    it('skips forum on error and falls back to fuzzy', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        mockAxiosGet.mockRejectedValue(new Error('Network timeout'));
        findTopNicknamesInCache.mockReturnValue([
            { worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily', score: 0.85 }
        ]);

        const result = await lookupNicknameWithSearch('PlayrOne', mockDb, mockCache);

        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(false);
        expect(result.fuzzySuggestion).toBe('PlayerOne');
    });

    // ── Exact cache match wins even when forum has results ──

    it('prefers exact cache match over forum results', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([
            { worldId: '611', nickname: 'PlayerOne', clanName: 'ToxicFamily' }
        ]);
        mockAxiosGet.mockResolvedValue({ data: forumSearchResult('PlayerOne', 'ToxicFamily') });

        const result = await lookupNicknameWithSearch('PlayerOne', mockDb, mockCache);

        expect(result.found).toBe(true);
        expect(result.exactMatch).toBe(true);
        expect(result.fromForumSearch).toBeUndefined();
        expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    // ── Forum finds result → fuzzy not called ──

    it('does not call fuzzy when forum finds a result', async () => {
        findAllNicknameMatchesInCache.mockReturnValue([]);
        mockAxiosGet.mockResolvedValue({ data: forumSearchResult('TestNick', 'SomeClan') });

        const result = await lookupNicknameWithSearch('TestNick', mockDb, mockCache);

        expect(result.found).toBe(true);
        expect(result.fromForumSearch).toBe(true);
        expect(findTopNicknamesInCache).not.toHaveBeenCalled();
    });
});
