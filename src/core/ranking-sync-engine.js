import { DISCORD_SERVER_ID, MEMBER_ROLE_ID, OUT_OF_ALLIED_GRACE_MS, ensureConfig } from './ranking-constants.js';
import { fetchMir4RankingData, safelyFetchGuildMembers } from './ranking-scraper.js';
import { getLocalRankingCache, findNicknameInCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';
import { getMsg } from '../lang/lang.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';

// ==========================================
// 🔄 SYNCHRONIZATION ENGINE
// ==========================================

// Global lock: only one sync may run at a time. Concurrent syncs (startup sync +
// /forcesync + the 20:00 cron) pile up CPU-heavy member loops and
// hundreds of Discord API calls, which can stall interaction handling long enough
// for the 3-second acknowledgement window to expire ("The application did not
// respond"). Returns true when this call ran the sync, false when skipped because
// another sync is already in progress.
let syncInProgress = false;

export async function runDailySynchronization(client, db, saveLocalStorage, logEvent, forceRefresh = false) {
    if (syncInProgress) {
        logEvent('⏭️ [Sync] Skipped — synchronization already in progress (another sync is running)');
        return false;
    }
    syncInProgress = true;
    // Conservative Discord-write batching: nickname/role mutations are queued
    // and drained in small groups (8 concurrent writes, 500ms pause between
    // groups) so a heavy sync no longer serializes hundreds of API calls one
    // at a time. flush() is awaited between steps so each step still observes
    // the members' role/nickname state as it is on the server.
    const { queueWrite, flush } = createWriteBatcher();
    try {
        ensureConfig(db);
        logEvent(getMsg('ranking.logs.syncStart'));
        // Fetch ranking data to populate cache (used by /manualregister)
        await fetchMir4RankingData(forceRefresh);
        // Load the ranking cache ONCE — all later steps (validation, temp cleanup,
        // pre-reg conversion, nickname sync) reuse this same object, avoiding
        // repeated stat/read/parse of the cache file on every step.
        const rankingCache = getLocalRankingCache();
        const activeGuild = client.guilds.cache.get(DISCORD_SERVER_ID);
        if (!activeGuild) return false;

        if (!db.users) db.users = {};
        
        const members = await safelyFetchGuildMembers(activeGuild, logEvent);
        if (!members || members.size === 0) {
            logEvent(getMsg('ranking.logs.syncAbort'));
            return false;
        }

        // Precompute nickname → owner once. The per-member passes below otherwise
        // rescan all users for every member (O(members × users)), which can block
        // the event loop for seconds on a large guild — stalling every interaction.
        const ownerByNick = new Map();
        for (const [id, data] of Object.entries(db.users)) {
            if (!data || !data.nickname) continue;
            const cleanKey = data.nickname.trim().normalize('NFC').toLowerCase();
            if (!ownerByNick.has(cleanKey)) ownerByNick.set(cleanKey, { id, data });
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
                const ownerEntry = ownerByNick.get(ownerBaseNick.toLowerCase());
                if (ownerEntry) {
                    const ownerData = ownerEntry.data;
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
            const ownerEntry = ownerByNick.get(cleanNick.toLowerCase());

            if (ownerEntry) {
                const registeredOwnerId = ownerEntry.id;
                const ownerData = ownerEntry.data;
                if (memberId !== registeredOwnerId && (!ownerData.pilotIds || !ownerData.pilotIds.includes(memberId))) {
                    logEvent(getMsg('ranking.logs.imposterDetected', { username: member.user.username, nickname: ownerData.nickname }));
                    queueWrite(() => member.setNickname(member.user.username));
                    if (member.roles.cache.has(MEMBER_ROLE_ID)) queueWrite(() => member.roles.remove(MEMBER_ROLE_ID));
                    continue; 
                }
            }
        }

        await flush();

        // 2.5. RANKING VALIDATION — remove ROLE (not registration) if nickname not in any world's ranking.
        //      Subject to the same per-person 72h grace: the role is only stripped once the
        //      member has been missing from the ranking for over 72h.
        const rankingValidationEnabled = db.config?.rankingValidationEnabled === true;
        if (rankingValidationEnabled && rankingCache) {
            let removedRoleCount = 0;
            let graceStartedCount = 0;
            const cache = rankingCache;

            for (const [memberId, userData] of Object.entries(db.users)) {
                if (!userData.nickname) continue;
                if (userData.tempUntil) continue;
                if (userData.manualPermanent) continue;

                const nickname = userData.nickname.trim().normalize('NFC');
                const inRanking = findNicknameInCache(nickname, cache);

                if (inRanking) {
                    // Account is back in the ranking — allow future notifications + reset grace
                    deleteRoleNotifyFlag(db, memberId, 'rankingValidationNotifiedAt');
                    deleteRoleNotifyFlag(db, memberId, 'outOfAlliedSince');
                } else {
                    const member = members.get(memberId);
                    const graceEnabled = db.config?.graceEnabled !== false; // default: enabled
                    const grace = getOutOfAlliedGraceStatus(db, memberId);

                    if (!graceEnabled) {
                        // Grace disabled — remove role immediately, no timer
                        if (member) {
                            if (member.roles.cache.has(MEMBER_ROLE_ID)) {
                                queueWrite(() => member.roles.remove(MEMBER_ROLE_ID));
                            }
                            removedRoleCount++;
                            logEvent(`⚠️ [Ranking Validation] ${member.user.tag} (${userData.nickname}) not found in any EU ranking — grace disabled, role removed immediately`);
                        }
                    } else if (!grace.started) {
                        // First detection — start the 72h timer. A fresh timer only
                        // matters while the member still holds the role; if it was
                        // already stripped (e.g. after an earlier grace expiry) there
                        // is nothing left to remove.
                        startOutOfAlliedGrace(db, memberId);
                        graceStartedCount++;
                        const stillHasRole = !!(member && member.roles.cache.has(MEMBER_ROLE_ID));
                        logEvent(`⏳ [Ranking Validation] ${member?.user?.tag || memberId} (${userData.nickname}) not found in any EU ranking — 72h grace started${stillHasRole ? ', role kept' : ', role already removed'}`);

                    } else if (grace.expired) {
                        if (member) {
                            const displayName = userData.nickname || member.user.username;
                            logEvent(`⚠️ [Ranking Validation] ${member.user.tag} (${displayName}) not found in any EU ranking for over 72h — removing role (keeping registration)`);

                            if (member.roles.cache.has(MEMBER_ROLE_ID)) {
                                queueWrite(() => member.roles.remove(MEMBER_ROLE_ID));
                            }

                            // Keep the nickname — only remove the role
                            removedRoleCount++;
                        }

                        // Also handle pilots linked to this owner — just remove role, keep nickname.
                        // Pilots follow their owner, but the per-person grace still applies: a
                        // pilot with their own running timer only loses the role once that
                        // timer has elapsed on their own account.
                        if (userData.pilotIds && userData.pilotIds.length > 0) {
                            for (const pId of userData.pilotIds) {
                                const pilotMember = members.get(pId);
                                if (pilotMember && pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                                    const pilotGrace = getOutOfAlliedGraceStatus(db, pId);
                                    if (pilotGrace.expired || !pilotGrace.started) {
                                        queueWrite(() => pilotMember.roles.remove(MEMBER_ROLE_ID));
                                    }
                                }
                            }
                        }

                        // Grace consumed — clear so a later re-entry restarts the countdown
                        deleteRoleNotifyFlag(db, memberId, 'outOfAlliedSince');
                    } else {
                        logEvent(`⏳ [Ranking Validation] ${member?.user?.tag || memberId} (${userData.nickname}) not found in any EU ranking — within 72h grace (${grace.hoursLeft}h left), role kept`);
                    }
                }
            }

            if (removedRoleCount > 0 || graceStartedCount > 0) {
                saveLocalStorage();
                if (removedRoleCount > 0) {
                    logEvent(`🧹 [Ranking Validation] Removed roles from ${removedRoleCount} member(s) not found in any EU ranking for over 72h (registrations kept)`);
                }
            }
        }

        await flush();

        // 2.75. TEMP REGISTRATION CLEANUP — convert to permanent or remove on expiry
        if (rankingCache) {
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
                const lookup = lookupNickname(userData.nickname, db, rankingCache);
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
                            // Deliberately NOT batched: opening a DM channel has its
                            // own strict per-user rate limit, and this path runs at
                            // most once per temp user per sync.
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
                                queueWrite(() => member.roles.remove(MEMBER_ROLE_ID));
                            }
                        }

                        // Also remove any pilots linked to this owner — just remove role, keep nickname
                        if (userData.pilotIds && userData.pilotIds.length > 0) {
                            for (const pId of userData.pilotIds) {
                                const pilotMember = members.get(pId);
                                if (pilotMember) {
                                    if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                                        queueWrite(() => pilotMember.roles.remove(MEMBER_ROLE_ID));
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

        await flush();

        // 2.85. PRE-REGISTRATION AUTO-CONVERSION — convert pre-registered users who are now in allied clans
        if (db.preRegistrations && Object.keys(db.preRegistrations).length > 0 && rankingCache) {
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
                const lookup = lookupNickname(preReg.nickname, db, rankingCache);
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
                    queueWrite(() => prodMember.setNickname(buildPrefixedNickname(preReg.ownerNick, db, 'Pilot')));
                    logEvent(`✅ [PreReg Sync] Auto-converted pilot "${preReg.nickname}" (${memberId}) → pilot of "${preReg.ownerNick}"`);
                } else {
                    // Owner
                    db.users[memberId] = {
                        nickname: preReg.nickname,
                        registeredAt: new Date().toISOString(),
                        pilotIds: preReg.pilotIds || []
                    };
                    queueWrite(() => prodMember.setNickname(buildPrefixedNickname(preReg.nickname, db)));
                    logEvent(`✅ [PreReg Sync] Auto-converted owner "${preReg.nickname}" (${memberId}) — allied clan: ${lookup.clanName}`);
                }

                if (!prodMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    queueWrite(() => prodMember.roles.add(MEMBER_ROLE_ID));
                }

                delete db.preRegistrations[memberId];
                converted++;
            }

            if (converted > 0 || expired > 0) {
                saveLocalStorage();
                logEvent(`🧹 [PreReg Sync] ${converted} auto-converted, ${expired} expired pre-registrations cleaned up`);
            }
        }

        await flush();

        // 3. NICKNAME SYNCHRONIZATION + MEMBER ROLE (allied clan aware)
        const syncCache = rankingCache;

        // Reverse map pilotId → ownerId built after the pre-registration auto-conversion
        // above, so newly linked pilots are included too.
        const ownerIdByPilot = new Map();
        for (const [id, data] of Object.entries(db.users)) {
            if (data.pilotIds) {
                for (const pid of data.pilotIds) ownerIdByPilot.set(pid, id);
            }
        }

        for (const [memberId, member] of members) {
            if (member.user.bot) continue;

            const ownerIdOfThisPilot = ownerIdByPilot.get(memberId);
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

            const hasMemberRole = member.roles.cache.has(MEMBER_ROLE_ID);

            // ── ROLE MANAGEMENT ──
            if (isRegistered) {
                if (ownerData?.manualPermanent) {
                    // 👑 ManualForce user — always ensure role is present, never remove
                    if (!hasMemberRole) {
                        queueWrite(() => member.roles.add(MEMBER_ROLE_ID));
                        logEvent(`[Sync] Restored role for manualforce user ${member.user.username}`);
                    }
                } else if (ownerData?.tempUntil) {
                    // ⏳ Temporary registration — keep role until expiry (handled in step 2.75)
                    if (!hasMemberRole) {
                        queueWrite(() => member.roles.add(MEMBER_ROLE_ID));
                        logEvent(`[Sync] Restored role for temp user ${member.user.username} (expires ${new Date(ownerData.tempUntil).toLocaleDateString()})`);
                    }
                } else if (inAlliedClan) {
                    // ✅ In allied clan — ensure role is present
                    if (!hasMemberRole) {
                        queueWrite(() => member.roles.add(MEMBER_ROLE_ID));
                        logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: member.user.username }));
                    }
                    // Role restored — allow future notifications + reset the 72h grace timer
                    deleteRoleNotifyFlag(db, memberId, 'roleRemovedNotifiedAt');
                    deleteRoleNotifyFlag(db, memberId, 'noRoleReminderSent');
                    deleteRoleNotifyFlag(db, memberId, 'rankingValidationNotifiedAt');
                    deleteRoleNotifyFlag(db, memberId, 'outOfAlliedSince');
                } else if (syncCache) {
                    // ❌ Not in allied clan — remove role (keep registration)
                    // Only run when the ranking cache is available: if the cache is
                    // missing/unavailable, skip role changes (fail-safe, keep roles).
                    //
                    // Safety: a fuzzy-only match must never remove the role. A fuzzy
                    // match can be a DIFFERENT player with a similar name on another
                    // server (e.g. an EU member resolved to someone on NA022 in a
                    // non-allied clan), so it is not evidence that this member left
                    // the allied clans. Only an exact match in a non-allied clan — or
                    // no match at all — justifies stripping the role.
                    const fuzzyOnlyMatch = !!(lookup && lookup.found && lookup.exactMatch === false);
                    if (fuzzyOnlyMatch) {
                        // Fuzzy-only match — keep the role and let admins know why.
                        // The match may be a DIFFERENT player with a similar name,
                        // so it is not evidence this member left the allied clans.
                        if (hasMemberRole) {
                            logEvent(`[Sync] Kept role for ${member.user.username} — ranking match is fuzzy only (${lookup.serverName}/${lookup.clanName}), skipping removal`);
                        }
                    } else if (hasMemberRole) {
                        // ⏳ 72h per-person grace: members who leave the clan — or get
                        // moved to non-registered clans by server managers for events —
                        // can't rejoin until the server reset, so the role is only
                        // removed once they have been outside an allied clan for over
                        // 72h. The timer resets the moment they return to an allied clan.
                        const graceEnabled = db.config?.graceEnabled !== false; // default: enabled
                        const grace = getOutOfAlliedGraceStatus(db, memberId);
                        if (!graceEnabled) {
                            // Grace disabled — remove role immediately
                            queueWrite(() => member.roles.remove(MEMBER_ROLE_ID));
                            logEvent(`⚠️ [Sync] ${member.user.username} not in allied clan — grace disabled, role removed immediately (registration kept)`);
                        } else if (!grace.started) {
                            startOutOfAlliedGrace(db, memberId);
                            logEvent(`⏳ [Sync] ${member.user.username} not in allied clan — 72h grace started, role kept (registration kept)`);
                        } else if (grace.expired) {
                            queueWrite(() => member.roles.remove(MEMBER_ROLE_ID));
                            logEvent(`[Sync] Removed role from ${member.user.username} — not in allied clan for over 72h (registration kept)`);
                            // Grace consumed — clear so a later re-entry restarts the countdown
                            deleteRoleNotifyFlag(db, memberId, 'outOfAlliedSince');
                        } else {
                            logEvent(`⏳ [Sync] ${member.user.username} not in allied clan — within 72h grace (${grace.hoursLeft}h left), role kept`);
                        }
                    }
                }
            } else if (!isRegistered && hasMemberRole && rankingValidationEnabled) {
                // Non-registered user — remove role if validation enabled
                queueWrite(() => member.roles.remove(MEMBER_ROLE_ID));
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
                    // Reuse the allied-clan lookup already computed above — it resolves
                    // the SAME owner nickname, so no second ranking lookup is needed.
                    desiredNickname = buildPrefixedNickname(ownerNick, db, 'Pilot', lookup);
                } else if (ownerData?.nickname) {
                    const nick = ownerData.nickname.trim().normalize('NFC');
                    desiredNickname = buildPrefixedNickname(nick, db, '', lookup);
                }

                if (desiredNickname && (member.nickname || '').normalize('NFC') !== desiredNickname) {
                    queueWrite(() => member.setNickname(desiredNickname));
                }
            }
        }

        await flush();
        saveLocalStorage();
        logEvent(getMsg('ranking.logs.syncComplete'));
        return true;
    } catch (error) { 
        logEvent(getMsg('ranking.logs.syncError', { error: error.message }));
        return false;
    } finally {
        // Flush any writes queued before an error/early exit so a mid-step
        // exception never silently drops pending role/nickname corrections
        // (no-op when the queue is already empty).
        if (flush) await flush();
        syncInProgress = false;
    }
}

