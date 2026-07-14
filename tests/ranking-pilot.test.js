import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-constants.js', () => {
    const pilotStore = {};
    return {
        MEMBER_ROLE_ID: 'mock-member-role',
        DISCORD_SERVER_ID: 'mock-guild-id',
        pendingPilotApprovals: pilotStore,
        adminChannelId: null
    };
});

import * as constants from '../src/core/ranking-constants.js';
function getPending() { return constants.pendingPilotApprovals; }

vi.mock('../src/core/ranking-cache.js', () => ({
    cleanNickname: vi.fn(s => s.trim().normalize('NFC').toLowerCase().replace(/[^a-z0-9]/g, '')),
    levenshteinDistance: vi.fn((a, b) => {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++)
            for (let j = 1; j <= a.length; j++)
                matrix[i][j] = b[i-1] === a[j-1] ? matrix[i-1][j-1] : Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
        return matrix[b.length][a.length];
    })
}));

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key) => key)
}));

import { handlePilotRegistrationModal, handlePilotRemoveSelect, handleOwnerRemovePilotDm } from '../src/handlers/ranking-pilot.js';

// ──────────────────────────────────────────
// handlePilotRegistrationModal
// ──────────────────────────────────────────

describe('handlePilotRegistrationModal', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const OWNER_ID = '111111111111111111';
    const PILOT_ID = '222222222222222222';
    const OWNER_NICK = 'PlayerOne';
    const PILOT_TAG = 'PilotUser#1234';

    function setupBaseDb() {
        db.users[OWNER_ID] = { nickname: OWNER_NICK, pilotIds: [] };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(getPending()).forEach(k => delete getPending()[k]);

        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        constants.adminChannelId = null;

        interaction = {
            fields: { getTextInputValue: vi.fn() },
            deferReply: vi.fn().mockResolvedValue(),
            user: { id: PILOT_ID, tag: PILOT_TAG },
            guild: {
                members: { fetch: vi.fn() },
                channels: { cache: { get: vi.fn() } }
            },
            editReply: vi.fn().mockResolvedValue()
        };
    });

    it('errors when owner not found (exact or fuzzy)', async () => {
        interaction.fields.getTextInputValue.mockReturnValue('NonExistentPlayer');
        setupBaseDb();

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('Owner not found')
        );
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('errors when pilot tries to register as own pilot', async () => {
        interaction.user = { id: OWNER_ID, tag: 'OwnerUser#0001' };
        interaction.fields.getTextInputValue.mockReturnValue(OWNER_NICK);
        setupBaseDb();

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('cannot register as your own pilot')
        );
    });

    it('errors when owner already has 4 pilots', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(OWNER_NICK);
        db.users[OWNER_ID] = { nickname: OWNER_NICK, pilotIds: ['p1', 'p2', 'p3', 'p4'] };

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('maximum of 4 pilots')
        );
    });

    it('errors when pilot already linked to owner', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(OWNER_NICK);
        db.users[OWNER_ID] = { nickname: OWNER_NICK, pilotIds: [PILOT_ID] };

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('already registered as a pilot')
        );
    });

    it('DMs owner for approval and saves pending', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(OWNER_NICK);
        setupBaseDb();
        const dmChannel = { send: vi.fn().mockResolvedValue() };
        const ownerMember = {
            createDM: vi.fn().mockResolvedValue(dmChannel)
        };
        interaction.guild.members.fetch.mockResolvedValue(ownerMember);

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(getPending()[PILOT_ID]).toBeDefined();
        expect(getPending()[PILOT_ID].ownerId).toBe(OWNER_ID);
        expect(saveLocalStorage).toHaveBeenCalledOnce();
        expect(ownerMember.createDM).toHaveBeenCalledOnce();
        expect(dmChannel.send).toHaveBeenCalledWith({
            content: expect.stringContaining('wants to register as your pilot'),
            components: expect.any(Array)
        });
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('Request sent')
        );
        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('requested to be pilot')
        );
    });

    it('sends copy to admin channel if configured', async () => {
        constants.adminChannelId = 'admin-ch-123';
        interaction.fields.getTextInputValue.mockReturnValue(OWNER_NICK);
        setupBaseDb();
        const ownerMember = {
            createDM: vi.fn().mockResolvedValue({
                send: vi.fn().mockResolvedValue()
            })
        };
        interaction.guild.members.fetch.mockResolvedValue(ownerMember);
        const adminChSend = vi.fn().mockResolvedValue();
        interaction.guild.channels = {
            cache: { get: vi.fn().mockReturnValue({ send: adminChSend }) }
        };

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(adminChSend).toHaveBeenCalledWith({
            content: expect.stringContaining('Pilot Registration Request'),
            components: expect.any(Array)
        });
    });

    it('handles DM failure gracefully (deletes pending, saves, errors)', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(OWNER_NICK);
        setupBaseDb();
        interaction.guild.members.fetch.mockRejectedValue(new Error('Cannot DM'));

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(getPending()[PILOT_ID]).toBeUndefined();
        // saveLocalStorage is called twice: once after setting pending, once after deleting it on error
        expect(saveLocalStorage).toHaveBeenCalledTimes(2);
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('Could not send DM')
        );
        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('Failed to send pilot DM')
        );
    });

    it('fuzzy matches owner when exact name fails', async () => {
        interaction.fields.getTextInputValue.mockReturnValue('PlayrOne');
        db.users[OWNER_ID] = { nickname: OWNER_NICK, pilotIds: [] };
        db.users['444444444444444444'] = { nickname: 'OtherPlayer', pilotIds: [] };

        const ownerMember = {
            createDM: vi.fn().mockResolvedValue({
                send: vi.fn().mockResolvedValue()
            })
        };
        interaction.guild.members.fetch.mockResolvedValue(ownerMember);

        await handlePilotRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(getPending()[PILOT_ID]).toBeDefined();
        expect(getPending()[PILOT_ID].ownerId).toBe(OWNER_ID);
        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('fuzzy matched owner')
        );
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('Corrected')
        );
    });
});

