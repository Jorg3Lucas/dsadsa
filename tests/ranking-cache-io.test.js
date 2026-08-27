import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above imports, so the mock objects must be created with
// vi.hoisted to avoid "Cannot access 'fsMocks' before initialization".
const { fsMocks } = vi.hoisted(() => ({
    fsMocks: {
        statSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn()
    }
}));

vi.mock('node:fs', () => ({
    default: fsMocks
}));

vi.mock('../src/auto-backup.js', () => ({
    runBackup: vi.fn()
}));

import { saveRankingCache, getLocalRankingCache, getRankingCacheUpdatedAt } from '../src/core/ranking-cache.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('saveRankingCache / getLocalRankingCache (in-memory reference sharing)', () => {
    const rankingData = { 611: { PlayerOne: 'ToxicFamily' }, 612: { PlayerTwo: 'GearsofWar' } };

    it('saveRankingCache returns the SAME object reference without re-reading the file', () => {
        fsMocks.writeFileSync.mockImplementation(() => {});
        fsMocks.statSync.mockReturnValue({ mtimeMs: 1234 });

        saveRankingCache(rankingData);

        // The next read must return the exact object we just saved — no parse.
        const cached = getLocalRankingCache();
        expect(cached).toBe(rankingData);
        expect(fsMocks.readFileSync).not.toHaveBeenCalled();
    });

    it('tracks the updatedAt timestamp in memory for stats commands (no re-parse)', () => {
        fsMocks.writeFileSync.mockImplementation(() => {});
        fsMocks.statSync.mockReturnValue({ mtimeMs: 1234 });

        saveRankingCache(rankingData);

        expect(getRankingCacheUpdatedAt()).toBeTruthy();
        expect(new Date(getRankingCacheUpdatedAt()).getTime()).toBeGreaterThan(0);
        // The updatedAt matches what was actually written to disk
        const written = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1]);
        expect(getRankingCacheUpdatedAt()).toBe(written.updatedAt);
    });

    it('clears updatedAt when the cache is discarded (flat format)', () => {
        fsMocks.statSync.mockReturnValue({ mtimeMs: 3000 });
        fsMocks.readFileSync.mockReturnValue(JSON.stringify({ ranking: { PlayerOne: 'ToxicFamily' } }));

        expect(getLocalRankingCache()).toBeNull();
        expect(getRankingCacheUpdatedAt()).toBeNull();
    });

    it('writes compact JSON (no pretty-print indentation)', () => {
        fsMocks.writeFileSync.mockImplementation(() => {});
        fsMocks.statSync.mockReturnValue({ mtimeMs: 1234 });

        saveRankingCache(rankingData);

        expect(fsMocks.writeFileSync).toHaveBeenCalled();
        const written = fsMocks.writeFileSync.mock.calls[0][1];
        expect(written).not.toContain('\n'); // compact — single line
        expect(JSON.parse(written).ranking).toEqual(rankingData);
    });

    it('re-reads the file when mtime changed (external edit) and returns a fresh object', () => {
        // First save establishes the in-memory reference.
        fsMocks.writeFileSync.mockImplementation(() => {});
        fsMocks.statSync.mockReturnValue({ mtimeMs: 1000 }); // during save + after save
        saveRankingCache(rankingData);
        expect(getLocalRankingCache()).toBe(rankingData);

        // External change: mtime differs → must re-read + re-parse from disk.
        const newData = { 611: { PlayerOne: 'UpdatedClan' } };
        fsMocks.statSync.mockReturnValue({ mtimeMs: 2000 });
        fsMocks.readFileSync.mockReturnValue(JSON.stringify({ updatedAt: 'x', ranking: newData }));

        const cached = getLocalRankingCache();
        expect(cached).not.toBe(rankingData);
        expect(cached).toEqual(newData);
        expect(fsMocks.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('serves repeated reads from memory while mtime is unchanged (no file reads)', () => {
        fsMocks.writeFileSync.mockImplementation(() => {});
        fsMocks.statSync.mockReturnValue({ mtimeMs: 5000 });

        saveRankingCache(rankingData);

        expect(getLocalRankingCache()).toBe(rankingData);
        expect(getLocalRankingCache()).toBe(rankingData);
        expect(getLocalRankingCache()).toBe(rankingData);
        expect(fsMocks.readFileSync).not.toHaveBeenCalled();
    });

    it('discards an old flat-format file and returns null', () => {
        fsMocks.statSync.mockReturnValue({ mtimeMs: 3000 });
        fsMocks.readFileSync.mockReturnValue(JSON.stringify({ ranking: { PlayerOne: 'ToxicFamily' } }));

        expect(getLocalRankingCache()).toBeNull();
    });

    it('returns null when the file does not exist (ENOENT is silent)', () => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        fsMocks.statSync.mockImplementation(() => { throw err; });

        expect(getLocalRankingCache()).toBeNull();
        expect(fsMocks.readFileSync).not.toHaveBeenCalled();
    });

    it('returns null when the cache file content is invalid', () => {
        fsMocks.statSync.mockReturnValue({ mtimeMs: 4000 });
        fsMocks.readFileSync.mockReturnValue('not json');

        expect(getLocalRankingCache()).toBeNull();
    });
});
