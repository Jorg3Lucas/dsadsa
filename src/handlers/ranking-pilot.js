import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    pendingPilotApprovals
} from '../core/ranking-constants.js';
import { cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';

// ==========================================
// ✈️ PILOT REGISTRATION & REMOVAL HANDLERS
// ==========================================
// Extracted from ranking-handlers.js

// ── Pilot Registration Modal ──
export async function handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferReply({ flags: 64 });

    const ownerNick = interaction.fields.getTextInputValue('owner_nickname').trim().normalize('NFC');

    let ownerEntry = Object.entries(db.users).find(([id, data]) =>
        data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === ownerNick.toLowerCase()
    );

    // ── Fuzzy matching: if exact owner not found, try closest match ──
    let fuzzyCorrectedNick = null;
    if (!ownerEntry) {
        const cleanedInput = cleanNickname(ownerNick);

        if (cleanedInput.length >= 2) {
            const pilotIds = new Set();
            for (const [, data] of Object.entries(db.users)) {
                if (data.pilotIds && data.pilotIds.length > 0) {
                    for (const pid of data.pilotIds) {
                        pilotIds.add(pid);
                    }
                }
            }

            let bestMatch = null;
            let bestScore = 0;

            for (const [id, data] of Object.entries(db.users)) {
                if (!data.nickname) continue;
                if (pilotIds.has(id)) continue;
                const cleanedNick = cleanNickname(data.nickname);
                if (cleanedNick.length < 2) continue;

                const inputChars = new Set(cleanedInput);
                const nickChars = new Set(cleanedNick);
                let commonChars = 0;
                for (const c of inputChars) {
                    if (nickChars.has(c)) commonChars++;
                }
                const overlap = (2 * commonChars) / (inputChars.size + nickChars.size);
                if (overlap < 0.3) continue;

                const distance = levenshteinDistance(cleanedInput, cleanedNick);
                const maxLen = Math.max(cleanedInput.length, cleanedNick.length);
                const similarity = 1 - (distance / maxLen);

                if (similarity > bestScore && similarity >= 0.55) {
                    bestScore = similarity;
                    bestMatch = { id, nickname: data.nickname };
                }
            }

            if (bestMatch) {
                fuzzyCorrectedNick = bestMatch.nickname;
                ownerEntry = [bestMatch.id, db.users[bestMatch.id]];
                logEvent(`✈️ ${interaction.user.tag} — fuzzy matched owner "${ownerNick}" → "${bestMatch.nickname}" for pilot registration`);
            }
        }
    }

    if (!ownerEntry) {
        return interaction.editReply('❌ Owner not found. Verify the nickname is spelled correctly and the owner is already registered.');
    }

    const [ownerId, ownerData] = ownerEntry;
    const pilotId = interaction.user.id;

    if (ownerId === pilotId) {
        return interaction.editReply('❌ You cannot register as your own pilot.');
    }

    if (!ownerData.pilotIds) ownerData.pilotIds = [];
    if (ownerData.pilotIds.length >= 4) {
        return interaction.editReply('❌ This owner already has the maximum of 4 pilots.');
    }
    if (ownerData.pilotIds.includes(pilotId)) {
        return interaction.editReply('❌ You are already registered as a pilot for this owner.');
    }

    pendingPilotApprovals[pilotId] = {
        ownerId,
        ownerNick: ownerData.nickname,
        pilotId,
        pilotTag: interaction.user.tag,
        timestamp: Date.now()
    };
    saveLocalStorage();

    try {
        const ownerMember = await interaction.guild.members.fetch(ownerId);
        const dmChannel = await ownerMember.createDM();

        await dmChannel.send({
            content: `✈️ **Pilot Approval**\n\n👤 **${interaction.user.tag}** wants to register as your pilot.\n📝 **Owner nickname:** ${ownerData.nickname}\n\nDo you approve this pilot?`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-yes`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`approve_pilot_${pilotId}-no`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
                )
            ]
        });

        logEvent(`✈️ ${interaction.user.tag} requested to be pilot of ${ownerData.nickname} — DM sent to owner for approval`);
        const fuzzyReply = fuzzyCorrectedNick
            ? `\n🔍 **Corrected:** you typed "${ownerNick}" → using "${fuzzyCorrectedNick}"`
            : '';
        return interaction.editReply(`✅ **Request sent!** The owner **${ownerData.nickname}** received a DM to approve your pilot registration.${fuzzyReply}`);
    } catch (error) {
        logEvent(`❌ Failed to send pilot DM: ${interaction.user.tag} → owner ${ownerData.nickname} (${ownerId}): ${error.message}`);
        delete pendingPilotApprovals[pilotId];
        saveLocalStorage();
        return interaction.editReply('❌ Could not send DM to the owner. Make sure they have DMs enabled on this server.');
    }
}

// ── Pilot Removal (user removing their own pilot) ──
export async function handlePilotRemoveSelect(interaction, db, saveLocalStorage, logEvent) {
    await interaction.deferUpdate();

    const pilotToRemoveId = interaction.values[0];
    const userProfile = db.users[interaction.user.id];

    if (!userProfile || !userProfile.pilotIds || !userProfile.pilotIds.includes(pilotToRemoveId)) {
        return interaction.followUp({ content: getMsg('ranking.responses.removepilot.error'), flags: 64 });
    }

    userProfile.pilotIds = userProfile.pilotIds.filter(id => id !== pilotToRemoveId);
    saveLocalStorage();

    await interaction.webhook.editMessage(interaction.message.id, {
        content: getMsg('ranking.responses.removepilot.success'),
        components: []
    }).catch(() => {});

    interaction.guild.members.fetch(pilotToRemoveId)
        .then(async (pilotMember) => {
            if (pilotMember) {
                if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                    await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
                }
                await pilotMember.setNickname(pilotMember.user.username).catch(() => {});
            }
        }).catch(() => {});

    return;
}
