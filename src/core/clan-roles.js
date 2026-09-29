// ==========================================
// 🤝 MEMBER ROLE + CHANNEL PERMISSIONS
// ==========================================
// The bot manages EXACTLY ONE role for membership: the fixed member role
// (MEMBER_ROLE_ID, defined in ranking-constants.js).
//
//   • It is granted to registered members validated against the EU21 ranking
//     (allied clan, temp window or manualforce) and removed from members that
//     fail validation.
//   • The bot NEVER creates, renames or deletes roles — the member role must
//     already exist on the server (created manually by an admin).
//   • Claim channels (7F-12F, Summons) and the general member channels are
//     restricted to this single role. Clan roles and the old "GoW Kids" temp
//     role are ignored.
//
// Applied automatically at boot and at the end of the daily synchronization
// (ranking-sync-engine) — there is no slash command for it.

import { DISCORD_SERVER_ID, ensureConfig, MEMBER_ROLE_ID } from './ranking-constants.js';
import { CLAIM_CATEGORIES, GENERAL_CATEGORY, ELDER_ROLE_ID, buildClaimOverwrites, buildEldersOverwrites, buildMemberOverwrites, buildMemberViewOverwrites, findTextChannel, findClaimCategory } from './server-structure.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';

/**
 * Apply restrictive permissions to a claim category and its channels:
 * @everyone cannot view (or send), the bot and the member role can VIEW ONLY,
 * only the bot can send (panels).
 * @param {import('discord.js').Guild} guild
 * @param {string} botId
 * @param {string[]} memberRoleIds - member role IDs allowed to view
 */
async function applyClaimPermissions(guild, botId, memberRoleIds) {
    const everyone = guild.roles.everyone;
    const overwrites = buildClaimOverwrites(everyone.id, botId, memberRoleIds);

    for (const catDef of CLAIM_CATEGORIES) {
        const category = findClaimCategory(guild, catDef);
        if (!category) continue;
        // Keep the category name pretty too — except when it was matched by its
        // explicit ID, in which case the current name is left untouched.
        if (!catDef.id && category.name !== catDef.name) {
            await category.setName(catDef.name, '🤝 member role sync').catch(() => {});
        }
        try {
            await category.permissionOverwrites.set(overwrites, '🤝 member role sync');
        } catch (e) {
            console.error(`❌ [Member Role] Failed to set category perms for ${catDef.name}: ${e.message}`);
        }
        for (const chanDef of catDef.channels) {
            const channel = findTextChannel(guild, category.id, chanDef);
            if (!channel) continue;
            // Keep names pretty too (old legacy-named channels get upgraded here)
            if (channel.name !== chanDef.name) {
                await channel.setName(chanDef.name, '🤝 member role sync').catch(() => {});
            }
            try {
                await channel.permissionOverwrites.set(overwrites, '🤝 member role sync');
            } catch (e) {
                console.error(`❌ [Member Role] Failed to set channel perms for ${catDef.name}/${chanDef.name}: ${e.message}`);
            }
        }
    }
}

/**
 * Apply permissions to the General member channels:
 * - market/main-chat ('member') → registered members (the member role)
 *   can view AND send messages;
 * - events/reminders ('member-view') → members can VIEW only, only the bot sends;
 * - tower-rules/announcements/allied-list ('elders') → members VIEW only, only the
 *   elder role (and the bot) can write.
 * @everyone is locked out of all of them; the bot can always post.
 * @param {import('discord.js').Guild} guild
 * @param {string} botId
 * @param {string[]} memberRoleIds - member role IDs allowed to view
 */
async function applyMemberChannelPermissions(guild, botId, memberRoleIds) {
    const everyone = guild.roles.everyone;
    const memberOverwrites = buildMemberOverwrites(everyone.id, botId, memberRoleIds);
    const viewOverwrites = buildMemberViewOverwrites(everyone.id, botId, memberRoleIds);
    const eldersOverwrites = buildEldersOverwrites(
        everyone.id,
        botId,
        memberRoleIds,
        guild.roles.cache.has(ELDER_ROLE_ID) ? ELDER_ROLE_ID : null
    );
    const category = findClaimCategory(guild, GENERAL_CATEGORY);
    if (!category) return;
    for (const chanDef of GENERAL_CATEGORY.channels) {
        if (chanDef.mode !== 'member' && chanDef.mode !== 'member-view' && chanDef.mode !== 'elders') continue;
        const channel = findTextChannel(guild, category.id, chanDef);
        if (!channel) continue;
        const overwrites =
            chanDef.mode === 'member-view' ? viewOverwrites :
            chanDef.mode === 'elders' ? eldersOverwrites :
            memberOverwrites;
        try {
            await channel.permissionOverwrites.set(overwrites, '🔒 member role sync');
        } catch (e) {
            console.error(`❌ [Member Role] Failed to set member perms for ${chanDef.name}: ${e.message}`);
        }
    }
}

