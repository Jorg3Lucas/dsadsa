// ==========================================
// 🤝 CLAN ROLE SYNCHRONIZATION
// ==========================================
// Creates one Discord role per allied clan (with a distinct color and an emoji
// prefix for visibility), assigns it to registered members based on their
// in-game clan (resolved via the ranking cache), removes orphan roles for
// clans no longer allied, and restricts the claim channels (7F-12F, Summons)
// to members holding a clan role (or the temporary "GoW Kids" role).
//
// The fixed member role (MEMBER_ROLE_ID) was removed from the server — clan
// roles are now the member marker. Temporary registrations (not yet in an
// allied clan) receive the "GoW Kids" temp role instead.
//
// Run manually via /syncroles (super admin) and automatically at the end of
// the daily synchronization (ranking-sync-engine).

import { ChannelType } from 'discord.js';
import { DISCORD_SERVER_ID, ensureConfig } from './ranking-constants.js';
import { CLAIM_CATEGORIES, buildClaimOverwrites, findTextChannel } from './server-structure.js';
import { getLocalRankingCache, cleanNickname } from './ranking-cache.js';
import { lookupNickname } from './ranking-service.js';

// ⏳ Temporary registration role (users not yet in an allied clan)
export const TEMP_ROLE_NAME = 'GoW Kids';
const TEMP_ROLE_COLOR = 0x95A5A6; // gray

// Palette of distinct colors — one per clan, assigned deterministically
const CLAN_COLORS = [
    0xE74C3C, 0xE67E22, 0xF1C40F, 0x2ECC71, 0x1ABC9C, 0x3498DB,
    0x9B59B6, 0xE84393, 0xFD79A8, 0x00CEC9, 0xFDCB6E, 0x6C5CE7,
    0x0984E3, 0x00B894, 0xD63031, 0xE17055, 0x74B9FF, 0xA29BFE,
    0x55EFC4, 0xFFEAA7
];

// Emojis used as the role-name prefix (visibility in the member list)
const CLAN_EMOJIS = ['⚔️', '🛡️', '🔥', '⚡', '❄️', '🌊', '🌪️', '☠️', '💀', '👑', '🐉', '🦅', '🐺', '🦁', '🐍', '🦂', '🏹', '⚒️', '🎯', '⭐', '🌙', '🔱'];

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h;
}

/**
 * Deterministically assign { emoji, color } to each clan so every clan gets a
 * distinct color (and emoji) while keeping the same style across re-syncs.
 * @param {{name: string, clean: string}[]} clanNames
 */
function assignClanStyles(clanNames) {
    const sorted = [...clanNames].sort((a, b) => a.clean.localeCompare(b.clean));
    const usedColors = new Set();
    const usedEmojis = new Set();
    const styles = {};
    for (const { name, clean } of sorted) {
        const h = hashString(clean);
        let ci = h % CLAN_COLORS.length;
        while (usedColors.has(CLAN_COLORS[ci]) && usedColors.size < CLAN_COLORS.length) {
            ci = (ci + 1) % CLAN_COLORS.length;
        }
        const color = CLAN_COLORS[ci];
        usedColors.add(color);

        let ei = h % CLAN_EMOJIS.length;
        while (usedEmojis.has(CLAN_EMOJIS[ei]) && usedEmojis.size < CLAN_EMOJIS.length) {
            ei = (ei + 1) % CLAN_EMOJIS.length;
        }
        const emoji = CLAN_EMOJIS[ei];
        usedEmojis.add(emoji);

        styles[clean] = { emoji, color, name };
    }
    return styles;
}

/** Strip a leading emoji prefix (and whitespace) from a role name. */
function stripRoleEmoji(roleName) {
    return roleName.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u200D]+[ \u00A0]*/u, '').trim();
}

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
 * @everyone cannot view (or send), the bot and every clan role (+ the temp
 * role) can view, only the bot can send (panels).
 * @param {import('discord.js').Guild} guild
 * @param {string} botId
 * @param {string[]} clanRoleIds - IDs of the clan roles to grant view access
 * @param {string|null} tempRoleId - ID of the GoW Kids temp role (nullable)
 */
