import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-constants.js', async (importOriginal) => {
    const actual = await importOriginal();
    const pendingStore = {};
    const pilotStore = {};
    return {
        ...actual,
        pendingRegistrations: pendingStore,
        pendingPilotApprovals: pilotStore
    };
});

import * as constants from '../src/core/ranking-constants.js';
function getPendingRegs() { return constants.pendingRegistrations; }

vi.mock('../src/core/ranking-cache.js', () => ({
    getLocalRankingCache: vi.fn(() => null),
    cleanNickname: vi.fn(s => (s || '').trim().normalize('NFC').toLowerCase().replace(/[^a-z0-9]/g, '')),
    levenshteinDistance: vi.fn((a, b) => {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++)
            for (let j = 1; j <= a.length; j++)
                matrix[i][j] = b[i - 1] === a[j - 1] ? matrix[i - 1][j - 1] : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        return matrix[b.length][a.length];
    }),
    findNicknameInCache: vi.fn(() => null),
    findClosestNicknameInCache: vi.fn(() => null),
    findTopNicknamesInCache: vi.fn(() => [])
}));

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key) => key)
}));

vi.mock('../src/core/ranking-sync-engine.js', () => ({
    runDailySynchronization: vi.fn()
}));

vi.mock('../src/handlers/ranking-scan.js', () => ({
    handleScanImport: vi.fn(),
    handleScanImportStatus: vi.fn()
}));

vi.mock('../src/handlers/ranking-welcome.js', () => ({
    buildWelcomePanelComponents: vi.fn(() => [])
}));

vi.mock('../src/handlers/ranking-pilot.js', () => ({
    findOwnerCandidates: vi.fn(() => [])
}));

import { handleSelectPendingNickname } from '../src/handlers/ranking-commands.js';

// ──────────────────────────────────────────
// handleSelectPendingNickname
// ──────────────────────────────────────────

