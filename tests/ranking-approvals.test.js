import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-constants.js', () => {
    const pilotStore = {};
    const regStore = {};
    return {
        MEMBER_ROLE_ID: 'mock-member-role',
        DISCORD_SERVER_ID: 'mock-guild-id',
        pendingPilotApprovals: pilotStore,
        pendingRegistrations: regStore,
        APPROVER_ROLE_IDS: ['approver-role-1', 'approver-role-2'],
        PENDING_MAX_AGE_MS: 86400000
    };
});

import * as constants from '../src/core/ranking-constants.js';

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key, vars) => {
        if (key === 'ranking.logs.roleAdded') {
            return `✅ Member role added to ${vars?.username || 'unknown'}`;
        }
        return key;
    })
}));

// Helpers to access the shared mutable objects
function getPendingPilots() { return constants.pendingPilotApprovals; }
function getPendingRegs() { return constants.pendingRegistrations; }

import { handleAdminApprovePilot, handleApproveOwner, handleRejectOwner } from '../src/handlers/ranking-approvals.js';

// ──────────────────────────────────────────
// handleAdminApprovePilot tests
// ──────────────────────────────────────────

describe('handleAdminApprovePilot', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const OWNER_ID = '111111111111111111';
    const PILOT_ID = '222222222222222222';
    const PILOT_TAG = 'PilotUser#1234';
    const OWNER_NICK = 'OwnerNick';
    const ADMIN_TAG = 'AdminUser#0001';

    function setupPending() {
        getPendingPilots()[PILOT_ID] = {
            ownerId: OWNER_ID, ownerNick: OWNER_NICK,
            pilotId: PILOT_ID, pilotTag: PILOT_TAG,
            timestamp: Date.now()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(getPendingPilots()).forEach(k => delete getPendingPilots()[k]);

        db = { users: { [OWNER_ID]: { nickname: OWNER_NICK, pilotIds: [] } } };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: `admin_approve_pilot_${PILOT_ID}-yes`,
            deferUpdate: vi.fn().mockResolvedValue(),
            user: { id: ADMIN_TAG, tag: ADMIN_TAG },
            member: {
                permissions: { has: vi.fn().mockReturnValue(true) },
                roles: { cache: { some: vi.fn().mockReturnValue(false) } }
            },
            client: {
                guilds: { cache: { get: vi.fn() } },
                users: { fetch: vi.fn() }
            },
            editReply: vi.fn().mockResolvedValue(),
            followUp: vi.fn().mockResolvedValue()
        };
    });

    it('replies "already processed" when no pending', async () => {
        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.editReply).toHaveBeenCalledWith({ content: '⌛ This request has already been processed.', components: [] });
    });

    it('follows up error when no permission', async () => {
        setupPending();
        interaction.member.permissions.has.mockReturnValue(false);
        interaction.member.roles.cache.some.mockReturnValue(false);
        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.followUp).toHaveBeenCalledWith({ content: '❌ You do not have permission to approve pilot registrations.', flags: 64 });
    });

    it('rejects pilot, deletes pending, notifies pilot', async () => {
        interaction.customId = `admin_approve_pilot_${PILOT_ID}-no`;
        setupPending();
        const pilotUser = { send: vi.fn().mockResolvedValue() };
        interaction.client.users.fetch.mockResolvedValue(pilotUser);

        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);

        expect(getPendingPilots()[PILOT_ID]).toBeUndefined();
        expect(saveLocalStorage).toHaveBeenCalledOnce();
        expect(logEvent).toHaveBeenCalledWith(`❌ Admin ${ADMIN_TAG} REJECTED pilot ${PILOT_ID} (${PILOT_TAG}) for owner ${OWNER_NICK}`);
        expect(pilotUser.send).toHaveBeenCalledWith('❌ Your pilot registration was rejected by an administrator.');
    });

    it('rejection does not crash when pilot DM fails', async () => {
        interaction.customId = `admin_approve_pilot_${PILOT_ID}-no`;
        setupPending();
        interaction.client.users.fetch.mockRejectedValue(new Error('DMs closed'));
        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('❌ **Pilot Rejected by Admin**'), components: [] });
    });

    it('errors when guild not found', async () => {
        setupPending();
        interaction.client.guilds.cache.get.mockReturnValue(null);
        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);
        expect(logEvent).toHaveBeenCalledWith('❌ Admin pilot approval failed: guild not found');
    });

    it('errors when pilot/owner not in server', async () => {
        setupPending();
        interaction.client.guilds.cache.get.mockReturnValue({ members: { fetch: vi.fn().mockResolvedValue(null) } });
        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);
        expect(logEvent).toHaveBeenCalledWith('❌ Admin pilot approval failed: owner or pilot no longer in server');
    });

    it('full success: registers pilot, sets nickname, adds role, DMs', async () => {
        setupPending();
        const pilotMember = {
            user: { tag: PILOT_TAG, username: 'PilotUser' },
            roles: { cache: { has: vi.fn().mockReturnValue(false) }, add: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue()
        };
        const ownerMember = { user: { tag: 'OwnerUser#5678', username: 'OwnerUser' } };
        const mockGuild = { members: { fetch: vi.fn() } };
        mockGuild.members.fetch.mockImplementation(id =>
            id === PILOT_ID ? Promise.resolve(pilotMember) : Promise.resolve(ownerMember)
        );
        interaction.client.guilds.cache.get.mockReturnValue(mockGuild);
        const pilotUser = { send: vi.fn().mockResolvedValue() };
        const ownerUser = { send: vi.fn().mockResolvedValue() };
        interaction.client.users.fetch.mockImplementation(id =>
            id === PILOT_ID ? Promise.resolve(pilotUser) : Promise.resolve(ownerUser)
        );

        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);

        expect(getPendingPilots()[PILOT_ID]).toBeUndefined();
        expect(db.users[OWNER_ID].pilotIds).toContain(PILOT_ID);
        expect(pilotMember.setNickname).toHaveBeenCalledWith(`${OWNER_NICK} - Pilot`);
        expect(pilotMember.roles.add).toHaveBeenCalledWith('mock-member-role');
        expect(pilotUser.send).toHaveBeenCalledWith('✅ **Your pilot registration was approved by an administrator!**');
        expect(ownerUser.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('✈️ **Pilot Registered by Admin**') }));
    });

    it('does not role.add if pilot already has role', async () => {
        setupPending();
        const pilotMember = {
            user: { tag: PILOT_TAG, username: 'PilotUser' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue()
        };
        const mockGuild = { members: { fetch: vi.fn().mockResolvedValue(pilotMember) } };
        interaction.client.guilds.cache.get.mockReturnValue(mockGuild);
        interaction.client.users.fetch.mockResolvedValue({ send: vi.fn() });

        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);
        expect(pilotMember.roles.add).not.toHaveBeenCalled();
    });

    it('handles owner DM failure gracefully', async () => {
        setupPending();
        const pilotMember = {
            user: { tag: PILOT_TAG, username: 'PilotUser' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue()
        };
        const mockGuild = { members: { fetch: vi.fn().mockResolvedValue(pilotMember) } };
        interaction.client.guilds.cache.get.mockReturnValue(mockGuild);
        const pilotUser = { send: vi.fn().mockResolvedValue() };
        interaction.client.users.fetch.mockImplementation(id =>
            id === PILOT_ID ? Promise.resolve(pilotUser) : Promise.reject(new Error('Cannot DM'))
        );

        await handleAdminApprovePilot(interaction, db, saveLocalStorage, logEvent);
        expect(db.users[OWNER_ID].pilotIds).toContain(PILOT_ID);
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('⚠️ Could not DM owner'));
    });
});

