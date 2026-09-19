import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-cache.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getLocalRankingCache: vi.fn(() => null)
    };
});

vi.mock('../src/core/ranking-service.js', () => ({
    lookupNickname: vi.fn(() => ({ found: false })),
    lookupNicknameWithSearch: vi.fn(async () => ({ found: false }))
}));

vi.mock('../src/core/interaction-utils.js', () => ({
    deferReplySafe: vi.fn(async () => true),
    deferUpdateSafe: vi.fn(async () => true),
    editReplySafe: vi.fn(async () => null)
}));

vi.mock('axios', () => ({
    default: { get: vi.fn(async () => ({ data: '' })) }
}));

import axios from 'axios';
import { lookupNickname, lookupNicknameWithSearch } from '../src/core/ranking-service.js';
import { MEMBER_ROLE_ID } from '../src/core/ranking-constants.js';
import {
    handleScanAllied,
    parseAlliedList,
    splitListLine,
    nameCandidates,
    detectPilot,
    buildListIndex,
    matchMemberToList,
    chooseResolution
} from '../src/handlers/ranking-scan.js';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function createMember({ id, username, nickname = null, globalName = null, roles = [], bot = false }) {
    const roleSet = new Set(roles);
    return {
        id,
        user: { id, username, globalName, displayName: globalName || username, tag: `${username}#0001`, bot },
        nickname,
        setNickname: vi.fn(async () => {}),
        roles: {
            cache: { has: roleId => roleSet.has(roleId) },
            add: vi.fn(async () => { roleSet.add(MEMBER_ROLE_ID); })
        }
    };
}

function createInteraction({ listText = '', apply = false, members = [] }) {
    const replies = [];
    const guild = {
        members: {
            cache: new Map(members.map(m => [m.id, m])),
            fetch: vi.fn(async () => {})
        }
    };
    return {
        guild,
        user: { tag: 'AdminUser#0001' },
        options: {
            getAttachment: vi.fn(() => ({ name: 'allied-list.csv', url: 'https://example.com/allied-list.csv', size: listText.length })),
            getBoolean: vi.fn(() => apply)
        },
        editReply: vi.fn(async payload => { replies.push(payload); return payload; }),
        replies
    };
}

const ALLIED_MOON = { found: true, inAlliedClan: true, exactMatch: true, nickname: 'MooN', clanName: 'St', serverName: 'EU021', worldId: 621 };
const NOT_ALLIED_DEADSHOT = { found: true, inAlliedClan: false, exactMatch: true, nickname: 'Deadshot08', clanName: 'Rogues', serverName: 'SA031', worldId: 731 };

beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockResolvedValue({ data: '' });
    lookupNickname.mockImplementation(name => {
        if (name === 'MooN') return ALLIED_MOON;
        if (name === 'Deadshot08') return NOT_ALLIED_DEADSHOT;
        return { found: false };
    });
    lookupNicknameWithSearch.mockResolvedValue({ found: false });
});

// ──────────────────────────────────────────
// List parsing
// ──────────────────────────────────────────

describe('parseAlliedList', () => {
    it('parses quoted CSV rows and skips the header', () => {
        const text = [
            'Nickname,Username',
            '"[EU11] MooN","moon4167"',
            '"[SA31] St • Adi","adsssss_"'
        ].join('\n');

        expect(parseAlliedList(text)).toEqual([
            { nickname: '[EU11] MooN', username: 'moon4167' },
            { nickname: '[SA31] St • Adi', username: 'adsssss_' }
        ]);
    });

    it('keeps lines without a username and skips blank ones', () => {
        expect(parseAlliedList('Solo\n\n"RaStaScout eu11","rastarocket__"')).toEqual([
            { nickname: 'Solo', username: '' },
            { nickname: 'RaStaScout eu11', username: 'rastarocket__' }
        ]);
    });

    it('removes duplicate rows', () => {
        const text = '"MooN","moon4167"\n"MooN","moon4167"';
        expect(parseAlliedList(text)).toHaveLength(1);
    });

    it('supports tab separated files', () => {
        expect(splitListLine('MooN\tmoon4167')).toEqual(['MooN', 'moon4167']);
        expect(parseAlliedList('MooN\tmoon4167')).toEqual([{ nickname: 'MooN', username: 'moon4167' }]);
    });
});

// ──────────────────────────────────────────
// Name candidates
// ──────────────────────────────────────────

