import { DISCORD_SERVER_ID, ensureConfig, WORLD_IDS } from './ranking-constants.js';
import { fetchMir4RankingData, safelyFetchGuildMembers } from './ranking-scraper.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';
import { getMsg } from '../lang/lang.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';
import { syncClanRoles, assignClanRole, removeMemberRoles, hasAnyMemberRoles } from './clan-roles.js';

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
                    await removeMemberRoles(member, db);
                    continue; 
                }
            }
        }

        // 2.5. RANKING VALIDATION — remove the member ROLE (keep nickname + registration)
        // for users whose account name is NOT found in the NA42 ranking.
        // The nickname and the database registration are kept — only the role is removed.
        // Exempt: manualforce users (manualPermanent) and temporary users (handled in 2.75).
        const rankingValidationEnabled = db.config?.rankingValidationEnabled === true;
        const rankingCache = getLocalRankingCache();
        if (rankingCache) {
            // Safety guard: never run removal when the cache is empty — would wipe everyone.
            const totalPlayers = Object.values(rankingCache).reduce((sum, world) => sum + (world ? Object.keys(world).length : 0), 0);
            if (totalPlayers === 0) {
                logEvent('⚠️ [Ranking Validation] Ranking cache is empty — skipping removal to avoid mass deletion.');
            } else {
                let removedRoleCount = 0;

                for (const [memberId, userData] of Object.entries(db.users)) {
                    if (!userData.nickname) continue;
                    if (userData.tempUntil) continue;       // temp flow (2.75) decides these
                    if (userData.manualPermanent) continue; // manualforce exempt

                    const nickname = userData.nickname.trim().normalize('NFC');
                    const lookup = lookupNickname(nickname, db, rankingCache);

                    // ✅ Found in the NA42 ranking — keep everything, allow future notifications
                    if (lookup.found) {
                        deleteRoleNotifyFlag(db, memberId, 'rankingValidationNotifiedAt');
                        continue;
                    }

                    // ❌ Not found in the NA42 ranking — remove the role, keep the name
                    const member = members.get(memberId);
                    const displayName = userData.nickname || member?.user.username || memberId;

                    if (member) {
                        const hadRole = hasAnyMemberRoles(member, db);
                        await removeMemberRoles(member, db);
                        if (hadRole) {
                            removedRoleCount++;
                            logEvent(`🧹 [Ranking Validation] ${member.user.tag} (${displayName}) not found in the NA42 ranking — removed roles (nickname kept)`);

                            // Notify once when the role is removed by ranking validation
                            if (!getRoleNotifyFlag(db, memberId, 'rankingValidationNotifiedAt')) {
                                setRoleNotifyFlag(db, memberId, 'rankingValidationNotifiedAt');
                                // Suppress the step-3 "no role" reminder — this DM already covers it
                                setRoleNotifyFlag(db, memberId, 'noRoleReminderSent');
                                try {
                                    await sendRankingValidationDm(member, userData.nickname, db);
                                    logEvent(`📧 [DM] Ranking-validation notice sent to ${member.user.tag} (${userData.nickname})`);
                                } catch (e) {
                                    logEvent(`⚠️ [DM] Failed to send ranking-validation notice to ${member.user.tag}: ${e.message}`);
                                }
                            }
                        }
                    }

                    // Also remove the roles from any pilots linked to this owner (nickname kept)
                    if (userData.pilotIds && userData.pilotIds.length > 0) {
                        for (const pId of userData.pilotIds) {
                            const pilotMember = members.get(pId);
                            if (pilotMember) {
                                const hadRole = hasAnyMemberRoles(pilotMember, db);
                                await removeMemberRoles(pilotMember, db);
                                if (hadRole) {
                                    removedRoleCount++;

                                    if (!getRoleNotifyFlag(db, pId, 'rankingValidationNotifiedAt')) {
                                        setRoleNotifyFlag(db, pId, 'rankingValidationNotifiedAt');
                                        setRoleNotifyFlag(db, pId, 'noRoleReminderSent');
                                        try {
                                            // Prefer the pilot's registered nickname; fall back to their current
                                            // Discord nickname (carries the in-game "Owner - Pilot" name)
                                            const pilotNick = db.users[pId]?.nickname || pilotMember.nickname || pilotMember.user.username;
                                            await sendRankingValidationDm(pilotMember, pilotNick, db);
                                            logEvent(`📧 [DM] Ranking-validation notice sent to ${pilotMember.user.tag} (${pilotNick})`);
                                        } catch (e) {
                                            logEvent(`⚠️ [DM] Failed to send ranking-validation notice to ${pilotMember.user.tag}: ${e.message}`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (removedRoleCount > 0) {
                    saveLocalStorage();
                    logEvent(`🧹 [Ranking Validation] Removed member role from ${removedRoleCount} member(s) not found in the NA42 ranking (nicknames and registrations kept)`);
                }
            }
        }

        // 2.75. TEMP REGISTRATION CLEANUP — convert to permanent or remove on expiry
        const tempCache = getLocalRankingCache();
        if (tempCache) {
            // Check if we're in the clan expedition grace period (Fri 00:01 → Sun 17:00 fixed UTC-4)
            // During this window, don't remove temp users for not being in an allied clan
            const naDay = new Date().toLocaleDateString('en-US', { timeZone: 'Etc/GMT+4', weekday: 'short' });
            const naHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Etc/GMT+4', hour: 'numeric', hour12: false }), 10);
            const isGracePeriod = (naDay === 'Fri' || naDay === 'Sat') || (naDay === 'Sun' && naHour < 17);

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
                                await guildMember.user.send('⏳ **Reminder:** Your temporary registration expires in less than 24 hours.\n\nMake sure you are in an **allied clan** that appears in the NA42 ranking to keep your role permanently!\n\nIf you need more time, contact an administrator.');
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
                        logEvent(`⏸️ [Temp Grace] ${memberId} (${userData.nickname}) expired but in expedition grace period (${naDay} ${naHour}h NA) — deferring removal`);
                        continue;
                    }

                    // Remove roles only — keep nickname
                    const member = members.get(memberId);
                    if (member) {
                        await removeMemberRoles(member, db);
                    }

                    // Also remove any pilots linked to this owner — just remove roles, keep nickname
                    if (userData.pilotIds && userData.pilotIds.length > 0) {
                        for (const pId of userData.pilotIds) {
                            const pilotMember = members.get(pId);
                            if (pilotMember) {
                                await removeMemberRoles(pilotMember, db);
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

        // 2.85. PRE-REGISTRATION AUTO-CONVERSION — convert pre-registered users who are now in allied clans,
        // and remove pre-registrations whose nickname is not in the NA42 ranking
        if (db.preRegistrations && Object.keys(db.preRegistrations).length > 0) {
            const preRegCache = getLocalRankingCache();
            if (preRegCache) {
                let converted = 0;
                let removed = 0;

                // Safety guard: don't mass-remove pre-regs when the cache is empty
                const preRegTotalPlayers = Object.values(preRegCache).reduce((sum, world) => sum + (world ? Object.keys(world).length : 0), 0);

                for (const [memberId, preReg] of Object.entries(db.preRegistrations)) {
                    // Check if user is in the production server
                    const prodMember = members.get(memberId);
                    if (!prodMember) continue;

                    // Check ranking via centralized service
                    const lookup = lookupNickname(preReg.nickname, db, preRegCache);

                    // Not found in the NA42 ranking — remove immediately (no time-based expiry).
                    // Covers legacy pre-registrations.
                    if (preRegTotalPlayers > 0 && !lookup.found) {
                        delete db.preRegistrations[memberId];
                        removed++;
                        logEvent(`🧹 [PreReg Sync] Removed pre-registration "${preReg.nickname}" (${memberId}) — not in the NA42 ranking`);
                        continue;
                    }

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

                    await assignClanRole(prodMember, db, logEvent);

                    delete db.preRegistrations[memberId];
                    converted++;
                }

                if (converted > 0 || removed > 0) {
                    saveLocalStorage();
                    logEvent(`🧹 [PreReg Sync] ${converted} auto-converted, ${removed} not-in-ranking pre-registrations cleaned up`);
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
            let lookup = null;

            if (isRegistered && ownerData && ownerData.nickname && syncCache) {
                lookup = lookupNickname(ownerData.nickname, db, syncCache);
                if (lookup.found) {
                    inAlliedClan = lookup.inAlliedClan;
                }
            }

            const hasAnyRole = hasAnyMemberRoles(member, db);

            // ── ROLE MANAGEMENT (clan roles are the only member marker) ──
            if (isRegistered) {
                if (ownerData?.manualPermanent) {
                    // 👑 ManualForce user — always ensure access, never remove
                    await assignClanRole(member, db, logEvent);
                } else if (ownerData?.tempUntil) {
                    // ⏳ Temporary registration — no member role until validated in an allied clan (step 2.75)
                } else if (inAlliedClan) {
                    // ✅ In allied clan — ensure the clan role is present
                    await assignClanRole(member, db, logEvent);
                    // Role restored — allow future notifications
                    deleteRoleNotifyFlag(db, memberId, 'roleRemovedNotifiedAt');
                    deleteRoleNotifyFlag(db, memberId, 'noRoleReminderSent');
                    deleteRoleNotifyFlag(db, memberId, 'rankingValidationNotifiedAt');
                } else if (syncCache) {
                    // ❌ Not in allied clan — remove roles (keep registration)
                    // Only run when the ranking cache is available: if the cache is
                    // missing/unavailable, skip role changes (fail-safe, keep roles).
                    if (hasAnyRole) {
                        await removeMemberRoles(member, db);
                        logEvent(`[Sync] Removed roles from ${member.user.username} — not in allied clan (registration kept)`);

                        // Notify once when the role is removed for not being in an allied clan
                        if (!getRoleNotifyFlag(db, memberId, 'roleRemovedNotifiedAt')) {
                            setRoleNotifyFlag(db, memberId, 'roleRemovedNotifiedAt');
                            try {
                                await sendRoleRemovedDm(member, ownerData, lookup, db);
                                logEvent(`📧 [DM] Role-removed notice sent to ${member.user.tag} (${ownerData.nickname})`);
                            } catch (e) {
                                logEvent(`⚠️ [DM] Failed to send role-removed notice to ${member.user.tag}: ${e.message}`);
                            }
                        }
                    } else if (!getRoleNotifyFlag(db, memberId, 'noRoleReminderSent')) {
                        // Registered but already without role — remind once that they need an allied clan
                        setRoleNotifyFlag(db, memberId, 'noRoleReminderSent');
                        try {
                            await sendNoRoleReminderDm(member, ownerData, lookup, db);
                            logEvent(`📧 [DM] No-role reminder sent to ${member.user.tag} (${ownerData.nickname})`);
                        } catch (e) {
                            logEvent(`⚠️ [DM] Failed to send no-role reminder to ${member.user.tag}: ${e.message}`);
                        }
                    }
                }
            } else if (!isRegistered && hasAnyRole && rankingValidationEnabled) {
                // Non-registered user — remove roles if validation enabled
                await removeMemberRoles(member, db);
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

        // 🤝 Keep clan roles in sync with allied clans after every synchronization
        try {
            await syncClanRoles(client, db, saveLocalStorage, logEvent);
        } catch (syncRolesError) {
            logEvent(`❌ [Clan Roles] Sync failed: ${syncRolesError.message}`);
        }
    } catch (error) { 
        logEvent(getMsg('ranking.logs.syncError', { error: error.message }));
    }
}

// ==========================================
// 📧 ROLE STATUS DM HELPERS
// ==========================================

/**
 * Per-member notification flags (db.roleNotify[memberId][flag])
 * Kept per-member so owners and their pilots never share the same flag
 * (a pilot being processed first must not suppress the owner's DM).
 */
function getRoleNotifyFlag(db, memberId, flag) {
    if (!db.roleNotify) db.roleNotify = {};
    if (!db.roleNotify[memberId]) return false;
    return !!db.roleNotify[memberId][flag];
}

function setRoleNotifyFlag(db, memberId, flag) {
    if (!db.roleNotify) db.roleNotify = {};
    if (!db.roleNotify[memberId]) db.roleNotify[memberId] = {};
    db.roleNotify[memberId][flag] = Date.now();
}

function deleteRoleNotifyFlag(db, memberId, flag) {
    if (!db.roleNotify || !db.roleNotify[memberId]) return;
    delete db.roleNotify[memberId][flag];
}

/**
 * Build a readable list of all allied clans across configured worlds.
 */
function formatAlliedClansList(db) {
    const allied = db.config?.alliedClans || {};
    const lines = [];
    for (const [worldId, clans] of Object.entries(allied)) {
        if (!clans || clans.length === 0) continue;
        const serverName = WORLD_IDS[worldId] || `World ${worldId}`;
        lines.push(`**${serverName}:** ${clans.map(c => `\`${c}\``).join(', ')}`);
    }
    return lines.length > 0 ? lines.join('\n') : '*(none configured)*';
}

/**
 * DM the member when their role is removed by ranking validation (step 2.5):
 * the nickname was not found in the NA42 game-forum ranking. Explains that
 * the role is restored automatically once the account appears in the forum
 * ranking inside an allied clan.
 */
async function sendRankingValidationDm(member, nickname, db) {
    const alliedList = formatAlliedClansList(db);
    await member.send(
        `⚠️ **Member role removed**\n\n` +
        `Your account **${nickname}** was not found in the **game forum ranking**, so the member role was removed.\n\n` +
        `To keep Discord access during the **server reset**, your account needs to appear in the forum ranking inside one of the **main allied clans**:\n\n` +
        `${alliedList}\n\n` +
        `📌 As soon as your account shows up again in the ranking inside an allied clan, your role will be **restored automatically** on the next sync.`
    );
}

/**
 * DM the member when their role is removed because they left the allied clans.
 * Explains the current clan, that they must be in an allied clan for server-reset
 * access, that info is based on the game forum ranking, and that the role is
 * restored automatically once they return to an allied clan.
 */
async function sendRoleRemovedDm(member, userData, lookup, db) {
    const clanLine = lookup && lookup.found
        ? `🏰 **Current clan:** ${lookup.clanName} (${lookup.serverName})`
        : '❌ **Not found in the game forum ranking.**';
    const alliedList = formatAlliedClansList(db);
    await member.send(
        `⚠️ **Member role removed**\n\n` +
        `Your account **${userData.nickname}** lost the member role because you **left the allied clans**.\n\n` +
        `${clanLine}\n\n` +
        `To keep Discord access during the **server reset**, you need to be in one of the **main allied clans**:\n\n` +
        `${alliedList}\n\n` +
        `📌 This info is based on the **game forum ranking**. As soon as your account returns to an allied clan, your role will be **restored automatically** on the next sync.`
    );
}

/**
 * DM a registered member who currently has no member role,
 * explaining they need to be in an allied clan in the game forum.
 */
async function sendNoRoleReminderDm(member, userData, lookup, db) {
    const alliedList = formatAlliedClansList(db);
    const clanLine = lookup && lookup.found
        ? `\n🏰 **Current clan:** ${lookup.clanName} (${lookup.serverName})\n`
        : '\n';
    await member.send(
        `ℹ️ **Active registration — role pending**\n\n` +
        `Your account **${userData.nickname}** is registered, but you still **don't have the member role**.${clanLine}` +
        `To get your role back, you need to be in an **allied clan** in the game forum. When your account appears there, the role will be **restored automatically**.\n\n` +
        `🏰 **Allied clans:**\n${alliedList}`
    );
}
