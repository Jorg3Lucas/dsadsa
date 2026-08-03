// ==========================================
// 🤝 CLAN ROLE SYNCHRONIZATION
// ==========================================
// Creates one Discord role per allied clan, assigns it to registered members
// based on their in-game clan (resolved via the ranking cache), removes orphan
// roles for clans no longer allied, and restricts the claim channels
// (7F-12F, Summons) to members holding a clan/member role.
//
// Run manually via /syncroles (super admin) and automatically at the end of
// the daily synchronization (ranking-sync-engine).

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { DISCORD_SERVER_ID, MEMBER_ROLE_ID, ensureConfig } from './ranking-constants.js';
import { CLAIM_CATEGORIES } from './server-structure.js';
import { getLocalRankingCache, cleanNickname } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';

/**
 * Find a claim category by name (fallback to legacy ID).
 * @param {import('discord.js').Guild} guild
 * @param {{ name: string, legacyId?: string }} catDef
 */
function findCategory(guild, catDef) {
    const byName = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === catDef.name);
    if (byName) return byName;
    if (catDef.legacyId) return guild.channels.cache.get(catDef.legacyId);
    return null;
}

/**
 * Apply restrictive permissions to a claim category and its channels:
 * @everyone cannot view (or send), the bot and every clan role (+ member role)
 * can view, only the bot can send (panels).
 * @param {import('discord.js').Guild} guild
 * @param {string} botId
 * @param {string[]} clanRoleIds - IDs of the clan roles to grant view access
 */
async function applyClaimPermissions(guild, botId, clanRoleIds) {
    const everyone = guild.roles.everyone;
    const allowViewIds = [...new Set([botId, MEMBER_ROLE_ID, ...clanRoleIds])];
    const overwrites = [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...allowViewIds
            .filter(id => id !== botId)
            .map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel] }))
    ];

    for (const catDef of CLAIM_CATEGORIES) {
        const category = findCategory(guild, catDef);
        if (!category) continue;
        try {
            await category.permissionOverwrites.set(overwrites, '🤝 /syncroles clan access');
        } catch (e) {
            console.error(`❌ [Clan Roles] Failed to set category perms for ${catDef.name}: ${e.message}`);
        }
        for (const chanDef of catDef.channels) {
            const channel = guild.channels.cache.find(c => c.parentId === category.id && c.name === chanDef.name && c.type === ChannelType.GuildText);
            if (!channel) continue;
            try {
                await channel.permissionOverwrites.set(overwrites, '🤝 /syncroles clan access');
            } catch (e) {
                console.error(`❌ [Clan Roles] Failed to set channel perms for ${catDef.name}/${chanDef.name}: ${e.message}`);
            }
        }
    }
}

/**
 * Synchronize clan roles with the current allied clan config.
 * @returns {Promise<string>} Human-readable report for the /syncroles command.
 */
