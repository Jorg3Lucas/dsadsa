import axios from 'axios';
import * as cheerio from 'cheerio';
import { HOFGAMER_CLAN_URLS, getRankingServerConfig } from './ranking-constants.js';
import { saveRankingCache, getLocalRankingCache } from './ranking-cache.js';
import { getMsg } from './lang.js';
import { fetchWithBrowser, closeBrowser } from './hofgamer-scraper.js';

// ==========================================
// 🌐 WEB SCRAPING (MIR4 Official Ranking)
// ==========================================

/**
 * Fetch ranking data from the MIR4 official website.
 * If serverId is provided, uses the configured URL for that server.
 */
export async function fetchMir4RankingData(forceRefresh = false, serverId) {
    if (!forceRefresh) {
        const localCache = getLocalRankingCache(serverId);
        if (localCache && Object.keys(localCache).length > 0) return localCache;
    }

    // Get the ranking URL: use per-server config if available, else fallback to default
    let baseUrl;
    if (serverId) {
        const srvConfig = getRankingServerConfig(serverId);
        if (srvConfig && srvConfig.rankingUrl) {
            baseUrl = srvConfig.rankingUrl;
            console.log(`[Ranking] Using configured URL for ${srvConfig.name}`);
        }
    }
    if (!baseUrl) {
        baseUrl = 'https://forum.mir4global.com/rank?ranktype=1&worldgroupid=3&worldid=611&classtype=&searchname=';
        console.log('[Ranking] Using default URL (no per-server config)');
    }

    const rankingMap = {};
    const urlPrefix = baseUrl.includes('?') ? baseUrl + '&page=' : baseUrl + '?page=';
    console.log(getMsg('ranking.logs.fetchStart'));
    
    for (let page = 1; page <= 10; page++) {
        try {
            const { data } = await axios.get(`${urlPrefix}${page}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 30000 
            });
            const $ = cheerio.load(data);
            $('table tbody tr').each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length >= 3) {
                    let nick = cells.eq(1).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                    let clan = cells.eq(2).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                    if (nick) {
                        rankingMap[nick] = (clan && clan !== '-' && clan !== '—') ? clan : "No Clan";
                    }
                }
            });
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (err) { console.error(getMsg('ranking.logs.fetchPageError', { page, error: err.message })); }
    }
    if (Object.keys(rankingMap).length === 0) return getLocalRankingCache(serverId) || {};
    saveRankingCache(rankingMap, serverId);
    return rankingMap;
}

/**
 * Fetch clan power data from hofgamer.com.
 * Uses HOFGAMER_CLAN_URLS merged from all server configs.
 */
export async function fetchClanPowerData(logEvent) {
    const powerMap = {};
    try {
        for (const [clanName, url] of Object.entries(HOFGAMER_CLAN_URLS)) {
            try {
                const html = await fetchWithBrowser(url, { timeout: 60000 });
                const $ = cheerio.load(html);

                let count = 0;
                $('table').first().find('tr').each((i, el) => {
                    const cells = $(el).find('td');
                    if (cells.length >= 3) {
                        let rawNick = cells.eq(0).text().trim().normalize('NFC');
                        let nick = rawNick.split(/[\n\r]+/)[0].trim();
                        // Strip impersonation suffix (冒用) added by hofgamer.com
                        nick = nick.replace(/\(冒用\)/g, '').trim();
                        let powerText = cells.eq(2).text().replace(/[\n\t\r,]/g, '').trim();
                        let power = parseInt(powerText, 10);
                        if (nick && !isNaN(power) && power > 0) {
                            powerMap[nick] = power;
                            count++;
                        }
                    }
                });
                logEvent(`Scraped clan ${clanName}: ${count} members found (${Object.keys(powerMap).length} total)`);
                await new Promise(resolve => setTimeout(resolve, 2500));
            } catch (err) {
                logEvent(`Error scraping clan ${clanName}: ${err.message}`);
            }
        }
        if (Object.keys(powerMap).length === 0) {
            logEvent('WARNING: No power data found from any clan page! Selector may need adjustment.');
        }
        return powerMap;
    } finally {
        await closeBrowser();
    }
}

export async function safelyFetchGuildMembers(guild, logEvent) {
    try {
        return await guild.members.fetch({ time: 30000 });
    } catch (error) {
        logEvent(getMsg('ranking.logs.gatewayWarning'));
        return guild.members.cache;
    }
}
