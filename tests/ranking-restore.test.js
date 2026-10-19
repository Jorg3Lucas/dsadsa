import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Mocks ──
vi.mock('../src/core/ranking-constants.js', () => ({
    MEMBER_ROLE_ID: 'role-1',
    SUPER_ADMIN_USER_ID: '999999999999999999',
    MAX_PILOTS_PER_OWNER: 6,
    confirmationCache: {}
}));

vi.mock('../src/core/ranking-utils.js', () => ({
    buildPrefixedNickname: (nickname) => nickname,
    assignMemberRole: vi.fn(async () => ({ ok: true })),
    setMemberNickname: vi.fn(async () => ({ ok: true }))
}));

vi.mock('../src/core/ranking-dedup.js', () => ({
    findNicknameOwner: vi.fn(() => null),
    unlinkPilotLinks: vi.fn()
}));

import { confirmationCache } from '../src/core/ranking-constants.js';
import {
    handleRestoreBackupSelect,
    handleRestoreBackupCancel,
    handleRestoreBackupConfirm
} from '../src/handlers/ranking-confirmations.js';

const ADMIN_ID = '999999999999999999';
const BACKUP_NAME = 'database_ranking_TEST.json';
const DB_PATH = './database_ranking.json';
const BACKUP_DIR = './backups';

let workDir;
let originalCwd;

function makeInteraction({ id = ADMIN_ID, values = [] } = {}) {
    return {
        user: { id, tag: 'Admin#0001' },
        values,
        deferred: false,
        replied: false,
        deferUpdate: vi.fn(async () => {}),
        update: vi.fn(async () => ({})),
        editReply: vi.fn(async () => ({}))
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(confirmationCache)) delete confirmationCache[key];

    originalCwd = process.cwd();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-test-'));
    fs.mkdirSync(path.join(workDir, BACKUP_DIR));
    fs.writeFileSync(path.join(workDir, DB_PATH), JSON.stringify({ users: { old: { nickname: 'Old' } } }));
    process.chdir(workDir);
});

afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe('handleRestoreBackupSelect', () => {
    it('acknowledges the click before reading the backup', async () => {
        const interaction = makeInteraction({ values: [BACKUP_NAME] });
        confirmationCache[`${ADMIN_ID}-restorebackup`] = {};
        fs.writeFileSync(path.join(workDir, BACKUP_DIR, BACKUP_NAME), JSON.stringify({ users: { a: {}, b: {} } }));

        await handleRestoreBackupSelect(interaction, {}, vi.fn(), vi.fn());

        expect(interaction.deferUpdate).toHaveBeenCalledOnce();
        expect(interaction.update).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('CONFIRM RESTORE')
        }));
    });

    it('denies non super admins', async () => {
        const interaction = makeInteraction({ id: '123', values: [BACKUP_NAME] });

        await handleRestoreBackupSelect(interaction, {}, vi.fn(), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Access denied')
        }));
    });

    it('reports an expired session', async () => {
        const interaction = makeInteraction({ values: [BACKUP_NAME] });

        await handleRestoreBackupSelect(interaction, {}, vi.fn(), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Session expired')
        }));
    });

    it('reports a missing backup file', async () => {
        const interaction = makeInteraction({ values: ['nope.json'] });
        confirmationCache[`${ADMIN_ID}-restorebackup`] = {};

        await handleRestoreBackupSelect(interaction, {}, vi.fn(), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Backup file not found')
        }));
    });

    it('reports an unreadable backup file', async () => {
        const interaction = makeInteraction({ values: [BACKUP_NAME] });
        confirmationCache[`${ADMIN_ID}-restorebackup`] = {};
        fs.writeFileSync(path.join(workDir, BACKUP_DIR, BACKUP_NAME), '{broken');

        await handleRestoreBackupSelect(interaction, {}, vi.fn(), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Invalid backup file')
        }));
    });

    it('caches the selection and its stats', async () => {
        const interaction = makeInteraction({ values: [BACKUP_NAME] });
        confirmationCache[`${ADMIN_ID}-restorebackup`] = {};
        fs.writeFileSync(path.join(workDir, BACKUP_DIR, BACKUP_NAME), JSON.stringify({ users: { a: {}, b: {}, c: {} } }));

        await handleRestoreBackupSelect(interaction, {}, vi.fn(), vi.fn());

        const cached = confirmationCache[`${ADMIN_ID}-restorebackup`];
        expect(cached.selectedBackup).toBe(BACKUP_NAME);
        expect(cached.backupStats).toMatchObject({ userCount: 3 });
    });
});

describe('handleRestoreBackupCancel', () => {
    it('clears the pending selection and confirms', async () => {
        const interaction = makeInteraction();
        confirmationCache[`${ADMIN_ID}-restorebackup`] = { selectedBackup: BACKUP_NAME };

        await handleRestoreBackupCancel(interaction, {}, vi.fn(), vi.fn());

        expect(confirmationCache[`${ADMIN_ID}-restorebackup`]).toBeUndefined();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('cancelled')
        }));
    });
});

describe('handleRestoreBackupConfirm', () => {
    it('reports an expired session when nothing was selected', async () => {
        const interaction = makeInteraction();

        await handleRestoreBackupConfirm(interaction, {}, vi.fn(), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Session expired')
        }));
    });

    it('backs up the current database, restores the selected one and reloads memory', async () => {
        const interaction = makeInteraction();
        const db = { users: { current: { nickname: 'Current' } } };
        const saveLocalStorage = vi.fn(() => fs.writeFileSync(DB_PATH, JSON.stringify(db)));
        const logEvent = vi.fn();
        confirmationCache[`${ADMIN_ID}-restorebackup`] = { selectedBackup: BACKUP_NAME };
        fs.writeFileSync(path.join(workDir, BACKUP_DIR, BACKUP_NAME), JSON.stringify({ users: { from: { nickname: 'FromBackup' } } }));

        await handleRestoreBackupConfirm(interaction, db, saveLocalStorage, logEvent);

        const preRestore = fs.readdirSync(path.join(workDir, BACKUP_DIR))
            .filter((f) => f.startsWith('database_ranking_PRE_RESTORE_'));
        expect(preRestore).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(path.join(workDir, BACKUP_DIR, preRestore[0]), 'utf8')).users)
            .toEqual({ current: { nickname: 'Current' } });

        expect(JSON.parse(fs.readFileSync(path.join(workDir, DB_PATH), 'utf8')).users)
            .toEqual({ from: { nickname: 'FromBackup' } });
        expect(db.users).toEqual({ from: { nickname: 'FromBackup' } });
        // Once before the snapshot (so the pre-restore copy is current), once after.
        expect(saveLocalStorage).toHaveBeenCalledTimes(2);
        expect(confirmationCache[`${ADMIN_ID}-restorebackup`]).toBeUndefined();
        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
            content: expect.stringContaining('Backup Restored Successfully')
        }));
    });

    it('reports a failure instead of leaving the click unanswered', async () => {
        const interaction = makeInteraction();
        const logEvent = vi.fn();
        confirmationCache[`${ADMIN_ID}-restorebackup`] = { selectedBackup: 'gone.json' };

        await handleRestoreBackupConfirm(interaction, { users: {} }, vi.fn(), logEvent);

        expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
            content: expect.stringContaining('Restore failed')
        }));
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('Backup restore failed'));
    });
});
