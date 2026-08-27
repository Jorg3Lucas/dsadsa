#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// 🎯 Auto-Register Channel Members
// Scans a Discord channel, reads nicknames, looks up in
// ranking cache, and registers allied-clan members.
// ═══════════════════════════════════════════════════════════

import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import 'dotenv/config';
import { loadLocalStorageRanking, saveRankingStorage } from './src/core/ranking-storage.js';
import { isAlliedClanName } from './src/core/ranking-service.js';
import { WORLD_IDS } from './src/core/ranking-constants.js';
import { getLocalRankingCache, findAllNicknameMatchesInCache } from './src/core/ranking-cache.js';
import { DISCORD_SERVER_ID, MEMBER_ROLE_ID, ensureConfig } from './src/core/ranking-constants.js';
import { logRankingEvent } from './src/core/ranking-logger.js';

const TARGET_CHANNEL_ID = '1541444219787411538';

// ── Load database ──
const db = loadLocalStorageRanking();
ensureConfig(db);

// ── Load ranking cache ──
const cache = getLocalRankingCache();
if (!cache || Object.keys(cache).length === 0) {
    console.error('❌ Ranking cache not found. Run /forcesync first.');
    process.exit(1);
}
console.log(`📊 Ranking cache: ${Object.keys(cache).length} worlds loaded`);

const alliedClans = db.config?.alliedClans || {};
const save = () => saveRankingStorage(db);

// ── Discord client ──
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ── Extract game nickname from Discord nickname ──
function extractGameNickname(discordNickname) {
    if (!discordNickname) return { serverCode: null, gameNickname: null };

    let nick = discordNickname.trim();

    // Remove " - Pilot" suffix
    nick = nick.replace(/\s*-\s*Pilot$/i, '').trim();
    // Remove "* " prefix
    nick = nick.replace(/^\*\s+/, '').trim();
    // Remove "Name: " prefix
    nick = nick.replace(/^Name:\s*/i, '').trim();

    // "EU021 - GameName" or "EU021 | GameName"
    const m1 = nick.match(/^(EU|SA|NA|ASIA|BASIA|BNA|BEU|BSA|BINMENA|INMENA)(\d{3})\s*[-|]\s*(.+)$/i);
    if (m1) return { serverCode: m1[1].toUpperCase() + m1[2], gameNickname: m1[3].trim() };

    // "EU021 GameName" (no separator)
    const m2 = nick.match(/^(EU|SA|NA|ASIA|BASIA|BNA|BEU|BSA|BINMENA|INMENA)(\d{3})\s+(.+)$/i);
    if (m2) return { serverCode: m2[1].toUpperCase() + m2[2], gameNickname: m2[3].trim() };

    // No server prefix — use whole thing
    return { serverCode: null, gameNickname: nick };
}

// ── Main ──
client.once('ready', async () => {
    console.log(`🤖 Bot: ${client.user.tag}\n`);

    const guild = await client.guilds.fetch(DISCORD_SERVER_ID);
    const channel = await guild.channels.fetch(TARGET_CHANNEL_ID);
    if (!channel) { console.error('❌ Channel not found'); process.exit(1); }

    console.log(`📋 Channel: ${channel.name}`);
    await guild.members.fetch();
    console.log(`👥 Total guild members: ${guild.members.cache.size}\n`);

    // Members who can see the channel
    const membersWithAccess = [];
    for (const [, member] of guild.members.cache) {
        try {
            const perms = channel.permissionsFor(member);
            if (perms && perms.has(PermissionFlagsBits.ViewChannel)) {
                membersWithAccess.push(member);
            }
        } catch {}
    }
    console.log(`👁️  Members with access: ${membersWithAccess.length}\n`);

    const registered = [];
    const skippedNotAllied = [];
    const skippedNoRole = [];
    const notFound = [];

    for (const member of membersWithAccess) {
        // Already has role — skip
        if (member.roles.cache.has(MEMBER_ROLE_ID)) {
            skippedNoRole.push(member);
            continue;
        }

        const discordNick = member.nickname || member.user.username;
        const { gameNickname } = extractGameNickname(discordNick);

        // Exact match only — no fuzzy
        const exactMatches = findAllNicknameMatchesInCache(gameNickname, cache);

        if (exactMatches.length > 0) {
            const match = exactMatches[0];
            const inAlliedClan = isAlliedClanName(match.clanName, alliedClans[match.worldId]);
            const serverName = WORLD_IDS[match.worldId] || `World ${match.worldId}`;

            if (inAlliedClan) {
                // ✅ Register
                db.users[member.id] = {
                    nickname: match.nickname,
                    registeredAt: new Date().toISOString(),
                    serverName,
                    clanName: match.clanName,
                    worldId: match.worldId,
                    pilotIds: []
                };
                await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                registered.push({
                    username: member.user.username,
                    nickname: match.nickname,
                    server: serverName,
                    clan: match.clanName
                });
                logRankingEvent(`🎯 Auto-registered ${member.user.tag} → ${match.nickname} (${match.clanName} @ ${serverName})`);
            } else {
                skippedNotAllied.push({
                    username: member.user.username,
                    nickname: match.nickname,
                    clan: match.clanName
                });
            }
        } else {
            notFound.push({
                username: member.user.username,
                nickname: gameNickname
            });
        }
    }

    // Save database
    if (registered.length > 0) {
        save();
        console.log(`💾 Database saved (${registered.length} new registrations)\n`);
    }

    // ── Report ──
    console.log('══════════════════════════════════════════════');
    console.log('  📊 RESULTS');
    console.log('══════════════════════════════════════════════');

    console.log(`\n  ✅ REGISTERED (${registered.length}):`);
    for (const r of registered) {
        console.log(`     ${r.username} → ${r.nickname} (${r.clan} @ ${r.server})`);
    }

    console.log(`\n  ⏳ SKIPPED — already has role (${skippedNoRole.length})`);

    console.log(`\n  ⏳ SKIPPED — not allied (${skippedNotAllied.length}):`);
    for (const s of skippedNotAllied) {
        console.log(`     ${s.username} → ${s.nickname} (${s.clan})`);
    }

    console.log(`\n  ❌ NOT FOUND IN RANKING (${notFound.length}):`);
    for (const n of notFound) {
        console.log(`     ${n.username} → ${n.nickname}`);
    }

    console.log('\n══════════════════════════════════════════════');
    process.exit(0);
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
