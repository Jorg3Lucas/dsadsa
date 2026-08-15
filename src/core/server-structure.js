// ==========================================
// 🏗️ SERVER STRUCTURE (used by /setup)
// ==========================================
// Single source of truth for the Discord structure the /setup command creates.
// Categories are looked up by NAME (no hardcoded IDs in the bot) — legacyId is
// kept only as a boot fallback for servers that still have the old categories.
//
// Channel defs carry:
//   name       — the display name (with emoji) actually used on Discord
//   key        — stable logical id used by the bot for wiring (never shown)
//   legacyName — the old display name so /setup can RENAME existing channels
//                instead of creating duplicates (used for upgrades)

import { PermissionFlagsBits, ChannelType } from 'discord.js';

// Cargo elder — can write in tower-rules, announcements, allied-list
export const ELDER_ROLE_ID = '1503934006431973488';

// ── Claim categories (members view-only, bot sends panels) ──
// Each channel lists the panel keys that the bot posts into it.
export const CLAIM_CATEGORIES = [
    {
        name: '🗼 7F',
        legacyId: '1499858717456334878',
        channels: [
            { name: '🔸 SP-7F', key: 'sp7', legacyName: '🔸┃sp7', panels: ['7peak'] },
            { name: '🔹 MS-7F', key: 'ms7', legacyName: '🔹┃ms7', panels: ['7squarenormal', '7squareantidemon'] }
        ]
    },
    {
        name: '🗼 8F',
        legacyId: '1499858702814150758',
        channels: [
            { name: '🔸 SP-8F', key: 'sp8', legacyName: '🔸┃sp8', panels: ['8peak'] },
            { name: '🔹 MS-8F', key: 'ms8', legacyName: '🔹┃ms8', panels: ['8squarenormal', '8squareantidemon'] }
        ]
    },
    {
        name: '🗼 9F',
        legacyId: '1499858660678041753',
        channels: [
            { name: '🔸 SP-9F', key: 'sp9', legacyName: '🔸┃sp9', panels: ['9peak'] },
            { name: '🔹 MS-9F', key: 'ms9', legacyName: '🔹┃ms9', panels: ['9squarenormal', '9squareantidemon'] }
        ]
    },
    {
        name: '🗼 10F',
        legacyId: '1499857572453421159',
        channels: [
            { name: '🔸 SP-10F', key: 'sp10', legacyName: '🔸┃sp10', panels: ['10peak'] },
            { name: '🔹 MS-10F', key: 'ms10', legacyName: '🔹┃ms10', panels: ['10squarenormal', '10squareantidemon'] }
        ]
    },
    {
        name: '🌀 Summons',
        legacyId: '1512360620127817898',
        channels: [
            { name: '🌀 Summons', key: 'summons', legacyName: '🌀┃summons', panels: ['summon'] }
        ]
    }
];

// ── General category — one category with every general channel ──
// mode:
//   member      → members-only: only registered members (clan roles)
//                 can view and chat (market, main-chat)
//   member-view → members-only view: members see the posts, only the bot sends
//                 (reminders, events)
//   elders  → members view-only, only the elder role (+ bot) can write
//             (tower-rules, announcements, allied-list)
//   bot     → bot-managed: everyone views, only the bot sends (claim channels at creation)
//   staff   → staff-only: only approver roles (+ admins/bot) can view and chat (approvals)
//   system  → bot-managed registration channel (registration)
export const GENERAL_CATEGORY = {
    name: '🏠 General',
    channels: [
        { name: '🛒 market', key: 'market', legacyName: 'market', mode: 'member' },
        { name: '💬 main-chat', key: 'main-chat', legacyName: 'main-chat', mode: 'member' },
        { name: '📜 tower-rules', key: 'tower-rules', legacyName: 'tower-rules', mode: 'elders' },
        { name: '📢 announcements', key: 'announcements', legacyName: 'announcements', mode: 'elders' },
        { name: '🤝 allied-list', key: 'allied-list', legacyName: 'allied-list', mode: 'elders' },
        { name: '⏰ reminders', key: 'reminders', legacyName: 'reminders', mode: 'member-view' },
        { name: '📅 events', key: 'events', legacyName: 'events', mode: 'member-view' },
        { name: '📝 registration', key: 'registration', legacyName: 'registro', mode: 'system', system: 'registration' },
        { name: '📨 approvals', key: 'approvals', legacyName: 'approvals', mode: 'staff', system: 'approvals' }
    ]
};

