// ==========================================
// 🎯 ALLIED LIST SCAN — /scanallied
// ==========================================
// Scans a "Nickname,Username" list copied from an allied Discord server and
// registers the members of THIS guild that match one of its lines.
//
// Matching is by Discord username first (usernames are global and unique), then
// by game name (the nickname column with server tags, clan separators and pilot
// markers stripped). The matched name is then resolved against the ranking
// (local cache first, forum search as fallback) and the member role is only
// granted when the clan is one of the allied clans configured in
// /manage → Allied Clans. Registration follows the normal (non-manual) flow.
//
// The command is a dry run unless `apply: true` is passed.

import { AttachmentBuilder } from 'discord.js';
import axios from 'axios';
import { MEMBER_ROLE_ID, ensureConfig } from '../core/ranking-constants.js';
import { cleanNickname, getLocalRankingCache } from '../core/ranking-cache.js';
import { lookupNickname, lookupNicknameWithSearch } from '../core/ranking-service.js';
import { deferReplySafe } from '../core/interaction-utils.js';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
// How many name variations to try per member, and how many of them may hit the
// live forum search (cache lookups are free, forum requests are not).
const MAX_CANDIDATES = 6;
const MAX_FORUM_SEARCH_CANDIDATES = 2;

const HEADER_WORDS = new Set(['nickname', 'nicknames', 'username', 'user', 'nome', 'apelido', 'player', 'name', 'nick']);

const TAG_PREFIX = /^\[[^\]\n]{1,20}\]\s*/;
// "EU021 - Name" / "EU021 | Name" — the nickname format this bot assigns
const SERVER_PREFIX = /^(?:EU|SA|NA|ASIA|BASIA|BNA|BEU|BSA|BINMENA|INMENA)\d{2,3}\s*[-|]\s*/i;
const PILOT_SUFFIX = /\s*[-–—]\s*pilot\s*$/i;
const PILOT_MARKER = /\s*\((?:p|pilot|p[-\s][^)]*)\)\s*/gi;
const NAME_PREFIX = /^(?:name|nick|nickname)\s*:\s*/i;
const STAR_PREFIX = /^\*\s+/;
// Decorative clan suffixes common in MIR4 names ("Arës乂KAL", "Yukiメ", "Powder ツ")
const CLAN_DECORATION = /\s*[メ彡乂亅〆ツ]\S*$/u;
const SEPARATORS = ['•', '・', '·', '∙', '|', '/', '\\', ':', '—', '–', ' - '];

/** Drop a decorative clan suffix from one name variation. */
function stripDecoration(name) {
    return String(name ?? '').replace(CLAN_DECORATION, '').trim();
}

// ==========================================
// 📄 LIST PARSING
// ==========================================

/**
 * Split one list line into fields, honoring quotes. Supports comma, tab and
 * semicolon separated files (the browser copies usually use "a","b" rows).
 */
export function splitListLine(line) {
    let delimiter = null;
    if (line.includes('\t') && !line.includes(',')) delimiter = '\t';
    else if (line.includes(',')) delimiter = ',';
    else if (line.includes(';')) delimiter = ';';
    if (!delimiter) return [line.trim()];

    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            fields.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current);
    return fields.map(f => f.trim());
}

/**
 * Parse the pasted/copied member list into [{ nickname, username }].
 * Header rows ("Nickname,Username") and empty lines are skipped.
 */
