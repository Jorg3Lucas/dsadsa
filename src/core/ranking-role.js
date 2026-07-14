// ==========================================
// 🏷️ RANKING — Role Management Utilities
// Extracted from ranking-handlers.js
// ==========================================

import { CLAN_ROLES } from './ranking-constants.js';
import { fetchMir4RankingData } from './ranking-scraper.js';
import { noop } from "./config.js";

/** Apply clan role to a member, trying owner cache first, then ranking API. @param {import('discord.js').Interaction} interaction @param {import('discord.js').GuildMember} targetMember @param {string} ownerNick @param {string|null} ownerId */
export async function applyImmediateRoleWithCache(interaction, targetMember, ownerNick, ownerId) {
    if (ownerId) {
        try {
            const ownerMember = await interaction.guild.members.fetch(ownerId).catch(() => null);
            if (ownerMember) {
                for (const [, roleId] of Object.entries(CLAN_ROLES)) {
                    if (ownerMember.roles.cache.has(roleId)) {
                        for (const [, rId] of Object.entries(CLAN_ROLES)) {
                            if (rId === roleId) {
                                if (!targetMember.roles.cache.has(rId)) {await targetMember.roles.add(rId).catch(noop);}
                            } else {
                                if (targetMember.roles.cache.has(rId)) {await targetMember.roles.remove(rId).catch(noop);}
                            }
                        }
                        return;
                    }
                }
            }
        } catch (e) {
            // Silently ignored — non-critical operation
        }
    }

    const currentRanking = await fetchMir4RankingData(false);
    const normalizedOwner = ownerNick.trim().normalize('NFC').toLowerCase();
    const exactMatch = Object.keys(currentRanking).find(k => k.normalize('NFC').toLowerCase() === normalizedOwner);
    const clanName = exactMatch ? currentRanking[exactMatch] : "No Clan";
    const idealRoleId = CLAN_ROLES[clanName];

    for (const roleId of Object.values(CLAN_ROLES)) {
        if (roleId === idealRoleId) {
            if (!targetMember.roles.cache.has(roleId)) {await targetMember.roles.add(roleId).catch(noop);}
        } else {
            if (targetMember.roles.cache.has(roleId)) {await targetMember.roles.remove(roleId).catch(noop);}
        }
    }
}

/** Apply only the clan role matching the given clan name, removing all others. @param {import('discord.js').Interaction} interaction @param {import('discord.js').GuildMember} targetMember @param {string} clanName */
export async function applyClanRoleOnly(interaction, targetMember, clanName) {
    const idealRoleId = CLAN_ROLES[clanName];
    for (const rId of Object.values(CLAN_ROLES)) {
        if (rId === idealRoleId) {await targetMember.roles.add(rId).catch(noop);}
        else {await targetMember.roles.remove(rId).catch(noop);}
    }
}