describe('nameCandidates', () => {
    it('strips the server tag, clan separator and pilot marker', () => {
        const candidates = nameCandidates('[EU11] St • Motion (P)');
        expect(candidates).toContain('Motion');
        expect(candidates).toContain('St • Motion');
    });

    it('strips the decorative clan suffix', () => {
        const candidates = nameCandidates('St • Arës乂KAL');
        expect(candidates).toContain('Arës');
        expect(candidates).toContain('Arës乂KAL');
    });

    it('strips the EU021 - prefix used by this bot', () => {
        expect(nameCandidates('EU021 - MiloChoi ツ')).toContain('MiloChoi');
    });

    it('handles names without decorations', () => {
        expect(nameCandidates('MooN')[0]).toBe('MooN');
    });
});

// ──────────────────────────────────────────
// Pilot detection
// ──────────────────────────────────────────

describe('detectPilot', () => {
    it('detects the "(P)" marker and the owner written after it', () => {
        expect(detectPilot('St • Adi (P) Zay')).toMatchObject({
            isPilot: true,
            characterName: 'St • Adi',
            ownerName: 'Zay'
        });
    });

    it('detects the "(P-owner)" form', () => {
        expect(detectPilot('St • JAY (P-cecilia)')).toMatchObject({
            isPilot: true,
            characterName: 'St • JAY',
            ownerName: 'cecilia'
        });
    });

    it('detects the "Name Pilot Owner" form', () => {
        expect(detectPilot('St • mєjєrє Pilot OGUN')).toMatchObject({
            isPilot: true,
            characterName: 'St • mєjєrє',
            ownerName: 'OGUN'
        });
    });

    it('detects markers without an owner', () => {
        expect(detectPilot('Serious King (P)')).toMatchObject({ isPilot: true, ownerName: null });
        expect(detectPilot('ᴊᴀᴍᴍʏᴋᴏɪ |ᴍᴇᴊᴇʀᴇ&ᴀʀᴇꜱ [ᴘ]')).toMatchObject({ isPilot: true });
        expect(detectPilot('Scânteiere-Garfil Ⓖ Pilot')).toMatchObject({ isPilot: true, ownerName: null });
    });

    it('detects the " - Pilot" suffix this bot assigns', () => {
        expect(detectPilot('EU031 - Owner - Pilot')).toMatchObject({
            isPilot: true,
            characterName: 'EU031 - Owner',
            ownerName: null
        });
    });

    it('leaves regular names alone', () => {
        expect(detectPilot('MooN')).toMatchObject({ isPilot: false, ownerName: null });
        expect(detectPilot('[EU11] Powder ツ')).toMatchObject({ isPilot: false });
        expect(detectPilot('PilotPro')).toMatchObject({ isPilot: false });
    });
});

// ──────────────────────────────────────────
// Member ↔ list matching
// ──────────────────────────────────────────

describe('matchMemberToList', () => {
    const entries = [
        { nickname: '[EU11] MooN', username: 'moon4167' },
        { nickname: '[SA31] St • Adi', username: 'adsssss_' }
    ];
    const index = buildListIndex(entries);

    it('matches by Discord username, case-insensitively', () => {
        const member = createMember({ id: '1', username: 'MooN4167' });
        const match = matchMemberToList(member, index);
        expect(match.via).toBe('username');
        expect(match.entry).toBe(entries[0]);
    });

    it('matches by the member nickname when the username is unknown', () => {
        const member = createMember({ id: '2', username: 'renamed_handle', nickname: 'EU031 - Adi' });
        const match = matchMemberToList(member, index);
        expect(match.via).toBe('nickname');
        expect(match.entry).toBe(entries[1]);
    });

    it('returns null for members outside the list', () => {
        const member = createMember({ id: '3', username: 'someone_else', nickname: 'EU011 - Nobody' });
        expect(matchMemberToList(member, index)).toBeNull();
    });
});

// ──────────────────────────────────────────
// Resolution preference
// ──────────────────────────────────────────

describe('chooseResolution', () => {
    it('prefers an exact allied hit over a fuzzy allied one', () => {
        const fuzzyAllied = { candidate: 'Moo', lookup: { ...ALLIED_MOON, exactMatch: false } };
        const exactAllied = { candidate: 'MooN', lookup: ALLIED_MOON };
        expect(chooseResolution([fuzzyAllied, exactAllied])).toBe(exactAllied);
    });

    it('prefers an allied hit over a non-allied exact hit', () => {
        const notAllied = { candidate: 'Deadshot08', lookup: NOT_ALLIED_DEADSHOT };
        const allied = { candidate: 'MooN', lookup: ALLIED_MOON };
        expect(chooseResolution([notAllied, allied])).toBe(allied);
    });

    it('returns null when nothing was found', () => {
        expect(chooseResolution([])).toBeNull();
    });
});

// ──────────────────────────────────────────
// /scanallied handler
// ──────────────────────────────────────────