// ──────────────────────────────────────────
// handleOwnerRemovePilotDm (existing tests)
// ──────────────────────────────────────────

describe('handleOwnerRemovePilotDm', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const OWNER_ID = '333333333333333333';
    const PILOT_ID = '444444444444444444';
    const PILOT_TAG = 'PilotUser#1234';
    const PILOT_USERNAME = 'PilotUser';

    beforeEach(() => {
        vi.clearAllMocks();

        Object.keys(getPending()).forEach(k => delete getPending()[k]);

        db = {
            users: {
                [OWNER_ID]: {
                    nickname: 'OwnerNick',
                    pilotIds: [PILOT_ID]
                }
            }
        };

        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            deferUpdate: vi.fn(),
            customId: `owner_remove_pilot_${PILOT_ID}`,
            user: { id: OWNER_ID },
            client: {
                guilds: {
                    cache: {
                        get: vi.fn()
                    }
                }
            },
            editReply: vi.fn().mockResolvedValue()
        };
    });

    it('replies error when ownerData does not exist', async () => {
        db.users = {};
        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ This pilot is no longer linked to your account.',
            components: []
        });
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('replies error when pilot not in list', async () => {
        db.users[OWNER_ID].pilotIds = ['some-other-pilot'];
        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ This pilot is no longer linked to your account.',
            components: []
        });
    });

    it('replies error when pilotIds is undefined', async () => {
        db.users[OWNER_ID].pilotIds = undefined;
        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ This pilot is no longer linked to your account.',
            components: []
        });
    });

    it('removes pilot successfully when guild and pilot member exist', async () => {
        const pilotMember = {
            user: { tag: PILOT_TAG, username: PILOT_USERNAME },
            roles: {
                cache: { has: vi.fn().mockReturnValue(true) },
                remove: vi.fn().mockResolvedValue()
            },
            setNickname: vi.fn().mockResolvedValue()
        };
        const mockGuild = { members: { fetch: vi.fn().mockResolvedValue(pilotMember) } };
        interaction.client.guilds.cache.get.mockReturnValue(mockGuild);

        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);

        expect(db.users[OWNER_ID].pilotIds).not.toContain(PILOT_ID);
        expect(saveLocalStorage).toHaveBeenCalledOnce();
        expect(pilotMember.roles.remove).toHaveBeenCalledWith('mock-member-role');
        expect(pilotMember.setNickname).toHaveBeenCalledWith(PILOT_USERNAME);
        expect(logEvent).toHaveBeenCalledWith(
            `❌ Owner ${OWNER_ID} removed pilot ${PILOT_ID} (${PILOT_TAG}) via DM button`
        );
    });

    it('removes pilot even when guild is not found', async () => {
        interaction.client.guilds.cache.get.mockReturnValue(null);
        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);
        expect(db.users[OWNER_ID].pilotIds).not.toContain(PILOT_ID);
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('(Unknown) via DM button'));
    });

    it('removes pilot when pilot member no longer in guild', async () => {
        const mockGuild = { members: { fetch: vi.fn().mockResolvedValue(null) } };
        interaction.client.guilds.cache.get.mockReturnValue(mockGuild);
        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);
        expect(db.users[OWNER_ID].pilotIds).not.toContain(PILOT_ID);
    });

    it('does not remove role if pilot lacks member role', async () => {
        const pilotMember = {
            user: { tag: PILOT_TAG, username: PILOT_USERNAME },
            roles: {
                cache: { has: vi.fn().mockReturnValue(false) },
                remove: vi.fn()
            },
            setNickname: vi.fn().mockResolvedValue()
        };
        const mockGuild = { members: { fetch: vi.fn().mockResolvedValue(pilotMember) } };
        interaction.client.guilds.cache.get.mockReturnValue(mockGuild);
        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);
        expect(pilotMember.roles.remove).not.toHaveBeenCalled();
    });

    it('handles fetch rejection silently', async () => {
        const mockGuild = { members: { fetch: vi.fn().mockRejectedValue(new Error('API error')) } };
        interaction.client.guilds.cache.get.mockReturnValue(mockGuild);
        await handleOwnerRemovePilotDm(interaction, db, saveLocalStorage, logEvent);
        expect(db.users[OWNER_ID].pilotIds).not.toContain(PILOT_ID);
        expect(logEvent).toHaveBeenCalledTimes(1);
    });
});
