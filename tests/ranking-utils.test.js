import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/core/ranking-cache.js', () => ({
    getLocalRankingCache: vi.fn(() => null)
}));

vi.mock('../src/core/ranking-service.js', () => ({
    lookupNickname: vi.fn()
}));

vi.mock('../src/core/ranking-constants.js', () => ({
    MEMBER_ROLE_ID: '123',
    WORLD_IDS: { 611: 'EU011', 621: 'EU021' },
    SERVER_MERGES: {
        'ASIA013': 'ASIA021', 'EU013': 'EU011', 'NA041': 'NA012'
    },
    resolveServerName: (name) => ({
        'ASIA013': 'ASIA021', 'EU013': 'EU011', 'NA041': 'NA012'
    }[name] || name)
}));

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key) => key)
}));

import { buildPrefixedNickname, baseNicknameKey, stripServerPrefix, stripPilotSuffix, assignMemberRole, refreshRoleChannelAccess, reapplyMemberRole, clearRoleRefreshThrottles } from '../src/core/ranking-utils.js';
import { resolveServerName } from '../src/core/ranking-constants.js';
import { getLocalRankingCache } from '../src/core/ranking-cache.js';
import { lookupNickname } from '../src/core/ranking-service.js';

beforeEach(() => {
    vi.clearAllMocks();
    // Throttles are module state: reset so each test starts from a clean slate.
    clearRoleRefreshThrottles();
});

describe('buildPrefixedNickname', () => {
    const db = { config: {} };

    it('uses the precomputed lookup without re-fetching the cache or re-resolving', () => {
        const precomputed = { found: true, serverName: 'EU011' };
        const result = buildPrefixedNickname('PlayerOne', db, '', precomputed);
        expect(result).toBe('EU011 - PlayerOne');
        expect(getLocalRankingCache).not.toHaveBeenCalled();
        expect(lookupNickname).not.toHaveBeenCalled();
    });

    it('appends the Pilot suffix when requested', () => {
        const precomputed = { found: true, serverName: 'EU011' };
        const result = buildPrefixedNickname('PlayerOne', db, 'Pilot', precomputed);
        expect(result).toBe('EU011 - PlayerOne - Pilot');
    });

    it('falls back to no prefix when the precomputed lookup is not found', () => {
        const precomputed = { found: false };
        const result = buildPrefixedNickname('PlayerOne', db, '', precomputed);
        expect(result).toBe('PlayerOne');
    });

    it('performs a fresh lookup when no precomputed lookup is given (legacy path)', () => {
        getLocalRankingCache.mockReturnValue({ 611: {} });
        lookupNickname.mockReturnValue({ found: true, serverName: 'SA021' });
        const result = buildPrefixedNickname('PlayerOne', db);
        expect(result).toBe('SA021 - PlayerOne');
        expect(getLocalRankingCache).toHaveBeenCalledTimes(1);
        expect(lookupNickname).toHaveBeenCalledWith('PlayerOne', db, { 611: {} });
    });

    it('returns bare nickname when the cache is unavailable (legacy path)', () => {
        getLocalRankingCache.mockReturnValue(null);
        const result = buildPrefixedNickname('PlayerOne', db, 'Pilot');
        expect(result).toBe('PlayerOne - Pilot');
        expect(lookupNickname).not.toHaveBeenCalled();
    });
});

describe('baseNicknameKey / prefix normalization', () => {
    it('strips the bot-assigned pilot suffix', () => {
        expect(baseNicknameKey('PlayerOne - Pilot')).toBe('playerone');
    });

    it('strips a known (surviving) server prefix', () => {
        expect(baseNicknameKey('EU011 - PlayerOne')).toBe('playerone');
        expect(stripServerPrefix('EU011 - PlayerOne')).toBe('PlayerOne');
    });

    it('strips a known (absorbed) server prefix', () => {
        expect(baseNicknameKey('EU013 - PlayerOne')).toBe('playerone');
        expect(stripServerPrefix('ASIA013 - PlayerOne')).toBe('PlayerOne');
    });

    it('strips the prefix and the pilot suffix together', () => {
        expect(baseNicknameKey('NA041 - PlayerOne - Pilot')).toBe('playerone');
    });

    it('maps a prefixed nickname to the same key as the bare registered name', () => {
        expect(baseNicknameKey('EU011 - PlayerOne')).toBe(baseNicknameKey('playerone'));
        expect(baseNicknameKey('EU013 - PlayerOne')).toBe(baseNicknameKey('PlayerOne'));
    });

    it('leaves an unknown prefix untouched', () => {
        expect(stripServerPrefix('XX999 - PlayerOne')).toBe('XX999 - PlayerOne');
    });

    it('is safe with null/undefined input', () => {
        expect(baseNicknameKey(undefined)).toBe('');
        expect(baseNicknameKey(null)).toBe('');
        expect(stripPilotSuffix(undefined)).toBe('');
    });
});

