import { describe, it, expect } from 'vitest';
import {
    DEFAULT_PILOT_PATTERNS,
    detectPilot,
    getPilotPatterns,
    hasCustomPilotPatterns,
    validatePattern
} from '../src/core/pilot-patterns.js';

describe('detectPilot (default patterns)', () => {
    it('detects the " - Pilot" suffix this bot assigns', () => {
        expect(detectPilot('EU031 - Owner - Pilot')).toMatchObject({
            isPilot: true,
            characterName: 'EU031 - Owner',
            ownerName: null,
            patternName: 'pilot-suffix'
        });
    });

    it('detects "(P-owner)" and keeps the owner', () => {
        expect(detectPilot('St • JAY (P-cecilia)')).toMatchObject({
            isPilot: true,
            characterName: 'St • JAY',
            ownerName: 'cecilia',
            marker: '(P-cecilia)',
            patternName: 'p-dash'
        });
    });

    it('detects "(P)" with the owner written after it', () => {
        expect(detectPilot('St • Adi (P) Zay')).toMatchObject({
            isPilot: true,
            characterName: 'St • Adi',
            ownerName: 'Zay',
            marker: '(P)',
            patternName: 'p-bracket'
        });
    });

    it('detects bracketed markers without an owner', () => {
        expect(detectPilot('ᴊᴀᴍᴍʏᴋᴏɪ |ᴍᴇᴊᴇʀᴇ&ᴀʀᴇꜱ [ᴘ]')).toMatchObject({
            isPilot: true,
            ownerName: null,
            patternName: 'p-bracket'
        });
        expect(detectPilot('Serious King (P)')).toMatchObject({ isPilot: true, ownerName: null });
    });

    it('detects "Name Pilot Owner"', () => {
        expect(detectPilot('St • mєjєrє Pilot OGUN')).toMatchObject({
            isPilot: true,
            characterName: 'St • mєjєrє',
            ownerName: 'OGUN',
            patternName: 'pilot-word'
        });
    });

    it('leaves regular names alone', () => {
        expect(detectPilot('MooN')).toMatchObject({ isPilot: false, marker: null, patternName: null });
        expect(detectPilot('[EU11] Powder ツ')).toMatchObject({ isPilot: false });
        expect(detectPilot('PilotPro')).toMatchObject({ isPilot: false });
        expect(detectPilot('')).toMatchObject({ isPilot: false });
    });
});

describe('detectPilot (custom patterns)', () => {
    it('uses the provided pattern list', () => {
        const patterns = [{ name: 'plus-owner', regex: '\\+\\s*(\\S+)$', ownerGroup: 1 }];
        expect(detectPilot('MooN +Yuki', patterns)).toMatchObject({
            isPilot: true,
            characterName: 'MooN',
            ownerName: 'Yuki',
            patternName: 'plus-owner'
        });
    });

    it('takes the owner from the text after the marker when ownerGroup is 0', () => {
        const patterns = [{ name: 'arrow', regex: '->', ownerGroup: 0 }];
        expect(detectPilot('MooN -> Yuki', patterns)).toMatchObject({
            isPilot: true,
            characterName: 'MooN',
            ownerName: 'Yuki'
        });
    });

    it('skips invalid patterns instead of throwing', () => {
        expect(detectPilot('MooN', [{ name: 'broken', regex: '([', ownerGroup: 0 }])).toMatchObject({ isPilot: false });
    });

    it('ignores a marker that has no character name before it', () => {
        expect(detectPilot('(P) Zay', [{ name: 'only-p', regex: '\\(p\\)', ownerGroup: 0 }])).toMatchObject({ isPilot: false });
    });
});

describe('getPilotPatterns', () => {
    it('falls back to the defaults when nothing usable is configured', () => {
        expect(getPilotPatterns({})).toBe(DEFAULT_PILOT_PATTERNS);
        expect(getPilotPatterns({ config: { pilotPatterns: [] } })).toBe(DEFAULT_PILOT_PATTERNS);
        expect(getPilotPatterns({ config: { pilotPatterns: [{ name: 'bad', regex: '(' }] } })).toBe(DEFAULT_PILOT_PATTERNS);
    });

    it('returns the configured patterns when present', () => {
        const custom = [{ name: 'x', regex: '\\(p\\)', ownerGroup: 0 }];
        const db = { config: { pilotPatterns: custom } };
        expect(getPilotPatterns(db)).toEqual(custom);
        expect(hasCustomPilotPatterns(db)).toBe(true);
        expect(hasCustomPilotPatterns({})).toBe(false);
    });
});

describe('validatePattern', () => {
    it('accepts a valid expression', () => {
        expect(validatePattern('\\(p\\)')).toMatchObject({ ok: true, source: '\\(p\\)' });
    });

    it('rejects empty, invalid and oversized expressions', () => {
        expect(validatePattern('').ok).toBe(false);
        expect(validatePattern('   ').ok).toBe(false);
        expect(validatePattern('([').ok).toBe(false);
        expect(validatePattern('a'.repeat(201)).ok).toBe(false);
    });
});
