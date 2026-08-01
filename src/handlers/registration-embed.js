// ==========================================
// 🎨 REGISTRATION — Embed & Button Builders
// Extracted from registration-panel.js
// ==========================================

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { CLAN_ROLES } from '../core/ranking-constants.js';
import { getLocalRankingCache, cleanNickname } from '../core/ranking-cache.js';
import {
    pilotRequests,
    pendingOwnerRegistrations,
    regEmbed,
    BUTTON_IDS,
    WELCOME_EMBED_TITLE,
    REG_PANEL_EMBED_TITLE
} from './registration-shared.js';

/** Build the beautiful registration panel embed. Shows live server stats, clan distribution and clear steps. @param {object} rankingDb - The ranking database */
export function buildRegPanelEmbed(rankingDb) {
    const users = rankingDb.users || {};
    const registered = Object.values(users).filter(
        u => u && (u.registeredAt || u.manual === true)
    );
    const registeredCount = registered.length;

    // ── Live stats ──
    const pilotCount = registered.reduce((acc, u) => acc + (Array.isArray(u.pilotIds) ? u.pilotIds.length : 0), 0);
    const pendingApprovals = Object.keys(pendingOwnerRegistrations).length + Object.keys(pilotRequests).length;

    // ── Clan distribution (clanManual override first, then local ranking cache) ──
    const localCache = getLocalRankingCache() || {};
    const cleanedCache = new Map(Object.keys(localCache).map(k => [cleanNickname(k), k]));
    const clanCounts = {};
    for (const u of registered) {
        let clan = null;
        if (u.clanManual) {
            clan = u.clanManual;
        } else if (u.nickname) {
            const cleanedNick = cleanNickname(u.nickname);
            const exactKey = cleanedCache.get(cleanedNick);
            clan = exactKey ? localCache[exactKey] : null;
        }
        if (clan) clanCounts[clan] = (clanCounts[clan] || 0) + 1;
    }
    const clanDistribution = Object.entries(clanCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6)
        .map(([clan, count]) => `▸ **${count}** — ${clan}`)
        .join('\n') || 'No registered members yet.';

    const embed = regEmbed(
        REG_PANEL_EMBED_TITLE,
        '#5865F2',
        'Welcome! Link your **in-game character** to unlock your clan role and manage pilots.\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        'Click a button below to manage your account'
    )
        .addFields(
            {
                name: '📊 Server Stats',
                value: [
                    `👥 **${registeredCount}** registered member(s)`,
                    `✈️ **${pilotCount}** linked pilot(s)`,
                    `⏳ **${pendingApprovals}** pending approval(s)`
                ].join('\n'),
                inline: false
            },
            {
                name: '📋 How It Works',
                value: [
                    '**1.** Click **📝 Register** and type your exact in-game nickname.',
                    '**2.** The bot auto-detects your clan from the official ranking and assigns the role.',
                    '**3.** Want to pilot for someone? Use **✈️ Register as Pilot** (up to **4 pilots** per owner).',
                    '**4.** Roles & nicknames sync automatically every day at **22:00 BRT**.'
                ].join('\n'),
                inline: false
            },
            {
                name: '🏛️ Clan Distribution',
                value: clanDistribution,
                inline: true
            },
            {
                name: '🏷️ Available Clans',
                value: Object.keys(CLAN_ROLES).join(' • ') || 'None configured',
                inline: true
            }
        )
    return embed;
}

/** Build the fixed welcome embed posted in the welcome channel — consistent with the registration panel. */
export function buildWelcomeEmbed() {
    return regEmbed(
        WELCOME_EMBED_TITLE,
        '#5865F2',
        'Get your **in-game clan roles** and manage your characters below! 👇\n\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━'
    )
        .addFields(
            {
                name: '⚠️ Important',
                value: 'Your character **MUST** be visible in the official server ranking (Top 1000) for the bot to find you and assign roles.',
                inline: false
            },
            {
                name: '📌 How to get your roles automatically',
                value: [
                    '**1.** Click **📝 Register** and type your in-game name **exactly**.',
                    '**2.** Have pilots handling your characters? Use **✈️ Register as Pilot** (**up to 4 pilots** per owner).',
                    '**3.** Need to remove a pilot? Use **🗑️ Remove Pilot**.',
                    '**4.** Your request is approved by the **Elders** — you\'ll get a DM when it\'s done.'
                ].join('\n'),
                inline: false
            },
            {
                name: '🔄 Ranking Updates',
                value: 'The database cache and role assignments refresh automatically every day at **22:00 BRT**.',
                inline: false
            },
            {
                name: 'ℹ️ Need help?',
                value: 'Click the **❓ Help** button to see all commands and tips.',
                inline: false
            }
        );
}

/** Build the action row buttons for the registration panel. @param {boolean} [disableAll=false] */
export function buildRegPanelButtons(disableAll = false) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.register)
            .setEmoji('📝')
            .setLabel('Register')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.registerPilot)
            .setEmoji('✈️')
            .setLabel('Register as Pilot')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disableAll)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.removePilot)
            .setEmoji('🗑️')
            .setLabel('Remove Pilot')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.sync)
            .setEmoji('🔄')
            .setLabel('Force Sync')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll),
        new ButtonBuilder()
            .setCustomId(BUTTON_IDS.help)
            .setEmoji('❓')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableAll)
    );

    return [row1, row2];
}
