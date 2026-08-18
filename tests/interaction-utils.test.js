import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isExpiredError, deferReplySafe, deferUpdateSafe, editReplySafe } from '../src/core/interaction-utils.js';

describe('isExpiredError', () => {
    it('returns true for Discord error code 10062', () => {
        expect(isExpiredError({ code: 10062 })).toBe(true);
    });

    it('returns true when message mentions Unknown interaction', () => {
        expect(isExpiredError(new Error('Unknown interaction'))).toBe(true);
        expect(isExpiredError({ message: 'Unknown interaction', code: 10062 })).toBe(true);
    });

    it('returns false for other errors and falsy values', () => {
        expect(isExpiredError(new Error('Some other error'))).toBe(false);
        expect(isExpiredError(null)).toBe(false);
        expect(isExpiredError(undefined)).toBe(false);
    });
});

describe('deferReplySafe', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('defers and returns true', async () => {
        const interaction = {
            customId: 'cmd',
            deferred: false,
            replied: false,
            deferReply: vi.fn().mockResolvedValue()
        };
        const result = await deferReplySafe(interaction);
        expect(result).toBe(true);
        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    });

    it('returns false without throwing when deferReply fails with 10062', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const interaction = {
            customId: 'cmd',
            deferred: false,
            replied: false,
            deferReply: vi.fn().mockRejectedValue({ code: 10062, message: 'Unknown interaction' })
        };
        const result = await deferReplySafe(interaction);
        expect(result).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('returns true without calling deferReply when already deferred', async () => {
        const interaction = {
            deferred: true,
            replied: false,
            deferReply: vi.fn()
        };
        expect(await deferReplySafe(interaction)).toBe(true);
        expect(interaction.deferReply).not.toHaveBeenCalled();
    });
});

describe('deferUpdateSafe', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('defers the update and returns true', async () => {
        const interaction = {
            customId: 'btn',
            deferred: false,
            replied: false,
            deferUpdate: vi.fn().mockResolvedValue()
        };
        expect(await deferUpdateSafe(interaction)).toBe(true);
        expect(interaction.deferUpdate).toHaveBeenCalledOnce();
    });

    it('returns false without throwing on expired interaction', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const interaction = {
            customId: 'btn',
            deferred: false,
            replied: false,
            deferUpdate: vi.fn().mockRejectedValue(new Error('Unknown interaction'))
        };
        expect(await deferUpdateSafe(interaction)).toBe(false);
        warn.mockRestore();
    });

    it('returns true when already acknowledged', async () => {
        const interaction = {
            deferred: true,
            replied: false,
            deferUpdate: vi.fn()
        };
        expect(await deferUpdateSafe(interaction)).toBe(true);
        expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
});

describe('editReplySafe', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('edits the reply and returns the message', async () => {
        const message = { id: '1' };
        const interaction = { editReply: vi.fn().mockResolvedValue(message) };
        expect(await editReplySafe(interaction, { content: 'ok' })).toBe(message);
        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'ok' });
    });

    it('returns null without throwing when the interaction expired mid-flow', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const interaction = {
            editReply: vi.fn().mockRejectedValue({ code: 10062, message: 'Unknown interaction' })
        };
        expect(await editReplySafe(interaction, { content: 'late' })).toBeNull();
        warn.mockRestore();
    });
});
