// ==========================================
// ✈️ /pilotbulk — RESOLVE PENDING PILOTS IN BULK
// ==========================================
// /scanallied detects pilots from the copied nicknames. When the owner cannot be
// identified during the scan, the pilot is registered as a regular member and
// queued in db.scanPilotPending. This command drains that queue: for every queued
// pilot it looks up the owner name from the list among the registered members and
// links the pair — exactly what /manualpilot does, but in bulk.
//
//   /pilotbulk                → preview (dry run): who would be linked to whom
//   /pilotbulk apply:true     → links every pilot whose owner is unambiguous
//   /pilotbulk owner:@X apply:true → links every queued pilot to @X (cap of 4)
//
// Ambiguous entries (several owners with a similar name, or no owner name in the
// list) are left in the queue and reported so an admin can settle them with
// /manualpilot.

import { ActionRowBuilder, AttachmentBuilder, StringSelectMenuBuilder } from 'discord.js';
import { MEMBER_ROLE_ID, MAX_PILOTS_PER_OWNER } from '../core/ranking-constants.js';
import { cleanNickname } from '../core/ranking-cache.js';
import { buildPrefixedNickname, assignMemberRole, refreshRoleChannelAccess, setMemberNickname } from '../core/ranking-utils.js';
import { findOwnerCandidates } from './ranking-pilot.js';
import { deferReplySafe, deferUpdateSafe } from '../core/interaction-utils.js';

// Entries older than this are dropped from the queue (they are stale data).
const PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A fuzzy owner must be a single, quite similar candidate to be linked unattended.
const AUTO_OWNER_MIN_SCORE = 0.75;

/** Member ids that are already registered as someone's pilot. */
function buildPilotIdSet(db) {
    const ids = new Set();
    for (const data of Object.values(db?.users || {})) {
        for (const pilotId of data?.pilotIds || []) ids.add(pilotId);
    }
    return ids;
}

const MAX_OWNER_OPTIONS = 10;
const MAX_SELECT_ROWS = 5;

/** Read a value from a select option, which may be a builder or raw API data. */
function optionField(option, field) {
    return (option?.data ?? option ?? {})[field];
}

/**
 * Read a select property. discord.js message components come back as builders,
 * which keep everything inside `.data` (raw API naming), so both shapes are read.
 */
function selectField(select, field) {
    return select?.data?.[field] ?? select?.[field];
}

/**
 * One select menu per ambiguous pilot, so an admin can settle them inline
 * without running /manualpilot for each pair. Discord caps a message at 5 rows,
 * so the first five resolvable entries get a picker.
 */
function buildAmbiguousRows(ambiguous) {
    const rows = [];

    for (const item of ambiguous) {
        if (rows.length >= MAX_SELECT_ROWS) break;

        const seen = new Set();
        const options = [];
        for (const candidate of item.candidates || []) {
            if (!candidate?.id || seen.has(candidate.id)) continue;
            seen.add(candidate.id);
            options.push({
                label: String(candidate.nickname || candidate.id).substring(0, 100),
                value: candidate.id,
                description: `${Math.round((candidate.score || 0) * 100)}% parecido com "${item.info?.ownerName || '—'}"`.substring(0, 100)
            });
            if (options.length >= MAX_OWNER_OPTIONS) break;
        }
        if (options.length === 0) continue;

        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`pilotbulk_owner_${item.pilotId}`)
                .setPlaceholder(`Owner of ${item.member.user.username}${item.info?.ownerName ? ` (suggested: ${item.info.ownerName})` : ''}`.substring(0, 100))
                .addOptions(options)
        ));
    }

    return rows;
}

/** Strip the trailing hint lines before appending a new one. */
function stripTrailingHints(content) {
    return String(content || '').replace(/\n*(?:🧩|📎)[^\n]*/g, '').trimEnd();
}

/**
 * Handle /pilotbulk [owner] [apply].
 */