/**
 * Restrict the claim channels AND the member channels to the fixed member
 * role. Runs at bot boot.
 *
 * Nothing is ever created: when MEMBER_ROLE_ID does not exist on the server
 * the permissions are left untouched and `reason: 'no-roles'` is returned.
 *
 * @param {import('discord.js').Client} client
 * @param {object} db
 * @param {Function} [logEvent]
 * @param {Function} [saveLocalStorage] - unused (kept for call-site compatibility)
 * @returns {Promise<{applied: boolean, clanRoles: number, tempRoleApplied: boolean, discovered: number, reason?: string}>}
 */
export async function applyClaimChannelPermissions(client, db, logEvent, saveLocalStorage) {
    ensureConfig(db);
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (!guild) {
        if (logEvent) logEvent('⚠️ [Member Role] Guild not found — permissions not applied.');
        return { applied: false, clanRoles: 0, tempRoleApplied: false, discovered: 0, reason: 'guild-not-found' };
    }

    if (!guild.roles.cache.has(MEMBER_ROLE_ID)) {
        if (logEvent) logEvent(`⚠️ [Member Role] Role ${MEMBER_ROLE_ID} not found on the server — permissions not applied (the bot never creates roles).`);
        return { applied: false, clanRoles: 0, tempRoleApplied: false, discovered: 0, reason: 'no-roles' };
    }

    const memberRoleIds = [MEMBER_ROLE_ID];

    await applyClaimPermissions(guild, client.user.id, memberRoleIds);
    await applyMemberChannelPermissions(guild, client.user.id, memberRoleIds);

    if (logEvent) logEvent('🔒 [Member Role] Claim channels restricted to the member role; market/main-chat open to members; events/reminders + elders channels members view-only.');
    return { applied: true, clanRoles: 1, tempRoleApplied: false, discovered: 0 };
}

// ==========================================
// 🛠️ SHARED HELPERS (used by registration flows)
// ==========================================

/**
 * Find the owner ID of a pilot (the registered user whose pilotIds includes memberId).
 */
function findOwnerIdForPilot(memberId, db) {
    for (const [uid, data] of Object.entries(db.users || {})) {
        if (data.pilotIds && data.pilotIds.includes(memberId)) return uid;
    }
    return null;
}

/**
 * Resolve the role a member is eligible for (pilots inherit their owner's
 * clan): the fixed member role when the in-game clan is one of the configured
 * allied clans, null otherwise.
 * @returns {string|null} MEMBER_ROLE_ID or null
 */
export function resolveMemberClanRoleId(memberId, db) {
    const ownerId = findOwnerIdForPilot(memberId, db);
    const targetId = ownerId || memberId;
    const userData = db.users?.[targetId];
    if (!userData?.nickname) return null;
    const lookup = lookupNickname(userData.nickname, db);
    if (!lookup.found || !lookup.inAlliedClan) return null;
    return MEMBER_ROLE_ID;
}

/**
 * Grant the member role to an eligible player. Returns true when it was added.
 * Never creates roles — a missing MEMBER_ROLE_ID is reported as "not granted".
 */
export async function assignClanRole(member, db, logEvent) {
    const roleId = resolveMemberClanRoleId(member.id, db);
    if (!roleId || !member.guild?.roles?.cache?.has(roleId)) return false;
    if (member.roles.cache.has(roleId)) return false;
    await member.roles.add(roleId).catch(() => {});
    if (logEvent) logEvent(`🎖️ [Member Role] Granted to ${member.user.username}`);
    return true;
}

/**
 * Grant the member role to a temp / unresolved user (manual approvals and the
 * temp registration window).
 * The bot never creates roles — when MEMBER_ROLE_ID does not exist on the
 * server, nothing happens (create it manually first).
 */
export async function assignTempRole(member, db, saveLocalStorage, logEvent) {
    if (member.guild?.roles?.cache && !member.guild.roles.cache.has(MEMBER_ROLE_ID)) return false;
    if (member.roles.cache.has(MEMBER_ROLE_ID)) return false;
    await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
    if (logEvent) logEvent(`🎖️ [Member Role] Granted to ${member.user.username}`);
    return true;
}