// ──────────────────────────────────────────
// handleApproveOwner tests
// ──────────────────────────────────────────

describe('handleApproveOwner', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const USER_ID = '333333333333333333';
    const USER_NICK = 'PlayerOne';
    const ADMIN_TAG = 'AdminUser#0001';

    function setupPending(overrides = {}) {
        getPendingRegs()[USER_ID] = {
            nickname: USER_NICK,
            timestamp: Date.now(),
            channelId: null,
            messageId: null,
            selectedNickname: null,
            ...overrides
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(getPendingRegs()).forEach(k => delete getPendingRegs()[k]);

        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: `approve_owner_${USER_ID}-yes`,
            update: vi.fn().mockResolvedValue(),
            deferUpdate: vi.fn().mockResolvedValue(),
            showModal: vi.fn().mockResolvedValue(),
            user: { id: ADMIN_TAG, tag: ADMIN_TAG },
            member: {
                permissions: { has: vi.fn().mockReturnValue(true) },
                roles: { cache: { some: vi.fn().mockReturnValue(false) } }
            },
            guild: {
                members: { fetch: vi.fn() }
            },
            followUp: vi.fn().mockResolvedValue(),
            editReply: vi.fn().mockResolvedValue()
        };
    });

    // ── Early returns ──

    it('returns "already processed" when no pending', async () => {
        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.update).toHaveBeenCalledWith({ content: '⌛ This request was already processed.', components: [] });
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('marks expired registration (>24h) and deletes pending', async () => {
        setupPending({ timestamp: Date.now() - 86400001 }); // just over 24h
        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        expect(getPendingRegs()[USER_ID]).toBeUndefined();
        expect(saveLocalStorage).toHaveBeenCalledOnce();
        expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining('This registration has expired')
        }));
    });

    // ── Rejection (result === 'no') ──

    it('reject flow: shows modal when user has permission', async () => {
        interaction.customId = `approve_owner_${USER_ID}-no`;
        setupPending();

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.showModal).toHaveBeenCalled();
        // Verify it's a modal with reject customId
        const modal = interaction.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toBe(`reject_owner_${USER_ID}`);
    });

    it('reject flow: followUp error when user lacks permission', async () => {
        interaction.customId = `approve_owner_${USER_ID}-no`;
        setupPending();
        interaction.member.permissions.has.mockReturnValue(false);
        interaction.member.roles.cache.some.mockReturnValue(false);

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.deferUpdate).toHaveBeenCalledOnce();
        expect(interaction.followUp).toHaveBeenCalledWith({
            content: '❌ You do not have permission to reject registrations.', flags: 64
        });
    });

    // ── Approve flow: permission ──

    it('approve flow: followUp error when user lacks permission', async () => {
        setupPending();
        interaction.member.permissions.has.mockReturnValue(false);
        interaction.member.roles.cache.some.mockReturnValue(false);

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.followUp).toHaveBeenCalledWith({
            content: '❌ You do not have permission to approve registrations.', flags: 64
        });
    });

    // ── Approve flow: member not found ──

    it('approve flow: errors when target member not in server', async () => {
        setupPending();
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('tried to approve')
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ User is no longer in the server.', components: []
        });
    });

    // ── Full approval (yes) ──

    it('approves permanently: sets nickname, adds role, sends DM', async () => {
        setupPending({ selectedNickname: USER_NICK });
        const targetMember = {
            toString: () => `<@${USER_ID}>`,
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(false) }, add: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue(),
            send: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        // User registered in db
        expect(db.users[USER_ID].nickname).toBe(USER_NICK);
        expect(db.users[USER_ID].registeredAt).toBeDefined();
        expect(db.users[USER_ID].pilotIds).toEqual([]);
        // No temp fields
        expect(db.users[USER_ID].tempUntil).toBeUndefined();

        // Pending cleaned up
        expect(getPendingRegs()[USER_ID]).toBeUndefined();
        expect(saveLocalStorage).toHaveBeenCalledOnce();

        // Nickname set
        expect(targetMember.setNickname).toHaveBeenCalledWith(USER_NICK);

        // Role added
        expect(targetMember.roles.add).toHaveBeenCalledWith('mock-member-role');

        // Log
        expect(logEvent).toHaveBeenCalledWith(
            `✅ APPROVED Admin ${ADMIN_TAG} approved registration for ${USER_ID} as ${USER_NICK}`
        );

        // Reply
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: expect.stringContaining('✅ APPROVED'),
            components: []
        });

        // DM sent
        expect(targetMember.send).toHaveBeenCalledWith(
            '✅ **Registration approved!** You received the member role.'
        );
    });

    // ── Temporary approval (temp) ──

    it('approves temporarily: sets tempUntil, uses temp DM msg', async () => {
        interaction.customId = `approve_owner_${USER_ID}-temp`;
        setupPending({ selectedNickname: USER_NICK });
        const targetMember = {
            toString: () => `<@${USER_ID}>`,
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue(),
            send: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        // Temp fields set
        expect(db.users[USER_ID].tempUntil).toBeDefined();
        expect(db.users[USER_ID].tempRegisteredAt).toBeDefined();

        // Log
        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('⏳ TEMPORARILY APPROVED')
        );

        // DM with temp message
        expect(targetMember.send).toHaveBeenCalledWith(
            expect.stringContaining('Temporary registration approved')
        );
    });

    it('temporary approval: does not role.add if already has role', async () => {
        interaction.customId = `approve_owner_${USER_ID}-temp`;
        setupPending();
        const targetMember = {
            toString: () => `<@${USER_ID}>`,
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue(),
            send: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        expect(targetMember.roles.add).not.toHaveBeenCalled();
    });

    // ── selectedNickname ──

    it('uses selectedNickname when admin chose a suggestion', async () => {
        const SUGGESTED_NICK = 'PlayerOneCorrected';
        setupPending({ selectedNickname: SUGGESTED_NICK, nickname: USER_NICK });
        const targetMember = {
            toString: () => `<@${USER_ID}>`,
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(false) }, add: vi.fn().mockResolvedValue() },
            setNickname: vi.fn().mockResolvedValue(),
            send: vi.fn().mockResolvedValue()
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        await handleApproveOwner(interaction, db, saveLocalStorage, logEvent);

        // Uses selectedNickname (not the original pending.nickname)
        expect(db.users[USER_ID].nickname).toBe(SUGGESTED_NICK);
        expect(targetMember.setNickname).toHaveBeenCalledWith(SUGGESTED_NICK);
        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining(SUGGESTED_NICK)
        );
    });

    // ── DM failure ──

    it('handles DM failure gracefully', async () => {
        setupPending();
        const targetMember = {
            toString: () => `<@${USER_ID}>`,
            user: { tag: 'PlayerOne#1234', username: 'PlayerOne' },
            roles: { cache: { has: vi.fn().mockReturnValue(true) }, add: vi.fn() },
            setNickname: vi.fn().mockResolvedValue(),
            send: vi.fn().mockRejectedValue(new Error('DMs closed'))
        };
        interaction.guild.members.fetch.mockResolvedValue(targetMember);

        // Should not throw
        await expect(handleApproveOwner(interaction, db, saveLocalStorage, logEvent)).resolves.toBeUndefined();

        // Registration still went through
        expect(db.users[USER_ID].nickname).toBe(USER_NICK);
    });
});

