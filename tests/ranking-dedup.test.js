import { describe, it, expect } from 'vitest';
import {
    duplicateKey,
    findDuplicateGroups,
    findNicknameOwner,
    unlinkPilotLinks,
    ownerReferences,
    applyDuplicateCleanup
} from '../src/core/ranking-dedup.js';

describe('duplicateKey', () => {
    it('normalizes case, surrounding space and Unicode form', () => {
        expect(duplicateKey('  PlayerOne ')).toBe('playerone');
        expect(duplicateKey('PLAYERONE')).toBe('playerone');
        expect(duplicateKey('Cecilia')).toBe(duplicateKey('cecilia'));
    });

    it('is safe with missing values', () => {
        expect(duplicateKey(undefined)).toBe('');
        expect(duplicateKey(null)).toBe('');
    });
});

describe('findDuplicateGroups', () => {
    it('returns nothing for a clean database', () => {
        const users = {
            a: { nickname: 'Alpha', registeredAt: '2026-01-01T00:00:00.000Z' },
            b: { nickname: 'Beta', registeredAt: '2026-01-02T00:00:00.000Z' }
        };
        expect(findDuplicateGroups(users)).toEqual([]);
    });

    it('groups the same nickname across different accounts', () => {
        const users = {
            a: { nickname: 'Rusima', registeredAt: '2026-01-01T00:00:00.000Z' },
            b: { nickname: 'rusima', registeredAt: '2026-02-01T00:00:00.000Z' },
            c: { nickname: 'Other', registeredAt: '2026-01-01T00:00:00.000Z' }
        };
        const groups = findDuplicateGroups(users);
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('rusima');
        expect(groups[0].all.sort()).toEqual(['a', 'b']);
    });

    it('ignores profiles without a nickname', () => {
        const users = {
            a: { registeredAt: '2026-01-01T00:00:00.000Z' },
            b: { nickname: '', registeredAt: '2026-01-01T00:00:00.000Z' }
        };
        expect(findDuplicateGroups(users)).toEqual([]);
    });

    it('keeps a manual registration over an automatic one even if newer', () => {
        const users = {
            auto: { nickname: 'Name', registeredAt: '2026-01-01T00:00:00.000Z' },
            manual: { nickname: 'Name', registeredAt: '2026-06-01T00:00:00.000Z', manual: true }
        };
        expect(findDuplicateGroups(users)[0].winner.id).toBe('manual');
    });

    it('keeps the profile with the most pilots (removing it would orphan them)', () => {
        const users = {
            few: { nickname: 'Name', registeredAt: '2026-01-01T00:00:00.000Z', pilotIds: ['p1'] },
            many: { nickname: 'Name', registeredAt: '2026-03-01T00:00:00.000Z', pilotIds: ['p1', 'p2'] }
        };
        expect(findDuplicateGroups(users)[0].winner.id).toBe('many');
    });

    it('keeps the oldest registration when nothing else separates them', () => {
        const users = {
            newer: { nickname: 'Name', registeredAt: '2026-05-01T00:00:00.000Z' },
            older: { nickname: 'Name', registeredAt: '2026-01-01T00:00:00.000Z' }
        };
        expect(findDuplicateGroups(users)[0].winner.id).toBe('older');
    });

    it('prefers a dated profile over one without a registration date', () => {
        const users = {
            undated: { nickname: 'Name' },
            dated: { nickname: 'Name', registeredAt: '2026-09-01T00:00:00.000Z' }
        };
        expect(findDuplicateGroups(users)[0].winner.id).toBe('dated');
    });

    it('is deterministic on a full tie (smallest id kept)', () => {
        const users = {
            b: { nickname: 'Name', registeredAt: '2026-01-01T00:00:00.000Z' },
            a: { nickname: 'Name', registeredAt: '2026-01-01T00:00:00.000Z' }
        };
        expect(findDuplicateGroups(users)[0].winner.id).toBe('a');
    });

    it('handles three-way duplicates', () => {
        const users = {
            a: { nickname: 'Rusima', registeredAt: '2026-01-01T00:00:00.000Z' },
            b: { nickname: 'rusima', registeredAt: '2026-02-01T00:00:00.000Z' },
            c: { nickname: 'RUSIMA', registeredAt: '2026-03-01T00:00:00.000Z' }
        };
        const group = findDuplicateGroups(users)[0];
        expect(group.winner.id).toBe('a');
        expect(group.losers.map((l) => l.id)).toEqual(['b', 'c']);
    });
});

