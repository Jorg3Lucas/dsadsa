// ==========================================
// 🔄 RECOVER-DB — Rebuild database from Discord
// ==========================================
// Reconstructs database_ranking.json from the current Discord server state:
//   - Members with the member role   → registered users
//   - Nickname "EU011 - CharName"    → owner (server prefix stripped)
//   - Nickname "EU011 - Owner - Pilot" → pilot (linked to matching owner)
//
// READ-ONLY on Discord: never changes roles or nicknames.
// Only writes the local database_ranking.json file.
//
// Usage: node recover-db.js
// ==========================================

import 'dotenv/config';
import fs from 'node:fs';
import { Client, GatewayIntentBits } from 'discord.js';
import { WORLD_IDS } from './src/core/ranking-constants.js';

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_SERVER_ID || '1481566364631044119';
const MEMBER_ROLE_ID = '1481568299966926879';
const DB_PATH = './database_ranking.json';
const PILOT_SUFFIX = ' - Pilot';

if (!TOKEN) {
    console.error('❌ No TOKEN found in .env — cannot connect to Discord.');
    process.exit(1);
}

// Exact server prefixes from WORLD_IDS (e.g. "EU011 - ", "ASIA311 - ")
const SERVER_NAMES = Object.values(WORLD_IDS).sort((a, b) => b.length - a.length);
const PREFIX_REGEX = new RegExp(`^(?:${SERVER_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*[-–—]\\s*(.+)$`);

function stripServerPrefix(nick) {
    const m = nick.match(PREFIX_REGEX);
    return m ? m[1].trim() : nick.trim();
}