describe('resolveServerName', () => {
    it('returns the surviving server for an absorbed server', () => {
        expect(resolveServerName('ASIA013')).toBe('ASIA021');
        expect(resolveServerName('EU013')).toBe('EU011');
        expect(resolveServerName('NA041')).toBe('NA012');
    });

    it('returns the same name when the server is not merged', () => {
        expect(resolveServerName('EU011')).toBe('EU011');
        expect(resolveServerName('ASIA021')).toBe('ASIA021');
        expect(resolveServerName('NA011')).toBe('NA011');
    });

    it('returns the same name for unknown server names', () => {
        expect(resolveServerName('UNKNOWN')).toBe('UNKNOWN');
        expect(resolveServerName('')).toBe('');
    });
});

// ──────────────────────────────────────────
// Member role assignment + channel-access refresh
// ──────────────────────────────────────────

const ROLE_ID = '123'; // matches the mocked MEMBER_ROLE_ID

/** A channel whose overwrites DO or DON'T include the Member role. */
function makeChannel(id, hasRoleOverwrite = true) {
    const overwrite = { toJSON: () => ({ id: ROLE_ID, type: 0, allow: '1024', deny: '0' }) };
    const cache = {
        has: (roleId) => hasRoleOverwrite && roleId === ROLE_ID,
        map: (fn) => (hasRoleOverwrite ? [overwrite].map(fn) : [])
    };
    return { id, name: `channel-${id}`, permissionOverwrites: { cache, set: vi.fn(async () => {}) } };
}

function makeGuild(channels = []) {
    return {
        channels: { cache: new Map(channels.map((c) => [c.id, c])) },
        roles: { cache: { get: () => ({ name: 'Member' }) } }
    };
}

function makeMember(hasRole = false) {
    const roleSet = new Set(hasRole ? [ROLE_ID] : []);
    const member = {
        id: 'u1',
        user: { tag: 'User#0001', username: 'User' },
        roles: {
            cache: { has: (roleId) => roleSet.has(roleId) },
            add: vi.fn(async () => { roleSet.add(ROLE_ID); }),
            remove: vi.fn(async () => { roleSet.delete(ROLE_ID); })
        }
    };
    return member;
}

describe('refreshRoleChannelAccess', () => {
    it('re-emits the overwrites only on channels that carry the Member role overwrite', async () => {
        const withRole = makeChannel('c1', true);
        const withoutRole = makeChannel('c2', false);
        const logEvent = vi.fn();

        const refreshed = await refreshRoleChannelAccess(makeGuild([withRole, withoutRole]), logEvent);

        expect(refreshed).toBe(1);
        expect(withRole.permissionOverwrites.set).toHaveBeenCalledTimes(1);
        expect(withoutRole.permissionOverwrites.set).not.toHaveBeenCalled();
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('Re-emitted channel access'));
    });

    it('throttles repeated refreshes per guild, and force bypasses it', async () => {
        const channel = makeChannel('c1', true);
        const guild = makeGuild([channel]);

        expect(await refreshRoleChannelAccess(guild, vi.fn())).toBe(1);
        expect(await refreshRoleChannelAccess(guild, vi.fn())).toBe(0);
        expect(channel.permissionOverwrites.set).toHaveBeenCalledTimes(1);

        expect(await refreshRoleChannelAccess(guild, vi.fn(), { force: true })).toBe(1);
        expect(channel.permissionOverwrites.set).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when the guild or its channels are unavailable', async () => {
        expect(await refreshRoleChannelAccess(null, vi.fn())).toBe(0);
        expect(await refreshRoleChannelAccess({}, vi.fn())).toBe(0);
        expect(await refreshRoleChannelAccess({ channels: {} }, vi.fn())).toBe(0);
    });

    it('does not throw and logs when a channel overwrite update is refused', async () => {
        const channel = makeChannel('c1', true);
        channel.permissionOverwrites.set.mockRejectedValue({ code: 50013, message: 'Missing Permissions' });
        const logEvent = vi.fn();

        await expect(refreshRoleChannelAccess(makeGuild([channel]), logEvent)).resolves.toBe(0);
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('Could not refresh channel access'));
    });
});