// ==========================================
// 📧 ROLE STATUS HELPERS
// ==========================================

/**
 * Delete a per-member notification flag (db.roleNotify[memberId][flag]).
 * Kept per-member so owners and their pilots never share the same flag
 * (a pilot being processed first must not suppress the owner's flag).
 */
function deleteRoleNotifyFlag(db, memberId, flag) {
    if (!db.roleNotify || !db.roleNotify[memberId]) return;
    delete db.roleNotify[memberId][flag];
}

// ==========================================
// ⏳ 72H OUT-OF-ALLIED-CLAN GRACE (per person)
// ==========================================

/**
 * Per-person 72h grace before a member's role is removed for being outside an
 * allied clan (or missing from the ranking). MIR4 players frequently leave the
 * clan temporarily — or get moved to non-registered clans by server managers
 * for events — and can't rejoin until the weekly server reset, so stripping the
 * role on the very next sync is too aggressive. The countdown is stored per
 * member in db.roleNotify[memberId].outOfAlliedSince and resets the moment the
 * member is found back in an allied clan.
 */

/**
 * Read the grace timestamp for a member, or null when no grace is active.
 */
function getOutOfAlliedSince(db, memberId) {
    return db.roleNotify?.[memberId]?.outOfAlliedSince || null;
}

/**
 * Start the 72h grace timer for a member (idempotent — a running timer is kept).
 */
