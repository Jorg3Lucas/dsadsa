import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

vi.mock('../src/core/ranking-cache.js', () => ({
    saveRankingCache: vi.fn(),
    getLocalRankingCache: vi.fn(() => null)
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    WORLD_IDS: {},
    WORLD_GROUP_IDS: {}
}));

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key) => key)
}));

import axios from 'axios';
import { fetchRankingPage, getRetryDelay, destroyRankingScraperAgents, fetchWorldRanking } from '../src/core/ranking-scraper.js';

const axiosGet = axios.get;

// Build a ranking-page HTML fixture with `rowCount` table rows. Names are
// page-unique (rankingMap is keyed by nickname, so pages must not collide).
function pageHtml(rowCount, page = 1) {
    let rows = '';
    for (let i = 0; i < rowCount; i++) {
        rows += `<tr><td>${i + 1}</td><td>P${page}_${i}</td><td>Clan${page}_${i}</td></tr>`;
    }
    return `<html><body><table><tbody>${rows}</tbody></table></body></html>`;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

// Helper: flush pending timers so sleep() promises resolve
async function flushTimers() {
    await vi.runAllTimersAsync();
}

describe('getRetryDelay', () => {
    it('grows exponentially with attempt number', () => {
        const d1 = getRetryDelay(1, {});
        const d2 = getRetryDelay(2, {});
        const d3 = getRetryDelay(3, {});
        expect(d1).toBeGreaterThanOrEqual(1000);
        expect(d1).toBeLessThan(2000);
        expect(d2).toBeGreaterThanOrEqual(2000);
        expect(d2).toBeLessThan(4000);
        expect(d3).toBeGreaterThanOrEqual(4000);
        expect(d3).toBeLessThan(8000);
    });

    it('honors the Retry-After header when present (seconds)', () => {
        const err = { response: { headers: { 'retry-after': '7' } } };
        const delay = getRetryDelay(1, err);
        expect(delay).toBe(7000);
    });

    it('honors the Retry-After header when present (HTTP-date)', () => {
        const future = new Date(Date.now() + 5000).toUTCString();
        const err = { response: { headers: { 'retry-after': future } } };
        const delay = getRetryDelay(1, err);
        // ~5s in the future, allowing clock drift between now and parse
        expect(delay).toBeGreaterThan(4000);
        expect(delay).toBeLessThanOrEqual(20000);
    });

    it('caps the delay at RETRY_MAX_DELAY_MS', () => {
        // retry-after far above the cap must be clamped
        const err = { response: { headers: { 'retry-after': '9999' } } };
        const delay = getRetryDelay(1, err);
        expect(delay).toBe(20000);
    });
});

describe('fetchRankingPage', () => {
    it('returns the body on first successful attempt', async () => {
        axiosGet.mockResolvedValueOnce({ data: '<html>ok</html>' });

        const resultPromise = fetchRankingPage('https://example.com/rank?page=1', 'World page 1');
        await flushTimers();
        const data = await resultPromise;

        expect(data).toBe('<html>ok</html>');
        expect(axiosGet).toHaveBeenCalledTimes(1);
    });

    it('retries transient 500 errors with backoff and eventually succeeds', async () => {
        axiosGet
            .mockRejectedValueOnce({ response: { status: 500 } })
            .mockRejectedValueOnce({ response: { status: 500 } })
            .mockResolvedValueOnce({ data: '<html>recovered</html>' });

        const resultPromise = fetchRankingPage('https://example.com/rank?page=1', 'World page 1');
        await flushTimers();
        const data = await resultPromise;

        expect(data).toBe('<html>recovered</html>');
        expect(axiosGet).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry non-transient client errors (404)', async () => {
        axiosGet.mockRejectedValue({ response: { status: 404 } });

        const resultPromise = fetchRankingPage('https://example.com/rank?page=1', 'World page 1');
        // Attach the rejection handler BEFORE flushing timers so the rejection
        // is never left unhandled while the test advances fake time.
        const assertion = expect(resultPromise).rejects.toMatchObject({ response: { status: 404 } });
        await flushTimers();
        await assertion;

        expect(axiosGet).toHaveBeenCalledTimes(1);
    });

    it('retries network errors (no status)', async () => {
        axiosGet
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockResolvedValueOnce({ data: '<html>ok</html>' });

        const resultPromise = fetchRankingPage('https://example.com/rank?page=1', 'World page 1');
        await flushTimers();
        const data = await resultPromise;

        expect(data).toBe('<html>ok</html>');
        expect(axiosGet).toHaveBeenCalledTimes(2);
    });

    it('throws the last error after exhausting all attempts', async () => {
        axiosGet.mockRejectedValue({ response: { status: 503 } });

        const resultPromise = fetchRankingPage('https://example.com/rank?page=1', 'World page 1');
        const assertion = expect(resultPromise).rejects.toMatchObject({ response: { status: 503 } });
        await flushTimers();
        await assertion;

        expect(axiosGet).toHaveBeenCalledTimes(3);
    });
});

describe('fetchWorldRanking (early termination)', () => {
    it('stops at the first empty page after players were seen (exact-multiple ranking)', async () => {
        // A world whose ranking fills whole pages: page 2 comes back empty → end.
        axiosGet
            .mockResolvedValueOnce({ data: pageHtml(10, 1) })
            .mockResolvedValueOnce({ data: pageHtml(0, 2) });

        const resultPromise = fetchWorldRanking(611, 3);
        await flushTimers();
        const { rankingMap } = await resultPromise;

        expect(Object.keys(rankingMap)).toHaveLength(10);
        expect(axiosGet).toHaveBeenCalledTimes(2); // never touched pages 3-10
    });

    it('does NOT stop on a partial page — stops on the empty tail instead (mid-size world)', async () => {
        // A partial page (4 rows) must NOT stop the scrape: against a live ranking
        // a non-final page can legitimately shrink. The empty page after it ends it.
        axiosGet
            .mockResolvedValueOnce({ data: pageHtml(10, 1) })
            .mockResolvedValueOnce({ data: pageHtml(4, 2) })
            .mockResolvedValueOnce({ data: pageHtml(0, 3) });

        const resultPromise = fetchWorldRanking(611, 3);
        await flushTimers();
        const { rankingMap } = await resultPromise;

        expect(Object.keys(rankingMap)).toHaveLength(14);
        expect(axiosGet).toHaveBeenCalledTimes(3);
    });

    it('stops for a tiny world once a page is empty', async () => {
        axiosGet
            .mockResolvedValueOnce({ data: pageHtml(3, 1) })
            .mockResolvedValueOnce({ data: pageHtml(0, 2) });

        const resultPromise = fetchWorldRanking(611, 3);
        await flushTimers();
        const { rankingMap } = await resultPromise;

        expect(Object.keys(rankingMap)).toHaveLength(3);
        expect(axiosGet).toHaveBeenCalledTimes(2);
    });

    it('does NOT stop on an empty FIRST page (keeps scraping to recover from a transient block)', async () => {
        // Page 1 empty is ambiguous (layout change or transient block). With no
        // players seen yet, the old all-pages behavior is preserved.
        axiosGet.mockResolvedValue({ data: pageHtml(0) });

        const resultPromise = fetchWorldRanking(611, 3);
        await flushTimers();
        const { rankingMap } = await resultPromise;

        expect(Object.keys(rankingMap)).toHaveLength(0);
        expect(axiosGet).toHaveBeenCalledTimes(10); // all pages still scraped
    });
});

describe('destroyRankingScraperAgents', () => {
    it('does not throw and is idempotent (safe to call multiple times)', () => {
        expect(() => destroyRankingScraperAgents()).not.toThrow();
        // Second call must be a no-op — agents are already destroyed.
        expect(() => destroyRankingScraperAgents()).not.toThrow();
    });

    it('is safe to call even when no scrape ever ran', () => {
        expect(() => destroyRankingScraperAgents()).not.toThrow();
    });
});
