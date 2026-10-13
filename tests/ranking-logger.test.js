import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

vi.mock('node:fs', () => ({
    default: {
        appendFileSync: vi.fn(),
        statSync: vi.fn(() => ({ size: 0 })),
        readFileSync: vi.fn(() => ''),
        writeFileSync: vi.fn()
    }
}));

import fs from 'node:fs';
import { logRankingEvent } from '../src/core/ranking-logger.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    fs.statSync.mockReturnValue({ size: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    // Drain anything the test buffered so state does not leak into the next one.
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('ranking logger', () => {
    it('buffers events and flushes them once per window', () => {
        logRankingEvent('first');
        logRankingEvent('second');

        // Nothing hits the disk before the flush window elapses.
        expect(fs.appendFileSync).not.toHaveBeenCalled();

        vi.advanceTimersByTime(500);
        expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
        const written = fs.appendFileSync.mock.calls[0][1];
        expect(written).toContain('first');
        expect(written).toContain('second');
    });

    it('does not rotate below the size cap', () => {
        fs.statSync.mockReturnValue({ size: MAX_LOG_BYTES });
        logRankingEvent('small');
        vi.advanceTimersByTime(500);

        expect(fs.readFileSync).not.toHaveBeenCalled();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('rotates above the cap, keeping only the newest lines', () => {
        fs.statSync.mockReturnValue({ size: MAX_LOG_BYTES + 1 });
        const lines = Array.from({ length: 2500 }, (_, i) => `line ${i}`);
        fs.readFileSync.mockReturnValue(lines.join('\n'));

        logRankingEvent('trigger');
        vi.advanceTimersByTime(500);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const [, kept] = fs.writeFileSync.mock.calls[0];
        const keptLines = kept.split('\n');
        expect(keptLines).toHaveLength(2000);
        expect(keptLines[0]).toBe('line 500');
        expect(keptLines[keptLines.length - 1]).toBe('line 2499');
    });

    it('stays silent when the log file does not exist yet', () => {
        const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        fs.statSync.mockImplementation(() => { throw enoent; });

        logRankingEvent('no file');
        vi.advanceTimersByTime(500);

        expect(console.error).not.toHaveBeenCalled();
    });
});
