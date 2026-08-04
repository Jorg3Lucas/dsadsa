import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory filesystem so the storage module never touches a real disk.
// vi.hoisted runs before the hoisted vi.mock call, so the factory can safely
// reference these bindings.
const { memFs, memFsMock } = vi.hoisted(() => {
    const memFs = new Map();
    const memFsMock = {
        existsSync: vi.fn((p) => memFs.has(p)),
        readFileSync: vi.fn((p) => {
            if (!memFs.has(p)) throw new Error(`ENOENT: ${p}`);
            return memFs.get(p);
        }),
        writeFileSync: vi.fn((p, data) => memFs.set(p, String(data))),
        renameSync: vi.fn((from, to) => {
            if (memFs.has(from)) {
                memFs.set(to, memFs.get(from));
                memFs.delete(from);
            }
        }),
        mkdirSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        statSync: vi.fn(() => ({ size: 1, mtimeMs: Date.now() })),
        unlinkSync: vi.fn((p) => memFs.delete(p))
    };
    return { memFs, memFsMock };
});

vi.mock('node:fs', () => ({
    default: memFsMock,
    ...memFsMock
}));

vi.mock('../src/auto-backup.js', () => ({
    runBackup: vi.fn(() => 0)
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    pendingRegistrations: {},
    pendingPilotApprovals: {}
}));

import { loadLocalStorageRanking, saveRankingStorage, saveRankingStorageSync } from '../src/core/ranking-storage.js';

const DB_FILE = './database_ranking.json';

function validDb() {
    return JSON.stringify({
        users: {
            '123': { nickname: 'TestChar', registeredAt: '2026-01-01T00:00:00.000Z', pilotIds: [] }
        },
        config: {}
    });
}

describe('saveRankingStorage — no-argument calls (regression)', () => {
    // NOTE: these tests run in declaration order on purpose — module state
    // (databaseLoaded/currentRankingDb) is shared across tests in this file.
    beforeEach(() => {
        memFs.clear();
        vi.clearAllMocks();
    });

    it('blocks saving before the database is loaded (no file, no users)', async () => {
        const loaded = loadLocalStorageRanking(); // no file → empty db, databaseLoaded = false
        expect(Object.keys(loaded.users)).toHaveLength(0);

        const result = await saveRankingStorage(); // no args, like handlers call it
        expect(result).toBe(false);
    });

    it('saves the loaded database when called with NO arguments', async () => {
        memFs.set(DB_FILE, validDb());
        const loaded = loadLocalStorageRanking();
        expect(Object.keys(loaded.users)).toHaveLength(1);

        const result = await saveRankingStorage(); // the exact crash scenario from production
        expect(result).toBe(true);

        const saved = JSON.parse(memFs.get(DB_FILE));
        expect(Object.keys(saved.users)).toHaveLength(1);
        expect(saved._metadata).toBeDefined();
        expect(saved.users['123'].nickname).toBe('TestChar');
    });

    it('persists in-memory mutations made before a no-arg save', async () => {
        memFs.set(DB_FILE, validDb());
        const loaded = loadLocalStorageRanking();

        loaded.users['456'] = { nickname: 'SecondChar', registeredAt: '2026-02-01T00:00:00.000Z', pilotIds: [] };
        const result = await saveRankingStorage();
        expect(result).toBe(true);

        const saved = JSON.parse(memFs.get(DB_FILE));
        expect(Object.keys(saved.users)).toHaveLength(2);
    });

    it('saveRankingStorageSync also works with no arguments after load', async () => {
        memFs.set(DB_FILE, validDb());
        loadLocalStorageRanking();

        const result = saveRankingStorageSync();
        expect(result).toBe(true);
        const saved = JSON.parse(memFs.get(DB_FILE));
        expect(Object.keys(saved.users)).toHaveLength(1);
    });

    it('uses an explicit database argument when provided', async () => {
        memFs.set(DB_FILE, validDb());
        loadLocalStorageRanking();

        const explicit = { users: { '999': { nickname: 'Explicit', registeredAt: '2026-03-01T00:00:00.000Z', pilotIds: [] } } };
        const result = await saveRankingStorage(explicit);
        expect(result).toBe(true);

        const saved = JSON.parse(memFs.get(DB_FILE));
        expect(Object.keys(saved.users)).toEqual(['999']);
    });
});
