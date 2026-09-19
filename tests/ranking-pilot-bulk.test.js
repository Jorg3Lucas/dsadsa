import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-cache.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getLocalRankingCache: vi.fn(() => null)
    };
});

vi.mock('../src/handlers/ranking-pilot.js', () => ({
    findOwnerCandidates: vi.fn(() => [])
}));

vi.mock('../src/core/interaction-utils.js', () => ({
    deferReplySafe: vi.fn(async () => true),
    deferUpdateSafe: vi.fn(async () => true),
    editReplySafe: vi.fn(async () => null)
}));

import { findOwnerCandidates } from '../src/handlers/ranking-pilot.js';
import { MEMBER_ROLE_ID } from '../src/core/ranking-constants.js';
import { handlePilotBulk, handlePilotBulkSelect } from '../src/handlers/ranking-pilot-bulk.js';

/** Read the selects out of a report payload ({ components: [ActionRow, ...] }). */
function selectsOf(payload) {
    return (payload?.components || []).map(row => row.components?.[0]).filter(Boolean);
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function createMember({ id, username = `user${id}`, roles = [] }) {
    const roleSet = new Set(roles);
    return {
        id,
        user: { id, username, tag: `${username}#0001` },
        setNickname: vi.fn(async () => {}),
        roles: {
            cache: { has: roleId => roleSet.has(roleId) },
            add: vi.fn(async () => { roleSet.add(MEMBER_ROLE_ID); })
        }
    };
}

function createInteraction({ apply = false, owner = null, members = [] }) {
    const cache = new Map(members.map(m => [m.id, m]));
    const replies = [];
    return {
        guild: { members: { cache, fetch: vi.fn(async id => cache.get(id) || null) } },
        user: { tag: 'AdminUser#0001' },
        options: {
            getBoolean: vi.fn(() => apply),
            getMember: vi.fn(() => owner)
        },
        editReply: vi.fn(async payload => { replies.push(payload); return payload; }),
        replies
    };
}

/** A queued pending pilot. */
function pendingPilot(overrides = {}) {
    return {
        pilotTag: 'pilot#0001',
        characterName: 'St • JAY',
        ownerName: 'cecilia',
        marker: '(P-cecilia)',
        patternName: 'p-dash',
        reason: 'dono não identificado',
        createdAt: new Date().toISOString(),
        ...overrides
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    findOwnerCandidates.mockReturnValue([]);
});

// ──────────────────────────────────────────
// /pilotbulk
// ──────────────────────────────────────────

describe('handlePilotBulk', () => {
    it('reports an empty queue', async () => {
        const interaction = createInteraction({ members: [] });
        await handlePilotBulk(interaction, { users: {}, config: {} }, vi.fn(), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Fila vazia'));
    });

    it('links a queued pilot to the owner with the exact nickname', async () => {
        const owner = createMember({ id: '4' });
        const pilot = createMember({ id: '5' });
        const db = {
            users: { 4: { nickname: 'cecilia', registeredAt: '2026-01-01T00:00:00.000Z', pilotIds: [] } },
            scanPilotPending: { 5: pendingPilot() },
            config: {}
        };
        const save = vi.fn(async () => {});
        const interaction = createInteraction({ apply: true, members: [owner, pilot] });

        await handlePilotBulk(interaction, db, save, vi.fn());

        expect(db.users['4'].pilotIds).toEqual(['5']);
        expect(pilot.roles.add).toHaveBeenCalledWith(MEMBER_ROLE_ID);
        expect(pilot.setNickname).toHaveBeenCalledWith('cecilia - Pilot');
        expect(db.scanPilotPending).toBeUndefined();
        expect(save).toHaveBeenCalled();
        expect(interaction.replies[0].content).toContain('cecilia');
    });

    it('does not change anything in dry run', async () => {
        const owner = createMember({ id: '4' });
        const pilot = createMember({ id: '5' });
        const db = {
            users: { 4: { nickname: 'cecilia', registeredAt: '2026-01-01T00:00:00.000Z', pilotIds: [] } },
            scanPilotPending: { 5: pendingPilot() },
            config: {}
        };
        const interaction = createInteraction({ apply: false, members: [owner, pilot] });

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4'].pilotIds).toEqual([]);
        expect(db.scanPilotPending['5']).toBeDefined();
        expect(pilot.roles.add).not.toHaveBeenCalled();
        expect(interaction.replies[0].content).toContain('DRY RUN');
        expect(interaction.replies[0].content).toContain('Seriam vinculados');
    });

    it('auto-links when a single close fuzzy candidate exists', async () => {
        findOwnerCandidates.mockReturnValue([{ id: '4', nickname: 'cecilia', score: 0.9 }]);
        const owner = createMember({ id: '4' });
        const pilot = createMember({ id: '5' });
        const db = {
            users: { 4: { nickname: 'cecilja', registeredAt: '2026-01-01T00:00:00.000Z', pilotIds: [] } },
            scanPilotPending: { 5: pendingPilot({ ownerName: 'cecilia' }) },
            config: {}
        };
        const interaction = createInteraction({ apply: true, members: [owner, pilot] });

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4'].pilotIds).toEqual(['5']);
        expect(interaction.replies[0].content).toContain('90%');
    });

    it('leaves ambiguous owners in the queue and reports them', async () => {
        // No exact match — two equally plausible owners come back from the fuzzy search.
        findOwnerCandidates.mockReturnValue([
            { id: '4', nickname: 'cecilja', score: 0.8 },
            { id: '6', nickname: 'cecilie', score: 0.9 }
        ]);
        const ownerA = createMember({ id: '4' });
        const ownerB = createMember({ id: '6' });
        const pilot = createMember({ id: '5' });
        const db = {
            users: {
                4: { nickname: 'cecilja', registeredAt: 'x', pilotIds: [] },
                6: { nickname: 'cecilie', registeredAt: 'x', pilotIds: [] }
            },
            scanPilotPending: { 5: pendingPilot() },
            config: {}
        };
        const interaction = createInteraction({ apply: true, members: [ownerA, ownerB, pilot] });

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4'].pilotIds).toEqual([]);
        expect(db.scanPilotPending['5']).toBeDefined();
        expect(interaction.replies[0].content).toContain('Ambíguos');
        expect(interaction.replies[0].content).toContain('/manualpilot');
    });

    it('links every queued pilot to an explicitly informed owner', async () => {
        const owner = createMember({ id: '4' });
        const pilotA = createMember({ id: '5' });
        const pilotB = createMember({ id: '6' });
        const db = {
            users: { 4: { nickname: 'cecilia', registeredAt: 'x', pilotIds: [] } },
            scanPilotPending: {
                5: pendingPilot(),
                6: pendingPilot({ ownerName: null, characterName: 'St • Ali', marker: '(P)' })
            },
            config: {}
        };
        const interaction = createInteraction({ apply: true, owner, members: [owner, pilotA, pilotB] });

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4'].pilotIds).toEqual(['5', '6']);
        expect(interaction.replies[0].content).toContain('dono forçado');
    });

    it('refuses an owner without registration', async () => {
        const owner = createMember({ id: '4' });
        const interaction = createInteraction({ apply: true, owner, members: [owner] });
        const db = { users: {}, scanPilotPending: { 5: pendingPilot() }, config: {} };

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('não tem registro'));
    });

    it('skips owners that already reached the pilot cap', async () => {
        const owner = createMember({ id: '4' });
        const pilot = createMember({ id: '5' });
        const db = {
            users: { 4: { nickname: 'cecilia', registeredAt: 'x', pilotIds: ['7', '8', '9', '10'] } },
            scanPilotPending: { 5: pendingPilot() },
            config: {}
        };
        const interaction = createInteraction({ apply: true, members: [owner, pilot] });

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4'].pilotIds).toEqual(['7', '8', '9', '10']);
        expect(interaction.replies[0].content).toContain('4 pilotos');
    });

    it('drops queue entries for pilots that already have an owner', async () => {
        const owner = createMember({ id: '4' });
        const pilot = createMember({ id: '5' });
        const db = {
            users: {
                4: { nickname: 'cecilia', registeredAt: 'x', pilotIds: ['5'] },
                5: { nickname: 'JAY', registeredAt: 'x', pilotIds: [] }
            },
            scanPilotPending: { 5: pendingPilot() },
            config: {}
        };
        const save = vi.fn(async () => {});
        const interaction = createInteraction({ apply: true, members: [owner, pilot] });

        await handlePilotBulk(interaction, db, save, vi.fn());

        expect(db.scanPilotPending).toBeUndefined();
        expect(db.users['4'].pilotIds).toEqual(['5']);
        expect(save).toHaveBeenCalled();
    });

    it('attaches an owner picker for every ambiguous pilot', async () => {
        findOwnerCandidates.mockReturnValue([
            { id: '4', nickname: 'cecilja', score: 0.8 },
            { id: '6', nickname: 'cecilie', score: 0.9 }
        ]);
        const ownerA = createMember({ id: '4' });
        const ownerB = createMember({ id: '6' });
        const pilotA = createMember({ id: '5' });
        const pilotB = createMember({ id: '7' });
        const db = {
            users: {
                4: { nickname: 'cecilja', registeredAt: 'x', pilotIds: [] },
                6: { nickname: 'cecilie', registeredAt: 'x', pilotIds: [] }
            },
            scanPilotPending: { 5: pendingPilot(), 7: pendingPilot({ characterName: 'St • Ali' }) },
            config: {}
        };
        const interaction = createInteraction({ apply: true, members: [ownerA, ownerB, pilotA, pilotB] });

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        const selects = selectsOf(interaction.replies[0]);
        expect(selects).toHaveLength(2);
        expect(selects.map(s => s.data.custom_id)).toEqual(['pilotbulk_owner_5', 'pilotbulk_owner_7']);
        expect(selects[0].options.map(o => o.data.value)).toEqual(['4', '6']);
        expect(interaction.replies[0].content).toContain('🧩');
    });

    it('has no picker when every ambiguity has no candidate', async () => {
        findOwnerCandidates.mockReturnValue([]);
        const pilot = createMember({ id: '5' });
        const db = {
            users: { 4: { nickname: 'cecilja', registeredAt: 'x', pilotIds: [] } },
            scanPilotPending: { 5: pendingPilot() },
            config: {}
        };
        const interaction = createInteraction({ apply: true, members: [pilot] });

        await handlePilotBulk(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(interaction.replies[0].components).toEqual([]);
    });

    it('drops queue entries for members that left the server', async () => {
        const db = {
            users: {},
            scanPilotPending: { 5: pendingPilot() },
            config: {}
        };
        const save = vi.fn(async () => {});
        const interaction = createInteraction({ apply: true, members: [] });

        await handlePilotBulk(interaction, db, save, vi.fn());

        expect(db.scanPilotPending).toBeUndefined();
        expect(interaction.replies[0].content).toContain('Descartados');
    });
});

// ──────────────────────────────────────────
// Inline owner picker
// ──────────────────────────────────────────

describe('handlePilotBulkSelect', () => {
    /** Report produced by /pilotbulk for two ambiguous pilots. */
    async function buildReport() {
        findOwnerCandidates.mockReturnValue([
            { id: '4', nickname: 'cecilja', score: 0.8 },
            { id: '6', nickname: 'cecilie', score: 0.9 }
        ]);
        const ownerA = createMember({ id: '4' });
        const ownerB = createMember({ id: '6' });
        const pilotA = createMember({ id: '5' });
        const pilotB = createMember({ id: '7' });
        const db = {
            users: {
                4: { nickname: 'cecilja', registeredAt: 'x', pilotIds: [] },
                6: { nickname: 'cecilie', registeredAt: 'x', pilotIds: [] }
            },
            scanPilotPending: { 5: pendingPilot(), 7: pendingPilot({ characterName: 'St • Ali' }) },
            config: {}
        };
        const report = createInteraction({ apply: true, members: [ownerA, ownerB, pilotA, pilotB] });
        await handlePilotBulk(report, db, vi.fn(async () => {}), vi.fn());
        return { db, report, pilots: { 5: pilotA, 7: pilotB } };
    }

    function selectInteraction(report, { pilotId, ownerId, guild }) {
        const payload = report.replies[0];
        return {
            customId: `pilotbulk_owner_${pilotId}`,
            values: [ownerId],
            user: { tag: 'AdminUser#0001' },
            guild,
            message: { content: payload.content, components: payload.components || [] },
            update: vi.fn(async p => p),
            followUp: vi.fn(async p => p)
        };
    }

    it('links the chosen pair and keeps the other pickers open', async () => {
        const { db, report, pilots } = await buildReport();
        const save = vi.fn(async () => {});
        const interaction = selectInteraction(report, { pilotId: '5', ownerId: '4', guild: report.guild });

        await handlePilotBulkSelect(interaction, db, save, vi.fn());

        expect(db.users['4'].pilotIds).toEqual(['5']);
        expect(pilots[5].roles.add).toHaveBeenCalledWith(MEMBER_ROLE_ID);
        expect(pilots[5].setNickname).toHaveBeenCalledWith('cecilja - Pilot');
        expect(db.scanPilotPending['5']).toBeUndefined();
        expect(db.scanPilotPending['7']).toBeDefined();
        expect(save).toHaveBeenCalled();

        const payload = interaction.update.mock.calls[0][0];
        expect(payload.content).toContain('✅');
        expect(selectsOf(payload)).toHaveLength(1);
        expect(selectsOf(payload)[0].data.custom_id).toBe('pilotbulk_owner_7');
    });

    it('warns when the chosen owner is already full', async () => {
        const { db, report } = await buildReport();
        db.users['4'].pilotIds = ['a', 'b', 'c', 'd'];
        const interaction = selectInteraction(report, { pilotId: '5', ownerId: '4', guild: report.guild });

        await handlePilotBulkSelect(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4'].pilotIds).toEqual(['a', 'b', 'c', 'd']);
        expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('4 pilotos') }));
        expect(interaction.update).not.toHaveBeenCalled();
    });

    it('warns when the chosen owner has no registration anymore', async () => {
        const { db, report } = await buildReport();
        delete db.users['4'];
        const interaction = selectInteraction(report, { pilotId: '5', ownerId: '4', guild: report.guild });

        await handlePilotBulkSelect(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('não tem mais registro') }));
        expect(interaction.update).not.toHaveBeenCalled();
    });
});
