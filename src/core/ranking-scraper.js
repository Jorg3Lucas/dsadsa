import axios from 'axios';
import * as cheerio from 'cheerio';
import { saveRankingCache, getLocalRankingCache } from './ranking-cache.js';
import { getMsg } from './lang.js';

// ==========================================
// 🌐 WEB SCRAPING (MIR4 Official Ranking)
// ==========================================

export async function fetchMir4RankingData(forceRefresh = false) {
    if (!forceRefresh) {
        const localCache = getLocalRankingCache();
        if (localCache && Object.keys(localCache).length > 0) return localCache;
    }

    const rankingMap = {};
    const baseUrl = 'https://forum.mir4global.com/rank?ranktype=1&worldgroupid=3&worldid=611&classtype=&searchname=';
    console.log(getMsg('ranking.logs.fetchStart'));
    
    for (let page = 1; page <= 10; page++) {
        let success = false;
        for (let attempt = 1; attempt <= 3 && !success; attempt++) {
            try {
                const { data } = await axios.get(`${baseUrl}&page=${page}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    timeout: 60000
                });
                const $ = cheerio.load(data);
                $('table tbody tr').each((i, el) => {
                    const cells = $(el).find('td');
                    if (cells.length >= 3) {
                        const nick = cells.eq(1).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                        const clan = cells.eq(2).text().replace(/[\n\t\r]/g, '').trim().normalize('NFC');
                        if (nick) {
                            rankingMap[nick] = (clan && clan !== '-' && clan !== '—') ? clan : "No Clan";
                        }
                    }
                });
                success = true;
                if (page < 10) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (err) {
                if (attempt < 3) {
                    console.error(`⚠️ Retry ${attempt}/3 for page ${page}: ${err.message}. Waiting 5s...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    console.error(getMsg('ranking.logs.fetchPageError', { page, error: err.message }));
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }
    }
    if (Object.keys(rankingMap).length === 0) return getLocalRankingCache() || {};
    saveRankingCache(rankingMap);
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