describe('reapplyMemberRole', () => {
    it('removes and re-adds the role so the client recomputes its channels', async () => {
        const member = makeMember(true);
        const logEvent = vi.fn();

        const result = await reapplyMemberRole(member, logEvent, { delayMs: 0 });

        expect(result).toEqual({ ok: true });
        expect(member.roles.remove).toHaveBeenCalledWith(ROLE_ID);
        expect(member.roles.add).toHaveBeenCalledWith(ROLE_ID);
        expect(member.roles.remove.mock.invocationCallOrder[0])
            .toBeLessThan(member.roles.add.mock.invocationCallOrder[0]);
    });

    it('retries the re-add once so the member is never left without the role', async () => {
        const member = makeMember(true);
        member.roles.add.mockRejectedValueOnce({ code: 50013, message: 'Missing Permissions' });
        const logEvent = vi.fn();

        const result = await reapplyMemberRole(member, logEvent, { delayMs: 0 });

        expect(result.ok).toBe(true);
        expect(member.roles.add).toHaveBeenCalledTimes(2);
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('on retry'));
    });

    it('reports a loud failure when the role cannot be put back', async () => {
        const member = makeMember(true);
        member.roles.add.mockRejectedValue({ code: 50013, message: 'Missing Permissions' });
        const logEvent = vi.fn();

        const result = await reapplyMemberRole(member, logEvent, { delayMs: 0 });

        expect(result.ok).toBe(false);
        expect(result.roleRemoved).toBe(true);
        expect(result.reason).toEqual(expect.any(String));
        expect(logEvent).toHaveBeenCalledWith(expect.stringContaining('FAILED to re-add'));
    });

    it('skips a second nudge for the same member inside the debounce window', async () => {
        const member = makeMember(true);

        expect(await reapplyMemberRole(member, vi.fn(), { delayMs: 0 })).toEqual({ ok: true });
        expect(await reapplyMemberRole(member, vi.fn(), { delayMs: 0 })).toEqual({ ok: true, skipped: true });

        expect(member.roles.remove).toHaveBeenCalledOnce();
        expect(member.roles.add).toHaveBeenCalledOnce();
    });

    it('does nothing when the member does not have the role', async () => {
        const member = makeMember(false);

        const result = await reapplyMemberRole(member, vi.fn(), { delayMs: 0 });

        expect(result.ok).toBe(false);
        expect(member.roles.remove).not.toHaveBeenCalled();
        expect(member.roles.add).not.toHaveBeenCalled();
    });
});

describe('assignMemberRole', () => {
    it('grants the role and refreshes the channel access by default', async () => {
        const member = makeMember(false);
        const guild = makeGuild([makeChannel('c1', true)]);

        const result = await assignMemberRole(member, vi.fn(), guild, { reapplyDelayMs: 0 });

        expect(member.roles.add).toHaveBeenCalledWith(ROLE_ID);
        expect(result).toMatchObject({ ok: true, alreadyHad: false, channelsRefreshed: 1, reapplied: true });
    });

    it('re-applies the freshly granted role to nudge the member client', async () => {
        const member = makeMember(false);
        const guild = makeGuild([makeChannel('c1', true)]);

        await assignMemberRole(member, vi.fn(), guild, { reapplyDelayMs: 0 });

        expect(member.roles.remove).toHaveBeenCalledWith(ROLE_ID);
        expect(member.roles.add).toHaveBeenCalledTimes(2);
    });

    it('skips the channel refresh and the re-apply for bulk callers', async () => {
        const member = makeMember(false);
        const guild = makeGuild([makeChannel('c1', true)]);

        await assignMemberRole(member, vi.fn(), guild, { refreshChannels: false, reapplyRole: false });

        expect(member.roles.add).toHaveBeenCalledWith(ROLE_ID);
        expect(member.roles.remove).not.toHaveBeenCalled();
        expect(guild.channels.cache.get('c1').permissionOverwrites.set).not.toHaveBeenCalled();
    });

    it('still refreshes the channel access when the member already had the role', async () => {
        const member = makeMember(true);
        const guild = makeGuild([makeChannel('c1', true)]);

        const result = await assignMemberRole(member, vi.fn(), guild);

        expect(member.roles.add).not.toHaveBeenCalled();
        expect(member.roles.remove).not.toHaveBeenCalled();
        expect(result).toMatchObject({ ok: true, alreadyHad: true, channelsRefreshed: 1 });
        expect(guild.channels.cache.get('c1').permissionOverwrites.set).toHaveBeenCalledTimes(1);
    });

    it('reports the failure and does not refresh when Discord refuses the role', async () => {
        const member = makeMember(false);
        member.roles.add.mockRejectedValue({ code: 50013 });
        const guild = makeGuild([makeChannel('c1', true)]);

        const result = await assignMemberRole(member, vi.fn(), guild, { reapplyDelayMs: 0 });

        expect(result.ok).toBe(false);
        expect(result.reason).toEqual(expect.any(String));
        expect(guild.channels.cache.get('c1').permissionOverwrites.set).not.toHaveBeenCalled();
    });
});