describe('ownerReferences', () => {
    it('lists owners whose pilotIds reference the member', () => {
        const users = {
            owner1: { nickname: 'O1', pilotIds: ['pilot'] },
            owner2: { nickname: 'O2', pilotIds: ['other'] },
            owner3: { nickname: 'O3', pilotIds: ['pilot', 'other'] }
        };
        expect(ownerReferences(users, 'pilot').sort()).toEqual(['owner1', 'owner3']);
    });

    it('never reports the member itself', () => {
        const users = { self: { nickname: 'S', pilotIds: ['self'] } };
        expect(ownerReferences(users, 'self')).toEqual([]);
    });
});

describe('findNicknameOwner', () => {
    const users = {
        a: { nickname: 'PlayerOne' },
        b: { nickname: 'Other' }
    };

    it('matches ignoring case and surrounding space', () => {
        expect(findNicknameOwner(users, ' playerone ')?.id).toBe('a');
    });

    it('can ignore the account being (re)registered', () => {
        expect(findNicknameOwner(users, 'PlayerOne', 'a')).toBeNull();
    });

    it('returns null when the name is free or empty', () => {
        expect(findNicknameOwner(users, 'Nobody')).toBeNull();
        expect(findNicknameOwner(users, '')).toBeNull();
    });
});

describe('unlinkPilotLinks', () => {
    it('removes the member from every owner without touching other pilots', () => {
        const users = {
            owner1: { nickname: 'O1', pilotIds: ['pilot', 'kept'] },
            owner2: { nickname: 'O2', pilotIds: ['pilot'] },
            pilot: { nickname: 'P', pilotIds: ['nested'] }
        };

        expect(unlinkPilotLinks(users, 'pilot').sort()).toEqual(['owner1', 'owner2']);
        expect(users.owner1.pilotIds).toEqual(['kept']);
        expect(users.owner2.pilotIds).toEqual([]);
        // The member's own pilot list is never touched
        expect(users.pilot.pilotIds).toEqual(['nested']);
    });

    it('is a no-op when the member is not linked anywhere', () => {
        const users = { owner: { nickname: 'O', pilotIds: ['other'] } };
        expect(unlinkPilotLinks(users, 'missing')).toEqual([]);
        expect(users.owner.pilotIds).toEqual(['other']);
    });
});

describe('applyDuplicateCleanup', () => {
    it('removes the losers, unlinks them from owners and clears their role notes', () => {
        const users = {
            keeper: { nickname: 'Name', registeredAt: '2026-01-01T00:00:00.000Z' },
            dupe: { nickname: 'NAME', registeredAt: '2026-02-01T00:00:00.000Z' },
            owner: { nickname: 'Owner', pilotIds: ['dupe', 'someoneElse'] }
        };
        const roleNotify = { dupe: { outOfAlliedSince: '2026-08-01T00:00:00.000Z' }, keeper: {} };

        const groups = findDuplicateGroups(users);
        const removed = applyDuplicateCleanup(users, groups, roleNotify);

        expect(users.dupe).toBeUndefined();
        expect(users.keeper).toBeDefined();
        expect(users.owner.pilotIds).toEqual(['someoneElse']);
        expect(roleNotify.dupe).toBeUndefined();
        expect(roleNotify.keeper).toBeDefined();
        expect(removed).toEqual([
            { id: 'dupe', nickname: 'NAME', keptId: 'keeper', unlinkedFrom: ['owner'] }
        ]);
    });

    it('works without a roleNotify map', () => {
        const users = {
            keeper: { nickname: 'Name', registeredAt: '2026-01-01T00:00:00.000Z' },
            dupe: { nickname: 'Name', registeredAt: '2026-02-01T00:00:00.000Z' }
        };
        const removed = applyDuplicateCleanup(users, findDuplicateGroups(users));
        expect(removed).toHaveLength(1);
        expect(users.dupe).toBeUndefined();
    });

    it('is a no-op on a clean database', () => {
        const users = { a: { nickname: 'Alpha' } };
        expect(applyDuplicateCleanup(users, findDuplicateGroups(users))).toEqual([]);
        expect(users.a).toBeDefined();
    });
});
