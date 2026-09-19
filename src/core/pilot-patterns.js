// ==========================================
// ✈️ PILOT PATTERN DETECTION
// ==========================================
// Pilot status is not exposed by the ranking portal — it is read from the
// nickname text copied from the allied servers. Each allied clan writes its own
// marker ("Name (P)", "Name (P-owner)", "Name [ᴘ]", "Name Pilot Owner", …), so
// the patterns are configurable per server and stored in db.config.pilotPatterns
// (managed with /pilotmarkers). When nothing is configured, the defaults below
// are used.
//
// Pattern shape: { name, regex, ownerGroup }
//   name       — label shown in the /scanallied report
//   regex      — source compiled with the "iu" flags
//   ownerGroup — 0 = the owner is the text AFTER the marker,
//                N >= 1 = the owner is capture group N of the regex
//
// The name BEFORE the marker is always the character the line belongs to.

export const DEFAULT_PILOT_PATTERNS = [
    // "EU031 - Owner - Pilot" — the suffix this bot itself assigns
    { name: 'pilot-suffix', regex: '\\s*[-–—]\\s*pilot\\s*$', ownerGroup: 0 },
    // "St • JAY (P-cecilia)" / "[P-cecilia]"
    { name: 'p-dash', regex: '[([\\s]*[pᴘ]\\s*[-–—]\\s*([^)\\]]+)\\s*[)\\]]', ownerGroup: 1 },
    // "Serious King (P)" / "(Pilot)" / "MooN [ᴘ]" — the owner may follow the marker
    { name: 'p-bracket', regex: '[([]\\s*(?:p|pilot|ᴘ)\\s*[)\\]]', ownerGroup: 0 },
    // "mєjєrє Pilot OGUN" / "Scânteiere-Garfil Ⓖ Pilot"
    { name: 'pilot-word', regex: '\\s+pilot\\b\\s*(.*)$', ownerGroup: 1 }
];

// Compiled patterns are cached by source string — detectPilot runs a few times
// per member during a scan, and db.config.pilotPatterns is mutated in place by
// the /pilotmarkers handler (same trick as the allied-clans cleaned cache).
const compiledCache = new Map();

/**
 * Compile one pattern source with the fixed "iu" flags. Invalid sources return
 * null instead of throwing, so a broken config can never break the scan.
 */
function compilePattern(regex) {
    if (typeof regex !== 'string' || !regex) return null;
    const cached = compiledCache.get(regex);
    if (cached !== undefined) return cached;

    let compiled = null;
    try {
        compiled = new RegExp(regex, 'iu');
    } catch {
        compiled = null;
    }
    compiledCache.set(regex, compiled);
    return compiled;
}

/**
 * Validate a user-provided pattern before storing it: must compile, must not be
 * absurdly long, and must not be slow (a catastrophic-backtracking regex would
 * hang the whole bot on every nickname).
 */
export function validatePattern(regex) {
    if (typeof regex !== 'string' || !regex.trim()) {
        return { ok: false, error: 'O regex está vazio.' };
    }
    const source = regex.trim();
    if (source.length > 200) {
        return { ok: false, error: 'Regex muito longo (máx. 200 caracteres).' };
    }

    let compiled;
    try {
        compiled = new RegExp(source, 'iu');
    } catch (e) {
        return { ok: false, error: `Regex inválida: ${e.message}` };
    }

    const sample = 'A-P-Pilot シ (P) [ᴘ] '.repeat(10);
    const started = Date.now();
    compiled.test(sample);
    const elapsed = Date.now() - started;
    if (elapsed > 50) {
        return { ok: false, error: `Regex muito lenta (${elapsed}ms numa amostra de 200 chars) — simplifique o padrão.` };
    }

    return { ok: true, source };
}

/**
 * The effective pilot patterns for this database: the configured list when it
 * has at least one valid entry, otherwise the built-in defaults.
 */
export function getPilotPatterns(db) {
    const configured = db?.config?.pilotPatterns;
    if (!Array.isArray(configured)) return DEFAULT_PILOT_PATTERNS;

    const valid = configured.filter(p =>
        p && typeof p.regex === 'string' && p.regex.trim() && compilePattern(p.regex)
    );
    return valid.length > 0 ? valid : DEFAULT_PILOT_PATTERNS;
}

/** True when the database carries its own (valid) pattern list. */
export function hasCustomPilotPatterns(db) {
    return getPilotPatterns(db) !== DEFAULT_PILOT_PATTERNS;
}

/**
 * Detect a pilot marker in a nickname copied from another server.
 *
 * Returns { isPilot, characterName, ownerName, marker, patternName }:
 *   marker      — the matched text, e.g. "(P-cecilia)"
 *   patternName — the label of the pattern that matched (see DEFAULT_PILOT_PATTERNS)
 *   ownerName   — the owner when the entry carries one, otherwise null
 */
export function detectPilot(rawNickname, patterns = DEFAULT_PILOT_PATTERNS) {
    const raw = String(rawNickname ?? '').trim();
    if (!raw) return { isPilot: false, characterName: raw, ownerName: null, marker: null, patternName: null };

    for (const pattern of patterns || []) {
        const regex = compilePattern(pattern?.regex);
        if (!regex) continue;

        const match = raw.match(regex);
        if (!match) continue;

        const markerText = (match[0] || '').trim();
        const start = match.index ?? 0;
        const characterName = raw.slice(0, start).trim();
        // A marker with nothing before it names no character — try the next pattern.
        if (!characterName) continue;

        const ownerGroup = Number(pattern.ownerGroup) || 0;
        const ownerFromGroup = ownerGroup > 0 ? String(match[ownerGroup] ?? '').trim() : '';
        const ownerAfter = raw.slice(start + (match[0] || '').length).replace(/^[\s\-–—/|:]+/, '').trim();

        return {
            isPilot: true,
            characterName,
            ownerName: ownerFromGroup || ownerAfter || null,
            marker: markerText || pattern.name,
            patternName: pattern.name || pattern.regex
        };
    }

    return { isPilot: false, characterName: raw, ownerName: null, marker: null, patternName: null };
}
