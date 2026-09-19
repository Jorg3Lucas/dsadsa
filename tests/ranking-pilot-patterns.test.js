import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/interaction-utils.js', () => ({
    deferReplySafe: vi.fn(async () => true),
    deferUpdateSafe: vi.fn(async () => true),
    editReplySafe: vi.fn(async () => null)
}));

import { DEFAULT_PILOT_PATTERNS } from '../src/core/pilot-patterns.js';
import { handlePilotMarkers } from '../src/handlers/ranking-pilot-patterns.js';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function createInteraction({ action, name = null, regex = null, ownerGroup = null, position = null }) {
    const replies = [];
    return {
        user: { tag: 'AdminUser#0001' },
        options: {
            getString: vi.fn(key => ({ action, name, regex, position })[key] ?? null),
            getInteger: vi.fn(() => ownerGroup)
        },
        editReply: vi.fn(async payload => { replies.push(payload); return payload; }),
        replies
    };
}

/** The handler replies with plain strings on errors and with objects otherwise. */
function replyText(interaction, index = 0) {
    const payload = interaction.replies[index];
    return typeof payload === 'string' ? payload : (payload?.content || '');
}

let db;
let save;

beforeEach(() => {
    vi.clearAllMocks();
    db = { users: {}, config: {} };
    save = vi.fn(async () => {});
});

// ──────────────────────────────────────────
// /pilotmarkers
// ──────────────────────────────────────────

describe('handlePilotMarkers', () => {
    it('lists the built-in patterns when nothing is configured', async () => {
        const interaction = createInteraction({ action: 'list' });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        const content = replyText(interaction);
        expect(content).toContain('padrões internos');
        for (const pattern of DEFAULT_PILOT_PATTERNS) {
            expect(content).toContain(pattern.name);
        }
        expect(save).not.toHaveBeenCalled();
    });

    it('adds a custom pattern on top of the defaults', async () => {
        const interaction = createInteraction({
            action: 'add', name: 'plus-owner', regex: '\\+\\s*(\\S+)$', ownerGroup: 1
        });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(db.config.pilotPatterns).toHaveLength(DEFAULT_PILOT_PATTERNS.length + 1);
        expect(db.config.pilotPatterns.at(-1)).toEqual({
            name: 'plus-owner', regex: '\\+\\s*(\\S+)$', ownerGroup: 1
        });
        expect(save).toHaveBeenCalled();
        expect(replyText(interaction)).toContain('adicionado');
    });

    it('can place a new pattern first in the test order', async () => {
        const interaction = createInteraction({
            action: 'add', name: 'first-try', regex: 'x', ownerGroup: 0, position: 'first'
        });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(db.config.pilotPatterns[0].name).toBe('first-try');
    });

    it('rejects a duplicate label', async () => {
        db.config.pilotPatterns = [{ name: 'p-bracket', regex: '\\(p\\)', ownerGroup: 0 }];
        const interaction = createInteraction({
            action: 'add', name: 'P-Bracket', regex: '\\[p\\]', ownerGroup: 0
        });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(db.config.pilotPatterns).toHaveLength(1);
        expect(save).not.toHaveBeenCalled();
        expect(replyText(interaction)).toContain('Já existe');
    });

    it('rejects an invalid regex', async () => {
        const interaction = createInteraction({ action: 'add', name: 'broken', regex: '([', ownerGroup: 0 });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(db.config.pilotPatterns).toBeUndefined();
        expect(replyText(interaction)).toContain('Regex inválida');
    });

    it('rejects a missing label', async () => {
        const interaction = createInteraction({ action: 'add', name: '', regex: 'x', ownerGroup: 0 });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(replyText(interaction)).toContain('rótulo');
    });

    it('removes a pattern by label', async () => {
        db.config.pilotPatterns = DEFAULT_PILOT_PATTERNS.map(p => ({ ...p }));
        const interaction = createInteraction({ action: 'remove', name: 'pilot-word' });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(db.config.pilotPatterns.some(p => p.name === 'pilot-word')).toBe(false);
        expect(save).toHaveBeenCalled();
    });

    it('reports an unknown label on remove', async () => {
        const interaction = createInteraction({ action: 'remove', name: 'nope' });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(replyText(interaction)).toContain('Nenhum padrão');
    });

    it('resets back to the built-in patterns', async () => {
        db.config.pilotPatterns = [{ name: 'only', regex: 'x', ownerGroup: 0 }];
        const interaction = createInteraction({ action: 'reset' });
        await handlePilotMarkers(interaction, db, save, vi.fn());

        expect(db.config.pilotPatterns).toBeUndefined();
        expect(save).toHaveBeenCalled();
        expect(replyText(interaction)).toContain('padrão interno');
    });
});
