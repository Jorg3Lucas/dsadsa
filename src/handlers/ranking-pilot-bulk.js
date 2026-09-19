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
import { MEMBER_ROLE_ID } from '../core/ranking-constants.js';
import { cleanNickname } from '../core/ranking-cache.js';
import { buildPrefixedNickname } from '../core/ranking-utils.js';
import { findOwnerCandidates } from './ranking-pilot.js';
import { deferReplySafe, deferUpdateSafe } from '../core/interaction-utils.js';

// Entries older than this are dropped from the queue (they are stale data).
const PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A fuzzy owner must be a single, quite similar candidate to be linked unattended.
const AUTO_OWNER_MIN_SCORE = 0.75;
const MAX_PILOTS_PER_OWNER = 4;

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
                .setPlaceholder(`Dono de ${item.member.user.username}${item.info?.ownerName ? ` (sugerido: ${item.info.ownerName})` : ''}`.substring(0, 100))
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
        return interaction.editReply(`❌ **${forcedOwner.displayName}** não tem registro — registre com \`/manualregister\` ou \`/manualforce\` antes.`);
    }

    const pending = (db.scanPilotPending && typeof db.scanPilotPending === 'object') ? db.scanPilotPending : {};
    const queuedTotal = Object.keys(pending).length;
    if (queuedTotal === 0) {
        return interaction.editReply('📭 **Fila vazia.** Rode `/scanallied <lista> apply:true` primeiro — os pilotos que ele detectar mas não conseguir vincular entram nessa fila.');
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
            stale.push({ pilotId, info, reason: 'fila expirada (> 30 dias)' });
            continue;
        }
        if (ownerOfPilot.has(pilotId)) {
            stale.push({ pilotId, info, reason: `já vinculado (dono ${db.users?.[ownerOfPilot.get(pilotId)]?.nickname || ownerOfPilot.get(pilotId)})` });
            continue;
        }

        const member = guild.members.cache.get(pilotId) || await guild.members.fetch(pilotId).catch(() => null);
        if (!member) {
            stale.push({ pilotId, info, reason: 'não está mais no servidor' });
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
                confidence: 'dono informado'
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

    for (const entry of ready) {
        const ownerData = db.users?.[entry.ownerId];
        if (!ownerData) {
            stale.push({ pilotId: entry.pilotId, info: entry.info, reason: 'o dono não tem mais registro' });
            continue;
        }
        const ownerPilots = ownerData.pilotIds || (ownerData.pilotIds = []);
        if (ownerPilots.includes(entry.pilotId)) {
            stale.push({ pilotId: entry.pilotId, info: entry.info, reason: 'já vinculado' });
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
                entry.member.roles.add(MEMBER_ROLE_ID).catch(() => {});
            }
            entry.member.setNickname(desiredNickname).catch(() => {});
            delete pending[entry.pilotId];
            linked.push({ ...entry, ownerNickname: ownerData.nickname, desiredNickname });
            logEvent(`✈️ [PilotBulk] Linked pilot ${entry.member.user.tag} → owner ${ownerData.nickname} (${entry.confidence})`);
        } else {
            linked.push({ ...entry, ownerNickname: ownerData.nickname });
        }
    }

    if (apply) {
        for (const item of stale) delete pending[item.pilotId];
        if (Object.keys(pending).length === 0) delete db.scanPilotPending;
        await saveLocalStorage(db);
    }

    const counts = [
        `📋 Pilotos na fila: **${queuedTotal}**${apply ? ` (restaram **${Object.keys(pending).length}**)` : ''}`,
        `${apply ? '✅ Vinculados' : '✅ Seriam vinculados'}: **${linked.length}**`,
        `🤔 Ambíguos (resolva com \`/manualpilot\`): **${ambiguous.length}**`,
        `🚫 Sem dono na lista: **${noOwner.length}**`,
        `⛔ Dono já com ${MAX_PILOTS_PER_OWNER} pilotos: **${ownerFull.length}**`,
        `🗑️ Descartados da fila: **${stale.length}**${apply ? '' : ' (aplicados só com `apply:true`)'}`
    ].join('\n');

    const details = [
        ...linked.map(l => `${apply ? '✅' : '➡️'} <@${l.pilotId}> (${l.member.user.username}) → dono **${l.ownerNickname}** [${l.confidence}]${l.desiredNickname ? ` — apelido "${l.desiredNickname}"` : ''}`),
        ...ambiguous.map(a => `🤔 <@${a.pilotId}> (${a.member.user.username}) — dono sugerido "${a.info.ownerName || '—'}"${a.candidates?.length ? `: ${a.candidates.map(c => `"${c.nickname}" (${Math.round((c.score || 0) * 100)}%)`).join(', ')}` : ' (nenhum candidato)'} — use \`/manualpilot\``),
        ...noOwner.map(n => `🚫 <@${n.pilotId}> (${n.member.user.username}) — piloto sem dono na lista (${n.info.marker ? `marcador "${n.info.marker}"` : 'sem marcador'}) — use \`/manualpilot\``),
        ...ownerFull.map(f => `⛔ <@${f.pilotId}> (${f.member.user.username}) — dono "${f.ownerNickname}" já tem ${MAX_PILOTS_PER_OWNER} pilotos`),
        ...stale.map(s => `🗑️ <@${s.pilotId}> — ${s.reason}`)
    ];

    const header = [
        '✈️ **/pilotbulk**' + (forcedOwner ? ` — dono forçado: **${forcedOwner.displayName}**` : ''),
        apply ? '⚠️ **APLICANDO** os vínculos' : '🧪 **DRY RUN** — nada foi alterado (rode com `apply: true`)',
        '',
        counts
    ].join('\n');

    const rows = buildAmbiguousRows(ambiguous);

    const preview = details.slice(0, 15);
    const content = [
        header,
        preview.length ? `\n${preview.join('\n')}` : '\nℹ️ Nada para fazer.',
        details.length > preview.length ? `\n📎 Mais ${details.length - preview.length} linha(s) no anexo.` : '\n📎 Relatório completo no arquivo anexado.',
        rows.length ? `\n🧩 Escolha o dono de ${rows.length} piloto(s) ambíguo(s) nos menus abaixo.` : ''
    ].filter(Boolean).join('\n');

    const report = [
        `# /pilotbulk ${apply ? '(APLICADO)' : '(DRY RUN)'}`,
        `Dono forçado: ${forcedOwner ? `${forcedOwner.user.username} (${db.users[forcedOwner.id]?.nickname})` : 'não'}`,
        `Data: ${new Date().toISOString()}`,
        '',
        '## Resumo',
        counts.replace(/\*\*/g, '').replace(/`/g, ''),
        '',
        '## Detalhes',
        ...(details.length ? details : ['- (nada na fila)']),
        '',
        '## Fila restante',
        ...(Object.keys(pending).length
            ? Object.entries(pending).map(([id, info]) => `- ${id} — "${info.characterName}" dono "${info.ownerName || '—'}" [${info.reason || 'pendente'}]`)
            : ['- (vazia)'])
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
        await interaction.followUp({ content: '❌ Esse dono não tem mais registro — rode `/pilotbulk` de novo.', flags: 64 }).catch(() => {});
        return false;
    }

    const ownerPilots = ownerData.pilotIds || (ownerData.pilotIds = []);
    if (!ownerPilots.includes(pilotId) && ownerPilots.length >= MAX_PILOTS_PER_OWNER) {
        await interaction.followUp({ content: `❌ **${ownerData.nickname}** já tem ${MAX_PILOTS_PER_OWNER} pilotos.`, flags: 64 }).catch(() => {});
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
        const hadMemberRole = pilotMember.roles.cache.has(MEMBER_ROLE_ID);
        await Promise.all([
            pilotMember.setNickname(desiredNickname).catch(() => {}),
            !hadMemberRole ? pilotMember.roles.add(MEMBER_ROLE_ID).catch(() => {}) : Promise.resolve()
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
        `✅ <@${pilotId}> → dono **${ownerData.nickname}** — apelido "${desiredNickname}"`,
        remainingRows.length
            ? `🧩 Ainda há ${remainingRows.length} piloto(s) ambíguo(s) — escolha nos menus abaixo.`
            : '🎉 Todos os ambíguos deste relatório foram resolvidos.'
    ].join('\n');

    await interaction.update({ content: content.substring(0, 1990), components: remainingRows }).catch(() => {});
    return true;
}
