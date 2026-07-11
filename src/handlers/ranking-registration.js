import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { WORLD_IDS, pendingRegistrations, adminChannelId } from '../core/ranking-constants.js';
import { findNicknameInCache, findClosestNicknameInCache, getLocalRankingCache } from '../core/ranking-cache.js';

// ==========================================
// 👑 OWNER REGISTRATION MODAL HANDLER
// ==========================================
// Extracted from ranking-handlers.js to fix fuzzy auto-correction
// (nickname is never silently replaced — fuzzy match is only informational)

export async function handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent) {
    if (!db.users) db.users = {};
    await interaction.deferReply({ flags: 64 });

    const nickname = interaction.fields.getTextInputValue('owner_nickname').trim().normalize('NFC');

    const existingUser = Object.entries(db.users).find(([id, data]) =>
        data.nickname && data.nickname.trim().normalize('NFC').toLowerCase() === nickname.toLowerCase()
    );
    if (existingUser) {
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but name already taken by user ${existingUser[0]}`);
        return interaction.editReply('❌ This character name is already registered by another user.');
    }

    const userId = interaction.user.id;

    // Look up nickname in ranking cache and check allied clan status
    let cacheHit = findNicknameInCache(nickname);
    let fuzzySuggestion = null;

    // ── Fuzzy matching: if exact nickname not found, find closest for informational note ──
    if (!cacheHit) {
        const rankingCache = getLocalRankingCache();
        if (rankingCache) {
            const fuzzyMatch = findClosestNicknameInCache(nickname, rankingCache);
            if (fuzzyMatch && fuzzyMatch.nickname.toLowerCase() !== nickname.toLowerCase()) {
                fuzzySuggestion = fuzzyMatch;
                // Use fuzzy match just for ranking/allied status display
                cacheHit = fuzzyMatch;
                logEvent(`👑 ${interaction.user.tag} — fuzzy suggestion: "${nickname}" → "${fuzzyMatch.nickname}" (${WORLD_IDS[fuzzyMatch.worldId] || fuzzyMatch.worldId})`);
            }
        }
    }

    // Always use the user's original nickname — no auto-correction
    pendingRegistrations[userId] = { nickname, timestamp: Date.now() };

    if (!adminChannelId) {
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but admin channel not configured`);
        delete pendingRegistrations[userId];
        return interaction.editReply('❌ Admin approval channel not configured. Use !setadminchannel first.');
    }

    const adminChannel = interaction.guild.channels.cache.get(adminChannelId);
    if (!adminChannel) {
        logEvent(`❌ ${interaction.user.tag} tried to register as "${nickname}" but admin channel ${adminChannelId} not found`);
        delete pendingRegistrations[userId];
        return interaction.editReply('❌ Admin approval channel not found. Contact an administrator.');
    }

    let rankingStatus = '❌ Not found in ranking';
    let alliedClanStatus = '❌ Not in allied clan';
    let fuzzyNote = '';

    if (cacheHit) {
        const serverName = WORLD_IDS[cacheHit.worldId] || `World ${cacheHit.worldId}`;
        rankingStatus = `✅ Found — ${serverName} (${cacheHit.clanName})`;

        if (fuzzySuggestion) {
            fuzzyNote = `\n🔍 **Fuzzy suggestion:** "${nickname}" → "${fuzzySuggestion.nickname}"`;
        }

        // Check if the clan is an allied clan
        const worldAlliedClans = db.config?.alliedClans?.[cacheHit.worldId];
        if (worldAlliedClans && worldAlliedClans.some(c => c.toLowerCase() === cacheHit.clanName.toLowerCase())) {
            alliedClanStatus = '✅ Yes — Allied clan';
        }
    }

    const isMissingRankingOrAllied = !cacheHit || alliedClanStatus === '❌ Not in allied clan';

    const approveButtons = [
        new ButtonBuilder().setCustomId(`approve_owner_${userId}-yes`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
    ];

    if (isMissingRankingOrAllied) {
        approveButtons.push(
            new ButtonBuilder().setCustomId(`approve_owner_${userId}-temp`).setLabel('⏳ Approve Temporarily (3 days)').setStyle(ButtonStyle.Primary)
        );
    }

    approveButtons.push(
        new ButtonBuilder().setCustomId(`approve_owner_${userId}-no`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
    );

    const adminMsg = await adminChannel.send({
        content: `👑 **New Owner Registration**\n\n👤 **User:** ${interaction.user.toString()} (${interaction.user.tag})\n🆔 **ID:** ${userId}\n📝 **Nickname:** ${nickname}${fuzzyNote}\n🔍 **Ranking:** ${rankingStatus}${fuzzyNote}\n🤝 **Allied Clan:** ${alliedClanStatus}\n🕐 **Date:** ${new Date().toLocaleString('en-US')}`,
        components: [
            new ActionRowBuilder().addComponents(approveButtons)
        ]
    });

    pendingRegistrations[userId].channelId = adminChannel.id;
    pendingRegistrations[userId].messageId = adminMsg.id;
    saveLocalStorage(); // Persist pending registration to survive bot restarts

    logEvent(`👑 ${interaction.user.tag} submitted owner registration for "${nickname}" — awaiting admin approval`);
    return interaction.editReply('✅ **Registration sent for approval!** An administrator will review it shortly.');
}