export async function syncClanRoles(client, db, saveLocalStorage, logEvent) {
    ensureConfig(db);
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (!guild) {
        const msg = '⚠️ [Clan Roles] Guild not found — nothing done.';
        logEvent(msg);
        return msg;
    }

    // ── Safety: never touch anything when the ranking cache is unavailable/empty ──
    const cache = getLocalRankingCache();
    if (!cache) {
        const msg = '⚠️ [Clan Roles] Ranking cache not available — skipped (run /forcesync first).';
        logEvent(msg);
        return msg;
    }
    const totalPlayers = Object.values(cache).reduce((sum, w) => sum + (w ? Object.keys(w).length : 0), 0);
    if (totalPlayers === 0) {
        const msg = '⚠️ [Clan Roles] Ranking cache is empty — skipped to avoid mass role removal.';
        logEvent(msg);
        return msg;
    }

    // ── 1. Collect allied clans across all worlds ──
    const alliedClans = []; // { worldId, name }
    for (const [worldId, clans] of Object.entries(db.config?.alliedClans || {})) {
        for (const clanName of clans) alliedClans.push({ worldId, name: clanName });
    }
    const alliedClanKeys = new Set(alliedClans.map(c => cleanNickname(c.name)));

    // ── 2. Ensure a role exists for every allied clan ──
    if (!db.config.clanRoles) db.config.clanRoles = {};
    const clanRoleIds = [];
    let rolesCreated = 0;
    let rolesFailed = 0;

    for (const { name } of alliedClans) {
        let role = db.config.clanRoles[name] ? guild.roles.cache.get(db.config.clanRoles[name]) : null;
        // Match an existing role by cleaned name too (handles casing/symbol diffs)
        if (!role) {
            role = guild.roles.cache.find(r => cleanNickname(r.name) === cleanNickname(name));
        }
        if (!role) {
            try {
                role = await guild.roles.create({ name, reason: '🤝 Clan role (managed by /syncroles)' });
                rolesCreated++;
                logEvent(`🤝 [Clan Roles] Created role "${name}"`);
            } catch (e) {
                rolesFailed++;
                logEvent(`❌ [Clan Roles] Failed to create role "${name}": ${e.message}`);
                continue;
            }
        }
        db.config.clanRoles[name] = role.id;
        clanRoleIds.push(role.id);
    }

    // Index roles by CLEANED clan name so lookups match regardless of how the
    // admin typed the clan in config vs. the canonical name stored in the cache
    // (e.g. "GearsofWar" in config vs "GearsofWar シ" in the ranking cache).
    const clanRoleByClean = {};
    for (const [name, roleId] of Object.entries(db.config.clanRoles)) {
        clanRoleByClean[cleanNickname(name)] = roleId;
    }

    // ── 3. Resolve each registered user's clan (pilots inherit their owner's clan) ──
    const userIdClan = {}; // userId → clanName
    for (const [userId, data] of Object.entries(db.users || {})) {
        if (!data || !data.nickname) continue;
        const lookup = lookupNickname(data.nickname, db, cache);
        if (!lookup.found || !lookup.inAlliedClan) continue;
        userIdClan[userId] = lookup.clanName;
        if (data.pilotIds) {
            for (const pid of data.pilotIds) userIdClan[pid] = lookup.clanName;
        }
    }

    // ── 4. Assign/remove roles on members ──
    const members = await guild.members.fetch().catch(() => null);
    const clanRoleIdSet = new Set(Object.values(db.config.clanRoles));
    let rolesAssigned = 0;
    let rolesRemoved = 0;
    let membersProcessed = 0;

    if (members) {
        for (const [memberId, member] of members) {
            if (member.user.bot) continue;
            membersProcessed++;
            const targetClan = userIdClan[memberId];
            const targetRoleId = targetClan ? clanRoleByClean[cleanNickname(targetClan)] : null;

            // Remove any clan role that isn't the member's current one
            for (const roleId of clanRoleIdSet) {
                if (member.roles.cache.has(roleId) && roleId !== targetRoleId) {
                    await member.roles.remove(roleId).catch(() => {});
                    rolesRemoved++;
                }
            }
            // Add the correct clan role
            if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
                await member.roles.add(targetRoleId).catch(() => {});
                rolesAssigned++;
            }
        }
    }

    // ── 5. Remove orphan roles (clans no longer allied) ──
    let orphansDeleted = 0;
    for (const [name, roleId] of Object.entries(db.config.clanRoles)) {
        if (alliedClanKeys.has(cleanNickname(name))) continue;
        const role = guild.roles.cache.get(roleId);
        if (role) {
            await role.delete('🗑️ Clan no longer allied (/syncroles)').catch(() => {});
            orphansDeleted++;
            logEvent(`🗑️ [Clan Roles] Deleted orphan role "${name}"`);
        }
        delete db.config.clanRoles[name];
    }

    // ── 6. Restrict claim channels to role holders ──
    await applyClaimPermissions(guild, client.user.id, clanRoleIds);

    saveLocalStorage();

    const report =
        `🤝 **Clan Roles Synced!**\n\n` +
        `🏰 Allied clans: **${alliedClans.length}**\n` +
        `🆕 Roles created: **${rolesCreated}**\n` +
        `✅ Roles assigned: **${rolesAssigned}**\n` +
        `❌ Roles removed: **${rolesRemoved}**\n` +
        `🗑️ Orphans deleted: **${orphansDeleted}**\n` +
        `👥 Members processed: **${membersProcessed}**\n` +
        `🔒 Claim channels now restricted to clan/member roles.`;

    if (rolesFailed > 0) {
        report += `\n⚠️ **${rolesFailed}** role creation(s) failed (role limit reached?).`;
        logEvent(`⚠️ [Clan Roles] ${rolesFailed} role creation(s) failed (role limit reached?)`);
    }
    logEvent(`🤝 [Clan Roles] Synced: ${alliedClans.length} clans, ${rolesAssigned} assigned, ${rolesRemoved} removed, ${orphansDeleted} orphans deleted`);
    return report;
}
