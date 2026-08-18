import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    DISCORD_SERVER_ID,
    pendingPilotApprovals,
    adminChannelId
} from '../core/ranking-constants.js';
import { cleanNickname, levenshteinDistance } from '../core/ranking-cache.js';

// ==========================================
// ✈️ PILOT REGISTRATION & REMOVAL HANDLERS
// ==========================================
// Extracted from ranking-handlers.js

// ── Fuzzy owner candidates (shared with modal + select flow + /pending) ──
// Returns up to `limit` registered owners sorted by similarity to the typed nickname.
export function findOwnerCandidates(ownerNick, db, limit = 3) {
    const cleanedInput = cleanNickname(ownerNick);
    if (cleanedInput.length < 2) return [];

    const pilotIds = new Set();
    for (const [, data] of Object.entries(db.users || {})) {
        if (data.pilotIds && data.pilotIds.length > 0) {
            for (const pid of data.pilotIds) {
                pilotIds.add(pid);
            }
        }
    }

    const candidates = [];
    for (const [id, data] of Object.entries(db.users || {})) {
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

        if (similarity >= 0.55) {
            candidates.push({ id, nickname: data.nickname, score: similarity });
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, limit);
}

// ── Pilot Registration Modal ──
export async function handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent) {
    try {
        await interaction.deferReply({ flags: 64 });
    } catch (e) {
        console.warn(`⚠️ [Pilot] deferReply failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

    const ownerNick = interaction.fields.getTextInputValue('owner_nickname').trim().normalize('NFC');
    const pilotId = interaction.user.id;

    let ownerEntry = Object.entries(db.users).find(([id, data]) =>
        data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === ownerNick.toLowerCase()
    );

    // ── Fuzzy matching: if exact owner not found, show candidates so the user picks ──
    if (!ownerEntry) {
        const candidates = findOwnerCandidates(ownerNick, db, 3);

        if (candidates.length > 0) {
            const selectOptions = candidates.map(c => new StringSelectMenuOptionBuilder()
                .setLabel(`${c.nickname.substring(0, 80)}`)
                .setValue(c.id)
                .setDescription(`Similarity ${Math.round(c.score * 100)}%`)
            );

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`user_select_pilot_owner_${pilotId}`)
                    .setPlaceholder('Select the correct owner')
                    .addOptions(selectOptions)
            );

            logEvent(`🔍 ${interaction.user.tag} — fuzzy candidates shown for owner "${ownerNick}" (pilot registration)`);
            return interaction.editReply({
                content: `🔍 **"${ownerNick}" not found exactly.** We found similar registered owners. Select the correct one below:`,
                components: [row]
            });
        }

        return interaction.editReply('❌ Owner not found. Verify the nickname is spelled correctly and the owner is already registered.');
    }

    return completePilotRegistration(interaction, db, saveLocalStorage, logEvent, ownerEntry, ownerNick);
}

// ── Select Menu: user picks which registered owner is their pilot's owner ──
export async function handleUserSelectPilotOwner(interaction, db, saveLocalStorage, logEvent) {
    try {
        await interaction.deferUpdate();
    } catch (e) {
        console.warn(`⚠️ [Pilot] deferUpdate failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

    const pilotId = interaction.customId.replace('user_select_pilot_owner_', '');
    const ownerId = interaction.values[0];
    const ownerData = db.users[ownerId];

    if (!ownerData) {
        await interaction.editReply({ content: '❌ That owner is no longer registered.', components: [] });
        return;
    }

    logEvent(`🔍 ${interaction.user.tag} selected owner "${ownerData.nickname}" for pilot registration`);
    return completePilotRegistration(interaction, db, saveLocalStorage, logEvent, [ownerId, ownerData], ownerData.nickname);
}

// ── Shared: finish pilot registration request (DM owner for approval) ──
async function completePilotRegistration(interaction, db, saveLocalStorage, logEvent, ownerEntry, ownerNick) {
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

        // ── Also send a copy to admin channel ──
        if (adminChannelId) {
            const adminChannel = interaction.guild.channels.cache.get(adminChannelId);
            if (adminChannel) {
                await adminChannel.send({
                    content: `✈️ **Pilot Registration Request**\n\n👤 **Pilot:** ${interaction.user.toString()} (${interaction.user.tag})\n🆔 **ID:** ${pilotId}\n👑 **Owner:** <@${ownerId}> (${ownerData.nickname})\n🕐 **Date:** ${new Date().toLocaleString('en-US')}\n\nThe owner was notified via DM. An admin can also approve or reject.`,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`admin_approve_pilot_${pilotId}-yes`).setLabel('✅ Admin Approve').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`admin_approve_pilot_${pilotId}-no`).setLabel('❌ Admin Reject').setStyle(ButtonStyle.Danger)
                        )
                    ]
                }).catch(e => logEvent(`⚠️ Failed to send pilot request to admin channel: ${e.message}`));
            }
        }

        return interaction.editReply(`✅ **Request sent!** The owner **${ownerData.nickname}** received a DM to approve your pilot registration.`);
    } catch (error) {
        logEvent(`❌ Failed to send pilot DM: ${interaction.user.tag} → owner ${ownerData.nickname} (${ownerId}): ${error.message}`);
        delete pendingPilotApprovals[pilotId];
        saveLocalStorage();
        return interaction.editReply('❌ Could not send DM to the owner. Make sure they have DMs enabled on this server.');
    }
}

