// ==========================================
// 📥 SCAN IMPORT HANDLERS
// ==========================================
// Handles scanimport and scanimport_status commands
// Extracted from ranking-cmd-admin.js

import {
    SUPER_ADMIN_USER_ID,
    DISCORD_SERVER_ID,
    SCAN_SERVER_ID
} from '../core/ranking-constants.js';
import { getLocalRankingCache } from '../core/ranking-cache.js';
import { lookupNickname } from '../core/ranking-service.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';
import { assignClanRole, assignTempRole, removeMemberRoles } from '../core/clan-roles.js';

// ==========================================
// 🖱️ SCAN IMPORT HANDLER
// ==========================================

export async function handleScanImport(interaction, db, saveLocalStorage, logEvent) {
    const { options, user, guild } = interaction;

    if (user.id !== SUPER_ADMIN_USER_ID) {
        return interaction.reply({ content: `❌ Only <@${SUPER_ADMIN_USER_ID}> can use this command.`, flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const prodGuild = interaction.guild;
    if (prodGuild.id !== DISCORD_SERVER_ID) {
        return interaction.editReply('❌ This command must be run in the main production server.');
    }

    // ── RESET MODE: clear all existing registrations from scan servers ──
    const doReset = options.getBoolean('reset') || false;
    let totalResetOwners = 0;
    let totalResetPilots = 0;

    if (doReset) {
        const resetServers = [
            { id: SCAN_SERVER_ID, name: 'Claim Server' }
        ];

        for (const srv of resetServers) {
            const srvGuild = interaction.client.guilds.cache.get(srv.id);
            if (!srvGuild) continue;

            const srvMembers = await srvGuild.members.fetch().catch(() => null);
            if (!srvMembers) continue;

            for (const [memberId] of srvMembers) {
                if (memberId === interaction.client.user.id) continue;

                const userData = db.users[memberId];
                if (!userData || (!userData.registeredAt && !userData.manual)) continue;

                // Check if this user is a pilot (linked to some owner)
                const isPilot = Object.values(db.users).some(u => u.pilotIds && u.pilotIds.includes(memberId));

                if (isPilot) {
                    // Remove pilot link from all owners
                    for (const [oid, od] of Object.entries(db.users)) {
                        if (od.pilotIds && od.pilotIds.includes(memberId)) {
                            od.pilotIds = od.pilotIds.filter(id => id !== memberId);
                        }
                    }
                    totalResetPilots++;
                } else {
                    // Owner — also remove their pilots
                    if (userData.pilotIds && userData.pilotIds.length > 0) {
                        for (const pId of userData.pilotIds) {
                            if (db.users[pId]) {
                                delete db.users[pId];
                                totalResetPilots++;
                            }
                        }
                    }
                    totalResetOwners++;
                }

                // Remove from production server: reset nickname + remove roles
                const prodMember = await prodGuild.members.fetch(memberId).catch(() => null);
                if (prodMember) {
                    await removeMemberRoles(prodMember, db);
                    await prodMember.setNickname(prodMember.user.username).catch(() => {});
                }

                delete db.users[memberId];
            }
        }

        // Also clean any pre-registrations linked to these servers
        if (db.preRegistrations) {
            const preRegIds = Object.keys(db.preRegistrations);
            for (const srv of resetServers) {
                const srvGuild = interaction.client.guilds.cache.get(srv.id);
                if (!srvGuild) continue;
                const srvMembers = await srvGuild.members.fetch().catch(() => null);
                if (!srvMembers) continue;
                for (const [memberId] of srvMembers) {
                    if (db.preRegistrations[memberId]) {
                        delete db.preRegistrations[memberId];
                    }
                }
            }
        }

        saveLocalStorage();
        logEvent(`📥 [ScanImport] 🔄 RESET: removed ${totalResetOwners} owners and ${totalResetPilots} pilots from scan servers — re-importing fresh`);
    }

    // Scan source — the single Discord server this bot operates on (claim server)
    const originServers = [
        {
            id: SCAN_SERVER_ID,
            name: 'Claim Server',
            isPilot(displayName) {
                return displayName.endsWith(' - Pilot');
            },
            parseNick(displayName) {
                const pilotSuffix = ' - Pilot';
                let base = displayName.endsWith(pilotSuffix)
                    ? displayName.slice(0, -pilotSuffix.length).trim()
                    : displayName.trim();
                // Strip known server prefix (e.g. "EU011 - Name" → "Name") so DB
                // nicknames stay as plain character names.
                const prefixMatch = base.match(/^[A-Z0-9]+ - (.+)$/);
                if (prefixMatch) base = prefixMatch[1].trim();
                return base;
            }
        }
    ];

    let totalRegistered = 0;
    let totalPreReg = 0;
    let totalSkipped = 0;
    let totalPilotsLinked = 0;
    let totalPilotPreReg = 0;
    let membersFetched = 0;
    let noNicknameCount = 0;
    const results = [];
    const pendingPilots = []; // { memberId, ownerNick, member }

    // Build a lookup map of existing owners for pilot linking
    const ownerNickLowerToId = {};
    for (const [id, data] of Object.entries(db.users || {})) {
        if (data.nickname) {
            ownerNickLowerToId[data.nickname.trim().normalize('NFC').toLowerCase()] = id;
        }
    }

    // Helper to register a pilot whose owner is not yet in Discord (pending link)
    const registerPilotPendingOwner = async (ownerNick, pilotMemberId, pilotMember) => {
        db.users[pilotMemberId] = {
            nickname: ownerNick,
            registeredAt: new Date().toISOString(),
            pilotIds: [],
            pendingOwnerNick: ownerNick
        };
        saveLocalStorage();

        // Also create pre-registration to track the pending link
        if (!db.preRegistrations) db.preRegistrations = {};
        db.preRegistrations[pilotMemberId] = {
            nickname: ownerNick,
            pilotIds: [],
            ownerNick,
            ownerId: null,
            registeredAt: new Date().toISOString()
        };
        saveLocalStorage();

        const prodPilot = await prodGuild.members.fetch(pilotMemberId).catch(() => null);
        if (prodPilot) {
            await prodPilot.setNickname(buildPrefixedNickname(ownerNick, db, 'Pilot')).catch(() => {});
            // Owner not in Discord yet — temp role until the link resolves
            await assignTempRole(prodPilot, db, saveLocalStorage, logEvent);
            logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} registered as pilot — awaiting owner "${ownerNick}"`);
            return `✈️ registered as pilot of "${ownerNick}" (awaiting owner)`;
        } else {
            logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} pre-registered as pilot — awaiting owner "${ownerNick}"`);
            return `⏳ pre-registered as pilot of "${ownerNick}" (awaiting owner)`;
        }
    };

    // Helper to link a pending pilot to an owner who just registered
    const linkPendingPilotToOwner = (ownerId, ownerNick) => {
        const ownerNickLower = ownerNick.toLowerCase();
        let linkedCount = 0;
        for (const [pid, pdata] of Object.entries(db.users)) {
            if (pdata.pendingOwnerNick && pdata.pendingOwnerNick.toLowerCase() === ownerNickLower) {
                delete pdata.pendingOwnerNick;
                if (!db.users[ownerId].pilotIds) db.users[ownerId].pilotIds = [];
                if (!db.users[ownerId].pilotIds.includes(pid) && db.users[ownerId].pilotIds.length < 4) {
                    db.users[ownerId].pilotIds.push(pid);
                    // Update pre-registration with ownerId
                    if (db.preRegistrations && db.preRegistrations[pid]) {
                        db.preRegistrations[pid].ownerId = ownerId;
                    }
                    // Update Discord nickname to reflect proper link
                    const member = prodGuild.members.cache.get(pid);
                    if (member) {
                        member.setNickname(buildPrefixedNickname(ownerNick, db, 'Pilot')).catch(() => {});
                    }
                    linkedCount++;
                }
            }
        }
        return linkedCount;
    };

    // Helper to register or pre-register a pilot
    const registerPilot = async (ownerId, ownerNick, pilotMemberId, pilotMember) => {
        if (!db.users[ownerId].pilotIds) db.users[ownerId].pilotIds = [];
        if (db.users[ownerId].pilotIds.includes(pilotMemberId)) {
            return '⏭️ already linked';
        }
        if (db.users[ownerId].pilotIds.length >= 4) {
            return '⏭️ owner has max pilots';
        }

        // Register the pilot user (with same nickname as owner, but they're a pilot)
        db.users[pilotMemberId] = {
            nickname: ownerNick,
            registeredAt: new Date().toISOString(),
            pilotIds: []
        };
        db.users[ownerId].pilotIds.push(pilotMemberId);
        saveLocalStorage();

        // Check if in production server
        const prodPilot = await prodGuild.members.fetch(pilotMemberId).catch(() => null);
        if (prodPilot) {
            await prodPilot.setNickname(buildPrefixedNickname(ownerNick, db, 'Pilot')).catch(() => {});
            // Pilots inherit the owner's clan role (GoW Kids fallback)
            const assigned = await assignClanRole(prodPilot, db, logEvent);
            if (!assigned) await assignTempRole(prodPilot, db, saveLocalStorage, logEvent);
            logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} linked as pilot of "${ownerNick}"`);
            return `✈️ linked as pilot of "${ownerNick}"`;
        } else {
            // Pre-register pilot — update if already exists
            if (!db.preRegistrations) db.preRegistrations = {};
            const existing = db.preRegistrations[pilotMemberId];
            if (existing && (existing.nickname !== ownerNick || existing.ownerNick !== ownerNick)) {
                existing.nickname = ownerNick;
                existing.ownerNick = ownerNick;
                existing.ownerId = ownerId;
                existing.registeredAt = new Date().toISOString();
                saveLocalStorage();
                logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} pre-registration updated as pilot of "${ownerNick}"`);
            } else if (!existing) {
                db.preRegistrations[pilotMemberId] = {
                    nickname: ownerNick,
                    pilotIds: [],
                    ownerNick,
                    ownerId,
                    registeredAt: new Date().toISOString()
                };
                saveLocalStorage();
            }
            logEvent(`📥 [ScanImport] ${pilotMember.user?.tag || pilotMemberId} pre-registered as pilot of "${ownerNick}"`);
            return `⏳ pre-registered as pilot of "${ownerNick}" (waiting to join)`;
        }
    };

    for (const server of originServers) {
        const guild = interaction.client.guilds.cache.get(server.id);
        if (!guild) {
            results.push(`⚠️ Server "${server.name}" (${server.id}) not found — skipping`);
            continue;
        }

        const members = await guild.members.fetch().catch(() => null);
        if (!members || members.size === 0) {
            results.push(`⚠️ Server "${server.name}" (${server.id}) has no members — skipping`);
            continue;
        }

        for (const [memberId, member] of members) {
            if (member.user.bot) continue;
            membersFetched++;

            // Only harvest members with a custom nickname — members without one
            // (showing their Discord username) were never registered.
            if (!member.nickname) {
                noNicknameCount++;
                totalSkipped++;
                continue;
            }

            const displayName = member.nickname;
            const isPilot = server.isPilot(displayName);
            let gameNick = server.parseNick(displayName);

            if (!gameNick) {
                totalSkipped++;
                continue;
            }

            // User already registered — do NOT change their DB nickname, never swap pilot/owner
            if (db.users[memberId] && (db.users[memberId].registeredAt || db.users[memberId].manual === true)) {
                // Check if looks like a wrong registration (pilot format but registered as owner)
                const looksLikeWrongOwner = isPilot && gameNick && 
                    !db.users[memberId].pendingOwnerNick &&
                    !Object.values(db.users || {}).some(u => u.pilotIds && u.pilotIds.includes(memberId));

                if (looksLikeWrongOwner) {
                    // Log warning but do NOT auto-fix — admin must handle manually
                    logEvent(`⚠️ [ScanImport] ${member.user.tag} (${memberId}) appears to be a pilot registered as owner "${db.users[memberId].nickname}" — NOT auto-fixing, admin intervention required`);
                }

                // Normal already-registered: only update Discord display nickname, NEVER change DB
                const prodMember = await prodGuild.members.fetch(memberId).catch(() => null);
                if (prodMember) {
                    const storedNick = db.users[memberId].nickname.trim().normalize('NFC');
                    const expectedNick = isPilot
                        ? buildPrefixedNickname(storedNick, db, 'Pilot')
                        : buildPrefixedNickname(storedNick, db);

                    if (prodMember.nickname !== expectedNick) {
                        await prodMember.setNickname(expectedNick).catch(() => {});
                        if (results.length < 20) results.push(`🔄 ${member.user.tag} → updated Discord nick to "${expectedNick}"`);
                        logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) Discord nickname updated to "${expectedNick}" (DB nick kept: "${storedNick}")`);
                    }
                }
                totalSkipped++;
                continue;
            }

            if (isPilot) {
                // ── Pilot detection ──
                const ownerNickLower = gameNick.toLowerCase();
                let ownerId = ownerNickLowerToId[ownerNickLower];

                if (ownerId && db.users[ownerId]) {
                    const status = await registerPilot(ownerId, gameNick, memberId, member);
                    if (status.startsWith('✈️')) totalPilotsLinked++;
                    else if (status.startsWith('⏳')) totalPilotPreReg++;
                    else { totalSkipped++; }
                    if (results.length < 20) results.push(`${member.user.tag} ${status}`);
                } else {
                    // Owner not found yet — register pilot as pending owner link
                    const status = await registerPilotPendingOwner(gameNick, memberId, member);
                    if (status.startsWith('✈️')) totalPilotsLinked++;
                    else if (status.startsWith('⏳')) totalPilotPreReg++;
                    else { totalSkipped++; }
                    if (results.length < 20) results.push(`${member.user.tag} ${status}`);
                    // Also keep in pendingPilots in case owner registers later in the same scan
                    pendingPilots.push({ memberId, ownerNick: gameNick, member, displayName });
                }
                continue;
            }

            // ── Owner registration ──
            // Check if nickname already taken
            const takenEntry = Object.entries(db.users).find(([id, data]) =>
                data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === gameNick.toLowerCase()
            );
            if (takenEntry) {
                const [existingId] = takenEntry;
                // Check if the existing user is a wrongly registered pilot (has pilot format in this server)
                const existingOriginMember = members.get(existingId);
                if (existingOriginMember) {
                    const existingDisplay = existingOriginMember.nickname || existingOriginMember.user.displayName;
                    if (server.isPilot(existingDisplay)) {
                        // Wrongly registered owner — fix and free the nickname
                        delete db.users[existingId];
                        saveLocalStorage();
                        logEvent(`📥 [ScanImport] ${member.user.tag} FIXED: removed wrong owner ${existingOriginMember.user.tag} — freeing nickname "${gameNick}"`);
                        // Fall through to register the real owner
                    } else {
                        totalSkipped++;
                        if (results.length < 20) results.push(`⏭️ ${member.user.tag} — "${gameNick}" already registered by ${existingOriginMember.user.tag}`);
                        continue;
                    }
                } else {
                    // Existing user not in this server — can't verify, skip
                    totalSkipped++;
                    if (results.length < 20) results.push(`⏭️ ${member.user.tag} — "${gameNick}" already registered`);
                    continue;
                }
            }

            const prodMember = await prodGuild.members.fetch(memberId).catch(() => null);

            if (prodMember) {
                db.users[memberId] = {
                    nickname: gameNick,
                    registeredAt: new Date().toISOString(),
                    pilotIds: []
                };
                saveLocalStorage();

                await prodMember.setNickname(buildPrefixedNickname(gameNick, db)).catch(() => {});
                // Registered owner — clan role if in an allied clan, else temp role
                const assigned = await assignClanRole(prodMember, db, logEvent);
                if (!assigned) await assignTempRole(prodMember, db, saveLocalStorage, logEvent);

                ownerNickLowerToId[gameNick.toLowerCase()] = memberId;

                // Link any pending pilots waiting for this owner
                const pilotsLinked = linkPendingPilotToOwner(memberId, gameNick);
                if (pilotsLinked > 0) {
                    totalPilotsLinked += pilotsLinked;
                    if (results.length < 20) results.push(`🔗 ${member.user.tag} → ${pilotsLinked} pending pilot(s) linked`);
                    logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) linked ${pilotsLinked} pending pilot(s) for "${gameNick}"`);
                }

                totalRegistered++;
                if (results.length < 20) results.push(`✅ ${member.user.tag} → registered as "${gameNick}"`);
                logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) registered as owner "${gameNick}"`);
            } else {
                // Check if already pre-registered, update nickname if changed
                if (!db.preRegistrations) db.preRegistrations = {};
                const existing = db.preRegistrations[memberId];
                if (existing && existing.nickname !== gameNick) {
                    const oldNick = existing.nickname;
                    existing.nickname = gameNick;
                    existing.registeredAt = new Date().toISOString();
                    saveLocalStorage();
                    logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) pre-registration updated: "${oldNick}" → "${gameNick}"`);
                } else if (!existing) {
                    db.preRegistrations[memberId] = {
                        nickname: gameNick,
                        pilotIds: [],
                        registeredAt: new Date().toISOString()
                    };
                    saveLocalStorage();
                }

                ownerNickLowerToId[gameNick.toLowerCase()] = memberId;
                totalPreReg++;
                if (results.length < 20) results.push(`⏳ ${member.user.tag} → pre-registered as "${gameNick}" (waiting for ranking validation)`);
                logEvent(`📥 [ScanImport] ${member.user.tag} (${memberId}) pre-registered as owner "${gameNick}"`);
            }
        }
    }

            // Resolve pending pilots — check if their owner was registered during the scan
    for (const pilot of pendingPilots) {
        const ownerNickLower = pilot.ownerNick.toLowerCase();
        const ownerId = ownerNickLowerToId[ownerNickLower];

        if (ownerId && db.users[ownerId] && db.users[pilot.memberId]) {
            if (db.users[pilot.memberId].pendingOwnerNick) {
                delete db.users[pilot.memberId].pendingOwnerNick;
                if (!db.users[ownerId].pilotIds) db.users[ownerId].pilotIds = [];
                if (!db.users[ownerId].pilotIds.includes(pilot.memberId) && db.users[ownerId].pilotIds.length < 4) {
                    db.users[ownerId].pilotIds.push(pilot.memberId);
                    if (db.preRegistrations && db.preRegistrations[pilot.memberId]) {
                        db.preRegistrations[pilot.memberId].ownerId = ownerId;
                    }
                    saveLocalStorage();
                    const prodPilot = await prodGuild.members.fetch(pilot.memberId).catch(() => null);
                    if (prodPilot) {
                        await prodPilot.setNickname(buildPrefixedNickname(pilot.ownerNick, db, 'Pilot')).catch(() => {});
                    }
                    logEvent(`📥 [ScanImport] ${pilot.member.user.tag} — linked to owner "${pilot.ownerNick}" (resolve)`);
                    if (results.length < 20) results.push(`🔗 ${pilot.member.user.tag} — linked to owner "${pilot.ownerNick}" (resolve)`);
                }
            }
        } else if (!ownerId || !db.users[ownerId]) {
            logEvent(`📥 [ScanImport] ${pilot.member.user.tag} — still awaiting owner "${pilot.ownerNick}" (already registered as pilot)`);
        }
    }