async function applyClaimPermissions(guild, botId, clanRoleIds, tempRoleId) {
    const everyone = guild.roles.everyone;
    const overwrites = buildClaimOverwrites(everyone.id, botId, [...clanRoleIds, ...(tempRoleId ? [tempRoleId] : [])]);

    for (const catDef of CLAIM_CATEGORIES) {
        const category = findCategory(guild, catDef);
        if (!category) continue;
        // Keep the category name pretty too (old legacy-named categories get upgraded here)
        if (category.name !== catDef.name) {
            await category.setName(catDef.name, '🤝 /syncroles renamed category').catch(() => {});
        }
        try {
            await category.permissionOverwrites.set(overwrites, '🤝 /syncroles clan access');
        } catch (e) {
            console.error(`❌ [Clan Roles] Failed to set category perms for ${catDef.name}: ${e.message}`);
        }
        for (const chanDef of catDef.channels) {
            const channel = findTextChannel(guild, category.id, chanDef);
            if (!channel) continue;
            // Keep names pretty too (old legacy-named channels get upgraded here)
            if (channel.name !== chanDef.name) {
                await channel.setName(chanDef.name, '🤝 /syncroles renamed channel').catch(() => {});
            }
            try {
                await channel.permissionOverwrites.set(overwrites, '🤝 /syncroles clan access');
            } catch (e) {
                console.error(`❌ [Clan Roles] Failed to set channel perms for ${catDef.name}/${chanDef.name}: ${e.message}`);
            }
        }
    }
}

// ==========================================
// 🔐 CLAIM CHANNEL ACCESS (reads roles from the DB)
// ==========================================

/**
 * Apply claim-channel permissions using the clan roles stored in the database.
 * Reads db.config.clanRoles + db.config.tempRoleId AND auto-discovers clan
 * roles on the server by matching role names against the allied clans saved in
 * db.config.alliedClans (so permissions work even when db.config.clanRoles is
 * empty — e.g. roles were created manually or the DB was reset). Discovered
 * IDs are persisted back into db.config so later runs are instant.
 * Runs at bot boot and after /setup so the claim channels are always
 * restricted to clan-role holders (+ GoW Kids), without requiring a full
 * /syncroles pass.
 * @param {import('discord.js').Client} client
 * @param {object} db
 * @param {Function} [logEvent]
 * @param {Function} [saveLocalStorage]
 * @returns {Promise<{applied: boolean, clanRoles: number, tempRoleApplied: boolean, discovered: number, reason?: string}>}
 */
export async function applyClaimChannelPermissions(client, db, logEvent, saveLocalStorage) {
    ensureConfig(db);
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (!guild) {
        if (logEvent) logEvent('⚠️ [Clan Perms] Guild not found — claim permissions not applied.');
        return { applied: false, clanRoles: 0, tempRoleApplied: false, discovered: 0, reason: 'guild-not-found' };
    }

    // ── 1. Roles already mapped in the DB (skip IDs that no longer exist) ──
    const clanRoleIds = new Set(
        Object.values(db.config?.clanRoles || {}).filter(id => id && guild.roles.cache.has(id))
    );

    // ── 2. Auto-discover clan roles by name from the allied-clan config ──
    //    e.g. role "⚔️ ClanA" → clean "ClanA" matches db.config.alliedClans.
    if (!db.config.clanRoles) db.config.clanRoles = {};
    let discovered = 0;
    for (const [worldId, clans] of Object.entries(db.config?.alliedClans || {})) {
        for (const clanName of clans) {
            const clean = cleanNickname(clanName);
            // Already mapped? Keep the mapped ID if it still exists.
            if (db.config.clanRoles[clanName] && guild.roles.cache.has(db.config.clanRoles[clanName])) {
                clanRoleIds.add(db.config.clanRoles[clanName]);
                continue;
            }
            // Otherwise find the role on the server by cleaned name (emoji prefix tolerated)
            const role = guild.roles.cache.find(r => cleanNickname(stripRoleEmoji(r.name)) === clean);
            if (role) {
                db.config.clanRoles[clanName] = role.id;
                clanRoleIds.add(role.id);
                discovered++;
                if (logEvent) logEvent(`🔒 [Clan Perms] Discovered clan role "${role.name}" (${clanName}).`);
            }
        }
    }

    // ── 3. Temp role: from the DB, or discovered by name ("GoW Kids") ──
    let tempRoleId = db.config?.tempRoleId && guild.roles.cache.has(db.config.tempRoleId)
        ? db.config.tempRoleId
        : null;
    let tempDiscovered = false;
    if (!tempRoleId) {
        const tempRole = guild.roles.cache.find(r => r.name === TEMP_ROLE_NAME);
        if (tempRole) {
            tempRoleId = tempRole.id;
            db.config.tempRoleId = tempRoleId;
            tempDiscovered = true;
            if (logEvent) logEvent(`🔒 [Clan Perms] Discovered temp role "${TEMP_ROLE_NAME}".`);
        }
    }

    // Persist any discovered mappings so future runs are instant.
    if (saveLocalStorage && (discovered > 0 || tempDiscovered)) {
        saveLocalStorage();
    }

    if (clanRoleIds.size === 0 && !tempRoleId) {
        if (logEvent) logEvent('⚠️ [Clan Perms] No clan/temp roles found in the DB or on the server — run /syncroles first.');
        return { applied: false, clanRoles: 0, tempRoleApplied: false, discovered: 0, reason: 'no-roles' };
    }

    await applyClaimPermissions(guild, client.user.id, [...clanRoleIds], tempRoleId);

    if (logEvent) logEvent(`🔒 [Clan Perms] Claim channels restricted to ${clanRoleIds.size} clan role(s)${tempRoleId ? ' + GoW Kids' : ''} (from DB/server).`);
    return { applied: true, clanRoles: clanRoleIds.size, tempRoleApplied: !!tempRoleId, discovered };
}

