import http from 'node:http';
import https from 'node:https';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { saveRankingCache, getLocalRankingCache } from './ranking-cache.js';

import { WORLD_IDS, WORLD_GROUP_IDS, WORLDS_BY_REGION, REGION_NAMES } from './ranking-constants.js';
import { getMsg } from '../lang/lang.js';

// ==========================================
// 🌐 WEB SCRAPING (MIR4 Official Ranking)
// ==========================================

const BASE_URL = 'https://forum.mir4global.com/rank?ranktype=1&classtype=&searchname=';
const CONCURRENT_REGIONS = 3;    // How many regions to scrape in parallel
const CONCURRENT_WORLDS = 3;     // How many worlds per region in parallel
const PAGES_PER_WORLD = 10;      // Pages to scrape per world
const DELAY_BETWEEN_PAGES_MS = 1200;  // Delay between pages (was 3000ms)
const MAX_RETRIES = 3;                // Attempts per page (was fixed 3)
const RETRY_BASE_DELAY_MS = 1000;     // Exponential backoff base
const RETRY_MAX_DELAY_MS = 20000;     // Backoff ceiling (keeps worst-case bounded)
const REQUEST_TIMEOUT_MS = 60000;

// ── Shared keep-alive HTTP agents ──
// A full scrape issues ~770 page requests (77 worlds × 10 pages). Without
// keep-alive, every request opens a fresh TCP connection + TLS handshake;
// with it, connections are reused across pages, retries and even across
// scrapes, cutting handshake overhead dramatically. maxSockets bounds the
// pool to roughly peak concurrency (3 regions × 3 worlds) plus slack.
const AGENT_MAX_SOCKETS = CONCURRENT_REGIONS * CONCURRENT_WORLDS + 4;
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: AGENT_MAX_SOCKETS });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: AGENT_MAX_SOCKETS });

const AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: REQUEST_TIMEOUT_MS,
    httpAgent,
    httpsAgent,
    maxRedirects: 5,
    decompress: true // gzip responses are decoded transparently by axios
};

/**
 * Destroy the shared keep-alive agents, releasing all pooled sockets.
 * Call during graceful shutdown so the process can exit cleanly instead of
 * lingering on idle keep-alive connections. Idempotent — safe to call even
 * after the agents were already destroyed.
 *
 * Note: Node >= 19.5 returns a Promise from Agent#destroy(); older versions
 * return undefined. Promise.allSettled handles both cases, so callers never
 * need to await.
 */
export function destroyRankingScraperAgents() {
    try {
        Promise.allSettled([httpAgent.destroy(), httpsAgent.destroy()]);
        console.log('🛑 [Scraper] Keep-alive agents destroyed — sockets released.');
    } catch (err) {
        console.error('❌ [Scraper] Failed to destroy keep-alive agents:', err.message);
    }
}

/**
 * Helper: sleep for ms milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute the delay before the next retry: exponential backoff with full
 * jitter (so parallel worlds don't retry in synchronized waves), capped at
 * RETRY_MAX_DELAY_MS, and honoring the server's Retry-After header when the
 * server explicitly asks us to wait (429/503).
 */
export function getRetryDelay(attempt, err) {
    const retryAfter = err?.response?.headers?.['retry-after'];
    if (retryAfter) {
        // RFC 7231 allows either seconds or an HTTP-date.
        const secs = parseInt(retryAfter, 10);
        if (Number.isFinite(secs) && secs > 0) {
            return Math.min(secs * 1000, RETRY_MAX_DELAY_MS);
        }
        const dateMs = Date.parse(retryAfter);
        if (Number.isFinite(dateMs)) {
            const waitMs = dateMs - Date.now();
            if (waitMs > 0) return Math.min(waitMs, RETRY_MAX_DELAY_MS);
        }
    }
    const exponential = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const jittered = exponential + Math.random() * exponential;
    return Math.min(jittered, RETRY_MAX_DELAY_MS);
}

/**
 * Fetch a ranking page with exponential-backoff retries.
 * Retries transient failures (network errors, 408/429, 5xx, 403) up to
 * MAX_RETRIES times. Non-retriable client errors (e.g. 404) fail fast. Throws
 * the last error once attempts are exhausted.
 */
export async function fetchRankingPage(url, label = 'page') {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const { data } = await axios.get(url, AXIOS_CONFIG);
            return data;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            // Network error (no status) or a transient server-side status → retry.
            // 403 is deliberately retried too: anti-bot blocks on the forum are
            // often transient, and the 20s cap keeps the worst-case cost bounded.
            const retriable = !status || status === 408 || status === 429 || status === 403 || status >= 500;
            if (attempt < MAX_RETRIES && retriable) {
                const delay = getRetryDelay(attempt, err);
                console.error(`⚠️ Retry ${attempt}/${MAX_RETRIES} for ${label} (${status || 'network error'}) — retrying in ${delay}ms`);
                await sleep(delay);
            } else if (attempt < MAX_RETRIES) {
                break; // Non-retriable error — don't waste attempts
            }
        }
    }
    throw lastError;
}