// Returns { isPilot, baseNick } — baseNick is the raw in-game name / owner name
function parseNickname(displayName) {
    const clean = (displayName || '').trim().normalize('NFC');
    if (clean.endsWith(PILOT_SUFFIX)) {
        return { isPilot: true, baseNick: stripServerPrefix(clean.slice(0, -PILOT_SUFFIX.length)) };
    }
    return { isPilot: false, baseNick: stripServerPrefix(clean) };
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('clientReady', async () => {
    console.log(`🤖 Connected as ${client.user.tag}`);
    console.log('========================================');

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error(`❌ Guild ${GUILD_ID} not found. Check DISCORD_SERVER_ID in .env.`);
        process.exit(1);
    }

    console.log(`📡 Fetching all members of ${guild.name}...`);
    const members = await guild.members.fetch().catch((e) => {
        console.error('❌ Failed to fetch members:', e.message);
        console.error('💡 Make sure the bot has the Server Members Intent enabled in the Developer Portal.');
        process.exit(1);
    });

    const owners = {};      // memberId -> { nickname, registeredAt, pilotIds }
    const orphanPilots = []; // { memberId, baseNick, username }
    const noNickMembers = [];
    const roleMembers = [];

    for (const [id, member] of members) {
        if (member.user.bot) continue;
        if (!member.roles.cache.has(MEMBER_ROLE_ID)) continue;

        roleMembers.push(member);
        const displayName = member.nickname || member.user.username;
        const { isPilot, baseNick } = parseNickname(displayName);

        // No usable game nickname (nickname == username or empty after parsing)
        if (!baseNick || baseNick.length === 0 || baseNick === member.user.username) {
            noNickMembers.push({ id, username: member.user.username });
            continue;
        }

        const entry = {
            nickname: baseNick,
            registeredAt: (member.joinedAt ? member.joinedAt.toISOString() : new Date().toISOString()),
            pilotIds: []
        };

        if (isPilot) {
            orphanPilots.push({ memberId: id, ownerBaseNick: baseNick, username: member.user.username });
        } else {
            owners[id] = entry;
        }
    }

    // ── Link pilots to owners (case-insensitive, NFC-normalized) ──
    const ownerByNick = new Map();
    for (const [id, data] of Object.entries(owners)) {
        const key = data.nickname.trim().normalize('NFC').toLowerCase();
        if (!ownerByNick.has(key)) ownerByNick.set(key, []);
        ownerByNick.get(key).push(id);
    }

    let linked = 0;
    let stillOrphan = 0;
    const duplicateWarnings = [];

    for (const pilot of orphanPilots) {
        const key = pilot.ownerBaseNick.trim().normalize('NFC').toLowerCase();
        const candidates = ownerByNick.get(key) || [];

        if (candidates.length === 1) {
            const ownerId = candidates[0];
            if (!owners[ownerId].pilotIds.includes(pilot.memberId)) {
                owners[ownerId].pilotIds.push(pilot.memberId);
                linked++;
            }
        } else if (candidates.length > 1) {
            // Ambiguous owner (same name registered twice) — don't guess
            duplicateWarnings.push(`⚠️ Pilot ${pilot.username} (${pilot.memberId}) matches ${candidates.length} owners with "${pilot.ownerBaseNick}" — NOT auto-linked`);
            stillOrphan++;
        } else {
            // Owner not found (not in prod guild with role) — keep pilot as pending link
            owners[pilot.memberId] = {
                nickname: pilot.ownerBaseNick,
                registeredAt: new Date().toISOString(),
                pilotIds: [],
                pendingOwnerNick: pilot.ownerBaseNick
            };
            stillOrphan++;
        }
    }

    // ── Duplicate owner nicknames warning ──
    for (const [key, ids] of ownerByNick) {
        if (ids.length > 1) {
            duplicateWarnings.push(`⚠️ "${key}" registered by ${ids.length} members (${ids.join(', ')}) — verify with /manage`);
        }
    }

    // ── Overwrite protection: backup current file if it exists ──
    if (fs.existsSync(DB_PATH)) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(DB_PATH, `./database_ranking_PRE_RECOVER_${ts}.json`);
        console.log(`💾 Backed up current database to database_ranking_PRE_RECOVER_${ts}.json`);
    }

    // ── Build and save the new database ──
    const userCount = Object.keys(owners).length;
    const db = {
        users: owners,
        config: {
            alliedClans: {}
        },
        _metadata: {
            savedAt: new Date().toISOString(),
            userCount,
            version: '2.0',
            recoveredFrom: 'discord-members'
        }
    };

    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');

    // ── Report ──
    console.log('========================================');
    console.log('📊 RECOVERY REPORT');
    console.log('========================================');
    console.log(`✅ Owners registered:        ${userCount}`);
    console.log(`✈️ Pilots linked to owners:  ${linked}`);
    console.log(`⏳ Pilots awaiting owner:    ${stillOrphan}`);
    console.log(`👥 Members with role:        ${roleMembers.length}`);
    if (noNickMembers.length > 0) {
        console.log(`⚠️  With role but no game nickname (registered with Discord username, verify with /manage): ${noNickMembers.length}`);
        for (const m of noNickMembers) console.log(`      - ${m.username} (${m.id})`);
    }
    if (duplicateWarnings.length > 0) {
        console.log('⚠️  Warnings:');
        for (const w of duplicateWarnings.slice(0, 15)) console.log(`      ${w}`);
        if (duplicateWarnings.length > 15) console.log(`      ... and ${duplicateWarnings.length - 15} more`);
    }
    console.log('========================================');
    console.log(`💾 Database saved to ${DB_PATH}`);
    console.log('');
    console.log('📌 NEXT STEPS:');
    console.log('   1. Run !setadminchannel in the admin channel');
    console.log('   2. Run !setwelcome in the welcome channel');
    console.log('   3. Run /forcesync to refresh the ranking cache and role sync');
    console.log('   4. Check with /manage and /checkdb');

    client.destroy();
    process.exit(0);
});

client.login(TOKEN).catch((e) => {
    console.error('❌ Login failed:', e.message);
    process.exit(1);
});
