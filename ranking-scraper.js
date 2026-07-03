import axios from 'axios';
import * as cheerio from 'cheerio';
import { getRankingServerConfig } from './ranking-constants.js';
import { saveRankingCache, getLocalRankingCache } from './ranking-cache.js';
import { getMsg } from './lang.js';

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

    // Get the ranking URL from per-server config
    let baseUrl;
    if (serverId) {
        const srvConfig = getRankingServerConfig(serverId);
        if (srvConfig && srvConfig.rankingUrl) {
            baseUrl = srvConfig.rankingUrl;
            console.log(`[Ranking] Using configured URL for ${srvConfig.name}`);
        }
    }
    if (!baseUrl) {
        console.warn(`[Ranking] No ranking URL configured${serverId ? ` for server "${serverId}"` : ''}. Use !setup to set one.`);
        return {};
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

export async function safelyFetchGuildMembers(guild, logEvent) {
    try {
        return await guild.members.fetch({ time: 30000 });
    } catch (error) {
        logEvent(getMsg('ranking.logs.gatewayWarning'));
        return guild.members.cache;
    }
}