// ==========================================
// 🛠️ SHARED HELPERS (used by registration flows)
// ==========================================

/** Build a map: cleanNickname(clan config name) → role ID. */
function buildClanRoleCleanMap(db) {
    const map = {};
    for (const [name, roleId] of Object.entries(db.config?.clanRoles || {})) {
        map[cleanNickname(name)] = roleId;
    }
    return map;
}

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
 * Resolve the clan role ID for a member (pilots inherit their owner's clan).
 * @returns {string|null}
 */
export function resolveMemberClanRoleId(memberId, db) {
    const ownerId = findOwnerIdForPilot(memberId, db);
    const targetId = ownerId || memberId;
    const userData = db.users?.[targetId];
    if (!userData?.nickname) return null;
    const lookup = lookupNickname(userData.nickname, db);
    if (!lookup.found || !lookup.inAlliedClan) return null;
    return buildClanRoleCleanMap(db)[cleanNickname(lookup.clanName)] || null;
}

/**
 * Assign the member's clan role if resolvable. Returns true when assigned.
 */
export async function assignClanRole(member, db, logEvent) {
    const roleId = resolveMemberClanRoleId(member.id, db);
    if (roleId && !member.roles.cache.has(roleId)) {
        await member.roles.add(roleId).catch(() => {});
        if (logEvent) logEvent(`🤝 [Clan Roles] Assigned clan role to ${member.user.username}`);
        return true;
    }
    return false;
}

/**
 * Ensure the "GoW Kids" temp role exists in the guild (creates it if missing)
 * and returns it.
 */
export async function ensureTempRole(guild, db, saveLocalStorage) {
    if (db.config?.tempRoleId) {
        const existing = guild.roles.cache.get(db.config.tempRoleId);
        if (existing) return existing;
    }
    let role = guild.roles.cache.find(r => r.name === TEMP_ROLE_NAME);
    if (!role) {
        role = await guild.roles.create({ name: TEMP_ROLE_NAME, color: TEMP_ROLE_COLOR, reason: '⏳ Temporary role (managed by bot)' }).catch(() => null);
    }
    if (role) {
        if (!db.config) db.config = {};
        db.config.tempRoleId = role.id;
        if (saveLocalStorage) saveLocalStorage();
    }
    return role;
}

/**
 * Assign the "GoW Kids" temp role to a member (creates the role if needed).
 */
export async function assignTempRole(member, db, saveLocalStorage, logEvent) {
    const role = await ensureTempRole(member.guild, db, saveLocalStorage);
    if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role.id).catch(() => {});
        if (logEvent) logEvent(`⏳ [Temp Role] Assigned ${TEMP_ROLE_NAME} to ${member.user.username}`);
        return true;
    }
    return false;
}

/**
 * True when the member holds any clan role or the GoW Kids temp role
 * (i.e. is considered a "member" — replaces the old MEMBER_ROLE_ID check).
 */
export function hasMemberRole(member, db) {
    if (!member?.roles) return false;
    const ids = new Set();
    for (const roleId of Object.values(db.config?.clanRoles || {})) ids.add(roleId);
    if (db.config?.tempRoleId) ids.add(db.config.tempRoleId);
    return member.roles.cache.some(r => ids.has(r.id));
}

/** Alias used by the sync engine for the same membership check. */
export const hasAnyMemberRoles = hasMemberRole;

/**
 * Remove all clan roles and the temp role from a member.
 */
export async function removeMemberRoles(member, db) {
    const ids = new Set();
    for (const roleId of Object.values(db.config?.clanRoles || {})) ids.add(roleId);
    if (db.config?.tempRoleId) ids.add(db.config.tempRoleId);
    for (const id of ids) {
        if (member.roles.cache.has(id)) await member.roles.remove(id).catch(() => {});
    }
}