/**
 * True when the member holds the fixed member role.
 * @param {object} db - unused (kept for call-site compatibility)
 */
export function hasMemberRole(member, db) {
    if (!member?.roles) return false;
    return member.roles.cache.has(MEMBER_ROLE_ID);
}

/** Alias used by the sync engine for the same membership check. */
export const hasAnyMemberRoles = hasMemberRole;

/**
 * Remove the member role (the only role the bot manages).
 */
export async function removeMemberRoles(member, db) {
    if (member.roles.cache.has(MEMBER_ROLE_ID)) {
        await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
    }
}

// ==========================================
// 🔄 SYNC
// ==========================================

/**
 * Synchronize the fixed member role with the registrations and (re)apply the
 * channel permissions.
 * The bot never creates roles: MEMBER_ROLE_ID must already exist on the server.
 * @returns {Promise<string>} Human-readable report for the sync log.
 */
export async function syncClanRoles(client, db, saveLocalStorage, logEvent) {
    ensureConfig(db);
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (!guild) {
        const msg = '⚠️ [Member Role] Guild not found — nothing done.';
        logEvent(msg);
        return msg;
    }

    // ── Safety: never touch anything when the ranking cache is unavailable/empty ──
    const cache = getLocalRankingCache();
    if (!cache) {
        const msg = '⚠️ [Member Role] Ranking cache not available — skipped (run /forcesync first).';
        logEvent(msg);
        return msg;
    }
    const totalPlayers = Object.values(cache).reduce((sum, w) => sum + (w ? Object.keys(w).length : 0), 0);
    if (totalPlayers === 0) {
        const msg = '⚠️ [Member Role] Ranking cache is empty — skipped to avoid mass role removal.';
        logEvent(msg);
        return msg;
    }

    const memberRole = guild.roles.cache.get(MEMBER_ROLE_ID);
    if (!memberRole) {
        const msg = `⚠️ [Member Role] Role ${MEMBER_ROLE_ID} not found on the server — skipped (the bot never creates roles).`;
        logEvent(msg);
        return msg;
    }

    // ── 1. Who should hold the member role (owners + their pilots) ──
    const shouldHave = new Set();
    const registered = new Set();
    for (const [userId, data] of Object.entries(db.users || {})) {
        if (!data || !data.nickname) continue;
        registered.add(userId);
        for (const pid of data.pilotIds || []) registered.add(pid);

        const lookup = lookupNickname(data.nickname, db, cache);
        const eligible = !!data.manualPermanent || !!data.tempUntil || (lookup.found && lookup.inAlliedClan);
        if (!eligible) continue;
        shouldHave.add(userId);
        for (const pid of data.pilotIds || []) shouldHave.add(pid);
    }

    // ── 2. Grant / revoke the member role ──
    // Non-registered holders are left alone — the role may have been granted
    // manually by an admin and is not bot-managed territory.
    const members = await guild.members.fetch().catch(() => null);
    let rolesGranted = 0;
    let rolesRevoked = 0;
    let membersProcessed = 0;

    if (members) {
        for (const [memberId, member] of members) {
            if (member.user.bot) continue;
            membersProcessed++;
            const hasRole = member.roles.cache.has(MEMBER_ROLE_ID);
            if (shouldHave.has(memberId)) {
                if (!hasRole) {
                    await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                    rolesGranted++;
                }
            } else if (registered.has(memberId) && hasRole) {
                await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                rolesRevoked++;
            }
        }
    }

    // ── 3. Restrict the claim + member channels to the member role ──
    await applyClaimPermissions(guild, client.user.id, [MEMBER_ROLE_ID]);
    await applyMemberChannelPermissions(guild, client.user.id, [MEMBER_ROLE_ID]);

    saveLocalStorage();

    const report =
        `🎖️ **Member Role Synced!**\n\n` +
        `👥 Member role: **@${memberRole.name}** (fixed — the bot never creates roles)\n` +
        `✅ Granted: **${rolesGranted}**\n` +
        `❌ Revoked: **${rolesRevoked}**\n` +
        `📋 Eligible registrations: **${shouldHave.size}** / **${registered.size}**\n` +
        `👥 Members processed: **${membersProcessed}**\n` +
        `🔒 Claim channels (7F–12F, Summons) + market/main-chat restricted to the member role.`;

    logEvent(`🎖️ [Member Role] Synced: ${rolesGranted} granted, ${rolesRevoked} revoked, ${registered.size} registrations checked (ranking cache: ${totalPlayers} players)`);
    return report;
}
