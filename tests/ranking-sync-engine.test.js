import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWriteBatcher, WRITE_BATCH_SIZE, WRITE_BATCH_PAUSE_MS, startOutOfAlliedGrace, getOutOfAlliedGraceStatus, sendOutOfAlliedGraceDm } from '../src/core/ranking-sync-engine.js';
import { OUT_OF_ALLIED_GRACE_MS } from '../src/core/ranking-constants.js';

describe('createWriteBatcher (conservative Discord-write batching)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('flushes an empty queue immediately', async () => {
        const { flush } = createWriteBatcher();
        await expect(flush()).resolves.toBeUndefined();
    });

    it('drains all queued writes in order', async () => {
        const { queueWrite, flush } = createWriteBatcher();
        const calls = [];
        for (let i = 0; i < 5; i++) {
            queueWrite(() => {
                calls.push(i);
                return Promise.resolve();
            });
        }
        await flush();
        expect(calls).toEqual([0, 1, 2, 3, 4]);
    });

    it('runs writes in groups of WRITE_BATCH_SIZE with a pause between groups', async () => {
        vi.useFakeTimers();
        const { queueWrite, flush } = createWriteBatcher();
        const started = [];
        let active = 0;
        let maxActive = 0;
        const gates = []; // release functions, one per queued write

        for (let i = 0; i < WRITE_BATCH_SIZE * 2 + 1; i++) {
            queueWrite(() => {
                active++;
                maxActive = Math.max(maxActive, active);
                started.push(i);
                return new Promise((resolve) => {
                    gates.push(() => { active--; resolve(); });
                });
            });
        }
        const flushPromise = flush();

        // First group starts immediately at flush() — never more than the batch size.
        expect(started).toHaveLength(WRITE_BATCH_SIZE);
        expect(maxActive).toBeLessThanOrEqual(WRITE_BATCH_SIZE);

        // Nothing else starts until the first group completes AND the pause elapses.
        gates.splice(0, WRITE_BATCH_SIZE).forEach((release) => release());
        await vi.advanceTimersByTimeAsync(0);
        expect(started).toHaveLength(WRITE_BATCH_SIZE);
        await vi.advanceTimersByTimeAsync(WRITE_BATCH_PAUSE_MS);
        expect(started).toHaveLength(WRITE_BATCH_SIZE * 2);

        // Second group follows the same cadence.
        gates.splice(0, WRITE_BATCH_SIZE).forEach((release) => release());
        await vi.advanceTimersByTimeAsync(WRITE_BATCH_PAUSE_MS);
        expect(started).toHaveLength(WRITE_BATCH_SIZE * 2 + 1);

        // Release the final partial group; everything drains.
        gates.forEach((release) => release());
        await flushPromise;
        expect(active).toBe(0);
        expect(maxActive).toBeLessThanOrEqual(WRITE_BATCH_SIZE);
    });

    it('swallows per-op errors so one failing write never breaks the batch', async () => {
        const { queueWrite, flush } = createWriteBatcher();
        const calls = [];
        queueWrite(() => { calls.push('ok1'); return Promise.resolve(); });
        queueWrite(() => { calls.push('fail'); return Promise.reject(new Error('boom')); });
        queueWrite(() => { calls.push('ok2'); return Promise.resolve(); });
        await expect(flush()).resolves.toBeUndefined();
        expect(calls).toEqual(['ok1', 'fail', 'ok2']);
    });

    it('flush() waits for writes queued while a drain is already in progress', async () => {
        vi.useFakeTimers();
        const { queueWrite, flush } = createWriteBatcher();
        const calls = [];
        for (let i = 0; i < WRITE_BATCH_SIZE; i++) {
            queueWrite(() => { calls.push(i); return Promise.resolve(); });
        }
        const flushPromise = flush();

        // Drain is mid-flight (first group started); queue one more write now.
        queueWrite(() => { calls.push('late'); return Promise.resolve(); });

        await vi.advanceTimersByTimeAsync(WRITE_BATCH_PAUSE_MS + 1);
        await flushPromise;
        expect(calls).toEqual([
            ...[...Array(WRITE_BATCH_SIZE).keys()],
            'late'
        ]);
    });
});

