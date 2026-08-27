import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWriteBatcher, WRITE_BATCH_SIZE, WRITE_BATCH_PAUSE_MS } from '../src/core/ranking-sync-engine.js';

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
