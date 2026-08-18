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
import { pendingRegistrations } from '../src/core/ranking-constants.js';

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

    it('coalesces rapid saves — every caller resolves and the latest state is written once', async () => {
        memFs.set(DB_FILE, validDb());
        loadLocalStorageRanking();

        // Two saves within the debounce window: neither caller's promise may
        // hang (regression: the first timer used to be cancelled and never resolve).
        const [r1, r2] = await Promise.all([saveRankingStorage(), saveRankingStorage()]);
        expect(r1).toBe(true);
        expect(r2).toBe(true);

        const saved = JSON.parse(memFs.get(DB_FILE));
        expect(Object.keys(saved.users)).toHaveLength(1);
    });
});

describe('write path — compact JSON + pending backup diff', () => {
    const PENDING_FILE = './pending_registrations.json';

    function pendingWrites() {
        return memFsMock.writeFileSync.mock.calls.filter(c => c[0] === PENDING_FILE).length;
    }

    beforeEach(() => {
        memFs.clear();
        vi.clearAllMocks();
        // Reset module-shared pending state so tests don't leak entries into each other.
        for (const key of Object.keys(pendingRegistrations)) delete pendingRegistrations[key];
    });

    it('writes the database in compact JSON (no pretty-print indentation)', async () => {
        memFs.set(DB_FILE, validDb());
        loadLocalStorageRanking();

        const ok = await saveRankingStorage();
        expect(ok).toBe(true);

        const raw = memFs.get(DB_FILE);
        expect(raw).not.toContain('\n'); // single-line, compact
        const parsed = JSON.parse(raw);
        expect(parsed.users['123'].nickname).toBe('TestChar');
        expect(parsed._metadata).toBeDefined();
    });

    it('rewrites the pending backup ONLY when pending data actually changes', async () => {
        memFs.set(DB_FILE, validDb());
        loadLocalStorageRanking();

        // 1. Change pending → save writes the pending file (first save this test).
        pendingRegistrations['p1'] = { nickname: 'Pending1', timestamp: Date.now() };
        await saveRankingStorage();
        const writesAfterChange = pendingWrites();
        expect(writesAfterChange).toBeGreaterThanOrEqual(1);

        // 2. Unchanged pending → later saves must NOT rewrite the pending file.
        await saveRankingStorage();
        expect(pendingWrites()).toBe(writesAfterChange);

        // 3. Changed again → writes again (increment by exactly 1).
        pendingRegistrations['p1'].nickname = 'Pending2';
        await saveRankingStorage();
        expect(pendingWrites()).toBe(writesAfterChange + 1);

        const savedPending = JSON.parse(memFs.get(PENDING_FILE));
        expect(savedPending.pendingRegistrations.p1.nickname).toBe('Pending2');
        expect(savedPending.savedAt).toBeDefined();
    });

    it('rewrites the pending backup when a pending entry is DELETED', async () => {
        memFs.set(DB_FILE, validDb());
        loadLocalStorageRanking();

        pendingRegistrations['p1'] = { nickname: 'ToDelete', timestamp: Date.now() };
        await saveRankingStorage();
        const writesAfterAdd = pendingWrites();
        expect(writesAfterAdd).toBeGreaterThanOrEqual(1);

        delete pendingRegistrations['p1'];
        await saveRankingStorage();
        expect(pendingWrites()).toBe(writesAfterAdd + 1);
    });

    it('writes the pending file in compact JSON as well', async () => {
        memFs.set(DB_FILE, validDb());
        loadLocalStorageRanking();

        pendingRegistrations['p2'] = { nickname: 'Pending2', timestamp: Date.now() };
        await saveRankingStorage();

        const raw = memFs.get(PENDING_FILE);
        expect(raw).not.toContain('\n');
    });
});
