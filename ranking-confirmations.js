// ==========================================
// ✅ CONFIRMATION BUTTON HANDLERS
// For /manual* commands (manualregister, manualpilot, etc.)
// ==========================================
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from './lang.js';
import {
    confirmationCache,
    MEMBER_ROLE_ID,
} from './ranking-constants.js';
import { assignMemberRole } from './ranking-utils.js';

// ==========================================
// 🖱️ HANDLER
// ==========================================

export async function handleConfirmationButtons(interaction, db, saveLocalStorage, logEvent) {
    
    // CONFIRMATION BUTTON HANDLER for /manual* commands
        if (interaction.isButton() && interaction.customId.startsWith('confirm-')) {
            const [_, action, result] = interaction.customId.split('-');
            const cacheKey = `${interaction.user.id}-${action}`;
            const cached = confirmationCache[cacheKey];
            
            if (!cached) {
                return interaction.update({
                    content: '⌛ This confirmation has expired. Please run the command again.',
                    components: []
                }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
            }
    
            if (result === 'no') {
                delete confirmationCache[cacheKey];
                return interaction.update({
                    content: '❌ Action cancelled.',
                    components: []
                }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
            }
    
            delete confirmationCache[cacheKey];
    
            if (action === 'manualremove') {
                const guild = interaction.guild;
                const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
                if (!targetMember || !db.users[cached.targetId]) {
                    return interaction.update({ content: '❌ Target user no longer available.', components: [] }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                }
    
                const userData = db.users[cached.targetId];
                if (userData.pilotIds && userData.pilotIds.length > 0) {
                    for (const pId of userData.pilotIds) {
                        const pilotMember = await guild.members.fetch(pId).catch(() => null);
                        if (pilotMember) {
                            if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                                await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                            }
                            await pilotMember.setNickname(pilotMember.user.username).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                        }
                    }
                }
                if (targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await targetMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                }
                await targetMember.setNickname(targetMember.user.username).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                delete db.users[cached.targetId];
                saveLocalStorage();
    
                logEvent(`Admin ${interaction.user.tag} manually removed user ${cached.targetId}`);
                return interaction.update({
                    content: getMsg('ranking.responses.manualremove.success', { username: cached.targetName }),
                    components: []
                }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
            }
    
            if (action === 'manualremovepilot') {
                const guild = interaction.guild;
                const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
                const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);
    
                if (!ownerMember || !db.users[cached.ownerId]) {
                    return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                }
    
                if (!db.users[cached.ownerId].pilotIds || !db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
                    return interaction.update({ content: '❌ This pilot is no longer linked.', components: [] }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                }
    
                db.users[cached.ownerId].pilotIds = db.users[cached.ownerId].pilotIds.filter(id => id !== cached.pilotId);
                saveLocalStorage();
    
                if (pilotMember) {
                    if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                        await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                    }
                    await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
                }
    
                logEvent(`Admin ${interaction.user.tag} removed pilot ${cached.pilotName} from ${cached.ownerName}`);
                return interaction.update({
                    content: getMsg('ranking.responses.manualremovepilot.success', { ownerDisplay: cached.ownerName, pilotDisplay: cached.pilotName }),
                    components: []
                }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
            }
    
            if (action === 'manualpilot') {
                const guild = interaction.guild;
                const ownerMember = await guild.members.fetch(cached.ownerId).catch(() => null);
                const pilotMember = await guild.members.fetch(cached.pilotId).catch(() => null);
    
                if (!ownerMember || !db.users[cached.ownerId]) {
                    return interaction.update({ content: '❌ Owner no longer available.', components: [] }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                }
    
                if (!db.users[cached.ownerId].pilotIds) db.users[cached.ownerId].pilotIds = [];
                if (!db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
                    db.users[cached.ownerId].pilotIds.push(cached.pilotId);
                }
                saveLocalStorage();
    
                if (pilotMember) {
                    await pilotMember.setNickname(`${cached.ownerNick} - Pilot`).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                }
    
                if (pilotMember) {
                assignMemberRole(pilotMember, logEvent).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
                }
    
                logEvent(`Admin ${interaction.user.tag} manually linked pilot ${cached.pilotName} to ${cached.ownerName}`);
                return interaction.update({
                    content: getMsg('ranking.responses.manualpilot.success', { pilotMember: cached.pilotName, nick: cached.ownerNick }),
                    components: []
                }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
            }
    
            if (action === 'manualregister') {
                const guild = interaction.guild;
                const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
    
                if (!targetMember) {
                    return interaction.update({ content: '❌ Member no longer available.', components: [] }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
                }
    
                db.users[cached.targetId] = {
                    ...db.users[cached.targetId],
                    nickname: cached.nickname,
                    registeredAt: new Date().toISOString()
                };
    
                if (cached.needsTempApproval) {
                    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
                    db.users[cached.targetId].tempUntil = threeDaysFromNow.toISOString();
                    db.users[cached.targetId].tempRegisteredAt = db.users[cached.targetId].registeredAt;
                }
    
                if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
                if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;
                if (cached.manualPermanent) db.users[cached.targetId].manualPermanent = true;
                saveLocalStorage();
    
                await targetMember.setNickname(cached.nickname).catch(() => {});
                if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
                }
    
                const tempLabel = cached.needsTempApproval ? ' (temporary — 3 days)' : '';
                logEvent(`Admin ${interaction.user.tag} manually registered ${cached.targetId} as ${cached.nickname} in ${cached.clan}${cached.manualPermanent ? ' (manual permanent)' : cached.needsTempApproval ? ' (temporary — 3 days)' : ''}`);
    
                const responseMsg = cached.needsTempApproval
                    ? `⏳ **${cached.nickname}** registered as temporary (3 days) in **${cached.clan}**. Will be converted to permanent once found in an allied clan.`
                    : getMsg('ranking.responses.manualregister.cacheFound', { nickname: cached.nickname, clan: cached.clan });
    
                return interaction.update({
                    content: responseMsg,
                    components: []
                }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
            }
    
            return interaction.update({ content: '❌ Unknown action.', components: [] }).catch(() => {
            // Silently ignore — Discord API errors are non-critical
        });
        }
    
        
}
