import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-constants.js', () => {
    const store = {};
    return {
        MEMBER_ROLE_ID: 'mock-member-role',
        SUPER_ADMIN_USER_ID: '999999999999999999',
        NUKE_PROTECTED_CHANNEL_IDS: ['1432320163033645136'],
        confirmationCache: store
    };
});

import * as constants from '../src/core/ranking-constants.js';

function getCache() { return constants.confirmationCache; }

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key, vars) => {
        const templates = {
            'ranking.responses.manualremove.success': `✅ Removed user ${vars?.username}`,
            'ranking.responses.manualremovepilot.success': `✅ Removed pilot ${vars?.pilotDisplay} from ${vars?.ownerDisplay}`,
            'ranking.responses.manualpilot.success': `✅ Linked pilot ${vars?.pilotMember} to ${vars?.nick}`,
            'ranking.responses.manualregister.cacheFound': `✅ Registered ${vars?.nickname} in ${vars?.clan}`,
            'ranking.responses.manualforce.success': `✅ Force-registered ${vars?.username} as ${vars?.nickname}`,
            'ranking.logs.roleAdded': `✅ Member role added to ${vars?.username || 'unknown'}`
        };
        return templates[key] || key;
    })
}));

import { handleConfirmAction } from '../src/handlers/ranking-confirmations.js';

// ──────────────────────────────────────────
// handleConfirmAction — generic tests
// ──────────────────────────────────────────

