// ==========================================
// ✈️ /pilotmarkers — CONFIGURE THE PILOT MARKERS
// ==========================================
// Every allied clan writes its own pilot marker in the nickname ("Name (P)",
// "Name (P-owner)", "Name [ᴘ]", "Name Pilot Owner", …). This command lists and
// edits the patterns the /scanallied report uses to detect pilots.
//
// Patterns live in db.config.pilotPatterns as [{ name, regex, ownerGroup }] and
// are tried in order. When the list is empty/absent the built-in defaults apply.

import { ensureConfig } from '../core/ranking-constants.js';
import { deferReplySafe } from '../core/interaction-utils.js';
import { DEFAULT_PILOT_PATTERNS, getPilotPatterns, validatePattern } from '../core/pilot-patterns.js';

const MAX_NAME_LENGTH = 24;
const MAX_OWNER_GROUP = 9;

/** Render the effective pattern list for the ephemeral reply. */
function buildListView(db) {
    const configured = Array.isArray(db.config?.pilotPatterns) && db.config.pilotPatterns.length > 0;
    const patterns = getPilotPatterns(db);

    const lines = patterns.map((p, i) => {
        const regex = String(p.regex ?? '').replace(/`/g, '');
        const owner = Number(p.ownerGroup) > 0 ? `grupo ${p.ownerGroup}` : 'texto depois do marcador';
        const custom = configured && !DEFAULT_PILOT_PATTERNS.some(d => d.name === p.name && d.regex === p.regex);
        return `${i + 1}. \`${p.name}\` ${custom ? '*(custom)*' : ''}\n   \`${regex}\` — dono: ${owner}`;
    });

    return [
        `✈️ **Marcadores de piloto** — fonte: ${configured ? '**configurados neste servidor**' : 'padrões internos (nada configurado)'}`,
        'Testados nesta ordem — o primeiro que casar vence:',
        ...lines,
        '',
        '**Como configurar**',
        '`/pilotmarkers action:add name:<rótulo> regex:<expressão> owner_group:<n>`',
        '• `owner_group:0` → o dono é o texto **depois** do marcador (ex.: `(P) Zay`)',
        '• `owner_group:1` → o dono é o **grupo 1** da regex (ex.: `(P-cecilia)`)',
        '• Em todos os padrões, o nome **antes** do marcador é o personagem da linha.',
        '• `action:remove name:<rótulo>` apaga um padrão e `action:reset` volta aos padrões internos.',
        '⚠️ Só o nome do jogador é analisado — a regex roda sobre o apelido copiado da lista.'
    ].join('\n');
}

/**
 * Handle /pilotmarkers <action> [name] [regex] [owner_group] [position].
 */
export async function handlePilotMarkers(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferReplySafe(interaction)) return false;

    const action = interaction.options.getString('action');
    ensureConfig(db);

    // First add/remove materializes the defaults, so editing a pattern never
    // silently drops the built-in ones.
    const materialize = () => {
        if (!Array.isArray(db.config.pilotPatterns) || db.config.pilotPatterns.length === 0) {
            db.config.pilotPatterns = DEFAULT_PILOT_PATTERNS.map(p => ({ ...p }));
        }
        return db.config.pilotPatterns;
    };

    if (action === 'list') {
        return interaction.editReply({ content: buildListView(db).substring(0, 1990) });
    }

    if (action === 'reset') {
        if (Array.isArray(db.config.pilotPatterns)) delete db.config.pilotPatterns;
        await saveLocalStorage(db);
        logEvent(`✈️ [PilotMarkers] ${interaction.user?.tag || 'unknown'} reset the pilot patterns to the defaults`);
        return interaction.editReply({
            content: `♻️ Padrões voltaram ao padrão interno.\n\n${buildListView(db)}`.substring(0, 1990)
        });
    }

    if (action === 'add') {
        const name = (interaction.options.getString('name') || '').trim();
        const regex = interaction.options.getString('regex');
        const ownerGroup = interaction.options.getInteger('owner_group') ?? 0;
        const position = interaction.options.getString('position') || 'last';

        if (!name || name.length > MAX_NAME_LENGTH) {
            return interaction.editReply(`❌ Informe um rótulo de 1 a ${MAX_NAME_LENGTH} caracteres (\`name\`).`);
        }
        if (ownerGroup < 0 || ownerGroup > MAX_OWNER_GROUP) {
            return interaction.editReply(`❌ \`owner_group\` deve ficar entre 0 e ${MAX_OWNER_GROUP}.`);
        }

        const validation = validatePattern(regex);
        if (!validation.ok) return interaction.editReply(`❌ ${validation.error}`);

        const patterns = materialize();
        if (patterns.some(p => String(p.name).toLowerCase() === name.toLowerCase())) {
            return interaction.editReply(`❌ Já existe um padrão chamado \`${name}\`. Remova (\`action:remove\`) ou use outro rótulo.`);
        }
        if (patterns.some(p => p.regex === validation.source)) {
            return interaction.editReply('❌ Esse regex já está configurado.');
        }

        const entry = { name, regex: validation.source, ownerGroup };
        if (position === 'first') patterns.unshift(entry);
        else patterns.push(entry);

        await saveLocalStorage(db);
        logEvent(`✈️ [PilotMarkers] ${interaction.user?.tag || 'unknown'} added pilot pattern "${name}" (${validation.source}) at ${position}`);
        return interaction.editReply({
            content: `✅ Padrão \`${name}\` adicionado ${position === 'first' ? 'no **início**' : 'no **fim**'} da lista.\n\n${buildListView(db)}`.substring(0, 1990)
        });
    }

    if (action === 'remove') {
        const name = (interaction.options.getString('name') || '').trim();
        const patterns = materialize();
        const index = patterns.findIndex(p => String(p.name).toLowerCase() === name.toLowerCase());

        if (index === -1) {
            return interaction.editReply(`❌ Nenhum padrão chamado \`${name}\`. Veja a lista com \`action:list\`.`);
        }

        const [removed] = patterns.splice(index, 1);
        if (patterns.length === 0) delete db.config.pilotPatterns;

        await saveLocalStorage(db);
        logEvent(`✈️ [PilotMarkers] ${interaction.user?.tag || 'unknown'} removed pilot pattern "${removed.name}"`);
        return interaction.editReply({
            content: `🗑️ Padrão \`${removed.name}\` removido.\n\n${buildListView(db)}`.substring(0, 1990)
        });
    }

    return interaction.editReply('❌ Ação desconhecida. Use `list`, `add`, `remove` ou `reset`.');
}