describe('handleSelectPendingNickname', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const ADMIN_ID = '999999999999999999';
    const ADMIN_TAG = 'AdminUser#0001';
    const USER_ID = '333333333333333333';
    const OTHER_USER_ID = '444444444444444444';
    const NICK = 'PlayerOne';
    const SUGGESTED = 'PlayerOneCorrect';
    const SUGGESTED_2 = 'PlayerOneBetter';

    // Report as built by the /pending command
    function buildReport({ includeOther = true, withFuzzyLine = true } = {}) {
        const lines = [
            '⏳ **Pending Registrations**',
            '',
            `👑 **Owner Registrations (${includeOther ? 2 : 1})**`,
            `<@${USER_ID}> — **${NICK}**`,
            '   ⏰ Expires in: 23.0h | Panel: ✅'
        ];
        if (withFuzzyLine) {
            lines.push(`   🔍 **Fuzzy suggestion:** "${NICK}" → "${SUGGESTED}" (Asia1)`);
        }
        if (includeOther) {
            lines.push(
                `<@${OTHER_USER_ID}> — **OtherPlayer**`,
                '   ⏰ Expires in: 10.0h | Panel: ❌',
                '   🔍 **Fuzzy suggestion:** "OtherPlayer" → "OtherPlayerFix" (EU2)'
            );
        }
        lines.push('📤 **Re-sent 1 admin panel(s) for review.**');
        return lines.join('\n');
    }

    function setupPending(overrides = {}) {
        getPendingRegs()[USER_ID] = {
            nickname: NICK,
            timestamp: Date.now(),
            channelId: null,
            messageId: null,
            ...overrides
        };
    }

    function setupAdminPanel(channelMock) {
        const panelMsg = {
            content: [
                '👑 **New Owner Registration**',
                `👤 **User:** <@${USER_ID}> (PlayerOne#1234)`,
                `🆔 **ID:** ${USER_ID}`,
                `📝 **Nickname:** ${NICK}`,
                '🔍 **Ranking:** ✅ Found — Asia1 (ClanX)',
                '🤝 **Allied Clan:** ✅ Yes — Allied clan'
            ].join('\n'),
            components: [{ type: 1, components: [] }],
            edit: vi.fn().mockResolvedValue()
        };
        interaction.guild.channels.cache.get.mockReturnValue(channelMock || {
            messages: { fetch: vi.fn().mockResolvedValue(panelMsg) }
        });
        return panelMsg;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(getPendingRegs()).forEach(k => delete getPendingRegs()[k]);

        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: `select_pending_nickname_${USER_ID}`,
            values: [SUGGESTED],
            deferUpdate: vi.fn().mockResolvedValue(),
            followUp: vi.fn().mockResolvedValue(),
            editReply: vi.fn().mockResolvedValue(),
            user: { id: ADMIN_ID, tag: ADMIN_TAG },
            message: { content: '', components: [{ placeholder: 'rows' }] },
            guild: { channels: { cache: { get: vi.fn() } } }
        };
    });

    it('aborts without changes when the interaction is already expired', async () => {
        setupPending();
        interaction.deferUpdate.mockRejectedValue(new Error('Unknown interaction'));

        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        expect(getPendingRegs()[USER_ID].selectedNickname).toBeUndefined();
        expect(saveLocalStorage).not.toHaveBeenCalled();
        expect(interaction.editReply).not.toHaveBeenCalled();
        expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it('follows up when the pending registration no longer exists', async () => {
        interaction.message.content = buildReport();

        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.followUp).toHaveBeenCalledWith({
            content: '⌛ This pending registration no longer exists. Run /pending again.',
            flags: 64
        });
        expect(saveLocalStorage).not.toHaveBeenCalled();
        expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('selection: saves selectedNickname, replaces the user fuzzy line, keeps other entries intact', async () => {
        setupPending();
        interaction.message.content = buildReport();

        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        expect(getPendingRegs()[USER_ID].selectedNickname).toBe(SUGGESTED);
        expect(saveLocalStorage).toHaveBeenCalledOnce();

        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.components).toBe(interaction.message.components);
        // User's fuzzy line replaced by a Selected line
        expect(payload.content).toContain(`   ✅ **Selected:** "${SUGGESTED}" (instead of "${NICK}")`);
        expect(payload.content).not.toContain(`Fuzzy suggestion:** "${NICK}"`);
        // Other entry untouched
        expect(payload.content).toContain('Fuzzy suggestion:** "OtherPlayer"');
        expect(payload.content).toContain('📤 **Re-sent 1 admin panel(s) for review.**');

        expect(logEvent).toHaveBeenCalledWith(
            `✅ Admin ${ADMIN_TAG} corrected pending nickname for <@${USER_ID}>: "${NICK}" → "${SUGGESTED}"`
        );
    });

    it('selection: appends the selection line when the user block has no fuzzy line', async () => {
        setupPending();
        interaction.message.content = buildReport({ withFuzzyLine: false, includeOther: false });

        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.content).toContain(`   ✅ **Selected:** "${SUGGESTED}" (instead of "${NICK}")`);
    });

    it('re-selection replaces the previous selection without leaving duplicates', async () => {
        setupPending();
        interaction.message.content = buildReport();

        // First selection
        interaction.values = [SUGGESTED];
        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);
        const firstContent = interaction.editReply.mock.calls[0][0].content;

        // Second selection on the updated message
        interaction.values = [SUGGESTED_2];
        interaction.message.content = firstContent;
        interaction.editReply.mockClear();
        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        expect(getPendingRegs()[USER_ID].selectedNickname).toBe(SUGGESTED_2);
        const secondContent = interaction.editReply.mock.calls[0][0].content;
        // Exactly one Selected line remains, referencing the previous selection as the baseline
        const selectedMatches = secondContent.match(/✅ \*\*Selected:\*\* "[^"]*"/g) || [];
        expect(selectedMatches).toHaveLength(1);
        expect(secondContent).toContain(`   ✅ **Selected:** "${SUGGESTED_2}" (instead of "${SUGGESTED}")`);
        // The old selection line is gone (only referenced inside the "instead of" note)
        expect(secondContent).not.toMatch(/✅ \*\*Selected:\*\* "PlayerOneCorrect"/);
    });

    it('re-selection on a fresh report with a stale Selected line keeps exactly one', async () => {
        setupPending({ selectedNickname: SUGGESTED });
        // A fresh /pending run after a prior correction renders BOTH a Selected line and the fuzzy line
        interaction.message.content = [
            '⏳ **Pending Registrations**',
            '',
            '👑 **Owner Registrations (1)**',
            `<@${USER_ID}> — **${NICK}**`,
            '   ⏰ Expires in: 23.0h | Panel: ✅',
            `   ✅ **Selected:** "${SUGGESTED}"`,
            `   🔍 **Fuzzy suggestion:** "${NICK}" → "${SUGGESTED}" (Asia1)`,
            '📤 **Re-sent 1 admin panel(s) for review.**'
        ].join('\n');
        interaction.values = [SUGGESTED_2];

        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        const content = interaction.editReply.mock.calls[0][0].content;
        const selectedMatches = content.match(/✅ \*\*Selected:\*\* "[^"]*"/g) || [];
        expect(selectedMatches).toHaveLength(1);
        expect(content).toContain(`   ✅ **Selected:** "${SUGGESTED_2}" (instead of "${SUGGESTED}")`);
        expect(content).not.toMatch(/✅ \*\*Selected:\*\* "PlayerOneCorrect"/);
    });

    it('panel sync strips a stale Corrected-by-admin note from the panel', async () => {
        setupPending({ channelId: 'admin-ch-1', messageId: 'msg-1', selectedNickname: SUGGESTED });
        interaction.message.content = buildReport();
        interaction.values = [SUGGESTED_2];

        const panelMsg = {
            content: [
                '👑 **New Owner Registration**',
                `👤 **User:** <@${USER_ID}> (PlayerOne#1234)`,
                `🆔 **ID:** ${USER_ID}`,
                `📝 **Nickname:** ${SUGGESTED}`,
                `✅ **Corrected by admin:** "${NICK}" → "${SUGGESTED}"`,
                '🔍 **Ranking:** ✅ Found — Asia1 (ClanX)',
                '🤝 **Allied Clan:** ✅ Yes — Allied clan'
            ].join('\n'),
            components: [{ type: 1, components: [] }],
            edit: vi.fn().mockResolvedValue()
        };
        interaction.guild.channels.cache.get.mockReturnValue({
            messages: { fetch: vi.fn().mockResolvedValue(panelMsg) }
        });

        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        const editedContent = panelMsg.edit.mock.calls[0][0].content;
        expect(editedContent).toContain(`📝 **Nickname:** ${SUGGESTED_2} (corrected from "${SUGGESTED}")`);
        expect(editedContent).not.toContain('Corrected by admin');
    });

    it('keep-as-typed stores the typed nickname and keeps the panel note clean', async () => {
        setupPending({ channelId: 'admin-ch-1', messageId: 'msg-1' });
        interaction.message.content = buildReport();
        interaction.values = [NICK];

        const panelMsg = setupAdminPanel();
        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        expect(getPendingRegs()[USER_ID].selectedNickname).toBe(NICK);
        expect(saveLocalStorage).toHaveBeenCalledOnce();

        // Report updated
        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.content).toContain('**Selected:**');

        // Panel synced without a "corrected from" note
        expect(panelMsg.edit).toHaveBeenCalledWith({
            content: expect.stringContaining(`📝 **Nickname:** ${NICK}`),
            components: panelMsg.components
        });
        expect(panelMsg.edit.mock.calls[0][0].content).not.toContain('corrected from');
    });

    it('panel sync: updates the admin panel nickname when channelId/messageId exist', async () => {
        setupPending({ channelId: 'admin-ch-1', messageId: 'msg-1' });
        interaction.message.content = buildReport();

        const panelMsg = setupAdminPanel();
        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        expect(panelMsg.edit).toHaveBeenCalledWith({
            content: expect.stringContaining(`📝 **Nickname:** ${SUGGESTED} (corrected from "${NICK}")`),
            components: panelMsg.components
        });
    });

    it('panel sync: handles a missing admin channel gracefully', async () => {
        setupPending({ channelId: 'admin-ch-1', messageId: 'msg-1' });
        interaction.message.content = buildReport();
        interaction.guild.channels.cache.get.mockReturnValue(null);

        await expect(handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent)).resolves.toBeUndefined();

        expect(saveLocalStorage).toHaveBeenCalledOnce();
        expect(interaction.editReply).toHaveBeenCalledOnce();
    });

    it('panel sync: handles a message fetch failure gracefully', async () => {
        setupPending({ channelId: 'admin-ch-1', messageId: 'msg-1' });
        interaction.message.content = buildReport();
        interaction.guild.channels.cache.get.mockReturnValue({
            messages: { fetch: vi.fn().mockRejectedValue(new Error('Message deleted')) }
        });

        await expect(handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent)).resolves.toBeUndefined();

        expect(getPendingRegs()[USER_ID].selectedNickname).toBe(SUGGESTED);
        expect(interaction.editReply).toHaveBeenCalledOnce();
    });

    it('fallback: appends a note at the end when the user anchor is not found', async () => {
        setupPending();
        interaction.message.content = 'unrelated message content without the user block';

        await handleSelectPendingNickname(interaction, db, saveLocalStorage, logEvent);

        const payload = interaction.editReply.mock.calls[0][0];
        expect(payload.content).toContain(`📌 **Selected for <@${USER_ID}>:** "${SUGGESTED}"`);
    });
});