export async function handlePilotBulk(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferReplySafe(interaction)) return false;

    const apply = interaction.options.getBoolean('apply') === true;
    const forcedOwner = interaction.options.getMember('owner') || null;

    const guild = interaction.guild;
    if (!guild) return interaction.editReply('❌ This command must be used inside the server.');

    if (forcedOwner && !db.users?.[forcedOwner.id]) {
        return interaction.editReply(`❌ **${forcedOwner.displayName}** has no registration — register with \`/manualregister\` or \`/manualforce\` first.`);
    }

    const pending = (db.scanPilotPending && typeof db.scanPilotPending === 'object') ? db.scanPilotPending : {};
    const queuedTotal = Object.keys(pending).length;
    if (queuedTotal === 0) {
        return interaction.editReply('📭 **Queue empty.** Run `/scanallied <list> apply:true` first — pilots it detects but cannot link are added to this queue.');
    }

    const existingPilotIds = buildPilotIdSet(db);
    const ownerOfPilot = new Map();
    for (const [ownerId, data] of Object.entries(db.users || {})) {
        for (const pilotId of data?.pilotIds || []) ownerOfPilot.set(pilotId, ownerId);
    }

    const ready = [];       // { pilotId, member, info, ownerId, ownerNickname, confidence }
    const ambiguous = [];   // { pilotId, member, info, candidates }
    const noOwner = [];     // { pilotId, member, info }
    const stale = [];       // { pilotId, info, reason }

    for (const pilotId of Object.keys(pending)) {
        const info = pending[pilotId] || {};
        const createdAt = info.createdAt ? Date.parse(info.createdAt) : 0;

        if (createdAt && Date.now() - createdAt > PENDING_MAX_AGE_MS) {
            stale.push({ pilotId, info, reason: 'queue expired (> 30 days)' });
            continue;
        }
        if (ownerOfPilot.has(pilotId)) {
            stale.push({ pilotId, info, reason: `already linked (owner ${db.users?.[ownerOfPilot.get(pilotId)]?.nickname || ownerOfPilot.get(pilotId)})` });
            continue;
        }

        const member = guild.members.cache.get(pilotId) || await guild.members.fetch(pilotId).catch(() => null);
        if (!member) {
            stale.push({ pilotId, info, reason: 'no longer in the server' });
            continue;
        }

        // Explicit owner override — link everything to that owner (cap enforced below).
        if (forcedOwner) {
            ready.push({
                pilotId,
                member,
                info,
                ownerId: forcedOwner.id,
                ownerNickname: db.users[forcedOwner.id].nickname,
                confidence: 'owner provided'
            });
            continue;
        }

        if (!info.ownerName) {
            noOwner.push({ pilotId, member, info });
            continue;
        }

        // 1) Exact registered-nickname match (minus members that are pilots themselves).
        const cleanedOwner = cleanNickname(info.ownerName);
        const exact = Object.entries(db.users || {}).filter(([id, data]) =>
            id !== pilotId &&
            data?.nickname &&
            !existingPilotIds.has(id) &&
            guild.members.cache.has(id) &&
            cleanNickname(data.nickname) === cleanedOwner
        );

        if (exact.length === 1) {
            ready.push({
                pilotId,
                member,
                info,
                ownerId: exact[0][0],
                ownerNickname: exact[0][1].nickname,
                confidence: 'nome exato'
            });
            continue;
        }
        if (exact.length > 1) {
            ambiguous.push({
                pilotId,
                member,
                info,
                candidates: exact.map(([id, data]) => ({ id, nickname: data.nickname, score: 1 }))
            });
            continue;
        }

        // 2) A single, close fuzzy candidate.
        const candidates = findOwnerCandidates(info.ownerName, db, 3)
            .filter(c => c.id !== pilotId && guild.members.cache.has(c.id));
        if (candidates.length === 1 && candidates[0].score >= AUTO_OWNER_MIN_SCORE) {
            ready.push({
                pilotId,
                member,
                info,
                ownerId: candidates[0].id,
                ownerNickname: candidates[0].nickname,
                confidence: `nome parecido (${Math.round(candidates[0].score * 100)}%)`
            });
            continue;
        }

        ambiguous.push({ pilotId, member, info, candidates });
    }

    const linked = [];
    const ownerFull = [];
    const roleWrites = [];   // pending role grants — awaited before the channel refresh

    for (const entry of ready) {
        const ownerData = db.users?.[entry.ownerId];
        if (!ownerData) {
            stale.push({ pilotId: entry.pilotId, info: entry.info, reason: 'the owner no longer has a registration' });
            continue;
        }
        const ownerPilots = ownerData.pilotIds || (ownerData.pilotIds = []);
        if (ownerPilots.includes(entry.pilotId)) {
            stale.push({ pilotId: entry.pilotId, info: entry.info, reason: 'already linked' });
            continue;
        }
        if (ownerPilots.length >= MAX_PILOTS_PER_OWNER) {
            ownerFull.push({ ...entry, ownerNickname: ownerData.nickname });
            continue;
        }

        if (apply) {
            ownerPilots.push(entry.pilotId);
            const desiredNickname = buildPrefixedNickname(ownerData.nickname, db, 'Pilot');
            if (!entry.member.roles.cache.has(MEMBER_ROLE_ID)) {
                roleWrites.push(assignMemberRole(entry.member, logEvent, guild, { refreshChannels: false, reapplyRole: false }));
            }
            setMemberNickname(entry.member, desiredNickname, logEvent);
            delete pending[entry.pilotId];
            linked.push({ ...entry, ownerNickname: ownerData.nickname, desiredNickname });
            logEvent(`✈️ [PilotBulk] Linked pilot ${entry.member.user.tag} → owner ${ownerData.nickname} (${entry.confidence})`);
        } else {
            linked.push({ ...entry, ownerNickname: ownerData.nickname });
        }
    }

    // Let every role grant land first, then re-emit the Member role's channel
    // overwrites ONCE (not per member) so the linked pilots see the newly unlocked
    // channels immediately.
    if (roleWrites.length > 0) {
        await Promise.allSettled(roleWrites);
        await refreshRoleChannelAccess(guild, logEvent);
    }

    if (apply) {
        for (const item of stale) delete pending[item.pilotId];
        if (Object.keys(pending).length === 0) delete db.scanPilotPending;
        await saveLocalStorage(db);
    }

    const counts = [
        `📋 Pilots in queue: **${queuedTotal}**${apply ? ` (**${Object.keys(pending).length}** left)` : ''}`,
        `${apply ? '✅ Linked' : '✅ Would be linked'}: **${linked.length}**`,
        `🤔 Ambiguous (resolve with \`/manualpilot\`): **${ambiguous.length}**`,
        `🚫 No owner in the list: **${noOwner.length}**`,
        `⛔ Owner already at ${MAX_PILOTS_PER_OWNER} pilots: **${ownerFull.length}**`,
        `🗑️ Dropped from the queue: **${stale.length}**${apply ? '' : ' (only applied with `apply:true`)'}`
    ].join('\n');

    const details = [
        ...linked.map(l => `${apply ? '✅' : '➡️'} <@${l.pilotId}> (${l.member.user.username}) → owner **${l.ownerNickname}** [${l.confidence}]${l.desiredNickname ? ` — nickname "${l.desiredNickname}"` : ''}`),
        ...ambiguous.map(a => `🤔 <@${a.pilotId}> (${a.member.user.username}) — suggested owner "${a.info.ownerName || '—'}"${a.candidates?.length ? `: ${a.candidates.map(c => `"${c.nickname}" (${Math.round((c.score || 0) * 100)}%)`).join(', ')}` : ' (no candidate)'} — use \`/manualpilot\``),
        ...noOwner.map(n => `🚫 <@${n.pilotId}> (${n.member.user.username}) — pilot with no owner in the list (${n.info.marker ? `marker "${n.info.marker}"` : 'no marker'}) — use \`/manualpilot\``),
        ...ownerFull.map(f => `⛔ <@${f.pilotId}> (${f.member.user.username}) — owner "${f.ownerNickname}" already has ${MAX_PILOTS_PER_OWNER} pilots`),
        ...stale.map(s => `🗑️ <@${s.pilotId}> — ${s.reason}`)
    ];

    const header = [
        '✈️ **/pilotbulk**' + (forcedOwner ? ` — forced owner: **${forcedOwner.displayName}**` : ''),
        apply ? '⚠️ **APPLYING** the links' : '🧪 **DRY RUN** — nothing was changed (run with `apply: true`)',
        '',
        counts
    ].join('\n');

    const rows = buildAmbiguousRows(ambiguous);

    const preview = details.slice(0, 15);
    const content = [
        header,
        preview.length ? `\n${preview.join('\n')}` : '\nℹ️ Nothing to do.',
        details.length > preview.length ? `\n📎 ${details.length - preview.length} more line(s) in the attachment.` : '\n📎 Full report in the attached file.',
        rows.length ? `\n🧩 Choose the owner for ${rows.length} ambiguous pilot(s) in the menus below.` : ''
    ].filter(Boolean).join('\n');

    const report = [
        `# /pilotbulk ${apply ? '(APPLIED)' : '(DRY RUN)'}`,
        `Forced owner: ${forcedOwner ? `${forcedOwner.user.username} (${db.users[forcedOwner.id]?.nickname})` : 'no'}`,
        `Date: ${new Date().toISOString()}`,
        '',
        '## Summary',
        counts.replace(/\*\*/g, '').replace(/`/g, ''),
        '',
        '## Details',
        ...(details.length ? details : ['- (nothing in the queue)']),
        '',
        '## Remaining queue',
        ...(Object.keys(pending).length
            ? Object.entries(pending).map(([id, info]) => `- ${id} — "${info.characterName}" owner "${info.ownerName || '—'}" [${info.reason || 'pending'}]`)
            : ['- (empty)'])
    ].join('\n');

    const file = new AttachmentBuilder(Buffer.from(report, 'utf8'), { name: `pilotbulk-${Date.now()}.txt` });
    await interaction.editReply({ content: content.substring(0, 1990), components: rows, files: [file] });

    logEvent(`✈️ [PilotBulk] ${apply ? 'applied' : 'dry run'} by ${interaction.user?.tag || 'unknown'} — ${linked.length} linked, ${ambiguous.length} ambiguous, ${noOwner.length} without owner, ${stale.length} dropped`);

    return true;
}

// ==========================================
// 🧩 INLINE OWNER PICKER (ambiguous pilots)
// ==========================================

/**
 * Handle the owner picker attached to a /pilotbulk report: links the chosen pair
 * exactly like /manualpilot (pilotIds + "<Owner> - Pilot" nickname + member
 * role), drops the pilot from the queue and keeps the remaining pickers open.
 */
export async function handlePilotBulkSelect(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferUpdateSafe(interaction)) return false;

    const pilotId = interaction.customId.replace('pilotbulk_owner_', '');
    const ownerId = interaction.values?.[0];
    const ownerData = ownerId ? db.users?.[ownerId] : null;

    if (!ownerData) {
        await interaction.followUp({ content: '❌ That owner no longer has a registration — run `/pilotbulk` again.', flags: 64 }).catch(() => {});
        return false;
    }

    const ownerPilots = ownerData.pilotIds || (ownerData.pilotIds = []);
    if (!ownerPilots.includes(pilotId) && ownerPilots.length >= MAX_PILOTS_PER_OWNER) {
        await interaction.followUp({ content: `❌ **${ownerData.nickname}** already has ${MAX_PILOTS_PER_OWNER} pilots.`, flags: 64 }).catch(() => {});
        return false;
    }

    if (!ownerPilots.includes(pilotId)) ownerPilots.push(pilotId);

    const pending = db.scanPilotPending?.[pilotId] || null;
    if (pending) {
        delete db.scanPilotPending[pilotId];
        if (Object.keys(db.scanPilotPending).length === 0) delete db.scanPilotPending;
    }

    const desiredNickname = buildPrefixedNickname(ownerData.nickname, db, 'Pilot');
    const pilotMember = await interaction.guild?.members.fetch(pilotId).catch(() => null)
        || interaction.guild?.members.cache.get(pilotId)
        || null;

    if (pilotMember) {
        // Single-member path: assignMemberRole reports the outcome AND refreshes
        // the channel access by default, so the pilot sees the role's channels
        // right away (the bulk loops above refresh once for the whole batch).
        await Promise.all([
            setMemberNickname(pilotMember, desiredNickname, logEvent),
            assignMemberRole(pilotMember, logEvent, interaction.guild)
        ]);
    }

    await saveLocalStorage(db);
    logEvent(`✈️ [PilotBulk] ${interaction.user?.tag || 'unknown'} linked pilot ${pilotId} to owner ${ownerData.nickname} (${desiredNickname})`);

    // Keep every other picker usable — only the row that was just used is dropped.
    const remainingRows = [];
    for (const row of interaction.message?.components || []) {
        const select = row.components?.[0];
        const customId = selectField(select, 'custom_id');
        if (!select || !customId || customId === interaction.customId) continue;

        const options = (select.options || []).map(option => ({
            label: optionField(option, 'label'),
            value: optionField(option, 'value'),
            description: optionField(option, 'description')
        }));
        if (options.length === 0) continue;

        remainingRows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(customId)
                .setPlaceholder(selectField(select, 'placeholder') || 'Choose the owner...')
                .addOptions(options)
        ));
    }

    const base = stripTrailingHints(interaction.message?.content);
    const content = [
        base,
        `✅ <@${pilotId}> → owner **${ownerData.nickname}** — nickname "${desiredNickname}"`,
        remainingRows.length
            ? `🧩 Still ${remainingRows.length} ambiguous pilot(s) — choose in the menus below.`
            : '🎉 All ambiguous pilots in this report were resolved.'
    ].join('\n');

    // deferUpdate() already acknowledged the interaction — editReply is required.
    await interaction.editReply({ content: content.substring(0, 1990), components: remainingRows }).catch(() => {});
    return true;
}
