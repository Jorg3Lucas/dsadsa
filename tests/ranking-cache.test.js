import { describe, it, expect } from 'vitest';
import { cleanNickname, findNicknameInCache, findAllNicknameMatchesInCache } from '../src/core/ranking-cache.js';

describe('cleanNickname', () => {
    it('strips whitespace, so "Dinizメ" and "Diniz メ" are the same name', () => {
        expect(cleanNickname('Dinizメ')).toBe(cleanNickname('Diniz メ'));
    });

    it('lowercases and strips decorative formatting characters', () => {
        expect(cleanNickname('  One-Piece  ')).toBe('onepiece');
        expect(cleanNickname('Shadow·Xx')).toBe('shadowxx');
    });

    it('keeps katakana/CJK as part of the name', () => {
        expect(cleanNickname('GearsofWar シ')).toBe('gearsofwarシ');
        expect(cleanNickname('GearsofWar战争')).toBe('gearsofwar战争');
    });
});

describe('findAllNicknameMatchesInCache', () => {
    // Same world can hold two DIFFERENT players whose names clean to the same
    // key: "Diniz メ" (gold-seller clan) and "Dinizメ" (allied clan) on EU011.
    const cache = {
        611: {
            'Diniz メ': 'sellgold888',
            'Dinizメ': 'GearsofWar战争',
            'PlayerOne': 'ToxicFamily'
        },
        522: {
            'Dinizメ': 'RandomClan'
        }
    };

    it('returns EVERY cleaned-equal variant, including duplicates within the same world', () => {
        const matches = findAllNicknameMatchesInCache('Dinizメ', cache);
        expect(matches).toHaveLength(3);
        expect(matches).toEqual(expect.arrayContaining([
            { worldId: '611', nickname: 'Diniz メ', clanName: 'sellgold888' },
            { worldId: '611', nickname: 'Dinizメ', clanName: 'GearsofWar战争' },
            { worldId: '522', nickname: 'Dinizメ', clanName: 'RandomClan' }
        ]));
    });

    it('also matches when the typed name has a different spacing', () => {
        const matches = findAllNicknameMatchesInCache('Diniz メ', cache);
        expect(matches).toHaveLength(3);
    });

    it('returns an empty array when nothing matches', () => {
        expect(findAllNicknameMatchesInCache('Ghost', cache)).toEqual([]);
    });
});

describe('findNicknameInCache', () => {
    it('returns the FIRST cleaned-equal hit (documenting why callers must use findAll...)', () => {
        const hit = findNicknameInCache('Dinizメ', {
            611: {
                'Diniz メ': 'sellgold888',
                'Dinizメ': 'GearsofWar战争'
            }
        });
        // First key in insertion order — a DIFFERENT player! This is why the
        // allied-preference lookup (findAllNicknameMatchesInCache) must be used
        // for role decisions.
        expect(hit).toEqual({ worldId: '611', nickname: 'Diniz メ', clanName: 'sellgold888' });
    });
});