describe('handleConfirmAction', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const ADMIN_ID = '999999999999999999';
    const TARGET_ID = '111111111111111111';
    const PILOT_A = '222222222222222222';
    const PILOT_B = '333333333333333333';

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(getCache()).forEach(k => delete getCache()[k]);

        db = {
            users: {
                [TARGET_ID]: { nickname: 'PlayerOne', pilotIds: [PILOT_A], registeredAt: new Date().toISOString() },
                [PILOT_A]: { nickname: 'PilotOne', registeredAt: new Date().toISOString() }
            }
        };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: '',
            user: { id: ADMIN_ID, tag: 'AdminUser#0001' },
            guild: {
                members: { fetch: vi.fn() }
            },
            update: vi.fn().mockResolvedValue()
        };
    });

    // ── Generic ──

    it('returns expired when no cached confirmation', async () => {
        interaction.customId = 'confirm-manualremove-yes';
        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('expired')
        }));
    });

    it('returns cancelled when result is no', async () => {
        interaction.customId = 'confirm-manualremove-no';
        getCache()[`${ADMIN_ID}-manualremove`] = { targetId: TARGET_ID, targetName: 'PlayerOne' };

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Action cancelled')
        }));
        expect(getCache()[`${ADMIN_ID}-manualremove`]).toBeUndefined();
    });

    // ── manualremove ──

    it('manualremove: errors when target not found', async () => {
        interaction.customId = 'confirm-manualremove-yes';
        getCache()[`${ADMIN_ID}-manualremove`] = { targetId: 'nonexistent', targetName: 'Ghost' };
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('no longer available')
        }));
    });

    it('manualremove: removes user, cleans pilots, removes role', async () => {
        interaction.customId = 'confirm-manualremove-yes';
        getCache()[`${ADMIN_ID}-manualremove`] = { targetId: TARGET_ID, targetName: 'PlayerOne' };

        const targetMember = {
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, remove: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue()
        };
        const pilotMember = {
            user: { tag: 'PilotOne#5678', username: 'PilotOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, remove: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockImplementation(id =>
            id === TARGET_ID ? Promise.resolve(targetMember) : Promise.resolve(pilotMember)
        );

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        // Target removed from db
        expect(db.users[TARGET_ID]).toBeUndefined();
        expect(saveLocalStorage).toHaveBeenCalledOnce();

        // Pilots cleaned up
        expect(pilotMember.roles.remove).toHaveBeenCalledWith('mock-member-role');
        expect(pilotMember.setNickname).toHaveBeenCalledWith('PilotOne');

        // Target role removed + nickname reset
        expect(targetMember.roles.remove).toHaveBeenCalledWith('mock-member-role');
        expect(targetMember.setNickname).toHaveBeenCalledWith('PlayerOne');

        // Log
        expect(logEvent).toHaveBeenCalledWith(`Admin AdminUser#0001 manually removed user ${TARGET_ID}`);
    });

    // ── manualremovepilot ──

    it('manualremovepilot: errors when owner not found', async () => {
        interaction.customId = 'confirm-manualremovepilot-yes';
        getCache()[`${ADMIN_ID}-manualremovepilot`] = { ownerId: 'nonexistent', pilotId: PILOT_A };
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('no longer available')
        }));
    });

    it('manualremovepilot: errors when pilot not linked', async () => {
        interaction.customId = 'confirm-manualremovepilot-yes';
        getCache()[`${ADMIN_ID}-manualremovepilot`] = { ownerId: TARGET_ID, pilotId: 'unlinked' };
        interaction.guild.members.fetch.mockResolvedValue({ id: TARGET_ID });

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('no longer linked')
        }));
    });

    it('manualremovepilot: removes pilot from owner', async () => {
        interaction.customId = 'confirm-manualremovepilot-yes';
        getCache()[`${ADMIN_ID}-manualremovepilot`] = {
            ownerId: TARGET_ID, pilotId: PILOT_A,
            ownerName: 'PlayerOne', pilotName: 'PilotOne'
        };
        interaction.guild.members.fetch.mockResolvedValue({
            user: { tag: 'PilotOne#5678', username: 'PilotOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, remove: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue()
        });

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        expect(db.users[TARGET_ID].pilotIds).not.toContain(PILOT_A);
        expect(saveLocalStorage).toHaveBeenCalledOnce();
    });

    // ── manualpilot ──

    it('manualpilot: errors when owner not found', async () => {
        interaction.customId = 'confirm-manualpilot-yes';
        getCache()[`${ADMIN_ID}-manualpilot`] = { ownerId: 'nonexistent', pilotId: PILOT_A };
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('no longer available')
        }));
    });

    it('manualpilot: links pilot to owner', async () => {
        interaction.customId = 'confirm-manualpilot-yes';
        db.users[TARGET_ID].pilotIds = []; // ensure empty
        getCache()[`${ADMIN_ID}-manualpilot`] = {
            ownerId: TARGET_ID, pilotId: PILOT_A,
            ownerName: 'PlayerOne', pilotName: 'PilotOne',
            ownerNick: 'PlayerOne'
        };
        const pilotMember = {
            user: { tag: 'PilotOne#5678', username: 'PilotOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(false) }, add: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockImplementation(id =>
            id === PILOT_A ? Promise.resolve(pilotMember) : Promise.resolve({ id: TARGET_ID })
        );

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        expect(db.users[TARGET_ID].pilotIds).toContain(PILOT_A);
        expect(pilotMember.setNickname).toHaveBeenCalledWith('PlayerOne - Pilot');
        expect(pilotMember.roles.add).toHaveBeenCalledWith('mock-member-role');
        expect(saveLocalStorage).toHaveBeenCalledOnce();
    });

    it('manualpilot: does not role.add if pilot already has role', async () => {
        interaction.customId = 'confirm-manualpilot-yes';
        db.users[TARGET_ID].pilotIds = [];
        getCache()[`${ADMIN_ID}-manualpilot`] = {
            ownerId: TARGET_ID, pilotId: PILOT_A,
            ownerName: 'PlayerOne', pilotName: 'PilotOne',
            ownerNick: 'PlayerOne'
        };
        const pilotMember = {
            user: { tag: 'PilotOne#5678', username: 'PilotOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(pilotMember);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        expect(pilotMember.roles.add).not.toHaveBeenCalled();
    });

    // ── manualregister ──

    it('manualregister: errors when target not found', async () => {
        interaction.customId = 'confirm-manualregister-yes';
        getCache()[`${ADMIN_ID}-manualregister`] = { targetId: 'nonexistent', nickname: 'Test' };
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('no longer available')
        }));
    });

    it('manualregister: registers user permanently', async () => {
        interaction.customId = 'confirm-manualregister-yes';
        getCache()[`${ADMIN_ID}-manualregister`] = {
            targetId: TARGET_ID, nickname: 'PlayerOne', clan: 'ToxicFamily',
            worldId: '611', needsTempApproval: false, selectedNickname: null
        };
        const targetMember = {
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(false) }, add: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        expect(db.users[TARGET_ID].nickname).toBe('PlayerOne');
        expect(db.users[TARGET_ID].tempUntil).toBeUndefined();
        expect(targetMember.setNickname).toHaveBeenCalledWith('PlayerOne');
        expect(targetMember.roles.add).toHaveBeenCalledWith('mock-member-role');
        expect(saveLocalStorage).toHaveBeenCalledOnce();
    });

    it('manualregister: registers user as temporary with tempUntil', async () => {
        interaction.customId = 'confirm-manualregister-yes';
        getCache()[`${ADMIN_ID}-manualregister`] = {
            targetId: TARGET_ID, nickname: 'PlayerOne', clan: 'ToxicFamily',
            worldId: '611', needsTempApproval: true, selectedNickname: null
        };
        const targetMember = {
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        expect(db.users[TARGET_ID].tempUntil).toBeDefined();
        expect(db.users[TARGET_ID].tempRegisteredAt).toBeDefined();
        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('temporary')
        );
    });

    it('manualregister: uses selectedNickname when available', async () => {
        interaction.customId = 'confirm-manualregister-yes';
        getCache()[`${ADMIN_ID}-manualregister`] = {
            targetId: TARGET_ID, nickname: 'PlayerOne', clan: 'ToxicFamily',
            worldId: '611', needsTempApproval: false, selectedNickname: 'PlayerOneCorrected'
        };
        const targetMember = {
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        expect(db.users[TARGET_ID].nickname).toBe('PlayerOneCorrected');
        expect(targetMember.setNickname).toHaveBeenCalledWith('PlayerOneCorrected');
    });

    // ── manualforce ──

    it('manualforce: errors when target not found', async () => {
        interaction.customId = 'confirm-manualforce-yes';
        getCache()[`${ADMIN_ID}-manualforce`] = { targetId: 'nonexistent', nickname: 'Test' };
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('no longer available')
        }));
    });

    it('manualforce: registers permanently and cleans temp fields', async () => {
        interaction.customId = 'confirm-manualforce-yes';
        db.users[TARGET_ID] = {
            nickname: 'OldName', tempUntil: '2025-01-01T00:00:00.000Z',
            tempRegisteredAt: '2025-01-01T00:00:00.000Z', clanManual: true
        };
        getCache()[`${ADMIN_ID}-manualforce`] = {
            targetId: TARGET_ID, targetName: 'PlayerOne', nickname: 'PlayerOne'
        };
        const targetMember = {
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(false) }, add: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        // Cleaned temp fields
        expect(db.users[TARGET_ID].tempUntil).toBeUndefined();
        expect(db.users[TARGET_ID].tempRegisteredAt).toBeUndefined();
        expect(db.users[TARGET_ID].clanManual).toBeUndefined();

        // Registered permanently
        expect(db.users[TARGET_ID].nickname).toBe('PlayerOne');
        expect(targetMember.setNickname).toHaveBeenCalledWith('PlayerOne');
        expect(saveLocalStorage).toHaveBeenCalledOnce();
    });

    // ── nuke ──

    it('nuke: denies when user is not the super admin', async () => {
        interaction.customId = 'confirm-nuke-yes';
        interaction.user.id = '111111111111111111'; // not super admin
        getCache()[`${interaction.user.id}-nuke`] = { channelCount: 5, categoryCount: 2 };

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('super admin')
        }));
        expect(getCache()[`${interaction.user.id}-nuke`]).toBeUndefined();
    });

    it('nuke: deletes all channels/categories and creates #geral with summary', async () => {
        interaction.customId = 'confirm-nuke-yes';
        getCache()[`${ADMIN_ID}-nuke`] = { channelCount: 2, categoryCount: 1 };
        db.config = { panelChannelId: 'old-panel', panelMessageId: 'old-msg', alliedClans: {} };

        const catChannel = { type: 4, delete: vi.fn().mockResolvedValue() };
        const txtChannel = { type: 0, delete: vi.fn().mockResolvedValue() };
        const voiceChannel = { type: 2, delete: vi.fn().mockResolvedValue() };
        const geralChannel = { send: vi.fn().mockResolvedValue() };

        interaction.guild.channels = {
            cache: new Map([
                ['cat1', catChannel],
                ['txt1', txtChannel],
                ['voice1', voiceChannel]
            ]),
            create: vi.fn().mockResolvedValue(geralChannel)
        };

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        // Acknowledged before deletion
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('NUKE INITIATED')
        }));

        // All channels deleted (regular first, then categories)
        expect(txtChannel.delete).toHaveBeenCalledOnce();
        expect(voiceChannel.delete).toHaveBeenCalledOnce();
        expect(catChannel.delete).toHaveBeenCalledOnce();

        // Stale panel config cleaned up
        expect(db.config.panelChannelId).toBeUndefined();
        expect(db.config.panelMessageId).toBeUndefined();
        expect(saveLocalStorage).toHaveBeenCalled();

        // #geral created and summary sent with breakdown
        expect(interaction.guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'geral' }));
        expect(geralChannel.send).toHaveBeenCalledWith(expect.stringContaining('NUKE COMPLETED'));
        expect(geralChannel.send).toHaveBeenCalledWith(expect.stringContaining('categor(ies) deleted'));
        expect(geralChannel.send).toHaveBeenCalledWith(expect.stringContaining('channel(s) deleted'));

        // Logged
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('NUKE'));
    });

    it('nuke: preserves protected channels and reports them in the summary', async () => {
        interaction.customId = 'confirm-nuke-yes';
        getCache()[`${ADMIN_ID}-nuke`] = { channelCount: 2, categoryCount: 0 };

        const protectedChannel = { id: '1432320163033645136', type: 0, delete: vi.fn() };
        const normalChannel = { id: '222222222222222222', type: 0, delete: vi.fn().mockResolvedValue() };
        const geralChannel = { send: vi.fn().mockResolvedValue() };

        interaction.guild.channels = {
            cache: new Map([
                ['protected', protectedChannel],
                ['normal', normalChannel]
            ]),
            create: vi.fn().mockResolvedValue(geralChannel)
        };

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        // Protected channel NOT deleted, normal one deleted
        expect(protectedChannel.delete).not.toHaveBeenCalled();
        expect(normalChannel.delete).toHaveBeenCalledOnce();

        // Summary mentions the kept channels
        expect(geralChannel.send).toHaveBeenCalledWith(expect.stringContaining('kept (protected)'));
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('kept 1'));
    });

    it('nuke: does not delete a category containing a protected channel', async () => {
        interaction.customId = 'confirm-nuke-yes';
        getCache()[`${ADMIN_ID}-nuke`] = { channelCount: 2, categoryCount: 1 };

        const protectedChannel = { id: '1432320163033645136', type: 0, parentId: 'cat1', delete: vi.fn() };
        const siblingChannel = { id: '222222222222222222', type: 0, parentId: 'cat1', delete: vi.fn().mockResolvedValue() };
        const catChannel = { id: 'cat1', type: 4, delete: vi.fn() };
        const geralChannel = { send: vi.fn().mockResolvedValue() };

        interaction.guild.channels = {
            cache: new Map([
                ['cat1', catChannel],
                ['protected', protectedChannel],
                ['sibling', siblingChannel]
            ]),
            create: vi.fn().mockResolvedValue(geralChannel)
        };

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        // Category kept because it contains the protected channel (cascade would delete it)
        expect(catChannel.delete).not.toHaveBeenCalled();
        expect(protectedChannel.delete).not.toHaveBeenCalled();
        // Non-protected sibling inside the kept category is still deleted
        expect(siblingChannel.delete).toHaveBeenCalledOnce();
    });

    it('nuke: creates #geral even if a channel delete fails', async () => {
        interaction.customId = 'confirm-nuke-yes';
        getCache()[`${ADMIN_ID}-nuke`] = { channelCount: 1, categoryCount: 0 };

        const failingChannel = { type: 0, delete: vi.fn().mockRejectedValue(new Error('forbidden')) };
        const geralChannel = { send: vi.fn().mockResolvedValue() };

        interaction.guild.channels = {
            cache: new Map([['txt1', failingChannel]]),
            create: vi.fn().mockResolvedValue(geralChannel)
        };

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);

        expect(failingChannel.delete).toHaveBeenCalledOnce();
        expect(interaction.guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'geral' }));
        expect(geralChannel.send).toHaveBeenCalledWith(expect.stringContaining('NUKE COMPLETED'));
    });

    // ── Unknown action ──

    it('returns unknown action for unrecognized action type', async () => {
        interaction.customId = 'confirm-unknownaction-yes';
        getCache()[`${ADMIN_ID}-unknownaction`] = { dummy: true };

        await handleConfirmAction(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('Unknown action')
        }));
    });
});
