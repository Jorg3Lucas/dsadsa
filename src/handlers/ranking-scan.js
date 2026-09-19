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
// Pilot markers in the copied nicknames ("Name (P)", "Name (P) Owner",
// "Name (P-owner)", "Name [ᴘ]", "Name Pilot Owner") are detected: when the owner
// can be identified in this guild the member is linked as that owner's pilot
// (same data model as the normal pilot approval); otherwise they are registered
// as a regular member and flagged in the report.
//
// The command is a dry run unless `apply: true` is passed.

import { AttachmentBuilder } from 'discord.js';
import axios from 'axios';
import { MEMBER_ROLE_ID, ensureConfig } from '../core/ranking-constants.js';
import { cleanNickname, getLocalRankingCache } from '../core/ranking-cache.js';
import { lookupNickname, lookupNicknameWithSearch } from '../core/ranking-service.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';
import { deferReplySafe } from '../core/interaction-utils.js';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
// How many name variations to try per member, and how many of them may hit the
// live forum search (cache lookups are free, forum requests are not).
const MAX_CANDIDATES = 6;
const MAX_FORUM_SEARCH_CANDIDATES = 2;
// Same cap the pilot approval flow enforces per owner.
const MAX_PILOTS_PER_OWNER = 4;

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

// ==========================================
// ✈️ PILOT DETECTION
// ==========================================

/**
 * Detect a pilot marker in a nickname copied from another server.
 *
 * Returns { isPilot, characterName, ownerName, marker } where characterName is
 * the name BEFORE the marker (the character shown in the list) and ownerName is
 * the name AFTER it when the entry carries one:
 *
 *   "St • JAY (P-cecilia)"   → character "St • JAY",     owner "cecilia"
 *   "St • Adi (P) Zay"       → character "St • Adi",     owner "Zay"
 *   "mєjєrє Pilot OGUN"      → character "mєjєrє",       owner "OGUN"
 *   "Serious King (P)"       → character "Serious King", owner null
 *   "[EU11] MooN [ᴘ]"        → character "[EU11] MooN",  owner null
 *   "EU021 - Owner - Pilot"  → character "EU021 - Owner", owner null
 */
export function detectPilot(rawNickname) {
    const raw = String(rawNickname ?? '').trim();
    if (!raw) return { isPilot: false, characterName: raw, ownerName: null, marker: null };

    // "… - Pilot" — the suffix this bot itself assigns to registered pilots
    if (PILOT_SUFFIX.test(raw)) {
        return {
            isPilot: true,
            characterName: raw.replace(PILOT_SUFFIX, '').trim(),
            ownerName: null,
            marker: 'pilot-suffix'
        };
    }

    // "(P-owner)" / "[P-owner]"
    let match = raw.match(/[([\s]*[pᴘ]\s*[-–—]\s*([^)\]]+)\s*[)\]]/iu);
    if (match) {
        return {
            isPilot: true,
            characterName: raw.slice(0, match.index).trim(),
            ownerName: match[1].trim() || null,
            marker: match[0].trim()
        };
    }

    // "(P)" / "(Pilot)" / "[ᴘ]" — the owner may follow the marker
    match = raw.match(/[([]\s*(?:p|pilot|ᴘ)\s*[)\]]/iu);
    if (match) {
        const after = raw.slice(match.index + match[0].length).replace(/^[\s\-–—/|:]+/, '').trim();
        return {
            isPilot: true,
            characterName: raw.slice(0, match.index).trim(),
            ownerName: after || null,
            marker: match[0].trim()
        };
    }

    // "Name Pilot Owner" / "Name Pilot"
    match = raw.match(/\s+pilot\b\s*(.*)$/i);
    if (match) {
        const after = match[1].replace(/^[\s\-–—/|:]+/, '').trim();
        return {
            isPilot: true,
            characterName: raw.slice(0, match.index).trim(),
            ownerName: after || null,
            marker: 'Pilot'
        };
    }

    return { isPilot: false, characterName: raw, ownerName: null, marker: null };
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

/** Member ids that are already registered as someone's pilot. */
function buildPilotIdSet(db) {
    const ids = new Set();
    for (const data of Object.values(db?.users || {})) {
        for (const pilotId of data?.pilotIds || []) ids.add(pilotId);
    }
    return ids;
}

/**
 * Map cleaned nickname → guild member id for everyone that can act as an owner:
 * registered members (minus those already flagged as pilots) and the owners
 * matched in this run.
 */