export function startOutOfAlliedGrace(db, memberId, now = new Date()) {
    if (!db.roleNotify) db.roleNotify = {};
    if (!db.roleNotify[memberId]) db.roleNotify[memberId] = {};
    if (!db.roleNotify[memberId].outOfAlliedSince) {
        db.roleNotify[memberId].outOfAlliedSince = now.toISOString();
        return true;
    }
    return false;
}

/**
 * Status of the member's 72h grace:
 *   - started: a timer exists (they were detected outside an allied clan)
 *   - expired: the 72h window has elapsed (role removal is now allowed)
 *   - hoursLeft: whole hours remaining until the window closes (0 when expired)
 * A member with no timer is never "expired" — the first detection starts it.
 */
export function getOutOfAlliedGraceStatus(db, memberId, now = new Date()) {
    const HOUR_MS = 60 * 60 * 1000;
    const since = getOutOfAlliedSince(db, memberId);
    if (!since) {
        // No timer yet — a member detected for the first time effectively has the
        // full 72h ahead of them (never "expired" until a timer actually runs).
        return { started: false, expired: false, hoursLeft: OUT_OF_ALLIED_GRACE_MS / HOUR_MS };
    }
    const sinceMs = new Date(since).getTime();
    // Corrupt/unparseable timestamp: treat as no timer (keeps the role, and the
    // sync will self-heal by starting a fresh timer on the next detection).
    if (Number.isNaN(sinceMs)) {
        return { started: false, expired: false, hoursLeft: OUT_OF_ALLIED_GRACE_MS / HOUR_MS };
    }
    const elapsed = now.getTime() - sinceMs;
    if (elapsed >= OUT_OF_ALLIED_GRACE_MS) {
        return { started: true, expired: true, hoursLeft: 0 };
    }
    return {
        started: true,
        expired: false,
        hoursLeft: Math.max(1, Math.ceil((OUT_OF_ALLIED_GRACE_MS - elapsed) / HOUR_MS))
    };
}

