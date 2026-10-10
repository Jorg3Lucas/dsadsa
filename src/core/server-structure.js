// ==========================================
// 🏗️ SERVER STRUCTURE
// ==========================================
// Single source of truth for the Discord structure the bot manages.
// Claim categories are matched by their explicit `id` first (they win over
// name/legacy lookups), then by NAME, then by legacyId — which is kept only as
// an upgrade fallback for servers that still have the old categories.
//
// Channel defs carry:
//   name       — the display name (with emoji) actually used on Discord
//   key        — stable logical id used by the bot for wiring (never shown)
//   legacyName — the old display name so the bot can find (and rename) legacy channels
//                instead of creating duplicates (used for upgrades)

import { PermissionFlagsBits, ChannelType } from 'discord.js';

// Cargo elder — can write in tower-rules, announcements, allied-list.
// Override per deployment with the ELDER_ROLE_ID env var (.env).
export const ELDER_ROLE_ID = process.env.ELDER_ROLE_ID?.trim() || '1503934006431973488';

// Explicit Discord category IDs for the two claim categories.
// Override per deployment with CLAIM_CATEGORY_SP_SUMMONS_ID / CLAIM_CATEGORY_MS_ID (.env).
const SP_SUMMONS_CATEGORY_ID = process.env.CLAIM_CATEGORY_SP_SUMMONS_ID?.trim() || '1548033121012813905';
const MS_CATEGORY_ID = process.env.CLAIM_CATEGORY_MS_ID?.trim() || '1548033184619438162';

// Explicit Discord category ID for the ticket category.
// Override per deployment with TICKET_CATEGORY_ID (.env).
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID?.trim() || '1557229285629235220';

// ── Claim categories (members view-only, bot sends panels) ──
// Only TWO categories are used:
//   • SP → every Secret Peak floor
//   • MS → every Magic Square floor
// `id` is the explicit Discord category ID — it wins over name/legacy lookups,
// and a category matched by id keeps its current name (no rename).
// Claim channels created inside the category inherit its permission overwrites
// (auto-channel-setup copies them explicitly), so the category is the source
// of truth for who can see the panels.
export const CLAIM_CATEGORIES = [
    {
        id: SP_SUMMONS_CATEGORY_ID,
        name: '🔸 SP',
        channels: [
            { name: '🔸 SP-8F', key: 'sp8', legacyName: '🔸┃sp8', panels: ['8peak'] },
            { name: '🔸 SP-9F', key: 'sp9', legacyName: '🔸┃sp9', panels: ['9peak'] },
            { name: '🔸 SP-10F', key: 'sp10', legacyName: '🔸┃sp10', panels: ['10peak'] },
            { name: '🔸 SP-11F', key: 'sp11', legacyName: '🔸┃sp11', panels: ['11peak', '11goblin'] },
            { name: '🔸 SP-12F', key: 'sp12', legacyName: '🔸┃sp12', panels: ['12peak', '12randomevent', '12goblin'] }
        ]
    },
    {
        id: MS_CATEGORY_ID,
        name: '🔹 MS',
        channels: [
            { name: '🔹 MS-8F', key: 'ms8', legacyName: '🔹┃ms8', panels: ['8squarenormal', '8squareantidemon'] },
            { name: '🔹 MS-9F', key: 'ms9', legacyName: '🔹┃ms9', panels: ['9squarenormal', '9squareantidemon'] },
            { name: '🔹 MS-10F', key: 'ms10', legacyName: '🔹┃ms10', panels: ['10squarenormal', '10squareantidemon'] },
            { name: '🔹 MS-11F', key: 'ms11', legacyName: '🔹┃ms11', panels: ['11squareleaders', '11squareevents', '11squareantidemon', '11msgoblin'] },
            { name: '🔹 MS-12F', key: 'ms12', legacyName: '🔹┃ms12', panels: ['12squareleaders', '12squareevents', '12squareantidemon', '12msgoblin'] }
        ]
    }
];

// ── Ticket category — panel channel + transcript log ──
// On boot the bot ensures every channel below exists inside this category. It
// NEVER deletes anything in this category: existing channels (including open
// ticket-* rooms) are kept as-is, only missing ones are created, and the panel
// channel gets the 🎫 Open Ticket panel (re)posted.
//   panel: true → channel that receives the ticket panel on boot
//   key          → stable logical id used to resolve the transcript log channel
export const TICKET_CATEGORY = {
    id: TICKET_CATEGORY_ID,
    name: '🎫 Tickets',
    channels: [
        { name: '🎫 open-ticket', key: 'ticket-panel', legacyName: 'open-ticket', panel: true },
        { name: '📜 ticket-logs', key: 'ticket-logs', legacyName: 'ticket-logs' }
    ]
};

// ── General category — one category with every general channel ──
// mode:
//   member      → members-only: registered members (fixed member role)
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

// Legacy channels from a removed feature (deleted during upgrades)
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
 * This lets the permission sync find and upgrade channels
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
 * Find a claim/general category by its explicit ID, then by name, then by legacy ID.
 * A configured `id` wins, so renamed categories are never lost. Returns null when
 * nothing matches.
 * @param {import('discord.js').Guild} guild
 * @param {{ id?: string, name: string, legacyId?: string }} catDef
 * @returns {import('discord.js').CategoryChannel|null}
 */
export function findClaimCategory(guild, catDef) {
    if (catDef.id) {
        const byId = guild.channels.cache.get(catDef.id);
        if (byId && byId.type === ChannelType.GuildCategory) return byId;
    }
    const byName = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === catDef.name);
    if (byName) return byName;
    if (catDef.legacyId) {
        const byLegacy = guild.channels.cache.get(catDef.legacyId);
        if (byLegacy && byLegacy.type === ChannelType.GuildCategory) return byLegacy;
    }
    return null;
}

/**
 * Alias of buildMemberViewOverwrites used by the claim channels (8F-12F):
 * @everyone cannot view (or send), the bot and the given roles can VIEW ONLY,
 * only the bot can send (panels). Members holding the member role
 * can read the panels and click the buttons, but are explicitly denied sending
 * text messages — including in threads — so the channels stay clean.
 * @param {string} everyoneId
 * @param {string} botId
 * @param {string[]} allowViewIds - role IDs allowed to view (fixed member role)
 */
export function buildClaimOverwrites(everyoneId, botId, allowViewIds) {
    return buildMemberViewOverwrites(everyoneId, botId, allowViewIds);
}

/**
 * Build permission overwrites for members-view channels (reminders, events and
 * claim channels): @everyone is locked out, the member role
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
 * announcements, allied-list): @everyone is locked out, the member role
 * can VIEW only, the elder role (and the bot) can view AND
 * write.
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
 * @everyone is locked out, while the bot and the member role
 * can view AND send — registered members chat freely.
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