function buildOwnerIndex(db, guild) {
    const map = new Map();
    const pilotIds = buildPilotIdSet(db);

    const add = (name, memberId) => {
        for (const candidate of nameCandidates(name)) {
            const key = cleanNickname(candidate);
            if (key && key.length >= 2 && !map.has(key)) map.set(key, memberId);
        }
    };

    for (const [id, data] of Object.entries(db?.users || {})) {
        if (!data?.nickname || pilotIds.has(id)) continue;
        if (!guild.members.cache.has(id)) continue;
        add(data.nickname, id);
    }

    return map;
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

/**
 * Cache first, then a live forum search with the two most likely names only
 * (each request is a live HTTP call).
 */
async function resolveAllied(candidates, db, cache) {
    const limited = (candidates || []).slice(0, MAX_CANDIDATES);
    const cached = chooseResolution(resolveInCache(limited, db, cache));
    if (cached) return cached;

    const forumResolutions = [];
    for (const candidate of limited.slice(0, MAX_FORUM_SEARCH_CANDIDATES)) {
        const lookup = await lookupNicknameWithSearch(candidate, db, cache);
        if (lookup.found) forumResolutions.push({ candidate, lookup });
    }
    return chooseResolution(forumResolutions);
}

/** Name variations to look up for a list entry / member pair. */
function candidatesFor(entryNickname, member, extraNames = []) {
    const out = [];
    for (const source of [entryNickname, member.nickname, member.user?.globalName, ...extraNames]) {
        for (const candidate of nameCandidates(source)) {
            if (!out.includes(candidate)) out.push(candidate);
        }
    }
    return out;
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

    const registered = [];       // registered as a regular member (or role restored)
    const linkedPilots = [];     // linked to a registered owner
    const unlinkedPilots = [];   // pilot marker found, owner not identified
    const alreadyOk = [];
    const notAllied = [];
    const notFound = [];
    const details = [];

    // ── 1st pass: match members to list entries and classify them ──
    // Pilots are processed after the regular entries so an owner that is only in
    // the list gets registered first and can be linked in the same run.
    const owners = [];
    const pilots = [];

    for (const [, member] of guild.members.cache) {
        if (member.user?.bot) continue;

        const registeredUser = db.users?.[member.id];
        const isRegistered = !!(registeredUser && (registeredUser.nickname || registeredUser.registeredAt || registeredUser.manual));
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

        const entryPilot = detectPilot(match.entry.nickname);
        const memberPilot = detectPilot(member.nickname || '');
        const item = {
            member,
            entry: match.entry,
            via: match.via,
            isRegistered,
            hasRole,
            isPilot: entryPilot.isPilot || memberPilot.isPilot,
            ownerName: entryPilot.ownerName || memberPilot.ownerName || null,
            characterName: (entryPilot.isPilot ? entryPilot.characterName : '') || (memberPilot.isPilot ? memberPilot.characterName : '') || match.entry.nickname
        };

        if (item.isPilot) pilots.push(item);
        else owners.push(item);
    }

    const ownerIndex = buildOwnerIndex(db, guild);
    const existingPilotIds = buildPilotIdSet(db);

    const entryLabelOf = item => `"${item.entry.nickname}"${item.entry.username ? ` (@${item.entry.username})` : ''}`;
    const viaLabelOf = item => (item.via === 'username' ? 'username' : 'apelido/nickname');

    /** Store a normal (non-manual) registration for an allied lookup. */
    const registerMember = (item, lookup, note = '') => {
        const { member } = item;
        if (apply) {
            if (!item.isRegistered) {
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
            if (!item.hasRole) {
                member.roles.add(MEMBER_ROLE_ID).catch(() => {});
            }
        }

        registered.push({ member, entry: item.entry, lookup, via: item.via });
        details.push(`✅ ${member.user.username} ← ${entryLabelOf(item)} [${viaLabelOf(item)}] → "${lookup.nickname}" (${lookup.clanName} @ ${lookup.serverName}) — ${item.isRegistered ? 'registro mantido, ' : ''}${apply ? (item.hasRole ? 'cargo já estava' : 'cargo concedido') : 'seria registrado + cargo'}${note}`);
        logEvent(`🎯 [ScanAllied] ${apply ? 'Applied' : 'DRY RUN'} — ${member.user.tag} ← ${entryLabelOf(item)} → ${lookup.nickname} (${lookup.clanName} @ ${lookup.serverName})${note}`);

        // A newly registered owner becomes linkable for the pilot pass
        if (!item.isPilot) {
            for (const candidate of nameCandidates(lookup.nickname)) {
                const key = cleanNickname(candidate);
                if (key && key.length >= 2 && !ownerIndex.has(key)) ownerIndex.set(key, member.id);
            }
        }
    };

    // ── Regular members ──
    for (const item of owners) {
        const chosen = await resolveAllied(candidatesFor(item.entry.nickname, item.member), db, cache);

        if (!chosen) {
            notFound.push({ member: item.member, entry: item.entry });
            details.push(`❌ ${item.member.user.username} ← ${entryLabelOf(item)} [${viaLabelOf(item)}] — não encontrado no ranking`);
            continue;
        }
        if (!chosen.lookup.inAlliedClan) {
            notAllied.push({ member: item.member, entry: item.entry, lookup: chosen.lookup });
            details.push(`⏳ ${item.member.user.username} ← ${entryLabelOf(item)} [${viaLabelOf(item)}] → "${chosen.lookup.nickname}" (${chosen.lookup.clanName} @ ${chosen.lookup.serverName}) — clã NÃO aliado`);
            continue;
        }

        registerMember(item, chosen.lookup);
    }

    // ── Pilots ──
    for (const item of pilots) {
        const { member } = item;

        // Already someone's pilot — the bot manages that link, leave it alone.
        if (existingPilotIds.has(member.id)) {
            alreadyOk.push({ member, entry: item.entry, via: item.via });
            details.push(`🙋 ${member.user.username} — já registrado como piloto (não mexido)`);
            continue;
        }

        const ownerId = item.ownerName ? ownerIndex.get(cleanNickname(item.ownerName)) : null;
        const ownerMember = ownerId ? guild.members.cache.get(ownerId) : null;
        const ownerData = ownerId ? db.users?.[ownerId] : null;

        // Preferred path: the pilot is validated through their owner, exactly like
        // the normal pilot approval (owner holds the pilotIds entry + nickname).
        if (ownerMember && ownerData) {
            const ownerResolution = await resolveAllied(candidatesFor(item.ownerName, ownerMember), db, cache);

            if (ownerResolution && ownerResolution.lookup.inAlliedClan) {
                const ownerPilots = ownerData.pilotIds || (ownerData.pilotIds = []);
                if (ownerPilots.includes(member.id)) {
                    alreadyOk.push({ member, entry: item.entry, via: item.via });
                    details.push(`🙋 ${member.user.username} — já era piloto de "${ownerData.nickname}" (não mexido)`);
                    continue;
                }
                if (ownerPilots.length >= MAX_PILOTS_PER_OWNER) {
                    unlinkedPilots.push({ member, entry: item.entry, ownerNickname: ownerData.nickname, reason: 'owner cheio' });
                    details.push(`✈️ ${member.user.username} ← ${entryLabelOf(item)} — piloto de "${ownerData.nickname}", mas o dono já tem ${MAX_PILOTS_PER_OWNER} pilotos — NÃO vinculado`);
                    continue;
                }

                const desiredNickname = buildPrefixedNickname(ownerData.nickname, db, 'Pilot', ownerResolution.lookup);
                if (apply) {
                    ownerPilots.push(member.id);
                    if (!item.hasRole) member.roles.add(MEMBER_ROLE_ID).catch(() => {});
                    member.setNickname(desiredNickname).catch(() => {});
                }

                linkedPilots.push({ member, entry: item.entry, ownerNickname: ownerData.nickname, via: item.via });
                details.push(`✈️ ${member.user.username} ← ${entryLabelOf(item)} [${viaLabelOf(item)}] → piloto de "${ownerData.nickname}" (${ownerResolution.lookup.clanName} @ ${ownerResolution.lookup.serverName}) — ${apply ? `vinculado, apelido "${desiredNickname}"` : `seria vinculado, apelido "${desiredNickname}"`}`);
                logEvent(`🎯 [ScanAllied] ${apply ? 'Applied' : 'DRY RUN'} — pilot ${member.user.tag} linked to owner ${ownerData.nickname}`);
                continue;
            }
        }

        // Fallback: owner unknown here — register the pilot in their own right and
        // flag it so an admin can link them with /manualpilot.
        const ownResolution = await resolveAllied(candidatesFor(item.characterName, member, [item.entry.nickname]), db, cache);

        if (!ownResolution) {
            notFound.push({ member, entry: item.entry });
            details.push(`✈️ ${member.user.username} ← ${entryLabelOf(item)} [${viaLabelOf(item)}] — piloto${item.ownerName ? ` (dono "${item.ownerName}" não identificado no servidor)` : ''} e não encontrado no ranking`);
            continue;
        }
        if (!ownResolution.lookup.inAlliedClan) {
            notAllied.push({ member, entry: item.entry, lookup: ownResolution.lookup });
            details.push(`✈️ ${member.user.username} ← ${entryLabelOf(item)} → "${ownResolution.lookup.nickname}" (${ownResolution.lookup.clanName} @ ${ownResolution.lookup.serverName}) — piloto, clã NÃO aliado`);
            continue;
        }

        const ownerNote = item.ownerName
            ? ` (piloto detectado — dono "${item.ownerName}" não identificado, use /manualpilot)`
            : ' (piloto detectado — sem dono na lista, use /manualpilot)';
        unlinkedPilots.push({ member, entry: item.entry, ownerNickname: item.ownerName, reason: 'dono não identificado' });
        registerMember(item, ownResolution.lookup, ownerNote);
    }

    const listOnly = entries.filter(e => !matchedEntries.has(e));
    const listOnlyPilots = listOnly.filter(e => detectPilot(e.nickname).isPilot);

    if (apply && (registered.length > 0 || linkedPilots.length > 0)) {
        await saveLocalStorage(db);
    }

    const counts = [
        `${apply ? '✅ Aplicado (registro + cargo)' : '✅ Seriam registrados/cargo'}: **${registered.length}**`,
        `✈️ ${apply ? 'Vinculados como piloto' : 'Seriam vinculados como piloto'}: **${linkedPilots.length}**`,
        `✈️ Pilotos detectados sem dono identificado: **${unlinkedPilots.length}**`,
        `🙋 Já tinham registro + cargo: **${alreadyOk.length}**`,
        `⏳ Achados fora de clã aliado: **${notAllied.length}**`,
        `❌ Não encontrados no ranking: **${notFound.length}**`,
        `📄 Entradas da lista sem membro no servidor: **${listOnly.length}**${listOnlyPilots.length ? ` (${listOnlyPilots.length} com marca de piloto)` : ''}`
    ].join('\n');

    const header = [
        `🎯 **/scanallied** — \`${attachment.name}\``,
        `📋 ${entries.length} entradas na lista • 👥 ${guild.members.cache.size} membros no servidor`,
        apply ? '⚠️ **APLICANDO** alterações' : '🧪 **DRY RUN** — nada foi alterado (rode com `apply: true` para valer)',
        '',
        counts
    ].join('\n');

    const preview = [
        ...linkedPilots.map(p => `✈️ ${p.member.user.username} → piloto de **${p.ownerNickname}**`),
        ...registered.slice(0, 15 - Math.min(linkedPilots.length, 15)).map(r =>
            `• ${r.member.user.username} → **${r.lookup.nickname}** (${r.lookup.clanName} @ ${r.lookup.serverName})`
        )
    ].slice(0, 15);

    const totalApplied = registered.length + linkedPilots.length;
    const content = [
        header,
        preview.length ? `\n**${apply ? 'Aplicados' : 'Alvos'} (${totalApplied}${totalApplied > preview.length ? `, mostrando ${preview.length}` : ''}):**\n${preview.join('\n')}` : '',
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
            ? listOnly.map(e => `- ${e.nickname}${e.username ? ` (@${e.username})` : ''}${detectPilot(e.nickname).isPilot ? ' ✈️ piloto' : ''}`)
            : ['- (nenhuma)'])
    ].join('\n');

    const file = new AttachmentBuilder(Buffer.from(report, 'utf8'), { name: `allied-scan-${Date.now()}.txt` });

    await interaction.editReply({ content: content.substring(0, 1990), files: [file] });
    logEvent(`🎯 [ScanAllied] ${apply ? 'applied' : 'dry run'} by ${interaction.user?.tag || 'unknown'} — ${registered.length} registered, ${linkedPilots.length} pilots linked, ${notAllied.length} non-allied, ${notFound.length} not in ranking`);

    return true;
}