// ==========================================
// 🔄 SYNC
// ==========================================

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

    // Ensure the GoW Kids temp role exists (needed for temp registrations + claim access)
    const tempRole = await ensureTempRole(guild, db, saveLocalStorage);
    const tempRoleId = tempRole ? tempRole.id : null;

    // ── 1. Collect allied clans across all worlds ──
    const alliedClans = []; // { worldId, name }
    for (const [worldId, clans] of Object.entries(db.config?.alliedClans || {})) {
        for (const clanName of clans) alliedClans.push({ worldId, name: clanName });
    }
    const alliedClanKeys = new Set(alliedClans.map(c => cleanNickname(c.name)));
    const styles = assignClanStyles(alliedClans.map(c => ({ name: c.name, clean: cleanNickname(c.name) })));

    // ── 2. Ensure a role exists for every allied clan (with color + emoji prefix) ──
    if (!db.config.clanRoles) db.config.clanRoles = {};
    const clanRoleIds = [];
    let rolesCreated = 0;
    let rolesUpdated = 0;
    let rolesFailed = 0;

    for (const { name } of alliedClans) {
        const clean = cleanNickname(name);
        const style = styles[clean] || { emoji: '⚔️', color: CLAN_COLORS[0] };
        const desiredName = `${style.emoji} ${name}`;

        let role = db.config.clanRoles[name] ? guild.roles.cache.get(db.config.clanRoles[name]) : null;
        // Match an existing role by cleaned name too (handles casing/symbol diffs + emoji prefix)
        if (!role) {
            role = guild.roles.cache.find(r => cleanNickname(stripRoleEmoji(r.name)) === clean);
        }
        if (!role) {
            try {
                role = await guild.roles.create({ name: desiredName, color: style.color, reason: '🤝 Clan role (managed by /syncroles)' });
                rolesCreated++;
                logEvent(`🤝 [Clan Roles] Created role "${desiredName}" (color ${style.color.toString(16)})`);
            } catch (e) {
                rolesFailed++;
                logEvent(`❌ [Clan Roles] Failed to create role "${name}": ${e.message}`);
                continue;
            }
        } else {
            // Keep the role in sync: add emoji prefix and ensure the color is right
            if (role.name !== desiredName) {
                await role.setName(desiredName).catch(() => {});
                rolesUpdated++;
            }
            if (role.color !== style.color) {
                await role.setColor(style.color).catch(() => {});
                rolesUpdated++;
            }
        }
        db.config.clanRoles[name] = role.id;
        clanRoleIds.push(role.id);
    }

    // Index roles by CLEANED clan name so lookups match regardless of how the
    // admin typed the clan in config vs. the canonical name stored in the cache
    // (e.g. "GearsofWar" in config vs "GearsofWar シ" in the ranking cache).
    const clanRoleByClean = buildClanRoleCleanMap(db);

    // ── 3. Resolve each registered user's clan (pilots inherit their owner's clan) ──
    const userIdClan = {}; // userId → clanName
    const tempUserIds = new Set(); // registered users still in their temp window
    for (const [userId, data] of Object.entries(db.users || {})) {
        if (!data || !data.nickname) continue;
        if (data.tempUntil) tempUserIds.add(userId);
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
    let tempsAssigned = 0;
    let tempsUpgraded = 0;
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
            // Upgraded to a clan role → drop the GoW Kids temp role
            if (targetRoleId && tempRoleId && member.roles.cache.has(tempRoleId)) {
                await member.roles.remove(tempRoleId).catch(() => {});
                tempsUpgraded++;
            }
            // Temp users (still in their temp window, no clan role yet) → GoW Kids
            if (!targetRoleId && tempUserIds.has(memberId) && tempRoleId && !member.roles.cache.has(tempRoleId)) {
                await member.roles.add(tempRoleId).catch(() => {});
                tempsAssigned++;
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
    await applyClaimPermissions(guild, client.user.id, clanRoleIds, tempRoleId);

    saveLocalStorage();

    const report =
        `🤝 **Clan Roles Synced!**\n\n` +
        `🏰 Allied clans: **${alliedClans.length}**\n` +
        `🆕 Roles created: **${rolesCreated}** (with colors + emoji prefix)\n` +
        `🔧 Roles updated: **${rolesUpdated}**\n` +
        `✅ Roles assigned: **${rolesAssigned}**\n` +
        `❌ Roles removed: **${rolesRemoved}**\n` +
        `🗑️ Orphans deleted: **${orphansDeleted}**\n` +
        `⏳ GoW Kids assigned: **${tempsAssigned}** | upgraded to clan: **${tempsUpgraded}**\n` +
        `👥 Members processed: **${membersProcessed}**\n` +
        `🔒 Claim channels now restricted to clan roles (temp: ${TEMP_ROLE_NAME}).`;

    if (rolesFailed > 0) {
        report += `\n⚠️ **${rolesFailed}** role creation(s) failed (role limit reached?).`;
        logEvent(`⚠️ [Clan Roles] ${rolesFailed} role creation(s) failed (role limit reached?)`);
    }
    logEvent(`🤝 [Clan Roles] Synced: ${alliedClans.length} clans, ${rolesAssigned} assigned, ${rolesRemoved} removed, ${orphansDeleted} orphans deleted`);
    return report;
}
