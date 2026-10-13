import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/ranking-constants.js', () => ({
    MEMBER_ROLE_ID: 'mock-member-role'
}));

vi.mock('../src/core/ranking-service.js', () => ({
    lookupNickname: vi.fn()
}));

import { lookupNickname } from '../src/core/ranking-service.js';
import { handleWelcomeMyRegistration, buildWelcomePanelComponents } from '../src/handlers/ranking-welcome.js';

describe('buildWelcomePanelComponents', () => {
    it('includes the self-service "My Registration" button', () => {
        const rows = buildWelcomePanelComponents();
        const ids = rows.flatMap(row => row.components.map(c => c.data.custom_id));
        expect(ids).toContain('welcome_my_registration');
        // The classic registration/removal buttons must still be present
        expect(ids).toContain('welcome_register_owner');
        expect(ids).toContain('welcome_register_pilot');
        expect(ids).toContain('welcome_remove_registration');
        expect(ids).toContain('welcome_remove_pilot');
    });
});

describe('handleWelcomeMyRegistration', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const USER_ID = '111111111111111111';

    beforeEach(() => {
        vi.clearAllMocks();
        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            user: { id: USER_ID, tag: 'User#0001' },
            deferReply: vi.fn().mockResolvedValue(),
            editReply: vi.fn().mockResolvedValue(),
            guild: { members: { fetch: vi.fn().mockResolvedValue(null) } }
        };
    });

    it('invites an unregistered user to register', async () => {
        await handleWelcomeMyRegistration(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('no registration yet')
        );
    });

    it('tells a pilot who their owner is', async () => {
        db.users['owner-1'] = { nickname: 'OwnerOne', registeredAt: 'x', pilotIds: [USER_ID] };
        await handleWelcomeMyRegistration(interaction, db, saveLocalStorage, logEvent);
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('pilot for OwnerOne')
        );
    });

    it('shows a registered owner their nickname, type and ranking status', async () => {
        db.users[USER_ID] = { nickname: 'PlayerOne', registeredAt: 'x', pilotIds: [] };
        lookupNickname.mockReturnValue({ found: true, serverName: 'EU011', clanName: 'ToxicFamily', inAlliedClan: true });

        await handleWelcomeMyRegistration(interaction, db, saveLocalStorage, logEvent);

        const msg = interaction.editReply.mock.calls[0][0];
        expect(msg).toContain('PlayerOne');
        expect(msg).toContain('Permanent');
        expect(msg).toContain('EU011');
        expect(msg).toContain('Yes');
    });

    it('shows temporary registration with remaining time', async () => {
        db.users[USER_ID] = {
            nickname: 'TempPlayer',
            registeredAt: 'x',
            tempUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            pilotIds: []
        };
        lookupNickname.mockReturnValue({ found: false });

        await handleWelcomeMyRegistration(interaction, db, saveLocalStorage, logEvent);

        const msg = interaction.editReply.mock.calls[0][0];
        expect(msg).toContain('Temporary');
        expect(msg).toContain('h left');
        expect(msg).toContain('Not found');
    });
});