// ──────────────────────────────────────────
// handleRejectOwner tests
// ──────────────────────────────────────────

describe('handleRejectOwner', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const USER_ID = '333333333333333333';
    const USER_NICK = 'PlayerOne';
    const ADMIN_TAG = 'AdminUser#0001';
    const REJECT_REASON = 'Not in ranking. Must appear in Top 1000 first.';

    function setupPending(overrides = {}) {
        getPendingRegs()[USER_ID] = {
            nickname: USER_NICK,
            timestamp: Date.now(),
            channelId: null,
            messageId: null,
            selectedNickname: null,
            ...overrides
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(getPendingRegs()).forEach(k => delete getPendingRegs()[k]);

        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: `reject_owner_${USER_ID}`,
            fields: {
                getTextInputValue: vi.fn()
            },
            reply: vi.fn().mockResolvedValue(),
            deferReply: vi.fn().mockResolvedValue(),
            user: { id: ADMIN_TAG, tag: ADMIN_TAG },
            member: {
                permissions: { has: vi.fn().mockReturnValue(true) },
                roles: { cache: { some: vi.fn().mockReturnValue(false) } }
            },
            guild: {
                channels: { cache: { get: vi.fn() } }
            },
            client: {
                users: { fetch: vi.fn() }
            },
            editReply: vi.fn().mockResolvedValue()
        };
    });

    it('replies error when user lacks permission', async () => {
        interaction.member.permissions.has.mockReturnValue(false);
        interaction.member.roles.cache.some.mockReturnValue(false);

        await handleRejectOwner(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.reply).toHaveBeenCalledWith({
            content: '❌ You do not have permission to reject registrations.',
            flags: 64
        });
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('replies expired when no pending registration', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(REJECT_REASON);

        await handleRejectOwner(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            '⌛ This registration has expired or was already processed.'
        );
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('rejects, deletes pending, logs, DMs user', async () => {
        setupPending();
        interaction.fields.getTextInputValue.mockReturnValue(REJECT_REASON);
        const targetUser = { send: vi.fn().mockResolvedValue() };
        interaction.client.users.fetch.mockResolvedValue(targetUser);

        await handleRejectOwner(interaction, db, saveLocalStorage, logEvent);

        // Pending removed
        expect(getPendingRegs()[USER_ID]).toBeUndefined();
        expect(saveLocalStorage).toHaveBeenCalledOnce();

        // Log
        expect(logEvent).toHaveBeenCalledWith(
            `❌ Admin ${ADMIN_TAG} REJECTED registration for ${USER_ID} (nickname: ${USER_NICK}) — reason: ${REJECT_REASON}`
        );

        // DM sent
        expect(targetUser.send).toHaveBeenCalledWith(
            expect.stringContaining('Registration Rejected')
        );
        expect(targetUser.send).toHaveBeenCalledWith(
            expect.stringContaining(REJECT_REASON)
        );

        // Reply
        expect(interaction.editReply).toHaveBeenCalledWith(
            '❌ **Registration rejected.** The user was notified via DM with the reason.'
        );
    });

    it('updates admin channel message if channelId and messageId exist', async () => {
        setupPending({ channelId: 'admin-ch-1', messageId: 'msg-1' });
        interaction.fields.getTextInputValue.mockReturnValue(REJECT_REASON);
        const targetUser = { send: vi.fn().mockResolvedValue() };
        interaction.client.users.fetch.mockResolvedValue(targetUser);

        const adminMsg = { edit: vi.fn().mockResolvedValue() };
        const adminChannel = {
            messages: { fetch: vi.fn().mockResolvedValue(adminMsg) }
        };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        await handleRejectOwner(interaction, db, saveLocalStorage, logEvent);

        // Admin message updated
        expect(adminMsg.edit).toHaveBeenCalledWith({
            content: expect.stringContaining('❌ **Registration Rejected**'),
            components: []
        });
    });

    it('handles DM failure gracefully (logs warning)', async () => {
        setupPending();
        interaction.fields.getTextInputValue.mockReturnValue(REJECT_REASON);
        interaction.client.users.fetch.mockRejectedValue(new Error('DMs closed'));

        await handleRejectOwner(interaction, db, saveLocalStorage, logEvent);

        // Warning logged
        expect(logEvent).toHaveBeenCalledWith(
            `⚠️ Could not send rejection DM to ${USER_ID} (DMs closed or user not found)`
        );

        // Still succeeded
        expect(getPendingRegs()[USER_ID]).toBeUndefined();
        expect(interaction.editReply).toHaveBeenCalledWith(
            '❌ **Registration rejected.** The user was notified via DM with the reason.'
        );
    });

    it('handles admin channel message fetch failure gracefully', async () => {
        setupPending({ channelId: 'admin-ch-1', messageId: 'msg-1' });
        interaction.fields.getTextInputValue.mockReturnValue(REJECT_REASON);
        const targetUser = { send: vi.fn().mockResolvedValue() };
        interaction.client.users.fetch.mockResolvedValue(targetUser);

        // Admin channel exists but message fetch fails
        const adminChannel = {
            messages: { fetch: vi.fn().mockRejectedValue(new Error('Message deleted')) }
        };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        // Should not throw
        await expect(handleRejectOwner(interaction, db, saveLocalStorage, logEvent)).resolves.toBeUndefined();

        // Rejection still succeeded
        expect(getPendingRegs()[USER_ID]).toBeUndefined();
        expect(interaction.editReply).toHaveBeenCalledWith(
            '❌ **Registration rejected.** The user was notified via DM with the reason.'
        );
    });
});