// ── Pilot Removal (user removing their own pilot) ──
export async function handlePilotRemoveSelect(interaction, db, saveLocalStorage, logEvent) {
    try {
        await interaction.deferUpdate();
    } catch (e) {
        console.warn(`⚠️ [Pilot] deferUpdate failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

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

// ── Owner removes pilot via DM button (after admin approval) ──
export async function handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent) {
    try {
        await interaction.deferUpdate();
    } catch (e) {
        console.warn(`⚠️ [Pilot] deferUpdate failed for ${interaction.user.tag}: ${e.message}`);
        return;
    }

    const pilotUserId = interaction.customId.replace('owner_remove_pilot_', '');
    const ownerId = interaction.user.id;
    const ownerData = db.users[ownerId];

    // The DM is always sent to the correct owner, so interaction.user.id IS the owner.
    if (!ownerData || !ownerData.pilotIds || !ownerData.pilotIds.includes(pilotUserId)) {
        await interaction.editReply({
            content: '❌ This pilot is no longer linked to your account.',
            components: []
        }).catch(() => {});
        return;
    }

    ownerData.pilotIds = ownerData.pilotIds.filter(id => id !== pilotUserId);
    saveLocalStorage();

    // Remove role and reset nickname for pilot, and get pilot tag for the log
    let pilotTag = 'Unknown';
    try {
        const guild = interaction.client.guilds.cache.get(DISCORD_SERVER_ID);
        if (guild) {
            const pilotMember = await guild.members.fetch(pilotUserId).catch(() => null);
            if (pilotMember) {
                pilotTag = pilotMember.user.tag;
                // Role removal + nickname reset are independent — run concurrently.
                await Promise.all([
                    pilotMember.roles.cache.has(MEMBER_ROLE_ID)
                        ? pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {})
                        : Promise.resolve(),
                    pilotMember.setNickname(pilotMember.user.username).catch(() => {})
                ]);
            }
        }
    } catch (e) {
        logEvent(`⚠️ Could not update pilot ${pilotUserId} after removal: ${e.message}`);
    }

    logEvent(`❌ Owner ${ownerId} removed pilot ${pilotUserId} (${pilotTag}) via DM button`);

    await interaction.editReply({
        content: `✅ **Pilot removed successfully.**\n\n✈️ **${pilotTag}** is no longer your pilot.\n\nYou can use **/removepilot** anytime to manage your pilots.`,
        components: []
    }).catch(() => {});
}
