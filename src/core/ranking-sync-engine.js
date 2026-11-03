import { PermissionFlagsBits } from 'discord.js';
import { DISCORD_SERVER_ID, MEMBER_ROLE_ID, OUT_OF_ALLIED_GRACE_MS, MAX_PILOTS_PER_OWNER, ensureConfig } from './ranking-constants.js';
import { fetchMir4RankingData, safelyFetchGuildMembers } from './ranking-scraper.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname, lookupNicknameWithSearch } from './ranking-service.js';
import { isWarLeaveActive, isWarLeaveDenied, clearWarLeave, openWarLeave, trackWarLeaveMember } from './war-leave.js';
import { notifyAlliedClanSuggestions } from './allied-suggestions.js';
import { getMsg } from '../lang/lang.js';
import { recordSyncRun } from './runtime-metrics.js';
import { buildPrefixedNickname, baseNicknameKey, refreshRoleChannelAccess, reapplyMemberRole } from '../core/ranking-utils.js';
// Re-export the original OUT_OF_ALLIED_GRACE_MS constant so the rest of the
// engine does not have to redefine it (it was already declared in the file).
export { OUT_OF_ALLIED_GRACE_MS } from '../core/ranking-constants.js';


// ==========================================
// 🔄 SYNCHRONIZATION ENGINE
// ==========================================

// ==========================================
// ✈️ LEGACY PILOT QUEUE (retired /scanallied command)
// ==========================================
// The /scanallied and /pilotbulk commands were removed, but databases created
// before that still carry db.scanPilotPending entries: pilots registered as
// regular members while wearing "<Owner> - Pilot" whose owner was never linked.
// Until an admin resolves the pair with /manualpilot — or the owner registers and
// step 1 auto-links them — the sync keeps that nickname and never flags the
// member as an impostor using the owner's name. Dropping this handling would make
// the next sync strip those members' roles.

/** True when the member is a pilot left in the legacy queue, still without an owner. */
export function isPendingPilot(db, memberId) {
    return !!(db?.scanPilotPending?.[memberId]);
}

/**
 * Nickname a queued pilot should wear ("<Owner> - Pilot", server-prefixed when
 * the owner name is in the ranking), or null when the queue has no owner for them.
 */
export function pendingPilotNickname(db, memberId) {
    const pending = db?.scanPilotPending?.[memberId];
    if (!pending?.ownerName) return null;
    return buildPrefixedNickname(pending.ownerName, db, 'Pilot');
}

/**
 * True when Discord will accept a role/nickname change for this member.
 *
 * `GuildMember#manageable` is false for the guild owner, for the bot itself and
 * for every member whose highest role sits at or above the bot's highest role —
 * exactly the members Discord answers with 50013 Missing Permissions. Retrying
 * those writes on every sync only floods the log and burns the member-role
 * rate-limit bucket.
 *
 * Returns true when the check cannot be evaluated (cold member cache), so the
 * write still happens instead of silently skipping everyone.
 *
 * @param {object} member - GuildMember (or a partial one)
 * @returns {boolean}
 */
export function canManageGuildMember(member) {
    if (!member) return false;
    try {
        return member.manageable !== false;
    } catch {
        return true;
    }
}