export function parseAlliedList(text) {
    const entries = [];
    const seen = new Set();

    for (const rawLine of String(text ?? '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const fields = splitListLine(line);
        const nickname = (fields[0] || '').replace(/^"|"$/g, '').trim();
        const username = (fields[1] || '').replace(/^"|"$/g, '').trim();
        if (!nickname) continue;

        // Header row — e.g. "Nickname,Username"
        const nickWord = nickname.toLowerCase().replace(/[^a-z]/g, '');
        const userWord = username.toLowerCase().replace(/[^a-z]/g, '');
        if (HEADER_WORDS.has(nickWord) && (!username || HEADER_WORDS.has(userWord))) continue;

        const key = `${nickname.toLowerCase()}|${username.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        entries.push({ nickname, username });
    }

    return entries;
}

/** Discord usernames are case-insensitive — normalize for matching. */
export function normalizeUsername(username) {
    return String(username ?? '').trim().replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Game-name variations of a nickname copied from another server, best guess
 * first: the raw value, then without the [XX11] tag / (P) markers, then the part
 * after clan separators ("St • Motion" → "Motion"), then without the decorative
 * clan suffix ("Arës乂KAL" → "Arës").
 */
export function nameCandidates(rawNickname) {
    const out = [];
    const push = (value) => {
        const name = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (!name || name.length > 40) return;
        if (!out.includes(name)) out.push(name);
    };

    const base = String(rawNickname ?? '').trim();
    push(base);

    const stripped = base
        .replace(TAG_PREFIX, '')
        .replace(SERVER_PREFIX, '')
        .replace(NAME_PREFIX, '')
        .replace(STAR_PREFIX, '')
        .replace(PILOT_MARKER, ' ')
        .replace(PILOT_SUFFIX, '')
        .replace(/\s+/g, ' ')
        .trim();
    push(stripped);

    // Splits a decorated name into its segments: "St • Motion" → ["St • Motion", "Motion"]
    const segments = [stripped];
    for (const separator of SEPARATORS) {
        const idx = stripped.lastIndexOf(separator);
        if (idx !== -1) segments.push(stripped.slice(idx + separator.length));
    }

    // "Clan . Name" / "Clan. Name"
    const dotIdx = Math.max(stripped.lastIndexOf(' . '), stripped.lastIndexOf('. '));
    if (dotIdx !== -1) segments.push(stripped.slice(dotIdx + 1));

    for (const segment of segments) {
        push(segment);
        push(stripDecoration(segment));
    }

    return out;
}

/**
 * Index the parsed list for lookups: by Discord username and by cleaned
 * game-name variation.
 */
export function buildListIndex(entries) {
    const byUsername = new Map();
    const byName = new Map();

    for (const entry of entries) {
        const username = normalizeUsername(entry.username);
        if (username && !byUsername.has(username)) byUsername.set(username, entry);

        for (const candidate of nameCandidates(entry.nickname)) {
            const key = cleanNickname(candidate);
            if (key && !byName.has(key)) byName.set(key, entry);
        }
    }

    return { byUsername, byName };
}

/**
 * Find the list entry that belongs to a guild member.
 * Username first (authoritative), then the member's own names.
 */
export function matchMemberToList(member, index) {
    const usernames = [member?.user?.username, member?.user?.tag?.split('#')[0]];
    for (const username of usernames) {
        const key = normalizeUsername(username);
        if (key && index.byUsername.has(key)) {
            return { entry: index.byUsername.get(key), via: 'username' };
        }
    }

    const memberNames = [member?.nickname, member?.user?.globalName, member?.user?.displayName];
    for (const name of memberNames) {
        if (!name) continue;
        for (const candidate of nameCandidates(name)) {
            const key = cleanNickname(candidate);
            if (key && index.byName.has(key)) {
                return { entry: index.byName.get(key), via: 'nickname' };
            }
        }
    }

    return null;
}

// ==========================================
// 🔍 RANKING RESOLUTION
// ==========================================

/**
 * Pick the most trustworthy resolution among cached lookups: an exact match in
 * an allied clan beats a fuzzy allied hit, which beats an exact non-allied hit.
 */
export function chooseResolution(resolutions) {
    if (!resolutions || resolutions.length === 0) return null;
    const preferences = [
        r => r.lookup.inAlliedClan && r.lookup.exactMatch,
        r => r.lookup.inAlliedClan,
        r => r.lookup.exactMatch
    ];
    for (const prefer of preferences) {
        const hit = resolutions.find(prefer);
        if (hit) return hit;
    }
    return resolutions[0];
}

/**
 * Resolve a member's game name against the ranking cache (free, synchronous).
 */
export function resolveInCache(candidates, db, cache) {
    const resolutions = [];
    for (const candidate of candidates) {
        const lookup = lookupNickname(candidate, db, cache);
        if (lookup.found) resolutions.push({ candidate, lookup });
    }
    return resolutions;
}

// ==========================================
// 🎯 COMMAND HANDLER
// ==========================================

/**
 * Handle /scanallied <list> [apply].
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} db - Live ranking database
 * @param {Function} saveLocalStorage - Persist helper
 * @param {Function} logEvent - Logger
 */
export async function handleScanAllied(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferReplySafe(interaction)) return false;

    const attachment = interaction.options.getAttachment('list');
    const apply = interaction.options.getBoolean('apply') === true;

    if (!attachment) return interaction.editReply('❌ Attach the list file (CSV/TXT with "Nickname,Username" lines).');
    if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) {
        return interaction.editReply('❌ File too large (max 2 MB).');
    }

    let text;
    try {
        const { data } = await axios.get(attachment.url, { responseType: 'text', timeout: 20000 });
        text = typeof data === 'string' ? data : JSON.stringify(data);
    } catch (e) {
        return interaction.editReply(`❌ Could not download the attachment: ${e.message}`);
    }

    const entries = parseAlliedList(text);
    if (entries.length === 0) {
        return interaction.editReply('❌ No usable lines found. Expected `Nickname,Username` per line.');
    }

    const guild = interaction.guild;
    if (!guild) return interaction.editReply('❌ This command must be used inside the server.');

    try {
        await guild.members.fetch();
    } catch (err) {
        if (guild.members.cache.size === 0) {
            return interaction.editReply(`❌ Could not fetch guild members: ${err.message}`);
        }
    }

    ensureConfig(db);
    const cache = getLocalRankingCache();
    const index = buildListIndex(entries);
    const matchedEntries = new Set();

    const applied = [];
    const alreadyOk = [];
    const notAllied = [];
    const notFound = [];
    const details = [];

    for (const [, member] of guild.members.cache) {
        if (member.user?.bot) continue;

        const registered = db.users?.[member.id];
        const isRegistered = !!(registered && (registered.nickname || registered.registeredAt || registered.manual));
        const hasRole = member.roles.cache.has(MEMBER_ROLE_ID);

        const match = matchMemberToList(member, index);
        if (!match) {
            if (isRegistered || hasRole) {
                details.push(`➖ ${member.user.username} (${member.nickname || 'sem apelido'}) — fora da lista${hasRole ? ' [TEM CARGO]' : ''}${isRegistered ? ' [tem registro]' : ''}`);
            }
            continue;
        }

        matchedEntries.add(match.entry);

        // Already registered AND wearing the role — leave it untouched.
        if (isRegistered && hasRole) {
            alreadyOk.push({ member, entry: match.entry, via: match.via });
            details.push(`🙋 ${member.user.username} — já registrado + cargo (não mexido)`);
            continue;
        }

        const candidates = [];
        for (const source of [match.entry.nickname, member.nickname, member.user.globalName]) {
            for (const candidate of nameCandidates(source)) {
                if (!candidates.includes(candidate)) candidates.push(candidate);
            }
        }
        const limited = candidates.slice(0, MAX_CANDIDATES);

        let chosen = chooseResolution(resolveInCache(limited, db, cache));

        // Nothing usable in the cache — fall back to the live forum search with
        // the two most likely names only (each request is a live HTTP call).
        if (!chosen) {
            const forumResolutions = [];
            for (const candidate of limited.slice(0, MAX_FORUM_SEARCH_CANDIDATES)) {
                const lookup = await lookupNicknameWithSearch(candidate, db, cache);
                if (lookup.found) forumResolutions.push({ candidate, lookup });
            }
            chosen = chooseResolution(forumResolutions);
        }

        const entryLabel = `"${match.entry.nickname}"${match.entry.username ? ` (@${match.entry.username})` : ''}`;
        const viaLabel = match.via === 'username' ? 'username' : 'apelido/nickname';

        if (!chosen) {
            notFound.push({ member, entry: match.entry });
            details.push(`❌ ${member.user.username} ← ${entryLabel} [${viaLabel}] — não encontrado no ranking`);
            continue;
        }

        if (!chosen.lookup.inAlliedClan) {
            notAllied.push({ member, entry: match.entry, lookup: chosen.lookup });
            details.push(`⏳ ${member.user.username} ← ${entryLabel} [${viaLabel}] → "${chosen.lookup.nickname}" (${chosen.lookup.clanName} @ ${chosen.lookup.serverName}) — clã NÃO aliado`);
            continue;
        }

        const lookup = chosen.lookup;
        const wasRegistered = isRegistered;

        if (apply) {
            if (!wasRegistered) {
                db.users[member.id] = {
                    nickname: lookup.nickname,
                    registeredAt: new Date().toISOString(),
                    serverName: lookup.serverName,
                    clanName: lookup.clanName,
                    worldId: lookup.worldId,
                    pilotIds: [],
                    ...(lookup.fromForumSearch ? { fromForumSearch: true } : {})
                };
            }
            if (!hasRole) {
                await member.roles.add(MEMBER_ROLE_ID).catch(() => {});
            }
        }

        applied.push({ member, entry: match.entry, lookup, via: match.via, wasRegistered, hasRole });
        details.push(`✅ ${member.user.username} ← ${entryLabel} [${viaLabel}] → "${lookup.nickname}" (${lookup.clanName} @ ${lookup.serverName}) — ${wasRegistered ? 'registro mantido, ' : ''}${apply ? (hasRole ? 'cargo já estava' : 'cargo concedido') : 'seria registrado + cargo'}${wasRegistered ? '' : ' (novo registro)'}`);
        logEvent(`🎯 [ScanAllied] ${apply ? 'Applied' : 'DRY RUN'} — ${member.user.tag} ← ${entryLabel} → ${lookup.nickname} (${lookup.clanName} @ ${lookup.serverName})`);
    }

    const listOnly = entries.filter(e => !matchedEntries.has(e));

    if (apply && applied.length > 0) {
        await saveLocalStorage(db);
    }

    const counts = [
        `${apply ? '✅ Aplicado (registro + cargo)' : '✅ Seriam registrados/cargo'}: **${applied.length}**`,
        `🙋 Já tinham registro + cargo: **${alreadyOk.length}**`,
        `⏳ Achados fora de clã aliado: **${notAllied.length}**`,
        `❌ Não encontrados no ranking: **${notFound.length}**`,
        `📄 Entradas da lista sem membro no servidor: **${listOnly.length}**`
    ].join('\n');

    const header = [
        `🎯 **/scanallied** — \`${attachment.name}\``,
        `📋 ${entries.length} entradas na lista • 👥 ${guild.members.cache.size} membros no servidor`,
        apply ? '⚠️ **APLICANDO** alterações' : '🧪 **DRY RUN** — nada foi alterado (rode com `apply: true` para valer)',
        '',
        counts
    ].join('\n');

    const preview = applied.slice(0, 15).map(a =>
        `• ${a.member.user.username} → **${a.lookup.nickname}** (${a.lookup.clanName} @ ${a.lookup.serverName})`
    );

    const content = [
        header,
        preview.length ? `\n**${apply ? 'Registrados' : 'Alvos'} (${applied.length}${applied.length > preview.length ? `, mostrando ${preview.length}` : ''}):**\n${preview.join('\n')}` : '',
        '\n📎 Relatório completo no arquivo anexado.'
    ].filter(Boolean).join('\n');

    const report = [
        `# /scanallied ${apply ? '(APLICADO)' : '(DRY RUN)'}`,
        `Arquivo: ${attachment.name}`,
        `Entradas na lista: ${entries.length}`,
        `Membros no servidor: ${guild.members.cache.size}`,
        `Data: ${new Date().toISOString()}`,
        '',
        '## Resumo',
        counts.replace(/\*\*/g, ''),
        '',
        '## Detalhes',
        ...details,
        '',
        '## Entradas da lista sem membro encontrado no servidor',
        ...(listOnly.length
            ? listOnly.map(e => `- ${e.nickname}${e.username ? ` (@${e.username})` : ''}`)
            : ['- (nenhuma)'])
    ].join('\n');

    const file = new AttachmentBuilder(Buffer.from(report, 'utf8'), { name: `allied-scan-${Date.now()}.txt` });

    await interaction.editReply({ content: content.substring(0, 1990), files: [file] });
    logEvent(`🎯 [ScanAllied] ${apply ? 'applied' : 'dry run'} by ${interaction.user?.tag || 'unknown'} — ${applied.length} matches, ${notAllied.length} non-allied, ${notFound.length} not in ranking`);

    return true;
}