let report = `📥 **Scan Import Complete**\n\n`;
    report += `👥 **Members fetched:** ${membersFetched}\n`;
    report += `✅ **Registered (owners):** ${totalRegistered}\n`;
    report += `✈️ **Pilots linked:** ${totalPilotsLinked}\n`;
    report += `⏳ **Pre-registered (owners):** ${totalPreReg}\n`;
    report += `⏳ **Pre-registered (pilots):** ${totalPilotPreReg}\n`;
    report += `🚫 **No custom nickname:** ${noNicknameCount}\n`;
    report += `⏭️ **Skipped (total):** ${totalSkipped}\n\n`;

    if (membersFetched === 0) {
        report += '⚠️ **0 members fetched — o bot não consegue ver a lista de membros.\nVerifique se a intent privilegiada "Server Members Intent" está ATIVADA no Discord Developer Portal (Bot → Privileged Gateway Intents).**\n';
    } else if (noNicknameCount === membersFetched) {
        report += '⚠️ **Todos os membros estão sem nickname customizado — nada a importar por nickname.\nVerifique se os registrados têm nick definido no Discord, ou use o cargo de membro como filtro.**\n';
    }

    if (results.length > 0) {
        report += `📋 **Details:**\n`;
        report += results.join('\n');
    }

    if (report.length > 1900) {
        report = report.substring(0, 1900) + '\n\n... (truncated)';
    }

    logEvent(`📥 [ScanImport] ${interaction.user.tag} scan: ${totalRegistered} owners, ${totalPilotsLinked} pilots, ${totalPreReg} pre-reg, ${totalSkipped} skipped`);
    return interaction.editReply(report);
}

