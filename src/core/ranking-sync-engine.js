import { DISCORD_SERVER_ID, MEMBER_ROLE_ID, ensureConfig } from './ranking-constants.js';
import { fetchMir4RankingData, safelyFetchGuildMembers } from './ranking-scraper.js';
import { getLocalRankingCache, findNicknameInCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';
import { getMsg } from '../lang/lang.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';

// ==========================================
// 🔄 SYNCHRONIZATION ENGINE
// ==========================================

export async function runDailySynchronization(client, db, saveLocalStorage, logEvent, forceRefresh = false) {
    ensureConfig(db);
    logEvent(getMsg('ranking.logs.syncStart'));
    try {
        // Fetch ranking data to populate cache (used by /manualregister)
        await fetchMir4RankingData(forceRefresh);
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
                    if (member.roles.cache.has(MEMBER_ROLE_ID)) await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                    continue; 
                }
            }
        }

        // 2.5. RANKING VALIDATION — remove ROLE (not registration) if nickname not in any world's ranking
        const rankingValidationEnabled = db.config?.rankingValidationEnabled === true;
        const rankingCache = rankingValidationEnabled ? getLocalRankingCache() : null;
        if (rankingCache) {
            let removedRoleCount = 0;
            const cache = rankingCache;

            for (const [memberId, userData] of Object.entries(db.users)) {
                if (!userData.nickname) continue;
                if (userData.tempUntil) continue;
                if (userData.manualPermanent) continue;

                const nickname = userData.nickname.trim().normalize('NFC');
                const inRanking = findNicknameInCache(nickname, cache);

                if (!inRanking) {
                    const member = members.get(memberId);
                    if (member) {
                        const displayName = userData.nickname || member.user.username;
                        logEvent(`⚠️ [Ranking Validation] ${member.user.tag} (${displayName}) not found in any EU ranking — removing role (keeping registration)`);

                        if (member.roles.cache.has(MEMBER_ROLE_ID)) {
                            await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                        }

                        // Keep the nickname — only remove the role
                        removedRoleCount++;
                    }

                    // Also handle pilots linked to this owner — just remove role, keep nickname
                    if (userData.pilotIds && userData.pilotIds.length > 0) {
                        for (const pId of userData.pilotIds) {
                            const pilotMember = members.get(pId);
                            if (pilotMember) {
                                if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                                    await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                                }
                            }
                        }
                    }
                }
            }

            if (removedRoleCount > 0) {
                saveLocalStorage();
                logEvent(`🧹 [Ranking Validation] Removed roles from ${removedRoleCount} member(s) not found in any EU ranking (registrations kept)`);
            }
        }

        // 2.75. TEMP REGISTRATION CLEANUP — convert to permanent or remove on expiry
        const tempCache = getLocalRankingCache();
        if (tempCache) {
            // Check if we're in the clan expedition grace period (Fri 00:01 BRT → Sun 17:00 BRT)
            // During this window, don't remove temp users for not being in an allied clan
            const brtDay = new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
            const brtHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10);
            const isGracePeriod = (brtDay === 'Fri' || brtDay === 'Sat') || (brtDay === 'Sun' && brtHour < 17);

            for (const [memberId, userData] of Object.entries(db.users)) {
                if (!userData.tempUntil) continue;
                if (!userData.nickname) continue;

                const tempUntil = new Date(userData.tempUntil);
                const now = new Date();

                // Look up in ranking cache using centralized service
                const lookup = lookupNickname(userData.nickname, db, tempCache);
                const inAlliedClan = lookup.found && lookup.inAlliedClan;

                if (inAlliedClan) {
                    // Found in an allied clan — convert to permanent
                    delete userData.tempUntil;
                    delete userData.tempRegisteredAt;
                    delete userData.tempNotified24h;
                    saveLocalStorage();
                    logEvent(`✅ [Temp→Permanent] ${memberId} (${userData.nickname}) found in allied clan ${lookup.clanName} (${lookup.serverName}) — converted to permanent`);
                } else {
                    // Send 24h reminder DM if not yet notified and expiring soon
                    const hoursLeft = (tempUntil - now) / (1000 * 60 * 60);
                    if (hoursLeft > 0 && hoursLeft <= 30 && !userData.tempNotified24h) {
                        const guildMember = members.get(memberId);
                        if (guildMember) {
                            try {
                                await guildMember.user.send('⏳ **Reminder:** Your temporary registration expires in less than 24 hours.\n\nMake sure you are in an **allied clan** that appears in the EU ranking to keep your role permanently!\n\nIf you need more time, contact an administrator.');
                                userData.tempNotified24h = true;
                                saveLocalStorage();
                                logEvent(`📧 [Temp Reminder] ${memberId} (${userData.nickname}) sent 24h expiry reminder (${hoursLeft.toFixed(1)}h remaining)`);
                            } catch (e) {
                                logEvent(`⚠️ [Temp Reminder] Failed to send DM to ${memberId} (${userData.nickname}): ${e.message}`);
                            }
                        }
                    }

                    if (now >= tempUntil) {
                    // Expired and not in allied clan — check expedition grace period
                    if (isGracePeriod) {
                        logEvent(`⏸️ [Temp Grace] ${memberId} (${userData.nickname}) expired but in expedition grace period (${brtDay} ${brtHour}h BRT) — deferring removal`);
                        continue;
                    }

                    // Remove role only — keep nickname
                    const member = members.get(memberId);
                    if (member) {
                        if (member.roles.cache.has(MEMBER_ROLE_ID)) {
                            await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                        }
                    }

                    // Also remove any pilots linked to this owner — just remove role, keep nickname
                    if (userData.pilotIds && userData.pilotIds.length > 0) {
                        for (const pId of userData.pilotIds) {
                            const pilotMember = members.get(pId);
                            if (pilotMember) {
                                if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                                    await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                                }
                            }
                            delete db.users[pId];
                        }
                    }

                    logEvent(`⏳ [Temp Expired] ${memberId} (${userData.nickname}) temp registration expired — removing role and registration`);
                    delete db.users[memberId];
                    saveLocalStorage();
                }
            }
        }
        }

        // 2.85. PRE-REGISTRATION AUTO-CONVERSION — convert pre-registered users who are now in allied clans
        if (db.preRegistrations && Object.keys(db.preRegistrations).length > 0) {
            const preRegCache = getLocalRankingCache();
            if (preRegCache) {
                let converted = 0;
                let expired = 0;

                for (const [memberId, preReg] of Object.entries(db.preRegistrations)) {
                    // Check expiry
                    if (preReg.expiresAt && new Date(preReg.expiresAt).getTime() < Date.now()) {
                        delete db.preRegistrations[memberId];
                        expired++;
                        logEvent(`🧹 [PreReg Sync] Removed expired pre-registration for "${preReg.nickname}" (${memberId})`);
                        continue;
                    }

                    // Check if user is in the production server
                    const prodMember = members.get(memberId);
                    if (!prodMember) continue;

                    // Check ranking + allied clan via centralized service
                    const lookup = lookupNickname(preReg.nickname, db, preRegCache);
                    if (!lookup.found || !lookup.inAlliedClan) continue;

                    // Auto-convert!
                    if (preReg.ownerNick && preReg.ownerId && db.users[preReg.ownerId]) {
                        // Pilot
                        if (!db.users[preReg.ownerId].pilotIds) db.users[preReg.ownerId].pilotIds = [];
                        if (!db.users[preReg.ownerId].pilotIds.includes(memberId)) {
                            db.users[preReg.ownerId].pilotIds.push(memberId);
                        }
                        db.users[memberId] = {
                            nickname: preReg.nickname,
                            registeredAt: new Date().toISOString(),
                            pilotIds: []
                        };
                        await prodMember.setNickname(buildPrefixedNickname(preReg.ownerNick, db, 'Pilot')).catch(() => {});
                        logEvent(`✅ [PreReg Sync] Auto-converted pilot "${preReg.nickname}" (${memberId}) → pilot of "${preReg.ownerNick}"`);
                    } else {
                        // Owner
                        db.users[memberId] = {
                            nickname: preReg.nickname,
                            registeredAt: new Date().toISOString(),
                            pilotIds: preReg.pilotIds || []
                        };
                        await prodMember.setNickname(buildPrefixedNickname(preReg.nickname, db)).catch(() => {});
                        logEvent(`✅ [PreReg Sync] Auto-converted owner "${preReg.nickname}" (${memberId}) — allied clan: ${lookup.clanName}`);
                    }

                    if (!prodMember.roles.cache.has(MEMBER_ROLE_ID)) {
                        await prodMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
                    }

                    delete db.preRegistrations[memberId];
                    converted++;
                }

                if (converted > 0 || expired > 0) {
                    saveLocalStorage();
                    logEvent(`🧹 [PreReg Sync] ${converted} auto-converted, ${expired} expired pre-registrations cleaned up`);
                }
            }
        }

        // 3. NICKNAME SYNCHRONIZATION + MEMBER ROLE (allied clan aware)
        const syncCache = getLocalRankingCache();

        for (const [memberId, member] of members) {
            if (member.user.bot) continue;

            const ownerIdOfThisPilot = Object.keys(db.users).find(id => db.users[id].pilotIds && db.users[id].pilotIds.includes(memberId));
            const isPilot = !!ownerIdOfThisPilot;
            
            const effectiveOwnerId = isPilot ? ownerIdOfThisPilot : memberId;
            const ownerData = db.users[effectiveOwnerId];
            const isRegistered = !!(ownerData && (ownerData.registeredAt || ownerData.manual === true)) || isPilot;

            // ── If registered, check allied clan status ──
            let inAlliedClan = false;

            if (isRegistered && ownerData && ownerData.nickname && syncCache) {
                const lookup = lookupNickname(ownerData.nickname, db, syncCache);
                if (lookup.found) {
                    inAlliedClan = lookup.inAlliedClan;
                }
            }

            const hasMemberRole = member.roles.cache.has(MEMBER_ROLE_ID);

            // ── ROLE MANAGEMENT ──
            if (isRegistered) {
                if (ownerData?.manualPermanent) {
                    // 👑 ManualForce user — always ensure role is present, never remove
                    if (!hasMemberRole) {
                        await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                        logEvent(`[Sync] Restored role for manualforce user ${member.user.username}`);
                    }
                } else if (inAlliedClan) {
                    // ✅ In allied clan — ensure role is present
                    if (!hasMemberRole) {
                        await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                        logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: member.user.username }));
                    }
                } else {
                    // ❌ Not in allied clan — remove role (keep registration)
                    if (hasMemberRole) {
                        await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                        logEvent(`[Sync] Removed role from ${member.user.username} — not in allied clan (registration kept)`);
                    }
                }
            } else if (!isRegistered && hasMemberRole && rankingValidationEnabled) {
                // Non-registered user — remove role if validation enabled
                await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                logEvent(getMsg('ranking.logs.roleRemoved', { clan: 'Member', username: member.user.username }));
            }

            // ── NICKNAME MANAGEMENT ──
            // All registered users keep their character name + server prefix, regardless of role status.
            // The role is managed separately above — nickname is always set to the registered name.
            // Never change a user's registered nickname in the database — keep what they registered with.
            // manualPermanent users always keep their nickname regardless of clan status.
            if (isRegistered && (ownerData?.nickname || isPilot)) {
                // Ensure correct nickname — ServerName - CharacterName (or - Pilot suffix)
                let desiredNickname = "";
                if (isPilot) {
                    const ownerNick = db.users[ownerIdOfThisPilot].nickname.trim().normalize('NFC');
                    desiredNickname = buildPrefixedNickname(ownerNick, db, 'Pilot');
                } else if (ownerData?.nickname) {
                    const nick = ownerData.nickname.trim().normalize('NFC');
                    desiredNickname = buildPrefixedNickname(nick, db);
                }

                if (desiredNickname && (member.nickname || '').normalize('NFC') !== desiredNickname) {
                    await member.setNickname(desiredNickname).catch(() => {});
                }
            }
        }

        saveLocalStorage();
        logEvent(getMsg('ranking.logs.syncComplete'));
    } catch (error) { 
        logEvent(getMsg('ranking.logs.syncError', { error: error.message }));
    }
}
