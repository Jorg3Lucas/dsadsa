import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearchForum } = vi.hoisted(() => ({ mockSearchForum: vi.fn() }));

// Keep the real allied-clan helpers; only stub the forum request.
vi.mock('../src/core/ranking-service.js', async (importOriginal) => ({
    ...(await importOriginal()),
    searchRankingForumDetailed: mockSearchForum
}));

import {
    openWarLeave,
    trackWarLeaveMember,
    shouldAskElders
} from '../src/core/war-leave.js';

function makeClient() {
    const send = vi.fn(async () => ({ id: 'msg-1' }));
    const channel = { id: 'chan-1', send };
    const client = { channels: { fetch: vi.fn(async () => channel) } };
    return { client, send };
}

function makeDb() {
    return {
        config: {
            adminChannelId: 'chan-1',
            alliedClans: { 611: ['AlliedOne', 'AlliedTwo'] }
        },
        users: {}
    };
}

function forumHit(clanName, serverName = 'EU011') {
    return { results: [{ nickname: 'PlayerOne', clanName, serverName, worldId: null }], ok: true };
}

describe('war leave — allied clan changes must never prompt approvers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not ask the elders when the member is in an allied clan', () => {
        const warLeave = { status: 'pending', lastClan: 'AlliedOne', lastServer: 'EU011', lastAskedAt: new Date().toISOString() };
        expect(shouldAskElders(warLeave, {
            found: true, clanName: 'AlliedTwo', serverName: 'EU011', inAlliedClan: true
        })).toBe(false);
    });

    it('does not ask when the forum finds the member in a different allied clan', async () => {
        const db = makeDb();
        const userData = { nickname: 'PlayerOne' };
        const { client, send } = makeClient();
        mockSearchForum.mockResolvedValue(forumHit('AlliedTwo'));

        const result = await openWarLeave(client, db, '1', userData, vi.fn(), { ranking: null, hasRole: true });

        expect(send).not.toHaveBeenCalled();
        expect(result.asked).toBe(false);
        expect(result.protected).toBe(true);
        expect(result.allied).toBe(true);
        expect(userData.warLeave).toBeUndefined();
    });

    it('still asks when the forum finds the member in a non-allied clan', async () => {
        const db = makeDb();
        const userData = { nickname: 'PlayerOne' };
        const { client, send } = makeClient();
        mockSearchForum.mockResolvedValue(forumHit('RandomClan'));

        const result = await openWarLeave(client, db, '1', userData, vi.fn(), { ranking: null, hasRole: true });

        expect(send).toHaveBeenCalledTimes(1);
        expect(result.asked).toBe(true);
        expect(result.allied).toBeFalsy();
        expect(userData.warLeave.status).toBe('pending');
    });

    it('drops an existing record when the tracked member moved to another allied clan', async () => {
        const db = makeDb();
        const userData = {
            nickname: 'PlayerOne',
            warLeave: {
                status: 'pending',
                since: new Date().toISOString(),
                lastClan: 'AlliedOne',
                lastServer: 'EU011',
                lastAskedAt: new Date().toISOString()
            }
        };
        const { client, send } = makeClient();
        mockSearchForum.mockResolvedValue(forumHit('AlliedTwo'));

        const result = await trackWarLeaveMember(client, db, '1', userData, vi.fn(), { ranking: null, hasRole: true });

        expect(send).not.toHaveBeenCalled();
        expect(result).toEqual({ allied: true });
        expect(userData.warLeave).toBeUndefined();
    });

    it('drops an existing record when the ranking already shows an allied clan', async () => {
        const db = makeDb();
        const userData = {
            nickname: 'PlayerOne',
            warLeave: { status: 'approved', lastClan: 'RandomClan', lastServer: 'EU011', lastAskedAt: new Date().toISOString() }
        };
        const { client, send } = makeClient();

        const result = await trackWarLeaveMember(client, db, '1', userData, vi.fn(), {
            ranking: { found: true, clanName: 'AlliedTwo', serverName: 'EU011', inAlliedClan: true },
            hasRole: true
        });

        expect(send).not.toHaveBeenCalled();
        expect(result).toEqual({ allied: true });
        expect(userData.warLeave).toBeUndefined();
    });

    it('re-asks when a tracked member changes to a non-allied clan', async () => {
        const db = makeDb();
        const userData = {
            nickname: 'PlayerOne',
            warLeave: { status: 'approved', lastClan: 'AlliedOne', lastServer: 'EU011', lastAskedAt: new Date().toISOString() }
        };
        const { client, send } = makeClient();
        mockSearchForum.mockResolvedValue(forumHit('RandomClan'));

        await trackWarLeaveMember(client, db, '1', userData, vi.fn(), { ranking: null, hasRole: true });

        expect(send).toHaveBeenCalledTimes(1);
        expect(userData.warLeave.status).toBe('pending');
        expect(userData.warLeave.lastClan).toBe('RandomClan');
    });
});
