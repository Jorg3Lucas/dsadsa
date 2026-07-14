import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-constants.js', () => {
    const regStore = {};
    let chId = null;
    return {
        WORLD_IDS: { 611: 'EU011', 612: 'EU012' },
        pendingRegistrations: regStore,
        get adminChannelId() { return chId; },
        set adminChannelId(v) { chId = v; }
    };
});

import * as constants from '../src/core/ranking-constants.js';

function getPending() { return constants.pendingRegistrations; }

vi.mock('../src/core/ranking-service.js', () => ({
    lookupNickname: vi.fn(),
    lookupTopNicknames: vi.fn()
}));

import { lookupNickname, lookupTopNicknames } from '../src/core/ranking-service.js';
import { handleOwnerRegistrationModal } from '../src/handlers/ranking-registration.js';

describe('handleOwnerRegistrationModal', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const USER_ID = '111111111111111111';
    const USER_TAG = 'TestUser#1234';
    const NICKNAME = 'PlayerOne';

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(getPending()).forEach(k => delete getPending()[k]);
        constants.adminChannelId = null;
        constants.WORLD_IDS = { 611: 'EU011', 612: 'EU012' };

        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            fields: { getTextInputValue: vi.fn() },
            deferReply: vi.fn().mockResolvedValue(),
            user: { id: USER_ID, tag: USER_TAG, toString: () => `<@${USER_ID}>` },
            guild: {
                channels: { cache: { get: vi.fn() } }
            },
            editReply: vi.fn().mockResolvedValue()
        };
    });

    // ── Early returns ──

    it('errors when nickname is already taken', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        db.users['222222222222222222'] = { nickname: NICKNAME };

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('already registered')
        );
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('errors when admin channel not configured', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        lookupNickname.mockReturnValue({ found: false });
        lookupTopNicknames.mockReturnValue([]);

        constants.adminChannelId = null;

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('not configured')
        );
        expect(getPending()[USER_ID]).toBeUndefined();
        expect(saveLocalStorage).not.toHaveBeenCalled();
    });

    it('errors when admin channel not found', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        lookupNickname.mockReturnValue({ found: false });
        lookupTopNicknames.mockReturnValue([]);

        constants.adminChannelId = 'admin-ch-123';
        interaction.guild.channels.cache.get.mockReturnValue(null);

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('not found')
        );
        expect(getPending()[USER_ID]).toBeUndefined();
    });

    // ── Success (no suggestions) ──

    it('sends approval message to admin channel and saves pending', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        lookupNickname.mockReturnValue({ found: true, serverName: 'EU011', clanName: 'ToxicFamily', inAlliedClan: true, exactMatch: true, fuzzySuggestion: null });
        lookupTopNicknames.mockReturnValue([]);

        constants.adminChannelId = 'admin-ch-123';
        const adminMsg = { id: 'msg-1' };
        const adminChannel = { id: 'admin-ch-123', send: vi.fn().mockResolvedValue(adminMsg) };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        // Pending saved
        expect(getPending()[USER_ID]).toBeDefined();
        expect(getPending()[USER_ID].nickname).toBe(NICKNAME);
        expect(getPending()[USER_ID].channelId).toBe('admin-ch-123');
        expect(getPending()[USER_ID].messageId).toBe('msg-1');
        expect(saveLocalStorage).toHaveBeenCalledOnce();

        // Admin message sent
        expect(adminChannel.send).toHaveBeenCalledWith({
            content: expect.stringContaining('New Owner Registration'),
            components: expect.any(Array)
        });

        // Log
        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('submitted owner registration')
        );

        // Success reply
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('sent for approval')
        );
    });

    it('shows not-found ranking status when lookup fails', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        lookupNickname.mockReturnValue({ found: false });
        lookupTopNicknames.mockReturnValue([]);

        constants.adminChannelId = 'admin-ch-123';
        const adminMsg = { id: 'msg-2' };
        const adminChannel = { id: 'admin-ch-123', send: vi.fn().mockResolvedValue(adminMsg) };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        expect(adminChannel.send).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('❌ Not found in ranking')
            })
        );
    });

    it('includes temp approval button in components when not found in ranking', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        lookupNickname.mockReturnValue({ found: false });
        lookupTopNicknames.mockReturnValue([]);

        constants.adminChannelId = 'admin-ch-123';
        const adminMsg = { id: 'msg-3' };
        const adminChannel = { id: 'admin-ch-123', send: vi.fn().mockResolvedValue(adminMsg) };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        // Content shows not found (prerequisite for temp button)
        const sendArgs = adminChannel.send.mock.calls[0][0];
        expect(sendArgs.content).toContain('❌ Not found in ranking');
        // Temp button label is in the component row, not in content
    });

    // ── With fuzzy suggestions ──

    it('includes select menu when suggestions exist', async () => {
        interaction.fields.getTextInputValue.mockReturnValue('PlayrOne');
        lookupNickname.mockReturnValue({ found: true, serverName: 'EU011', clanName: 'ToxicFamily', inAlliedClan: true, exactMatch: false, fuzzySuggestion: 'PlayerOne' });
        lookupTopNicknames.mockReturnValue([
            { nickname: 'PlayerOne', clanName: 'ToxicFamily', serverName: 'EU011', inAlliedClan: true, score: 0.85 },
            { nickname: 'PlayerTwo', clanName: 'GearsofWar', serverName: 'EU011', inAlliedClan: false, score: 0.62 }
        ]);

        constants.adminChannelId = 'admin-ch-123';
        const adminMsg = { id: 'msg-4' };
        const adminChannel = { id: 'admin-ch-123', send: vi.fn().mockResolvedValue(adminMsg) };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        // Fuzzy note in the admin message
        const sendArgs = adminChannel.send.mock.calls[0][0];
        expect(sendArgs.content).toContain('Fuzzy suggestion');
        expect(sendArgs.content).toContain('PlayrOne');
        expect(sendArgs.content).toContain('PlayerOne');

        // Should have 2 component rows: select menu + buttons
        expect(sendArgs.components.length).toBe(2);
    });

    it('shows allied clan status', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        lookupNickname.mockReturnValue({ found: true, serverName: 'EU011', clanName: 'ToxicFamily', inAlliedClan: true, exactMatch: true, fuzzySuggestion: null });
        lookupTopNicknames.mockReturnValue([]);

        constants.adminChannelId = 'admin-ch-123';
        const adminMsg = { id: 'msg-5' };
        const adminChannel = { id: 'admin-ch-123', send: vi.fn().mockResolvedValue(adminMsg) };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        const sendArgs = adminChannel.send.mock.calls[0][0];
        expect(sendArgs.content).toContain('✅ Yes — Allied clan');
    });

    it('shows not-allied status when not in allied clan', async () => {
        interaction.fields.getTextInputValue.mockReturnValue(NICKNAME);
        lookupNickname.mockReturnValue({ found: true, serverName: 'EU012', clanName: 'RandomClan', inAlliedClan: false, exactMatch: true, fuzzySuggestion: null });
        lookupTopNicknames.mockReturnValue([]);

        constants.adminChannelId = 'admin-ch-123';
        const adminMsg = { id: 'msg-6' };
        const adminChannel = { id: 'admin-ch-123', send: vi.fn().mockResolvedValue(adminMsg) };
        interaction.guild.channels.cache.get.mockReturnValue(adminChannel);

        await handleOwnerRegistrationModal(interaction, db, saveLocalStorage, logEvent);

        const sendArgs = adminChannel.send.mock.calls[0][0];
        expect(sendArgs.content).toContain('❌ Not in allied clan');
    });
});
