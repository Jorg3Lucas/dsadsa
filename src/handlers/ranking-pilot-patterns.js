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
        const owner = Number(p.ownerGroup) > 0 ? `group ${p.ownerGroup}` : 'text after the marker';
        const custom = configured && !DEFAULT_PILOT_PATTERNS.some(d => d.name === p.name && d.regex === p.regex);
        return `${i + 1}. \`${p.name}\` ${custom ? '*(custom)*' : ''}\n   \`${regex}\` — owner: ${owner}`;
    });

    return [
        `✈️ **Pilot markers** — source: ${configured ? '**configured on this server**' : 'built-in defaults (nothing configured)'}`,
        'Tested in this order — the first one that matches wins:',
        ...lines,
        '',
        '**How to configure**',
        '`/pilotmarkers action:add name:<label> regex:<expression> owner_group:<n>`',
        '• `owner_group:0` → the owner is the text **after** the marker (e.g. `(P) Zay`)',
        '• `owner_group:1` → the owner is **group 1** of the regex (e.g. `(P-cecilia)`)',
        '• In every pattern, the name **before** the marker is the character on the line.',
        '• `action:remove name:<label>` deletes a pattern and `action:reset` restores the built-in ones.',
        '⚠️ Only the player name is analyzed — the regex runs over the nickname copied from the list.'
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
            content: `♻️ Patterns restored to the built-in defaults.\n\n${buildListView(db)}`.substring(0, 1990)
        });
    }

    if (action === 'add') {
        const name = (interaction.options.getString('name') || '').trim();
        const regex = interaction.options.getString('regex');
        const ownerGroup = interaction.options.getInteger('owner_group') ?? 0;
        const position = interaction.options.getString('position') || 'last';

        if (!name || name.length > MAX_NAME_LENGTH) {
            return interaction.editReply(`❌ Provide a label of 1 to ${MAX_NAME_LENGTH} characters (\`name\`).`);
        }
        if (ownerGroup < 0 || ownerGroup > MAX_OWNER_GROUP) {
            return interaction.editReply(`❌ \`owner_group\` must be between 0 and ${MAX_OWNER_GROUP}.`);
        }

        const validation = validatePattern(regex);
        if (!validation.ok) return interaction.editReply(`❌ ${validation.error}`);

        const patterns = materialize();
        if (patterns.some(p => String(p.name).toLowerCase() === name.toLowerCase())) {
            return interaction.editReply(`❌ A pattern named \`${name}\` already exists. Remove it (\`action:remove\`) or use another label.`);
        }
        if (patterns.some(p => p.regex === validation.source)) {
            return interaction.editReply('❌ That regex is already configured.');
        }

        const entry = { name, regex: validation.source, ownerGroup };
        if (position === 'first') patterns.unshift(entry);
        else patterns.push(entry);

        await saveLocalStorage(db);
        logEvent(`✈️ [PilotMarkers] ${interaction.user?.tag || 'unknown'} added pilot pattern "${name}" (${validation.source}) at ${position}`);
        return interaction.editReply({
            content: `✅ Pattern \`${name}\` added ${position === 'first' ? 'at the **start**' : 'at the **end**'} of the list.\n\n${buildListView(db)}`.substring(0, 1990)
        });
    }

    if (action === 'remove') {
        const name = (interaction.options.getString('name') || '').trim();
        const patterns = materialize();
        const index = patterns.findIndex(p => String(p.name).toLowerCase() === name.toLowerCase());

        if (index === -1) {
            return interaction.editReply(`❌ No pattern named \`${name}\`. See the list with \`action:list\`.`);
        }

        const [removed] = patterns.splice(index, 1);
        if (patterns.length === 0) delete db.config.pilotPatterns;

        await saveLocalStorage(db);
        logEvent(`✈️ [PilotMarkers] ${interaction.user?.tag || 'unknown'} removed pilot pattern "${removed.name}"`);
        return interaction.editReply({
            content: `🗑️ Pattern \`${removed.name}\` removed.\n\n${buildListView(db)}`.substring(0, 1990)
        });
    }

    return interaction.editReply('❌ Unknown action. Use `list`, `add`, `remove` or `reset`.');
}