// ==========================================
// 📊 SCAN IMPORT STATUS HANDLER
// ==========================================

export async function handleScanImportStatus(interaction, db, saveLocalStorage, logEvent) {
    const { guild } = interaction;
    await interaction.deferReply({ flags: 64 });

    if (guild.id !== DISCORD_SERVER_ID) {
        return interaction.editReply('❌ This command must be run in the main production server.');
    }

    // Load ranking cache
    const rankingCache = getLocalRankingCache();

    if (!rankingCache) {
        return interaction.editReply('❌ No ranking cache available. Wait for the daily sync or run /forcesync first to populate the cache.');
    }

    if (!db.preRegistrations || Object.keys(db.preRegistrations).length === 0) {
        return interaction.editReply('✅ **No pre-registrations found.** Everything is clean!');
    }

    let totalChecked = 0;
    let totalConverted = 0;
    let totalInAlliedClan = 0;
    let totalNotFound = 0;
    let totalNotInProd = 0;
    const results = [];
    const prodGuild = guild;

    // Fetch all prod members once
    const prodMembers = await prodGuild.members.fetch().catch(() => null);

    for (const [memberId, preReg] of Object.entries(db.preRegistrations)) {
        totalChecked++;

        // ── Check if user is in production server ──
        const prodMember = prodMembers ? prodMembers.get(memberId) : null;

        if (!prodMember) {
            totalNotInProd++;
            if (results.length < 30) results.push(`⏳ **${preReg.nickname}** — not in prod server yet`);
            continue;
        }

        // ── Check ranking + allied clan via centralized service ──
        const lookup = lookupNickname(preReg.nickname, db, rankingCache);

        if (!lookup.found) {
            // Not found in the EU11 ranking — remove immediately (no time-based expiry)
            delete db.preRegistrations[memberId];
            totalNotFound++;
            if (results.length < 30) results.push(`🗑️ **${preReg.nickname}** — not found in ranking, removed`);
            logEvent(`📊 [ScanImportStatus] Removed pre-registration "${preReg.nickname}" (${memberId}) — not in the EU11 ranking`);
            continue;
        }

        if (!lookup.inAlliedClan) {
            totalInAlliedClan++;
            if (results.length < 30) results.push(`⚠️ **${preReg.nickname}** — found in ${lookup.serverName} (${lookup.clanName}) but NOT allied clan`);
            continue;
        }

        // ── AUTO-CONVERT: in prod server + in ranking + in allied clan ──
        // Check if this is a pilot pre-registration
        if (preReg.ownerNick && preReg.ownerId && db.users[preReg.ownerId]) {
            // Pilot auto-conversion
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
            // Pilots inherit the owner's clan role
            await assignClanRole(prodMember, db, logEvent);
            delete db.preRegistrations[memberId];
            totalConverted++;
            if (results.length < 30) results.push(`✈️ **${preReg.nickname}** → CONVERTED as pilot of **${preReg.ownerNick}** (${lookup.serverName} — ${lookup.clanName})`);
            logEvent(`📊 [ScanImportStatus] Auto-converted pilot "${preReg.nickname}" (${memberId}) — linked to owner "${preReg.ownerNick}" (${lookup.serverName} — ${lookup.clanName})`);
        } else {
            // Owner auto-conversion
            db.users[memberId] = {
                nickname: preReg.nickname,
                registeredAt: new Date().toISOString(),
                pilotIds: preReg.pilotIds || []
            };

            await prodMember.setNickname(buildPrefixedNickname(preReg.nickname, db)).catch(() => {});
            // Converted in an allied clan — clan role is now the marker
            await assignClanRole(prodMember, db, logEvent);
            delete db.preRegistrations[memberId];
            totalConverted++;
            if (results.length < 30) results.push(`✅ **${preReg.nickname}** → CONVERTED to permanent (${lookup.serverName} — ${lookup.clanName})`);
            logEvent(`📊 [ScanImportStatus] Auto-converted owner "${preReg.nickname}" (${memberId}) — found in allied clan ${lookup.clanName} (${lookup.serverName})`);
        }
    }

    saveLocalStorage();

    let report = `📊 **Pre-Registration Status**\n\n`;
    report += `📋 **Total checked:** ${totalChecked}\n`;
    report += `⏳ **Not in prod server:** ${totalNotInProd}\n`;
    report += `❌ **Not found in ranking (removed):** ${totalNotFound}\n`;
    report += `⚠️ **Not in allied clan:** ${totalInAlliedClan}\n`;
    report += `✅ **CONVERTED to permanent:** ${totalConverted}\n\n`;

    if (results.length > 0) {
        report += `📋 **Details:**\n`;
        report += results.join('\n');
    }

    if (report.length > 1900) {
        report = report.substring(0, 1900) + '\n\n... (truncated)';
    }

    logEvent(`📊 [ScanImportStatus] ${interaction.user.tag} checked ${totalChecked} pre-registrations — ${totalConverted} auto-converted, ${totalNotFound} not-in-ranking removed`);
    return interaction.editReply(report);
}