describe('handleScanAllied', () => {
    const LIST = [
        'Nickname,Username',
        '"[EU11] MooN","moon4167"',
        '"[EU11] Deadshot08","xzel168"',
        '"[EU11] cool9","cool9"',
        '"[SA31] St • Adi","adsssss_"'
    ].join('\n');

    function buildScenario() {
        axios.get.mockResolvedValue({ data: LIST });
        return {
            members: [
                createMember({ id: '1', username: 'moon4167' }),                                  // → allied, no registration
                createMember({ id: '2', username: 'xzel168' }),                                   // → not allied
                createMember({ id: '3', username: 'cool9' }),                                     // → not in ranking
                createMember({ id: '4', username: 'adsssss_', nickname: 'EU031 - Adi', roles: [MEMBER_ROLE_ID] }) // → already registered + role
            ]
        };
    }

    it('dry run: reports targets without touching the database or roles', async () => {
        const { members } = buildScenario();
        const db = { users: { 4: { nickname: 'Adi', registeredAt: '2026-01-01T00:00:00.000Z' } }, config: { alliedClans: {} } };
        const interaction = createInteraction({ listText: LIST, apply: false, members });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        const payload = interaction.replies[0];
        expect(payload.content).toContain('DRY RUN');
        expect(payload.content).toContain('Seriam registrados/cargo');
        expect(payload.files).toHaveLength(1);

        // Nothing was written and no role was handed out
        expect(db.users['1']).toBeUndefined();
        expect(members[0].roles.add).not.toHaveBeenCalled();
        expect(members[1].roles.add).not.toHaveBeenCalled();
    });

    it('apply: registers the allied match and assigns the member role', async () => {
        const { members } = buildScenario();
        const db = { users: { 4: { nickname: 'Adi', registeredAt: '2026-01-01T00:00:00.000Z' } }, config: { alliedClans: {} } };
        const saveLocalStorage = vi.fn(async () => {});
        const interaction = createInteraction({ listText: LIST, apply: true, members });

        await handleScanAllied(interaction, db, saveLocalStorage, vi.fn());

        expect(db.users['1']).toMatchObject({
            nickname: 'MooN',
            clanName: 'St',
            serverName: 'EU021',
            worldId: 621,
            pilotIds: []
        });
        expect(members[0].roles.add).toHaveBeenCalledWith(MEMBER_ROLE_ID);
        expect(saveLocalStorage).toHaveBeenCalled();

        // Not allied / not in ranking → untouched
        expect(db.users['2']).toBeUndefined();
        expect(members[1].roles.add).not.toHaveBeenCalled();
        expect(db.users['3']).toBeUndefined();
        expect(members[2].roles.add).not.toHaveBeenCalled();

        // Already registered with the role → left alone
        expect(members[3].roles.add).not.toHaveBeenCalled();
        expect(db.users['4'].nickname).toBe('Adi');
    });

    it('gives the role to a registered member that lost it, without touching the nickname', async () => {
        axios.get.mockResolvedValue({ data: LIST });
        const member = createMember({ id: '1', username: 'moon4167', nickname: 'EU021 - MooN' });
        const db = { users: { 1: { nickname: 'MooN', registeredAt: '2026-01-01T00:00:00.000Z' } }, config: { alliedClans: {} } };
        const interaction = createInteraction({ listText: LIST, apply: true, members: [member] });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(member.roles.add).toHaveBeenCalledWith(MEMBER_ROLE_ID);
        expect(db.users['1'].nickname).toBe('MooN');
    });

    it('falls back to the live forum search when the cache has nothing', async () => {
        axios.get.mockResolvedValue({ data: '"St • Motion","motion43"' });
        lookupNicknameWithSearch.mockResolvedValue({
            found: true, inAlliedClan: true, exactMatch: true, fromForumSearch: true,
            nickname: 'Motion', clanName: 'St', serverName: 'EU021', worldId: 621
        });
        const member = createMember({ id: '1', username: 'motion43' });
        const db = { users: {}, config: { alliedClans: {} } };
        const interaction = createInteraction({ listText: '"St • Motion","motion43"', apply: true, members: [member] });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(lookupNicknameWithSearch).toHaveBeenCalled();
        expect(db.users['1']).toMatchObject({ nickname: 'Motion', fromForumSearch: true });
        expect(member.roles.add).toHaveBeenCalledWith(MEMBER_ROLE_ID);
    });

    it('reports unusable input', async () => {
        axios.get.mockResolvedValue({ data: '   \n\n' });
        const interaction = createInteraction({ listText: '   \n\n', members: [] });

        await handleScanAllied(interaction, { users: {}, config: {} }, vi.fn(), vi.fn());

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No usable lines'));
    });

    it('links a pilot to an owner registered in the same run', async () => {
        const list = [
            'Nickname,Username',
            '"St • Yuki","soraao"',
            '"St • Adi (P) Yuki","zayleigh"'
        ].join('\n');
        axios.get.mockResolvedValue({ data: list });
        lookupNickname.mockImplementation(name => {
            if (name === 'Yuki') {
                return { found: true, inAlliedClan: true, exactMatch: true, nickname: 'Yuki', clanName: 'St', serverName: 'EU031', worldId: 731 };
            }
            return { found: false };
        });

        const owner = createMember({ id: '4', username: 'soraao' });
        const pilot = createMember({ id: '5', username: 'zayleigh' });
        const db = { users: {}, config: { alliedClans: {} } };
        const interaction = createInteraction({ listText: list, apply: true, members: [owner, pilot] });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        // Owner registered normally, pilot linked through the owner's pilotIds
        expect(db.users['4']).toMatchObject({ nickname: 'Yuki', clanName: 'St' });
        expect(db.users['4'].pilotIds).toEqual(['5']);
        expect(pilot.roles.add).toHaveBeenCalledWith(MEMBER_ROLE_ID);
        expect(db.users['5']).toBeUndefined();
        expect(interaction.replies[0].content).toContain('piloto');
    });

    it('does not link pilots in dry run', async () => {
        const list = ['"St • Yuki","soraao"', '"St • Adi (P) Yuki","zayleigh"'].join('\n');
        axios.get.mockResolvedValue({ data: list });
        lookupNickname.mockImplementation(name => {
            if (name === 'Yuki') {
                return { found: true, inAlliedClan: true, exactMatch: true, nickname: 'Yuki', clanName: 'St', serverName: 'EU031', worldId: 731 };
            }
            return { found: false };
        });

        const owner = createMember({ id: '4', username: 'soraao' });
        const pilot = createMember({ id: '5', username: 'zayleigh' });
        const db = { users: {}, config: { alliedClans: {} } };
        const interaction = createInteraction({ listText: list, apply: false, members: [owner, pilot] });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4']).toBeUndefined();
        expect(pilot.roles.add).not.toHaveBeenCalled();
        expect(pilot.setNickname).not.toHaveBeenCalled();
        expect(interaction.replies[0].content).toContain('Seriam vinculados como piloto');
    });

    it('registers a pilot as a regular member when the owner is not in the server', async () => {
        const list = '"St • JAY (P-cecilia)","jay.fj"';
        axios.get.mockResolvedValue({ data: list });
        lookupNickname.mockImplementation(name => {
            if (name === 'JAY') {
                return { found: true, inAlliedClan: true, exactMatch: true, nickname: 'JAY', clanName: 'St', serverName: 'EU031', worldId: 731 };
            }
            return { found: false };
        });

        const pilot = createMember({ id: '5', username: 'jay.fj' });
        const db = { users: {}, config: { alliedClans: {} } };
        const interaction = createInteraction({ listText: list, apply: true, members: [pilot] });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['5']).toMatchObject({ nickname: 'JAY', clanName: 'St' });
        expect(pilot.roles.add).toHaveBeenCalledWith(MEMBER_ROLE_ID);
        expect(pilot.setNickname).not.toHaveBeenCalled();
        // Report explains the owner could not be identified
        expect(interaction.replies[0].files).toHaveLength(1);
        expect(db.users['5'].pilotIds).toEqual([]);
    });

    it('skips bots and members without a list match', async () => {
        axios.get.mockResolvedValue({ data: '"MooN","moon4167"' });
        const bot = createMember({ id: '9', username: 'moon4167', bot: true });
        const outsider = createMember({ id: '8', username: 'nobody' });
        const db = { users: {}, config: { alliedClans: {} } };
        const interaction = createInteraction({ listText: '"MooN","moon4167"', apply: true, members: [bot, outsider] });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['9']).toBeUndefined();
        expect(db.users['8']).toBeUndefined();
    });

    it('does not touch a member that is already registered as a pilot', async () => {
        const list = '"St • JAY (P-cecilia)","jay.fj"';
        axios.get.mockResolvedValue({ data: list });
        const pilot = createMember({ id: '5', username: 'jay.fj' });
        const db = {
            users: {
                4: { nickname: 'cecilia', registeredAt: '2026-01-01T00:00:00.000Z', pilotIds: ['5'] },
                5: { nickname: 'JAY', registeredAt: '2026-01-01T00:00:00.000Z', pilotIds: [] }
            },
            config: { alliedClans: {} }
        };
        const interaction = createInteraction({ listText: list, apply: true, members: [pilot] });

        await handleScanAllied(interaction, db, vi.fn(async () => {}), vi.fn());

        expect(db.users['4'].pilotIds).toEqual(['5']);
        expect(pilot.roles.add).not.toHaveBeenCalled();
        expect(pilot.setNickname).not.toHaveBeenCalled();
    });
});
