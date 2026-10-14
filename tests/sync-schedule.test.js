import { describe, it, expect } from 'vitest';
import {
    SYNC_CRON_EXPRESSION,
    SYNC_HOUR,
    SYNC_MINUTE,
    SYNC_TIME_ZONE,
    getScheduledSyncBoundary,
    shouldRunStartupSync
} from '../src/core/sync-schedule.js';

// The schedule is 20:00 America/Sao_Paulo (UTC-3 since 2019) → 23:00Z.
// Every expectation below is written as the absolute UTC instant of
// "20:00 BRT on <date>".
const BRT_20H = (day) => new Date(`2026-10-${day}T23:00:00.000Z`).getTime();

describe('sync schedule constants', () => {
    it('exposes the 20:00 BRT schedule as a node-cron expression', () => {
        expect(SYNC_TIME_ZONE).toBe('America/Sao_Paulo');
        expect(SYNC_HOUR).toBe(20);
        expect(SYNC_MINUTE).toBe(0);
        expect(SYNC_CRON_EXPRESSION).toBe('0 20 * * *');
    });
});

describe('getScheduledSyncBoundary', () => {
    it('returns today\'s scheduled time once it has passed', () => {
        // 20:30 BRT on Oct 13 → today's 20:00 is the last due moment
        const now = new Date('2026-10-13T23:30:00.000Z');
        expect(getScheduledSyncBoundary(now).getTime()).toBe(BRT_20H(13));
    });

    it('returns yesterday\'s scheduled time before today\'s has arrived', () => {
        // 19:00 BRT on Oct 13 → still inside yesterday's cycle
        const now = new Date('2026-10-13T22:00:00.000Z');
        expect(getScheduledSyncBoundary(now).getTime()).toBe(BRT_20H(12));
    });

    it('treats the scheduled instant itself as already due', () => {
        const now = new Date('2026-10-13T23:00:00.000Z'); // exactly 20:00 BRT
        expect(getScheduledSyncBoundary(now).getTime()).toBe(BRT_20H(13));
    });

    it('handles midnight in the schedule timezone (hour "24" formatting)', () => {
        // 00:00 BRT on Oct 13 → before today's 20:00 → yesterday's cycle
        const now = new Date('2026-10-13T03:00:00.000Z');
        expect(getScheduledSyncBoundary(now).getTime()).toBe(BRT_20H(12));
    });

    it('rolls back across a month boundary', () => {
        // 21:00 BRT on Oct 31 (= 00:00Z on Nov 1) → Oct 31 20:00 already passed
        const justAfterBoundary = new Date('2026-11-01T00:00:00.000Z');
        expect(getScheduledSyncBoundary(justAfterBoundary).getTime())
            .toBe(new Date('2026-10-31T23:00:00.000Z').getTime());

        // 00:00 BRT on Nov 1 → before Nov 1's 20:00 → boundary is Oct 31
        const midnightBrt = new Date('2026-11-01T03:00:00.000Z');
        expect(getScheduledSyncBoundary(midnightBrt).getTime())
            .toBe(new Date('2026-10-31T23:00:00.000Z').getTime());
    });
});

describe('shouldRunStartupSync (restart must not re-sync)', () => {
    it('runs when the bot has never synced', () => {
        expect(shouldRunStartupSync(undefined, new Date('2026-10-13T12:00:00.000Z'))).toBe(true);
        expect(shouldRunStartupSync(null, new Date('2026-10-13T12:00:00.000Z'))).toBe(true);
        expect(shouldRunStartupSync('', new Date('2026-10-13T12:00:00.000Z'))).toBe(true);
    });

    it('runs when the last successful sync predates the current cycle', () => {
        // Last sync was yesterday 20:01 BRT; now it is 20:05 BRT today
        const last = new Date('2026-10-12T23:01:00.000Z').toISOString();
        expect(shouldRunStartupSync(last, new Date('2026-10-13T23:05:00.000Z'))).toBe(true);
    });

    it('skips a restart after the daily sync already ran', () => {
        const now = new Date('2026-10-13T23:30:00.000Z'); // 20:30 BRT
        const last = new Date('2026-10-13T23:05:00.000Z').toISOString(); // 20:05 BRT
        expect(shouldRunStartupSync(last, now)).toBe(false);
        // A second restart in the same cycle must also skip
        expect(shouldRunStartupSync(last, new Date('2026-10-14T02:00:00.000Z'))).toBe(false);
    });

    it('skips when the sync completed exactly at the scheduled instant', () => {
        const boundaryIso = new Date('2026-10-13T23:00:00.000Z').toISOString();
        expect(shouldRunStartupSync(boundaryIso, new Date('2026-10-13T23:00:00.000Z'))).toBe(false);
    });

    it('still runs before today\'s scheduled time if yesterday\'s cycle was missed', () => {
        // Bot was offline at 20:00 yesterday and restarts at 10:00 today:
        // the last sync is from two days ago → the missed cycle is caught up.
        const last = new Date('2026-10-11T23:05:00.000Z').toISOString();
        expect(shouldRunStartupSync(last, new Date('2026-10-13T13:00:00.000Z'))).toBe(true);
    });

    it('treats a corrupt timestamp as "never synced" instead of skipping the day', () => {
        expect(shouldRunStartupSync('not-a-date', new Date('2026-10-13T23:30:00.000Z'))).toBe(true);
    });

    it('accepts a numeric timestamp', () => {
        const last = new Date('2026-10-13T23:05:00.000Z').getTime();
        expect(shouldRunStartupSync(last, new Date('2026-10-13T23:30:00.000Z'))).toBe(false);
    });
});
