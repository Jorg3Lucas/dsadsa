import axios from 'axios';
import * as cheerio from 'cheerio';
import { HOFGAMER_CLAN_URLS } from './ranking-constants.js';
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
        try {
            const { data } = await axios.get(`${baseUrl}&page=${page}`, {
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
    if (Object.keys(rankingMap).length === 0) return getLocalRankingCache() || {};
    saveRankingCache(rankingMap);
    return rankingMap;
}

export async function fetchClanPowerData(logEvent) {
    const powerMap = {};
    for (const [clanName, url] of Object.entries(HOFGAMER_CLAN_URLS)) {
        try {
            const { data } = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 30000
            });
            const $ = cheerio.load(data);
            
            let tableCount = $('table').length;
            logEvent(`Debug: Found ${tableCount} table(s) on ${clanName} page`);
            
            if (tableCount > 0) {
                let firstTableHtml = $('table').first().html().substring(0, 500);
                logEvent(`Debug: First table HTML (first 500 chars): ${firstTableHtml.replace(/[\n\t\r]/g, ' ')}`);
            }
            
            let count = 0;
            let rows = $('table').first().find('tr');
            let rowCount = rows.length;
            logEvent(`Debug: Rows found via table>tr: ${rowCount}`);
            
            rows.each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length >= 3) {
                    let rawNick = cells.eq(0).text().trim().normalize('NFC');
                    let nick = rawNick.split(/[\n\r]+/)[0].trim();
                    let powerText = cells.eq(2).text().replace(/[\n\t\r,]/g, '').trim();
                    let power = parseInt(powerText, 10);
                    if (nick && !isNaN(power) && power > 0) {
                        powerMap[nick] = power;
                        count++;
                    }
                }
            });
            logEvent(`Scraped clan ${clanName}: ${count} members found (${Object.keys(powerMap).length} total)`);
            let sampleNames = Object.keys(powerMap).slice(-3).map(n => `"${n}"`).join(', ');
            if (sampleNames) logEvent(`Sample scraped names: ${sampleNames}`);
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (err) {
            logEvent(`Error scraping clan ${clanName}: ${err.message}`);
        }
    }
    if (Object.keys(powerMap).length === 0) {
        logEvent('WARNING: No power data found from any clan page! Selector may need adjustment.');
        try {
            const { data } = await axios.get(Object.values(HOFGAMER_CLAN_URLS)[0], {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 30000
            });
            let tableSection = data.substring(data.indexOf('<table'), data.indexOf('</table>') + 8);
            logEvent(`RAW TABLE HTML: ${tableSection.substring(0, 800).replace(/[\n\t\r]/g, ' ')}`);
        } catch (e) {
            logEvent(`Debug fetch error: ${e.message}`);
        }
    }
    return powerMap;
}

export async function safelyFetchGuildMembers(guild, logEvent) {
    try {
        return await guild.members.fetch({ time: 30000 });
    } catch (error) {
        logEvent(getMsg('ranking.logs.gatewayWarning'));
        return guild.members.cache;
    }
}
