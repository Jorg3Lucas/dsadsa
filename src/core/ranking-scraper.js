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
const DELAY_BETWEEN_PAGES_MS = 3000;  // Delay between pages (reduced from 5s)
const DELAY_BETWEEN_RETRIES_MS = 5000; // Delay before retry

/**
 * Helper: sleep for ms milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
 */
async function fetchWorldRanking(worldId, worldgroupId) {
    const serverName = WORLD_IDS[worldId] || `World ${worldId}`;
    const rankingMap = {};

    for (let page = 1; page <= PAGES_PER_WORLD; page++) {
        let success = false;
        for (let attempt = 1; attempt <= 3 && !success; attempt++) {
            try {
                const { data } = await axios.get(
                    `${BASE_URL}&worldgroupid=${worldgroupId}&worldid=${worldId}&page=${page}`,
                    {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                        timeout: 60000
                    }
                );
                const $ = cheerio.load(data);
                $('table tbody tr').each((_, el) => {
                    const cells = $(el).find('td');
                    if (cells.length >= 3) {
                        const nick = cells.eq(1).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                        const clan = cells.eq(2).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                        if (nick) {
                            rankingMap[nick] = (clan && clan !== '-' && clan !== '—') ? clan : 'No Clan';
                        }
                    }
                });
                success = true;
                if (page < PAGES_PER_WORLD) {
                    await sleep(DELAY_BETWEEN_PAGES_MS);
                }
            } catch (err) {
                if (attempt < 3) {
                    console.error(`⚠️ Retry ${attempt}/3 for ${serverName} page ${page}: ${err.message}`);
                    await sleep(DELAY_BETWEEN_RETRIES_MS);
                } else {
                    console.error(`❌ Failed ${serverName} page ${page} after 3 attempts: ${err.message}`);
                }
            }
        }
    }

    const playerCount = Object.keys(rankingMap).length;
    console.log(`✅ ${serverName}: ${playerCount} players scraped.`);
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
