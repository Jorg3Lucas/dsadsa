import { describe, it, expect, beforeEach } from 'vitest';
import {
    recordRateLimit,
    recordUnhandledRejection,
    recordSyncRun,
    getRuntimeMetrics,
    resetRuntimeMetrics,
    REJECTION_ESCALATION_THRESHOLD,
    REJECTION_WINDOW_MS
} from '../src/core/runtime-metrics.js';

beforeEach(() => {
    resetRuntimeMetrics();
});

describe('rate limits', () => {
    it('counts hits and keeps the most recent bucket', () => {
        recordRateLimit({ route: '/channels/:id', method: 'PATCH', global: false, retryAfter: 250 });
        const metrics = getRuntimeMetrics();

        expect(metrics.rateLimitCount).toBe(1);
        expect(metrics.lastRateLimit).toMatchObject({
            route: '/channels/:id',
            method: 'PATCH',
            global: false,
            retryAfter: 250
        });
    });

    it('accepts the alternative retry field names (timeToReset / timeout)', () => {
        recordRateLimit({ route: '/a', timeToReset: 100 });
        expect(getRuntimeMetrics().lastRateLimit.retryAfter).toBe(100);

        recordRateLimit({ route: '/b', timeout: 300 });
        expect(getRuntimeMetrics().lastRateLimit.retryAfter).toBe(300);
    });

    it('defaults missing fields safely', () => {
        recordRateLimit();
        expect(getRuntimeMetrics().lastRateLimit).toMatchObject({ route: null, method: null, global: false, retryAfter: null });
    });
});

describe('unhandled rejections', () => {
    it('does not escalate below the threshold', () => {
        for (let i = 0; i < REJECTION_ESCALATION_THRESHOLD - 1; i++) {
            expect(recordUnhandledRejection(1000 + i)).toBe(false);
        }
        expect(getRuntimeMetrics(1000).unhandledRejectionCount).toBe(REJECTION_ESCALATION_THRESHOLD - 1);
    });

    it('escalates once the burst reaches the threshold', () => {
        let last = false;
        for (let i = 0; i < REJECTION_ESCALATION_THRESHOLD; i++) {
            last = recordUnhandledRejection(1000 + i);
        }
        expect(last).toBe(true);
    });

    it('forgets rejections that fall out of the rolling window (no flapping restart)', () => {
        const base = 1_000_000;
        // Threshold-1 rejections, then a much later one past the window:
        for (let i = 0; i < REJECTION_ESCALATION_THRESHOLD - 1; i++) {
            recordUnhandledRejection(base + i);
        }
        expect(recordUnhandledRejection(base + REJECTION_WINDOW_MS + 5000)).toBe(false);
        expect(getRuntimeMetrics(base + REJECTION_WINDOW_MS + 5000).recentUnhandledRejections).toBe(1);
    });
});

describe('last sync run', () => {
    it('records duration, member count and role writes', () => {
        recordSyncRun({ durationMs: 1234, members: 300, roleWrites: 12 });

        const { lastSync } = getRuntimeMetrics();
        expect(lastSync).toMatchObject({ durationMs: 1234, members: 300, roleWrites: 12 });
        expect(typeof lastSync.at).toBe('number');
    });

    it('is null before any run and cleared by reset', () => {
        expect(getRuntimeMetrics().lastSync).toBeNull();
        recordSyncRun({ durationMs: 1, members: 1, roleWrites: 0 });
        resetRuntimeMetrics();
        expect(getRuntimeMetrics().lastSync).toBeNull();
    });
});