/**
 * Helper: Get formatted memory usage info
 */
function getMemoryInfo() {
    const mem = process.memoryUsage();
    const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
    const rss = (mem.rss / 1024 / 1024).toFixed(1);
    const external = (mem.external / 1024 / 1024).toFixed(1);
    return {
        heapUsed: `${heapUsed}MB`,
        heapTotal: `${heapTotal}MB`,
        rss: `${rss}MB`,
        external: `${external}MB`,
        raw: mem
    };
}

/**
 * Helper: Log memory usage with context
 */
function logMemory(context) {
    const mem = getMemoryInfo();
    console.log(`💾 [Memory] ${context} | Heap: ${mem.heapUsed}/${mem.heapTotal} | RSS: ${mem.rss} | External: ${mem.external}`);
    return mem;
}

/**
 * Helper: Run async tasks with concurrency limit
 */
async function runWithConcurrency(tasks, concurrency) {
    const results = [];
    const executing = new Set();

    for (const task of tasks) {
        const promise = task().then(result => {
            executing.delete(promise);
            return result;
        });
        executing.add(promise);
        results.push(promise);

        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }

    return Promise.all(results);
}

/**
 * Fetch ranking data for a single world (all pages).
 * Returns { worldId, rankingMap, error? }
 *
 * Early termination: the ranking list is contiguous, so a page that comes back
 * EMPTY after players were seen marks the end — stop there and skip the
 * remaining page fetches AND their inter-page delays (the biggest scrape win
 * for the many worlds that don't fill all 10 pages).
 *
 * Safety: a PARTIAL page (fewer rows than usual) does NOT stop — the scrape
 * runs against a live ranking with 1.2s gaps between fetches, so a rank
 * removed/added mid-scrape can legitimately shrink a non-final page. Stopping
 * on it could truncate the world's data. An empty FIRST page also does NOT
 * stop (ambiguous — could be a transient block; the all-pages behavior is
 * preserved so a blocked page 1 can still recover on later pages). Exported
 * for direct unit testing.
 */
export async function fetchWorldRanking(worldId, worldgroupId) {
    const serverName = WORLD_IDS[worldId] || `World ${worldId}`;
    const rankingMap = {};
    let failedPages = 0;
    let totalPlayers = 0;

    for (let page = 1; page <= PAGES_PER_WORLD; page++) {
        try {
            const data = await fetchRankingPage(`${BASE_URL}&worldgroupid=${worldgroupId}&worldid=${worldId}&page=${page}`, `${serverName} page ${page}`);
            const $ = cheerio.load(data);
            let pageRowCount = 0;
            $('table tbody tr').each((_, el) => {
                const cells = $(el).find('td');
                if (cells.length >= 3) {
                    pageRowCount++;
                    const nick = cells.eq(1).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                    const clan = cells.eq(2).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                    if (nick) {
                        rankingMap[nick] = (clan && clan !== '-' && clan !== '—') ? clan : 'No Clan';
                    }
                }
            });
            totalPlayers += pageRowCount;

            // Empty page after players were seen → end of the ranking list. A
            // transient empty page would be an incomplete scrape either way (the
            // same failure mode as a failed page); the daily re-scrape self-heals
            // and the sync keeps roles while the cache is stale.
            if (pageRowCount === 0 && totalPlayers > 0) {
                console.log(`🛑 ${serverName}: ranking ended at page ${page} (0 rows) — stopping early`);
                break;
            }

            if (page < PAGES_PER_WORLD) {
                await sleep(DELAY_BETWEEN_PAGES_MS);
            }
        } catch (err) {
            console.error(`❌ Failed ${serverName} page ${page} after ${MAX_RETRIES} attempts: ${err.message}`);
            failedPages++;
        }
    }

    const playerCount = Object.keys(rankingMap).length;
    if (failedPages > 0) {
        // Incomplete data: players on the failed pages are missing from the cache,
        // which can make registered members look "not found" and lose their role.
        console.warn(`⚠️ ${serverName}: ${failedPages} page(s) FAILED after retries — ranking data INCOMPLETE (${playerCount} players scraped)`);
    } else if (playerCount === 0) {
        // No exceptions but nothing scraped — likely a site layout change or an
        // empty table; also a silent-incompleteness signal worth surfacing.
        console.warn(`⚠️ ${serverName}: 0 players scraped with no failures — check the site layout/parsing`);
    } else {
        console.log(`✅ ${serverName}: ${playerCount} players scraped.`);
    }
    return { worldId, rankingMap };
}

