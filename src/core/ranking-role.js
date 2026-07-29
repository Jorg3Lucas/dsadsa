// ==========================================
// 🏷️ ROLE ASSIGNMENT UTILITIES
// Looks up a player's clan/world from the
// ranking cache and assigns the appropriate
// Discord role.
// ==========================================

import { MEMBER_ROLE_ID } from './ranking-constants.js';
import { lookupNickname } from './ranking-service.js';
import { getLocalRankingCache } from './ranking-cache.js';
import { rankingDb } from './state.js';
import { noop } from './config.js';

/**
 * Look up a nickname in the ranking cache and return the server name + world config role ID.
 * Falls back to MEMBER_ROLE_ID if no world-specific role is configured.
 */
function getRoleForNickname(nickname) {
    const cache = getLocalRankingCache();
    if (!cache) return null;

    const lookup = lookupNickname(nickname, rankingDb || {}, cache);
    if (!lookup || !lookup.found) return null;

    const serverName = lookup.serverName; // e.g. "EU011"

    // Try world-specific member role from /setup config
    const worldConfig = rankingDb?.config?.worldSetup?.[serverName];
    const roleId = worldConfig?.roleMemberId || MEMBER_ROLE_ID;

    return { serverName, roleId, lookup };
}

/**
 * Apply the appropriate clan/world role to a member based on their in-game nickname.
 *
 * 1. Looks up the nickname in the ranking cache.
 * 2. Finds which world/server the player belongs to.
 * 3. Assigns the world-specific member role (or falls back to MEMBER_ROLE_ID).
 *
 * @param {import('discord.js').Interaction} interaction - The interaction context (used for guild.roles).
 * @param {import('discord.js').GuildMember} member    - The guild member to assign the role to.
 * @param {string} nickname                            - The in-game character name to look up.
 * @param {string} [userId]                            - The Discord user ID (unused, kept for signature compatibility).
 */
export async function applyImmediateRoleWithCache(interaction, member, nickname, userId) {
    const result = getRoleForNickname(nickname);
    if (!result) {
        // No ranking cache or nickname not found — assign general member role
        if (!member.roles.cache.has(MEMBER_ROLE_ID)) {
            await member.roles.add(MEMBER_ROLE_ID).catch(noop);
        }
        return;
    }

    const { roleId } = result;

    // Assign the resolved role (world-specific or MEMBER_ROLE_ID)
    const guild = interaction.guild || member.guild;
    const role = guild?.roles.cache.get(roleId);
    if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(noop);
    }

    // Also ensure the general member role if a world-specific role was used
    if (roleId !== MEMBER_ROLE_ID && !member.roles.cache.has(MEMBER_ROLE_ID)) {
        await member.roles.add(MEMBER_ROLE_ID).catch(noop);
    }
}

/**
 * Apply the clan role only, without requiring an interaction object.
 * Same logic as applyImmediateRoleWithCache but uses `member.guild` directly.
 *
 * @param {import('discord.js').GuildMember} member - The guild member to assign the role to.
 * @param {string} nickname                         - The in-game character name to look up.
 */
export async function applyClanRoleOnly(member, nickname) {
    const result = getRoleForNickname(nickname);
    if (!result) return;

    const { roleId } = result;
    const role = member.guild?.roles.cache.get(roleId);
    if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(noop);
    }

    if (roleId !== MEMBER_ROLE_ID && !member.roles.cache.has(MEMBER_ROLE_ID)) {
        await member.roles.add(MEMBER_ROLE_ID).catch(noop);
    }
}
