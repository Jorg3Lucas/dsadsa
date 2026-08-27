import { describe, it, expect } from 'vitest';
import { getMsg } from '../src/lang/lang.js';

describe('getMsg', () => {
    it('returns the string for an existing key without vars', () => {
        // Reads from the real lang.json — the key must exist there
        expect(typeof getMsg('ranking.logs.syncStart')).toBe('string');
        expect(getMsg('ranking.logs.syncStart')).not.toBe('ranking.logs.syncStart');
    });

    it('substitutes a single variable placeholder', () => {
        const result = getMsg('ranking.logs.roleAdded', { clan: 'Member', username: 'PlayerOne' });
        expect(result).toContain('PlayerOne');
        expect(result).toContain('Member');
    });

    it('replaces EVERY occurrence of a repeated placeholder (same as the old global regex)', () => {
        const result = getMsg('ranking.logs.autoLink', {
            username: 'PilotX',
            count: 3,
            baseNick: 'OwnerY'
        });
        // Every {username} occurrence must be substituted — no leftover braces
        expect(result).not.toContain('{username}');
        expect(result).not.toContain('{count}');
        expect(result).not.toContain('{baseNick}');
        expect(result).toContain('PilotX');
    });

    it('returns the key when it does not exist', () => {
        expect(getMsg('ranking.logs.doesNotExist')).toBe('ranking.logs.doesNotExist');
    });

    it('returns the key when a parent segment is missing', () => {
        expect(getMsg('nonexistent.section.key')).toBe('nonexistent.section.key');
    });

    it('handles vars values that contain placeholder-like text without misbehaving', () => {
        const result = getMsg('ranking.logs.roleAdded', { clan: '{clan}', username: 'X' });
        // Substituted literally, no infinite loop / partial re-replacement issues
        expect(result).toContain('{clan}');
        expect(result).not.toContain('{username}');
    });
});
