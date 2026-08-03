// ==========================================
// 🏗️ SERVER STRUCTURE (used by /setup)
// ==========================================
// Single source of truth for the Discord structure the /setup command creates.
// Categories are looked up by NAME (no hardcoded IDs in the bot) — legacyId is
// kept only as a boot fallback for servers that still have the old categories.

// Cargo elder — can write in tower-rules, announcements, allied-list
export const ELDER_ROLE_ID = '1503934006431973488';

// ── Claim categories (members view-only, bot sends panels) ──
// Each channel lists the panel keys that the bot posts into it.
export const CLAIM_CATEGORIES = [
    {
        name: '7F',
        legacyId: '1499858717456334878',
        channels: [
            { name: '🔸┃sp7', panels: ['7peak'] },
            { name: '🔹┃ms7', panels: ['7squarenormal', '7squareantidemon'] }
        ]
    },
    {
        name: '8F',
        legacyId: '1499858702814150758',
        channels: [
            { name: '🔸┃sp8', panels: ['8peak'] },
            { name: '🔹┃ms8', panels: ['8squarenormal', '8squareantidemon'] }
        ]
    },
    {
        name: '9F',
        legacyId: '1499858660678041753',
        channels: [
            { name: '🔸┃sp9', panels: ['9peak'] },
            { name: '🔹┃ms9', panels: ['9squarenormal', '9squareantidemon'] }
        ]
    },
    {
        name: '10F',
        legacyId: '1499857572453421159',
        channels: [
            { name: '🔸┃sp10', panels: ['10peak'] },
            { name: '🔹┃ms10', panels: ['10squarenormal', '10squareantidemon'] }
        ]
    },
    {
        name: '11F',
        legacyId: '1511063558224613396',
        channels: [
            { name: '🔸┃sp11', panels: ['11peak', '11goblin'] },
            { name: '🔹┃ms11', panels: ['11squareleaders', '11squareevents', '11squareantidemon', '11msgoblin'] }
        ]
    },
    {
        name: '12F',
        legacyId: '1511063661458751708',
        channels: [
            { name: '🔸┃sp12', panels: ['12peak', '12randomevent', '12goblin'] },
            { name: '🔹┃ms12', panels: ['12squareleaders', '12squareevents', '12squareantidemon', '12msgoblin'] }
        ]
    },
    {
        name: 'Summons',
        legacyId: '1512360620127817898',
        channels: [
            { name: '🌀┃summons', panels: ['summon'] }
        ]
    }
];

// ── General category — one category with every general channel ──
// mode:
//   open    → everyone can view and chat (market, main-chat)
//   elders  → only the elder role (+ admins/bot) can chat
//   bot     → bot-managed: everyone views, only the bot sends (reminder, events)
//   system  → bot-managed notification/registration channels (registro, domination, standby)
export const GENERAL_CATEGORY = {
    name: 'General',
    channels: [
        { name: 'market', mode: 'open' },
        { name: 'main-chat', mode: 'open' },
        { name: 'tower-rules', mode: 'elders' },
        { name: 'announcements', mode: 'elders' },
        { name: 'allied-list', mode: 'elders' },
        { name: 'reminder', mode: 'bot' },
        { name: 'events', mode: 'bot' },
        { name: 'registro', mode: 'system', system: 'registration' },
        { name: 'domination', mode: 'system', system: 'domination' },
        { name: 'standby', mode: 'system', system: 'standby' }
    ]
};
