import { describe, it, expect, vi } from 'vitest';
import { SLASH_COMMANDS, registerMir4SlashCommands } from '../src/core/ranking-deploy.js';

// The bot registers src/commands.json on startup and src/deploy-commands.cjs
// pushes the same file manually. This suite is the guard against drift: it
// checks the payload is API-valid and that registration really sends it.

const EXPECTED_NAMES = [
    'removepilot', 'forcesync', 'resetgrace', 'manualregister', 'manualforce',
    'manualpilot', 'cleandb', 'manage', 'manualremove', 'manualremovepilot',
    'sendpanel', 'pending', 'stats', 'grace', 'notify', 'restorebackup',
    'update', 'autoregister'
];

const MEMBER_COMMANDS = ['removepilot', 'stats'];
const VALID_OPTION_TYPES = [3, 4, 5, 6, 7, 8, 10, 11];

describe('slash command definitions (src/commands.json)', () => {
    it('declares every expected command exactly once', () => {
        const names = SLASH_COMMANDS.map(c => c.name);
        expect(names).toHaveLength(EXPECTED_NAMES.length);
        expect([...names].sort()).toEqual([...EXPECTED_NAMES].sort());
        expect(new Set(names).size).toBe(names.length);
    });

    it('uses names and descriptions Discord accepts', () => {
        for (const command of SLASH_COMMANDS) {
            expect(command.name).toMatch(/^[a-z0-9-]{1,32}$/);
            expect(typeof command.description).toBe('string');
            expect(command.description.length).toBeGreaterThan(0);
            expect(command.description.length).toBeLessThanOrEqual(100);
        }
    });

    it('restricts admin commands to Manage Server and leaves member commands open', () => {
        for (const command of SLASH_COMMANDS) {
            if (MEMBER_COMMANDS.includes(command.name)) {
                expect(command.default_member_permissions).toBeUndefined();
            } else {
                expect(command.default_member_permissions).toBe('8');
            }
        }
    });

    it('defines options with valid types, names and required flags', () => {
        for (const command of SLASH_COMMANDS) {
            for (const option of command.options || []) {
                expect(VALID_OPTION_TYPES).toContain(option.type);
                expect(option.name).toMatch(/^[a-z0-9_-]{1,32}$/);
                expect(typeof option.description).toBe('string');
                expect(option.description.length).toBeGreaterThan(0);
                expect(option.description.length).toBeLessThanOrEqual(100);
                expect(typeof option.required).toBe('boolean');
            }
        }
    });

    it('registration sends the shared list untouched', async () => {
        const set = vi.fn(async () => []);
        await registerMir4SlashCommands({ commands: { set } });

        expect(set).toHaveBeenCalledOnce();
        expect(set).toHaveBeenCalledWith(SLASH_COMMANDS);
        expect(set.mock.calls[0][0]).toHaveLength(EXPECTED_NAMES.length);
    });

    it('logs instead of throwing when Discord refuses the registration', async () => {
        const set = vi.fn(async () => { throw new Error('Missing Access'); });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(registerMir4SlashCommands({ commands: { set } })).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Error registering slash commands'), expect.any(Error));

        error.mockRestore();
    });
});
