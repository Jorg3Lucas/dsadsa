import { DISCORD_SERVER_ID, CLAN_ROLES, CLAN_POWER_ROLE, CLAN_POWER_THRESHOLD, normalizeForMatch } from './ranking-constants.js';
import { fetchMir4RankingData, fetchClanPowerData, safelyFetchGuildMembers } from './ranking-scraper.js';
import { getMsg } from './lang.js';

// ==========================================
// 🔄 SYNCHRONIZATION ENGINE
// ==========================================

export async function runDailySynchronization(client, db, saveLocalStorage, logEvent, forceRefresh = false) {
    logEvent(getMsg('ranking.logs.syncStart'));
    try {
        const currentRanking = await fetchMir4RankingData(forceRefresh); 
        const activeGuild = client.guilds.cache.get(DISCORD_SERVER_ID);
        if (!activeGuild) return;

        if (!db.users) db.users = {};
        
        const members = await safelyFetchGuildMembers(activeGuild, logEvent);
        if (!members || members.size === 0) {
            logEvent(getMsg('ranking.logs.syncAbort'));
            return;
        }

        for (const id in db.users) {
            if (db.users[id].pilotId) {
                if (!db.users[id].pilotIds) db.users[id].pilotIds = [db.users[id].pilotId];
                delete db.users[id].pilotId;
            }
            if (!db.users[id].pilotIds) db.users[id].pilotIds = [];
        }

        // 1. PILOT AUTO-LINK
        for (const [memberId, member] of members) {
            if (member.user.bot) continue;
            const currentNick = (member.nickname || member.user.username).trim().normalize('NFC');
            if (currentNick.endsWith(' - Pilot')) {
                const ownerBaseNick = currentNick.replace(' - Pilot', '').trim();
                const ownerEntry = Object.entries(db.users).find(([id, data]) => data.nickname.trim().normalize('NFC').toLowerCase() === ownerBaseNick.toLowerCase());
                if (ownerEntry) {
                    const [ownerId, ownerData] = ownerEntry;
                    if (!ownerData.pilotIds.includes(memberId) && ownerData.pilotIds.length < 4) {
                        ownerData.pilotIds.push(memberId);
                        logEvent(getMsg('ranking.logs.autoLink', { username: member.user.username, count: ownerData.pilotIds.length, baseNick: ownerBaseNick }));
                    }
                }
            }
        }

        // 2. ANTI-IMPOSTOR SECURITY SYSTEM
        for (const [memberId, member] of members) {
            if (member.user.bot) continue;
            const currentNick = (member.nickname || member.user.username).trim().normalize('NFC');
            const cleanNick = currentNick.replace(' - Pilot', '').trim();
            const ownerEntry = Object.entries(db.users).find(([id, data]) => data.nickname.trim().normalize('NFC').toLowerCase() === cleanNick.toLowerCase());

            if (ownerEntry) {
                const [registeredOwnerId, ownerData] = ownerEntry;
                if (memberId !== registeredOwnerId && (!ownerData.pilotIds || !ownerData.pilotIds.includes(memberId))) {
                    logEvent(getMsg('ranking.logs.imposterDetected', { username: member.user.username, nickname: ownerData.nickname }));
                    await member.setNickname(member.user.username).catch(() => {});
                    for (const roleId of Object.values(CLAN_ROLES)) {
                        if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => {});
                    }
                    continue; 
                }
            }
        }

        // 3. ROLE AND NICKNAME SYNCHRONIZATION
        for (const [memberId, member] of members) {
            if (member.user.bot) continue;

            const ownerIdOfThisPilot = Object.keys(db.users).find(id => db.users[id].pilotIds && db.users[id].pilotIds.includes(memberId));
            const isPilot = !!ownerIdOfThisPilot;
            
            const effectiveOwnerId = isPilot ? ownerIdOfThisPilot : memberId;
            const ownerData = db.users[effectiveOwnerId];

            let inGameNick = "";
            if (ownerData) {
                inGameNick = ownerData.nickname.trim().normalize('NFC');
            } else {
                inGameNick = (member.nickname || member.user.username).trim().normalize('NFC');
                if (inGameNick.endsWith(' - Pilot')) inGameNick = inGameNick.replace(' - Pilot', '').trim();
            }

            if (!db.users[memberId] && !isPilot) {
                db.users[memberId] = { nickname: inGameNick, pilotIds: [], registeredAt: new Date().toISOString() };
            }

            let currentClanInGame = "No Clan";
            if (ownerData && ownerData.clanManual) {
                currentClanInGame = ownerData.clanManual; 
            } else {
                const exactMatchNick = Object.keys(currentRanking).find(k => k.normalize('NFC').toLowerCase() === inGameNick.toLowerCase());
                currentClanInGame = exactMatchNick ? currentRanking[exactMatchNick] : "No Clan";
            }

            const idealRoleId = CLAN_ROLES[currentClanInGame];

            for (const [clanName, roleId] of Object.entries(CLAN_ROLES)) {
                const hasRole = member.roles.cache.has(roleId);
                if (roleId === idealRoleId) {
                    if (!hasRole) {
                        await member.roles.add(roleId).catch(() => {});
                        logEvent(getMsg('ranking.logs.roleAdded', { clan: clanName, username: member.user.username }));
                    }
                } else {
                    if (hasRole) {
                        await member.roles.remove(roleId).catch(() => {});
                        logEvent(getMsg('ranking.logs.roleRemoved', { clan: clanName, username: member.user.username }));
                    }
                }
            }

            let desiredNickname = "";
            if (isPilot) {
                desiredNickname = `${db.users[ownerIdOfThisPilot].nickname.trim().normalize('NFC')} - Pilot`;
            } else if (db.users[memberId]) {
                desiredNickname = db.users[memberId].nickname.trim().normalize('NFC');
            } else {
                desiredNickname = inGameNick;
            }

            if ((member.nickname || '').normalize('NFC') !== desiredNickname) {
                await member.setNickname(desiredNickname).catch(() => {});
            }
        }

        // 4. 10F POWER ROLE SYNCHRONIZATION
        try {
            const powerData = await fetchClanPowerData(logEvent);
            let powerRoleAdded = 0, powerRoleRemoved = 0;
            for (const [memberId, member] of members) {
                if (member.user.bot) continue;

                const ownerIdOfThisPilot = Object.keys(db.users).find(id => db.users[id].pilotIds && db.users[id].pilotIds.includes(memberId));
                const isPilot = !!ownerIdOfThisPilot;
                const effectiveOwnerId = isPilot ? ownerIdOfThisPilot : memberId;
                const ownerData = db.users[effectiveOwnerId];

                if (ownerData && ownerData.nickname) {
                    const normalizedNick = ownerData.nickname.trim().normalize('NFC');
                    // Step 1: Try exact match first
                    let matchKey = Object.keys(powerData).find(k => k.normalize('NFC').toLowerCase() === normalizedNick.toLowerCase());
                    // Step 2: If no exact match, try fuzzy match by stripping decorative chars
                    if (!matchKey) {
                        const cleanReg = normalizeForMatch(normalizedNick);
                        matchKey = Object.keys(powerData).find(k => normalizeForMatch(k) === cleanReg);
                        if (matchKey) {
                            logEvent(`10F Power: Fuzzy matched "${normalizedNick}" -> "${matchKey}"`);
                        }
                    }
                    const power = matchKey ? powerData[matchKey] : undefined;
                    if (!matchKey && powerData && Object.keys(powerData).length > 0) {
                        if (Math.random() < 0.1) {
                            let sampleKeys = Object.keys(powerData).slice(0, 3).map(k => `"${k}"`).join(', ');
                            logEvent(`10F Power: No match for "${normalizedNick}" in powerData. Sample keys: ${sampleKeys}`);
                        }
                    }

                    if (power !== undefined) {
                        const hasRole = member.roles.cache.has(CLAN_POWER_ROLE);
                        if (power >= CLAN_POWER_THRESHOLD) {
                            if (!hasRole) {
                                await member.roles.add(CLAN_POWER_ROLE).catch(() => {});
                                powerRoleAdded++;
                                logEvent(`10F Power: Added role to ${member.user.username} (${normalizedNick} - Power: ${power})`);
                            }
                        } else {
                            if (hasRole) {
                                await member.roles.remove(CLAN_POWER_ROLE).catch(() => {});
                                powerRoleRemoved++;
                                logEvent(`10F Power: Removed role from ${member.user.username} (${normalizedNick} - Power: ${power})`);
                            }
                        }
                    }
                }
            }
            if (powerRoleAdded > 0) logEvent(`10F Power Sync: Added role to ${powerRoleAdded} members (Power >= ${CLAN_POWER_THRESHOLD})`);
            if (powerRoleRemoved > 0) logEvent(`10F Power Sync: Removed role from ${powerRoleRemoved} members (Power < ${CLAN_POWER_THRESHOLD})`);
            logEvent(`10F Power Sync completed.`);
        } catch (powerError) {
            logEvent(`10F Power Sync error: ${powerError.message}`);
        }

        saveLocalStorage();
        logEvent(getMsg('ranking.logs.syncComplete'));
    } catch (error) { 
        logEvent(getMsg('ranking.logs.syncError', { error: error.message }));
    }
}