/**
 * Fetch ranking data for all worlds in a region (in parallel).
 */
async function fetchRegionRanking(regionKey) {
    const regionName = REGION_NAMES[regionKey] || regionKey;
    const worldIds = WORLDS_BY_REGION[regionKey] || [];

    if (worldIds.length === 0) return {};

    console.log(`\n🌏 [${regionName}] Starting parallel scrape of ${worldIds.length} servers...`);
    logMemory(`[${regionName}] Start`);

    const startTime = Date.now();

    // Create tasks for all worlds in this region
    const tasks = worldIds.map(worldId => () => {
        const worldgroupId = WORLD_GROUP_IDS[worldId] || 3;
        return fetchWorldRanking(worldId, worldgroupId);
    });

    // Run all worlds in parallel with concurrency limit
    const results = await runWithConcurrency(tasks, CONCURRENT_WORLDS);

    // Merge results
    const regionResult = {};
    let totalPlayers = 0;
    for (const { worldId, rankingMap } of results) {
        regionResult[worldId] = rankingMap;
        totalPlayers += Object.keys(rankingMap).length;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ [${regionName}] Done! ${totalPlayers} players across ${worldIds.length} servers (${elapsed}s)`);
    logMemory(`[${regionName}] End`);

    return regionResult;
}

/**
 * Fetch ranking data for ALL configured worlds across all regions.
 * Scrapes regions in parallel for maximum speed.
 *
 * Returns: { "611": { "PlayerName": "ClanName", ... }, "612": {...} }
 */
export async function fetchMir4RankingData(forceRefresh = false) {
    if (!forceRefresh) {
        const localCache = getLocalRankingCache();
        if (localCache && Object.keys(localCache).length > 0) return localCache;
    }

    const totalStart = Date.now();
    console.log('\n🚀 Starting PARALLEL ranking scrape across all regions...');
    console.log(`   Regions: ${Object.keys(WORLDS_BY_REGION).length} | Concurrent regions: ${CONCURRENT_REGIONS} | Concurrent worlds: ${CONCURRENT_WORLDS}`);
    logMemory('Scrape Start');

    const regionKeys = Object.keys(WORLDS_BY_REGION);

    // Create tasks for all regions
    const regionTasks = regionKeys.map(key => () => fetchRegionRanking(key));

    // Run all regions in parallel with concurrency limit
    const regionResults = await runWithConcurrency(regionTasks, CONCURRENT_REGIONS);

    // Merge all region results into final result
    const result = {};
    let totalPlayers = 0;
    let totalWorlds = 0;

    for (const regionResult of regionResults) {
        for (const [worldId, rankingMap] of Object.entries(regionResult)) {
            result[worldId] = rankingMap;
            totalPlayers += Object.keys(rankingMap).length;
            totalWorlds++;
        }
    }

    const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
    console.log(`\n🎉 PARALLEL SCRAPE COMPLETE!`);
    console.log(`   Total: ${totalPlayers} players across ${totalWorlds} worlds in ${totalElapsed}s`);
    logMemory('Scrape Complete');

    // Force garbage collection if available
    if (global.gc) {
        global.gc();
        logMemory('After GC');
    }

    if (totalPlayers === 0) return getLocalRankingCache() || {};
    saveRankingCache(result);
    logMemory('After Cache Save');

    return result;
}

/**
 * Fetch ranking data for a SINGLE region only.
 * Useful for targeted updates without scraping everything.
 */
export async function fetchRegionRankingData(regionKey, forceRefresh = false) {
    if (!forceRefresh) {
        const localCache = getLocalRankingCache();
        if (localCache && Object.keys(localCache).length > 0) {
            // Check if this region's data is already cached
            const worldIds = WORLDS_BY_REGION[regionKey] || [];
            const hasData = worldIds.some(id => localCache[id] && Object.keys(localCache[id]).length > 0);
            if (hasData) return localCache;
        }
    }

    console.log(`\n🚀 Starting single-region scrape: ${REGION_NAMES[regionKey] || regionKey}`);
    logMemory(`[${regionKey}] Start`);

    const regionResult = await fetchRegionRanking(regionKey);

    // Merge with existing cache
    const existingCache = getLocalRankingCache() || {};
    const merged = { ...existingCache, ...regionResult };
    saveRankingCache(merged);

    logMemory(`[${regionKey}] Complete`);
    return merged;
}

export async function safelyFetchGuildMembers(guild, logEvent) {
    try {
        return await guild.members.fetch({ time: 30000 });
    } catch (error) {
        logEvent(getMsg('ranking.logs.gatewayWarning'));
        return guild.members.cache;
    }
}