// Legacy channels from a removed feature (deleted by /setup during upgrades)
export const LEGACY_DELETED_CHANNELS = ['domination', 'standby'];

/**
 * Look up a General channel def by its logical key (e.g. 'events').
 * @param {string} key
 * @returns {{name: string, key: string, mode: string, system?: string}|undefined}
 */
export function getGeneralChannelDef(key) {
    return GENERAL_CATEGORY.channels.find(c => c.key === key);
}

/**
 * Get the display name of a General channel by its logical key.
 * Falls back to the key itself when unknown (so callers always get a string).
 * @param {string} key
 */
export function getGeneralChannelName(key) {
    return getGeneralChannelDef(key)?.name || key;
}

/**
 * Find a text channel inside a category matching a channel def:
 * 1. by the pretty name, 2. by the legacy name, 3. by the logical key.
 * This lets both /setup and the permission sync find and upgrade channels
 * that still carry the old (pre-emoji) names.
 * @param {import('discord.js').Guild} guild
 * @param {string} categoryId
 * @param {{name: string, key?: string, legacyName?: string}} chanDef
 * @returns {import('discord.js').TextChannel|undefined}
 */
export function findTextChannel(guild, categoryId, chanDef) {
    const inCat = guild.channels.cache.filter(c => c.parentId === categoryId && c.type === ChannelType.GuildText);
    const byName = inCat.find(c => c.name === chanDef.name);
    if (byName) return byName;
    if (chanDef.legacyName) {
        const byLegacy = inCat.find(c => c.name === chanDef.legacyName);
        if (byLegacy) return byLegacy;
    }
    if (chanDef.key) {
        const byKey = inCat.find(c => c.name === chanDef.key);
        if (byKey) return byKey;
    }
    return undefined;
}

/**
 * Alias of buildMemberViewOverwrites used by the claim channels (7F-12F, Summons):
 * @everyone cannot view (or send), the bot and the given roles can VIEW ONLY,
 * only the bot can send (panels). Members holding a clan role can read the
 * panels and click the buttons, but are explicitly denied sending text
 * messages — including in threads — so the channels stay clean.
 * @param {string} everyoneId
 * @param {string} botId
 * @param {string[]} allowViewIds - role IDs allowed to view (clan roles)
 */
export function buildClaimOverwrites(everyoneId, botId, allowViewIds) {
    return buildMemberViewOverwrites(everyoneId, botId, allowViewIds);
}

/**
 * Build permission overwrites for members-view channels (reminders, events and
 * claim channels): @everyone is locked out, the given member roles (clan roles)
 * can VIEW only, only the bot (and any extra writer roles) can send
 * (panels/alerts).
 * @param {string} everyoneId
 * @param {string} botId
 * @param {string[]} allowViewIds - member role IDs allowed to view
 * @param {string[]} [extraWriters] - extra role IDs allowed to view and write
 */
export function buildMemberViewOverwrites(everyoneId, botId, allowViewIds, extraWriters = []) {
    const unique = [...new Set([botId, ...allowViewIds])];
    const viewOnlyDeny = [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.SendMessagesInThreads
    ];
    const overwrites = [
        { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel, ...viewOnlyDeny] },
        { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...unique
            .filter(id => id !== botId)
            .map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel], deny: [...viewOnlyDeny] }))
    ];
    for (const rid of new Set(extraWriters.filter(id => id && id !== botId))) {
        overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
    return overwrites;
}

/**
 * Build permission overwrites for the elders channels (tower-rules,
 * announcements, allied-list): @everyone is locked out, member roles (clan
 * roles) can VIEW only, the elder role (and the bot) can view AND write.
 * @param {string} everyoneId
 * @param {string} botId
 * @param {string[]} memberViewIds - member role IDs allowed to view
 * @param {string|null} elderId - elder role ID allowed to view and write
 */
export function buildEldersOverwrites(everyoneId, botId, memberViewIds, elderId) {
    return buildMemberViewOverwrites(everyoneId, botId, memberViewIds, elderId ? [elderId] : []);
}

/**
 * Build permission overwrites for general member channels (market, main-chat):
 * @everyone is locked out, while the bot and the given member roles (clan
 * roles) can view AND send — registered members chat freely.
 * @param {string} everyoneId
 * @param {string} botId
 * @param {string[]} allowIds - member role IDs allowed to view and chat
 */
export function buildMemberOverwrites(everyoneId, botId, allowIds) {
    const unique = [...new Set([botId, ...allowIds])];
    return [
        { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...unique
            .filter(id => id !== botId)
            .map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
    ];
}