// ==========================================
// ⚡ CONSERVATIVE DISCORD-WRITE BATCHING
// ==========================================

export const WRITE_BATCH_SIZE = 8;
export const WRITE_BATCH_PAUSE_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Batches Discord mutations (setNickname / roles.add / roles.remove) into
 * conservative groups: up to WRITE_BATCH_SIZE concurrent writes, then a
 * WRITE_BATCH_PAUSE_MS pause before the next group. This is the middle ground
 * between one-at-a-time serial writes (slow on heavy syncs) and unbounded
 * parallelism (rate-limit risk).
 *
 * Per-op errors are swallowed (same semantics as the old `await x.catch(() => {})`),
 * so one failing write never breaks the rest of the batch.
 *
 * `queueWrite` is fire-and-forget; `flush()` must be awaited before the caller
 * relies on all writes having completed.
 */
export function createWriteBatcher() {
    const queue = [];
    let flushing = false;
    let startScheduled = false;
    let currentFlush = Promise.resolve();

    function startFlush() {
        flushing = true;
        currentFlush = (async () => {
            while (queue.length > 0) {
                const batch = queue.splice(0, WRITE_BATCH_SIZE);
                await Promise.all(batch.map((op) => op().catch(() => {})));
                if (queue.length > 0) await sleep(WRITE_BATCH_PAUSE_MS);
            }
            flushing = false;
        })();
        return currentFlush;
    }

    // Defer the first drain to the next tick so a synchronous burst of
    // queueWrite() calls (the sync engine's per-member loops) all land in the
    // queue before the first group is spliced — clean batches of 8 instead of
    // a ragged 1-item first group that costs an extra inter-group pause.
    function scheduleStart() {
        if (flushing || startScheduled) return;
        startScheduled = true;
        queueMicrotask(() => {
            startScheduled = false;
            if (flushing || queue.length === 0) return;
            startFlush();
        });
    }

    return {
        /** Queue one write (fire-and-forget; await flush() before relying on it). */
        queueWrite(op) {
            queue.push(op);
            scheduleStart();
            return currentFlush;
        },
        /** Wait until every queued write has completed. No-op on an empty queue. */
        async flush() {
            if (!flushing && queue.length > 0) startFlush();
            while (flushing) {
                await currentFlush;
            }
        }
    };
}

