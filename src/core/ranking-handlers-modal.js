// ==========================================
// 🖱️ RANKING — Register Modal Handler
// Extracted from ranking-handlers.js
// ==========================================

import { getLocalRankingCache, findClosestNicknameInCache, findNicknameInCache, cleanNickname, levenshteinDistance } from './ranking-cache.js';
import { getMsg } from './lang.js';
import { noop } from "./config.js";
import { applyImmediateRoleWithCache } from './ranking-role.js';

/** Handle the /register modal submission with fuzzy auto-correction and duplicate detection. @param {import('discord.js').ModalSubmitInteraction} interaction @param {object} db @param {Function} saveLocalStorage @param {Function} logEvent @returns {Promise} */
export async function handleRegisterModal(interaction, db, saveLocalStorage, logEvent) {
    const nickname = interaction.fields.getTextInputValue('character_nickname').trim().normalize('NFC');

    // ── Check exact duplicate ──
    const databaseRecord = Object.entries(db.users).find(([, data]) => data.nickname.trim().normalize('NFC').toLowerCase() === nickname.toLowerCase());
    if (databaseRecord && databaseRecord[0] !== interaction.user.id) {
        return interaction.editReply(getMsg('ranking.responses.register.alreadyRegistered'));
    }

    // ── Fuzzy conflict detection: warn if similar to another registered nickname ──
    let fuzzyConflict = null;
    let bestConflictScore = 0;
    for (const [userId, data] of Object.entries(db.users)) {
        if (userId === interaction.user.id) continue;
        const existingNick = data.nickname.trim().normalize('NFC');
        const cleanExisting = cleanNickname(existingNick);
        const cleanInput = cleanNickname(nickname);
        const maxLen = Math.max(cleanInput.length, cleanExisting.length);
        if (maxLen === 0) continue;
        const distance = levenshteinDistance(cleanInput, cleanExisting);
        const score = 1 - distance / maxLen;
        if (score > 0.7 && score > bestConflictScore) {
            bestConflictScore = score;
            fuzzyConflict = { id: userId, existingNick: data.nickname };
        }
    }

    // ── Auto-correct via ranking cache fuzzy ──
    const localCache = getLocalRankingCache() || {};
    const cacheExact = findNicknameInCache(nickname, localCache);
    let finalNickname = nickname;
    let wasAutoCorrected = false;

    if (!cacheExact) {
        const fuzzyCache = findClosestNicknameInCache(nickname, localCache);
        if (fuzzyCache && fuzzyCache.nickname.toLowerCase() !== nickname.toLowerCase()) {
            finalNickname = fuzzyCache.nickname;
            wasAutoCorrected = true;
            logEvent(`🔍 User ${interaction.user.tag} — auto-corrected "${nickname}" → "${fuzzyCache.nickname}" via /register`);
        }
    }

    // ── Second duplicate check with corrected name ──
    if (wasAutoCorrected) {
        const correctedConflict = Object.entries(db.users).find(([id, data]) =>
            id !== interaction.user.id &&
            data.nickname.trim().normalize('NFC').toLowerCase() === finalNickname.toLowerCase()
        );
        if (correctedConflict) {
            logEvent(`⚠️ User ${interaction.user.tag} — auto-correct blocked: "${nickname}" → "${finalNickname}" conflicts with existing user ${correctedConflict[0]}`);
            return interaction.editReply(
                `❌ **${nickname}** would be auto-corrected to **${finalNickname}**, but that name is already registered by another user.\n\nPlease contact an admin or use a different name.`
            );
        }
    }

    db.users[interaction.user.id] = { ...db.users[interaction.user.id], nickname: finalNickname, registeredAt: new Date().toISOString() };
    if (!db.users[interaction.user.id].pilotIds) db.users[interaction.user.id].pilotIds = [];
    saveLocalStorage();

    interaction.guild.members.fetch(interaction.user.id)
        .then(async (member) => {
            if (member) {
                await member.setNickname(finalNickname).catch(noop);
                await applyImmediateRoleWithCache(interaction, member, finalNickname, interaction.user.id).catch(noop);
            }
        }).catch(noop);

    let responseMsg = getMsg('ranking.responses.register.success', { nickname: finalNickname });
    if (wasAutoCorrected) {
        responseMsg += `\n\n✏️ **Auto-corrected** from "${nickname}" → "${finalNickname}"`;
    }
    if (fuzzyConflict) {
        responseMsg += `\n\n⚠️ **Note:** "${nickname}" is very similar to **${fuzzyConflict.existingNick}** (another registered user). If this was a mistake, please contact an admin.`;
    }

    return interaction.editReply(responseMsg);
}
