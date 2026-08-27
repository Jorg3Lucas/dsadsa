import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs entirely — the module under test only touches the filesystem
// through these stubs.
const fsMocks = vi.hoisted(() => ({
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
}));

vi.mock('node:fs', () => ({
    default: fsMocks
}));

import { runBackup, getBackupStats, rotateBackups } from '../src/auto-backup.js';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: filesystem "exists", all stat calls return a recent timestamp
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readdirSync.mockReturnValue([]);
    fsMocks.statSync.mockReturnValue({ mtimeMs: Date.now(), size: 1024 });
});

// ── rotateBackups ──

describe('rotateBackups', () => {
    it('removes backups older than the retention window with a single directory scan', () => {
        const oldFiles = ['database_ranking_2026-07-01T00-00-00.json', 'database_ranking_2026-07-02T00-00-00.json'];
        const freshFile = 'database_ranking_2026-08-07T00-00-00.json';
        fsMocks.readdirSync.mockReturnValue([...oldFiles, freshFile]);
        fsMocks.statSync.mockImplementation((p) => {
            const file = String(p).split(/[\\/]/).pop();
            return {
                mtimeMs: oldFiles.includes(file) ? Date.now() - 10 * DAY_MS : Date.now(),
                size: 100
            };
        });

        rotateBackups('database_ranking');

        expect(fsMocks.unlinkSync).toHaveBeenCalledTimes(2);
        for (const f of oldFiles) {
            expect(fsMocks.unlinkSync).toHaveBeenCalledWith(expect.stringContaining(f));
        }
        // One readdir for the whole rotation (no second scan for the count pass)
        expect(fsMocks.readdirSync).toHaveBeenCalledTimes(1);
    });

    it('keeps only MAX_BACKUPS (50) newest backups after age removal', () => {
        const files = [];
        for (let i = 0; i < 52; i++) {
            files.push(`database_ranking_2026-08-07T00-${String(i).padStart(2, '0')}.json`);
        }
        fsMocks.readdirSync.mockReturnValue(files);
        // All fresh — nothing removed by age, count pass must trim to 50
        fsMocks.statSync.mockReturnValue({ mtimeMs: Date.now(), size: 100 });

        rotateBackups('database_ranking');

        // The 2 lexicographically-oldest names are the ones sliced off
        expect(fsMocks.unlinkSync).toHaveBeenCalledTimes(2);
        expect(fsMocks.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('T00-00.'));
        expect(fsMocks.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('T00-01.'));
    });

    it('does not touch anything when the backup directory is missing', () => {
        fsMocks.readdirSync.mockImplementation(() => {
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });

        rotateBackups('database_ranking');

        // The module actually ran (readdir was attempted) and its ENOENT path
        // returned gracefully — guards against a trivially-passing test when
        // the module under test fails to load.
        expect(fsMocks.readdirSync).toHaveBeenCalledTimes(1);
        expect(fsMocks.statSync).not.toHaveBeenCalled();
        expect(fsMocks.unlinkSync).not.toHaveBeenCalled();
    });
});

// ── getBackupStats ──

describe('getBackupStats', () => {
    it('returns zeroed stats when the backup directory is missing — no dir creation side effect', () => {
        fsMocks.readdirSync.mockImplementation(() => {
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });

        const stats = getBackupStats();

        expect(stats.count).toBe(0);
        expect(stats.totalSizeMB).toBe('0.00');
        expect(stats.latestBackup).toBeNull();
        expect(stats.latestBackupTime).toBeNull();
        // The module actually ran its ENOENT path (readdir attempted) — guards
        // against a trivially-passing test when the module fails to load.
        expect(fsMocks.readdirSync).toHaveBeenCalledTimes(1);
        // Read-only call must not create directories or even check them
        expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
        expect(fsMocks.existsSync).not.toHaveBeenCalled();
    });

    it('aggregates count, total size and latest backup from statSync (DB backups only)', () => {
        fsMocks.readdirSync.mockReturnValue([
            'database_ranking_old.json',
            'database_ranking_new.json',
            'ranking_cache_ignored.json'
        ]);
        fsMocks.statSync.mockImplementation((p) => {
            const file = String(p).split(/[\\/]/).pop();
            if (file === 'database_ranking_old.json') return { mtimeMs: 1000, size: 2048 };
            if (file === 'database_ranking_new.json') return { mtimeMs: 2000, size: 4096 };
            return { mtimeMs: 999, size: 1024 }; // cache backup — filtered out
        });

        const stats = getBackupStats();

        expect(stats.count).toBe(2); // cache file excluded by the prefix filter
        expect(stats.totalSizeMB).toBe('0.01'); // (2048 + 4096) / 1048576
        expect(stats.latestBackup).toBe('database_ranking_new.json');
        expect(stats.latestBackupTime).toBe(new Date(2000).toISOString());
    });

    it('skips a file that vanished between readdir and stat instead of aborting', () => {
        fsMocks.readdirSync.mockReturnValue(['database_ranking_a.json', 'database_ranking_b.json']);
        fsMocks.statSync.mockImplementation((p) => {
            const file = String(p).split(/[\\/]/).pop();
            if (file === 'database_ranking_b.json') throw new Error('ENOENT');
            return { mtimeMs: 1000, size: 2048 };
        });

        const stats = getBackupStats();

        // count reflects the files that were LISTED (2); the vanished one only
        // contributes nothing to size/latest — acceptable for a startup log
        expect(stats.count).toBe(2);
        expect(stats.totalSizeMB).toBe('0.00'); // (2048) / 1048576 rounds to 0.00
        expect(stats.latestBackup).toBe('database_ranking_a.json');
    });
});

// ── runBackup smoke ──

describe('runBackup', () => {
    it('writes a valid backup, verifies integrity, and rotates (smoke)', () => {
        fsMocks.readFileSync.mockReturnValue(JSON.stringify({ users: { u1: { nickname: 'Test' } } }));
        fsMocks.readdirSync.mockReturnValue(['database_ranking_2026-08-06T00-00-00.json']);

        const count = runBackup(['./database_ranking.json'], 'test');

        expect(count).toBe(1);
        expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
        expect(fsMocks.unlinkSync).not.toHaveBeenCalled(); // existing backup is fresh
        // Rotation ran: the pre-existing backup was stat'd for the age check
        expect(fsMocks.statSync).toHaveBeenCalledTimes(1);
        expect(fsMocks.readdirSync).toHaveBeenCalledTimes(1);
    });
});