// Discord limits the member-role endpoints to roughly one write per second per
// guild. Firing 8 at a time only produced 429s whose 5-8s retries stalled the
// sync far longer than pacing the writes does.
export const ROLE_WRITE_MIN_INTERVAL_MS = 1100;

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
    //
    // Write failures are LOGGED instead of silently dropped: a refused
    // roles.add() (role hierarchy / missing permission) used to disappear while
    // the step still logged "role added", leaving approved members without the
    // role and no trace of why.
    const { queueWrite, flush } = createWriteBatcher({
        onError: (error) => logEvent(`❌ [Sync] Discord refused a role/nickname change — ${error?.code ? `[${error.code}] ` : ''}${error?.message || error}`)
    });

    // ── Writes Discord will refuse (50013 Missing Permissions) ──
    // The sync used to attempt roles.remove()/setNickname() for every member and
    // let Discord reject the ones the bot cannot manage (guild owner, staff with
    // a role above the bot, or the Member role itself above the bot's role).
    // Those members are now skipped up front and reported once at the end of the
    // run, instead of one "Missing Permissions" error per member per sync.
    const skippedWrites = { role: new Set(), nickname: new Set() };
    let memberRoleEditable = true;

    const canTouchMemberRole = (member) => memberRoleEditable && canManageGuildMember(member);

    const canTouchNickname = (member) => {
        if (!member) return false;
        try {
            if (member.guild?.ownerId && member.id === member.guild.ownerId) return false;
            const botMember = member.guild?.members?.me;
            if (botMember?.permissions?.has && !botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) return false;
        } catch {
            // Member cache unavailable — let Discord decide.
        }
        return canManageGuildMember(member);
    };

    const noteSkipped = (kind, member) => {
        const label = member?.nickname || member?.user?.username || member?.id || 'unknown member';
        skippedWrites[kind].add(label);
    };

    const logSkippedWrites = () => {
        const nameList = (set) => `${[...set].slice(0, 15).join(', ')}${set.size > 15 ? ', …' : ''}`;
        if (skippedWrites.role.size > 0) {
            logEvent(`⚠️ [Sync] Skipped role changes for ${skippedWrites.role.size} member(s) the bot cannot manage (their highest role is at/above the bot's, or the Member role is above the bot's role): ${nameList(skippedWrites.role)}`);
        }
        if (skippedWrites.nickname.size > 0) {
            logEvent(`⚠️ [Sync] Skipped nickname changes for ${skippedWrites.nickname.size} member(s) the bot cannot rename (role hierarchy, guild owner, or missing "Manage Nicknames"): ${nameList(skippedWrites.nickname)}`);
        }
        skippedWrites.role.clear();
        skippedWrites.nickname.clear();
    };

    // Serial, ~1 write per second for Member-role changes (see
    // ROLE_WRITE_MIN_INTERVAL_MS). The chain only spaces the calls; it never
    // blocks on the operation itself.
    let roleWriteChain = Promise.resolve();
    let lastRoleWriteAt = 0;
    const paceRoleWrite = () => {
        const run = roleWriteChain.then(async () => {
            const wait = ROLE_WRITE_MIN_INTERVAL_MS - (Date.now() - lastRoleWriteAt);
            if (wait > 0) await sleep(wait);
            lastRoleWriteAt = Date.now();
        });
        roleWriteChain = run.catch(() => {});
        return run;
    };

    // Count role mutations so the channel-access refresh below only runs when a
    // member's roles actually changed during this run — no pointless
    // CHANNEL_UPDATE storm on a sync that touched nothing.
    const syncStartedAt = Date.now();
    let roleWriteCount = 0;
    const queueRoleWrite = (member, op) => {
        if (!canTouchMemberRole(member)) {
            noteSkipped('role', member);
            return false;
        }
        roleWriteCount++;
        queueWrite(async () => {
            await paceRoleWrite();
            return op();
        });
        return true;
    };
    // Nickname writes share the same pre-flight check: a refused setNickname()
    // costs a rate-limited request and an error line on every sync.
    const queueNicknameWrite = (member, nickname) => {
        if (!canTouchNickname(member)) {
            noteSkipped('nickname', member);
            return false;
        }
        queueWrite(() => member.setNickname(nickname));
        return true;
    };
    // A role the sync RESTORES is a fresh grant for the member's client as well, so
    // it gets the same remove/re-add nudge the single-member flows use
    // (see reapplyMemberRole in ranking-utils). Without it the member keeps the
    // role on the profile but may not see the channels it unlocks.
    const queueRoleRestore = (member, username) => queueRoleWrite(member, async () => {
        await member.roles.add(MEMBER_ROLE_ID);
        const reapplyOutcome = await reapplyMemberRole(member, logEvent, { assumeHasRole: true });
        if (reapplyOutcome.roleRemoved) {
            logEvent(`⚠️ [Sync] Member role restored for ${username} but the client refresh nudge failed — ${reapplyOutcome.reason}`);
        }
    });
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

        // Guild-wide check: when the Member role sits above the bot's highest
        // role, EVERY member-role write is refused — detect it once instead of
        // letting Discord reject every call.
        try {
            const memberRole = activeGuild.roles?.cache?.get?.(MEMBER_ROLE_ID);
            memberRoleEditable = memberRole ? memberRole.editable !== false : true;
        } catch {
            memberRoleEditable = true;
        }
        if (!memberRoleEditable) {
            logEvent('⚠️ [Sync] The Member role is above the bot\'s highest role — role changes are skipped this run. Move the bot\'s role above the Member role.');
        }

        if (!db.users) db.users = {};
        
        const members = await safelyFetchGuildMembers(activeGuild, logEvent);
        if (!members || members.size === 0) {
            logEvent(getMsg('ranking.logs.syncAbort'));
            return false;
        }

        // Precompute nickname → owner once. The per-member passes below otherwise
        // rescan all users for every member (O(members × users)), which can block
        // the event loop for seconds on a large guild — stalling every interaction.
        // Keys use the SAME base normalization as the member lookups below, so a
        // server-prefixed Discord nickname ("EU011 - Name") still matches the
        // bare registered nickname ("Name").
        const ownerByNick = new Map();
        for (const [id, data] of Object.entries(db.users)) {
            if (!data || !data.nickname) continue;
            const cleanKey = baseNicknameKey(data.nickname);
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
                const ownerEntry = ownerByNick.get(baseNicknameKey(currentNick));
                if (ownerEntry) {
                    const ownerData = ownerEntry.data;
                    if (!ownerData.pilotIds.includes(memberId) && ownerData.pilotIds.length < MAX_PILOTS_PER_OWNER) {
                        ownerData.pilotIds.push(memberId);
                        logEvent(getMsg('ranking.logs.autoLink', { username: member.user.username, count: ownerData.pilotIds.length, baseNick: ownerBaseNick }));
                    }
                }
            }
        }

        // 2. ANTI-IMPOSTOR SECURITY SYSTEM
        for (const [memberId, member] of members) {
            if (member.user.bot) continue;
            // A queued pilot wears "<Owner> - Pilot" on purpose before the link
            // exists — never treat that as impersonation.
            if (isPendingPilot(db, memberId)) continue;
            const currentNick = (member.nickname || member.user.username).trim().normalize('NFC');
            const ownerEntry = ownerByNick.get(baseNicknameKey(currentNick));

            if (ownerEntry) {
                const registeredOwnerId = ownerEntry.id;
                const ownerData = ownerEntry.data;
                if (memberId !== registeredOwnerId && (!ownerData.pilotIds || !ownerData.pilotIds.includes(memberId))) {
                    logEvent(getMsg('ranking.logs.imposterDetected', { username: member.user.username, nickname: ownerData.nickname }));
                    queueNicknameWrite(member, member.user.username);
                    if (member.roles.cache.has(MEMBER_ROLE_ID)) queueRoleWrite(member, () => member.roles.remove(MEMBER_ROLE_ID));
                    continue; 
                }
            }
        }

        await flush();

        // NOTE: Step 2.5 (Ranking Validation) was removed — it used exact name matching
        // (findNicknameInCache) which contradicted step 3's fuzzy matching (lookupNickname),
        // causing a cycle where roles were removed then immediately re-added.
        // Step 3 now handles ALL role management consistently with fuzzy matching.

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

                // A manualforce registration is permanent by definition — a
                // leftover tempUntil (e.g. set before the force) must never expire
                // it. Clean the stale temp fields and leave the registration alone.
                if (userData.manualPermanent) {
                    delete userData.tempUntil;
                    delete userData.tempRegisteredAt;
                    delete userData.tempNotified24h;
                    continue;
                }

                const tempUntil = new Date(userData.tempUntil);
                const now = new Date();

                // Look up in ranking cache using centralized service
                // Players registered via forum search need live forum lookup
                const lookup = userData.fromForumSearch
                    ? await lookupNicknameWithSearch(userData.nickname, db, rankingCache)
                    : lookupNickname(userData.nickname, db, rankingCache);
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
                                queueRoleWrite(member, () => member.roles.remove(MEMBER_ROLE_ID));
                            }
                        }

                        // Also remove any pilots linked to this owner — just remove
                        // role, keep nickname. A pilot who is ALSO an owner (own
                        // registration) keeps their profile: the old code deleted
                        // db.users[pId] unconditionally and wiped it.
                        if (userData.pilotIds && userData.pilotIds.length > 0) {
                            for (const pId of userData.pilotIds) {
                                const pilotMember = members.get(pId);
                                if (pilotMember) {
                                    if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                                        queueRoleWrite(pilotMember, () => pilotMember.roles.remove(MEMBER_ROLE_ID));
                                    }
                                }
                                const pilotData = db.users[pId];
                                const hasOwnRegistration = !!(pilotData && (pilotData.registeredAt || pilotData.manual === true));
                                if (!hasOwnRegistration) {
                                    delete db.users[pId];
                                } else {
                                    logEvent(`ℹ️ [Temp Expired] Kept pilot ${pId} (${pilotData.nickname}) — they own their own registration`);
                                }
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
                    queueNicknameWrite(prodMember, buildPrefixedNickname(preReg.ownerNick, db, 'Pilot'));
                    logEvent(`✅ [PreReg Sync] Auto-converted pilot "${preReg.nickname}" (${memberId}) → pilot of "${preReg.ownerNick}"`);
                } else {
                    // Owner
                    db.users[memberId] = {
                        nickname: preReg.nickname,
                        registeredAt: new Date().toISOString(),
                        pilotIds: preReg.pilotIds || []
                    };
                    queueNicknameWrite(prodMember, buildPrefixedNickname(preReg.nickname, db));
                    logEvent(`✅ [PreReg Sync] Auto-converted owner "${preReg.nickname}" (${memberId}) — allied clan: ${lookup.clanName}`);
                }

                if (!prodMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    queueRoleRestore(prodMember, prodMember.user?.username || memberId);
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
                // Players registered via forum search need live forum lookup
                // (they're below top-1000 and won't appear in the ranking cache)
                lookup = ownerData.fromForumSearch
                    ? await lookupNicknameWithSearch(ownerData.nickname, db, syncCache)
                    : lookupNickname(ownerData.nickname, db, syncCache);
                if (lookup.found) {
                    inAlliedClan = lookup.inAlliedClan;
                }
            }

            const hasMemberRole = member.roles.cache.has(MEMBER_ROLE_ID);

            // ✅ Back in an allied clan — end any war-leave monitoring first, so
            // the role branch below does not keep a stale "away" state forever.
            if (isRegistered && !isPilot && inAlliedClan && ownerData?.warLeave) {
                clearWarLeave(ownerData);
                logEvent(`✅ [War Leave] ${ownerData.nickname} is back in an allied clan — monitoring ended`);
            }

            // 🛡️ Active war leave — refresh the forum location and re-ask when
            // the clan/server changed or the 30-day review is due.
            if (isRegistered && !isPilot && isWarLeaveActive(ownerData)) {
                await trackWarLeaveMember(client, db, effectiveOwnerId, ownerData, logEvent, {
                    ranking: lookup?.found ? lookup : null,
                    hasRole: member.roles.cache.has(MEMBER_ROLE_ID)
                });
            }

            // ── ROLE MANAGEMENT ──
            if (isRegistered) {
                if (ownerData?.manualPermanent) {
                    // 👑 ManualForce user — always ensure role is present, never remove
                    if (!hasMemberRole && queueRoleRestore(member, member.user.username)) {
                        logEvent(`[Sync] Restored role for manualforce user ${member.user.username}`);
                    }
                } else if (ownerData?.tempUntil) {
                    // ⏳ Temporary registration — keep role until expiry (handled in step 2.75)
                    if (!hasMemberRole && queueRoleRestore(member, member.user.username)) {
                        logEvent(`[Sync] Restored role for temp user ${member.user.username} (expires ${new Date(ownerData.tempUntil).toLocaleDateString()})`);
                    }
                } else if (isWarLeaveActive(ownerData)) {
                    // 🛡️ War leave (pending or approved) — keep/restore the role.
                    if (!hasMemberRole && queueRoleRestore(member, member.user.username)) {
                        logEvent(`🛡️ [War Leave] Restored role for ${member.user.username} — war leave active`);
                    }
                    deleteRoleNotifyFlag(db, memberId, 'outOfAlliedSince');
                } else if (inAlliedClan) {
                    clearWarLeave(ownerData);
                    // ✅ In allied clan — ensure role is present
                    if (!hasMemberRole && queueRoleRestore(member, member.user.username)) {
                        // Log the REAL role name so a renamed/recreated role id is visible in the logs.
                        const roleName = activeGuild?.roles?.cache?.get?.(MEMBER_ROLE_ID)?.name || 'Member';
                        logEvent(getMsg('ranking.logs.roleAdded', { clan: roleName, username: member.user.username }));
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
                    // 🛡️ Ask the approvers BEFORE the grace/removal in the
                    // approvals channel: any registered member outside the allied
                    // clans — listed in a non-allied clan on ANY server or missing
                    // from every ranking — gets a prompt with their role state,
                    // clan and server. A fuzzy-only match is not evidence, so it
                    // still follows the normal grace flow.
                    const canAskApprovers = !isPilot
                        && !isWarLeaveDenied(ownerData)
                        && (!lookup?.found || lookup.exactMatch !== false);
                    const warProtected = canAskApprovers
                        ? (await openWarLeave(client, db, effectiveOwnerId, ownerData, logEvent, {
                            ranking: lookup?.found ? lookup : null,
                            hasRole: hasMemberRole
                        }))?.protected
                        : false;

                    // Safety: a fuzzy-only match must never remove the role. A fuzzy
                    // match can be a DIFFERENT player with a similar name on another
                    // server (e.g. an EU member resolved to someone on NA022 in a
                    // non-allied clan), so it is not evidence that this member left
                    // the allied clans. Only an exact match in a non-allied clan — or
                    // no match at all — justifies stripping the role.
                    const fuzzyOnlyMatch = !!(lookup && lookup.found && lookup.exactMatch === false);
                    if (warProtected) {
                        if (!hasMemberRole) queueRoleRestore(member, member.user.username);
                        deleteRoleNotifyFlag(db, memberId, 'outOfAlliedSince');
                        logEvent(`🛡️ [War Leave] ${member.user.username} kept the member role while approvers decide`);
                    } else if (fuzzyOnlyMatch && lookup.inAlliedClan) {
                        // Fuzzy-only match in an ALLIED clan — keep the role.
                        // The fuzzy hit is likely the same player found in a clan we trust,
                        // so removing the role would be a false positive.
                        if (hasMemberRole) {
                            logEvent(`[Sync] Kept role for ${member.user.username} — fuzzy match in allied clan (${lookup.serverName}/${lookup.clanName}), skipping removal`);
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
                            if (queueRoleWrite(member, () => member.roles.remove(MEMBER_ROLE_ID))) {
                                logEvent(`⚠️ [Sync] ${member.user.username} not in allied clan — grace disabled, role removed immediately (registration kept)`);
                            }
                        } else if (!grace.started) {
                            startOutOfAlliedGrace(db, memberId);
                            logEvent(`⏳ [Sync] ${member.user.username} not in allied clan — 72h grace started, role kept (registration kept)`);
                        } else if (grace.expired) {
                            if (queueRoleWrite(member, () => member.roles.remove(MEMBER_ROLE_ID))) {
                                logEvent(`[Sync] Removed role from ${member.user.username} — not in allied clan for over 72h (registration kept)`);
                                // Grace consumed — clear so a later re-entry restarts the countdown
                                deleteRoleNotifyFlag(db, memberId, 'outOfAlliedSince');
                            }
                        } else {
                            logEvent(`⏳ [Sync] ${member.user.username} not in allied clan — within 72h grace (${grace.hoursLeft}h left), role kept`);
                        }
                    }
                }
            } else if (!isRegistered && hasMemberRole) {
                // Non-registered user — always remove role. Members must be
                // registered through the bot (panel, /manualregister, /manualforce)
                // to keep their role. Manually-assigned roles from the merge are
                // cleaned up here automatically.
                if (queueRoleWrite(member, () => member.roles.remove(MEMBER_ROLE_ID))) {
                    logEvent(getMsg('ranking.logs.roleRemoved', { clan: 'Member', username: member.user.username }));
                }
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
                    // The owner entry may be missing (deleted while a stale pilotIds
                    // link survived) — guard before touching .nickname.
                    const ownerNick = db.users[ownerIdOfThisPilot]?.nickname
                        ? db.users[ownerIdOfThisPilot].nickname.trim().normalize('NFC')
                        : '';
                    // Reuse the allied-clan lookup already computed above — it resolves
                    // the SAME owner nickname, so no second ranking lookup is needed.
                    desiredNickname = ownerNick
                        ? buildPrefixedNickname(ownerNick, db, 'Pilot', lookup)
                        : '';
                } else if (ownerData?.nickname) {
                    const nick = ownerData.nickname.trim().normalize('NFC');
                    // Queued pilot (owner not identified yet) keeps the nickname
                    // taken from the list instead of their own registered one.
                    desiredNickname = pendingPilotNickname(db, memberId)
                        || buildPrefixedNickname(nick, db, '', lookup);
                }

                if (desiredNickname && (member.nickname || '').normalize('NFC') !== desiredNickname) {
                    queueNicknameWrite(member, desiredNickname);
                }
            }
        }

        await flush();

        // Roles changed in this run: re-emit the Member role's channel overwrites
        // ONCE (not per member) so every affected client recomputes its channel
        // list immediately, instead of waiting for a manual role re-add.
        if (roleWriteCount > 0) {
            await refreshRoleChannelAccess(activeGuild, logEvent);
        }

        // Record the run's real size so /stats can show it and a future
        // regression is visible instead of "the sync feels slow".
        recordSyncRun({ durationMs: Date.now() - syncStartedAt, members: members.size, roleWrites: roleWriteCount });

        // Persist WHEN the sync last succeeded so the startup path (index.js)
        // can tell whether the daily cycle still needs a run: the cron owns the
        // schedule, and a restart only syncs as a catch-up when the last run
        // predates the most recent scheduled time (sync-schedule.js). Written on
        // success only — a failed run must leave the catch-up armed.
        db.config.lastSyncAt = new Date().toISOString();

        // 💡 Several registered members sitting in the same non-allied clan?
        // Suggest adding it to that server's allied list (once per clan/week).
        await notifyAlliedClanSuggestions(client, db, saveLocalStorage, logEvent, syncCache);

        saveLocalStorage();
        logEvent(getMsg('ranking.logs.syncComplete'));
        return true;
    } catch (error) { 
        recordSyncRun({ durationMs: Date.now() - syncStartedAt, members: null, roleWrites: roleWriteCount });
        logEvent(getMsg('ranking.logs.syncError', { error: error.message }));
        return false;
    } finally {
        // Flush any writes queued before an error/early exit so a mid-step
        // exception never silently drops pending role/nickname corrections
        // (no-op when the queue is already empty).
        if (flush) await flush();
        logSkippedWrites();
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
 * Per-op errors never break the rest of the batch; they are handed to the
 * optional `onError` callback (silently dropped when it is not provided, same
 * semantics as the old `await x.catch(() => {})`).
 *
 * `queueWrite` is fire-and-forget; `flush()` must be awaited before the caller
 * relies on all writes having completed.
 *
 * @param {{onError?: (error: Error) => void}} [options]
 */
export function createWriteBatcher({ onError } = {}) {
    const queue = [];
    let flushing = false;
    let startScheduled = false;
    let currentFlush = Promise.resolve();

    function startFlush() {
        flushing = true;
        currentFlush = (async () => {
            while (queue.length > 0) {
                const batch = queue.splice(0, WRITE_BATCH_SIZE);
                await Promise.all(batch.map((op) => op().catch((error) => {
                    try {
                        onError?.(error);
                    } catch {
                        // A failing log sink must never break the flush loop
                    }
                })));
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