describe('72h out-of-allied-clan grace (per person)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const MEMBER_ID = 'member-123';
    const HOUR_MS = 60 * 60 * 1000;

    function freshDb() {
        return { users: {}, roleNotify: {} };
    }

    it('starts a timer on first detection and keeps an existing timer (idempotent)', () => {
        const db = freshDb();
        const t0 = new Date('2026-08-01T12:00:00.000Z');
        expect(startOutOfAlliedGrace(db, MEMBER_ID, t0)).toBe(true);
        expect(db.roleNotify[MEMBER_ID].outOfAlliedSince).toBe(t0.toISOString());
        // Second start must NOT overwrite the original timestamp
        const t1 = new Date('2026-08-02T12:00:00.000Z');
        expect(startOutOfAlliedGrace(db, MEMBER_ID, t1)).toBe(false);
        expect(db.roleNotify[MEMBER_ID].outOfAlliedSince).toBe(t0.toISOString());
    });

    it('member with no timer is never expired — first detection starts the grace (full 72h left)', () => {
        const db = freshDb();
        const now = new Date('2026-08-05T12:00:00.000Z');
        const status = getOutOfAlliedGraceStatus(db, MEMBER_ID, now);
        expect(status.started).toBe(false);
        expect(status.expired).toBe(false);
        expect(status.hoursLeft).toBe(72);
    });

    it('a corrupt/unparseable timer is treated as no timer (keeps role, self-heals)', () => {
        const db = freshDb();
        db.roleNotify[MEMBER_ID] = { outOfAlliedSince: 'not-a-date' };
        const now = new Date('2026-08-05T12:00:00.000Z');
        const status = getOutOfAlliedGraceStatus(db, MEMBER_ID, now);
        expect(status.started).toBe(false);
        expect(status.expired).toBe(false);
        expect(status.hoursLeft).toBe(72);
    });

    it('keeps role while within the 72h window and reports hours left', () => {
        const db = freshDb();
        const t0 = new Date('2026-08-01T12:00:00.000Z');
        startOutOfAlliedGrace(db, MEMBER_ID, t0);
        // 10 hours later → not expired, ~62h left
        const now = new Date(t0.getTime() + 10 * HOUR_MS);
        const status = getOutOfAlliedGraceStatus(db, MEMBER_ID, now);
        expect(status.started).toBe(true);
        expect(status.expired).toBe(false);
        expect(status.hoursLeft).toBe(62);
    });

    it('role removal is allowed once the 72h window has elapsed', () => {
        const db = freshDb();
        const t0 = new Date('2026-08-01T12:00:00.000Z');
        startOutOfAlliedGrace(db, MEMBER_ID, t0);
        const now = new Date(t0.getTime() + OUT_OF_ALLIED_GRACE_MS + 1000);
        const status = getOutOfAlliedGraceStatus(db, MEMBER_ID, now);
        expect(status.started).toBe(true);
        expect(status.expired).toBe(true);
        expect(status.hoursLeft).toBe(0);
    });

    it('an elapsed grace can restart after the member returns (timer reset)', () => {
        const db = freshDb();
        const t0 = new Date('2026-08-01T12:00:00.000Z');
        startOutOfAlliedGrace(db, MEMBER_ID, t0);
        // 73h later the grace is expired
        const t73h = new Date(t0.getTime() + 73 * HOUR_MS);
        expect(getOutOfAlliedGraceStatus(db, MEMBER_ID, t73h).expired).toBe(true);
        // Member returns to an allied clan → the sync clears the flag (deleteRoleNotifyFlag)
        delete db.roleNotify[MEMBER_ID].outOfAlliedSince;
        expect(getOutOfAlliedGraceStatus(db, MEMBER_ID, t73h).expired).toBe(false);
        // And a fresh timer can start again
        expect(startOutOfAlliedGrace(db, MEMBER_ID, t73h)).toBe(true);
        expect(getOutOfAlliedGraceStatus(db, MEMBER_ID, t73h).started).toBe(true);
    });
});

describe('sendOutOfAlliedGraceDm — 72h grace warning DM', () => {
    function makeMember({ sendImpl } = {}) {
        return {
            id: 'member-123',
            user: {
                tag: 'TestUser#1234',
                send: sendImpl || vi.fn().mockResolvedValue(undefined)
            }
        };
    }

    it('sends the warning DM and logs success', async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const member = makeMember({ sendImpl: send });
        const logs = [];
        const logEvent = (msg) => logs.push(msg);

        await sendOutOfAlliedGraceDm(member, logEvent);

        expect(send).toHaveBeenCalledTimes(1);
        const msg = send.mock.calls[0][0];
        expect(msg).toContain('outside an allied clan');
        expect(msg).toContain('removed in 72 hours');
        expect(logs.some(l => l.includes('[Grace DM]') && l.includes('warned'))).toBe(true);
    });

    it('logs a failure without throwing when the DM cannot be sent', async () => {
        const send = vi.fn().mockRejectedValue(new Error('Cannot send messages to this user'));
        const member = makeMember({ sendImpl: send });
        const logs = [];
        const logEvent = (msg) => logs.push(msg);

        await expect(sendOutOfAlliedGraceDm(member, logEvent)).resolves.toBeUndefined();
        expect(logs.some(l => l.includes('[Grace DM]') && l.includes('Failed to send DM'))).toBe(true);
    });
});
