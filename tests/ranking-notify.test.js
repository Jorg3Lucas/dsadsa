import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──
vi.mock('../src/core/ranking-constants.js', () => ({
    MEMBER_ROLE_ID: 'mock-member-role',
    REGISTRATION_CHANNEL_ID: 'mock-reg-channel',
    DOMINATION_CHANNEL_ID: 'mock-dom-channel',
    STANDBY_CHANNEL_ID: 'mock-standby-channel',
    adminChannelId: null
}));

import * as constants from '../src/core/ranking-constants.js';

vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key, vars) => {
        const templates = {
            'ranking.responses.notify.prompt': '📧 **Select the type of notification to send:**',
            'ranking.responses.notify.placeholder': 'Choose an option...',
            'ranking.responses.notify.optionUnreg.label': '📧 Unregistered',
            'ranking.responses.notify.optionUnreg.description': 'Notify unregistered members via DM to register',
            'ranking.responses.notify.optionDomination.label': '⚔️ Domination',
            'ranking.responses.notify.optionDomination.description': 'Call all members to Domination',
            'ranking.responses.notify.optionStandby.label': '⏳ Standby',
            'ranking.responses.notify.optionStandby.description': 'Call all members to the Standby channel',
            'ranking.responses.notify.confirmBtn': '✅ Yes, notify',
            'ranking.responses.notify.cancelBtn': '❌ Cancel',
            'ranking.responses.notify.unregConfirm': '⚠️ Confirm DM all unregistered?',
            'ranking.responses.notify.dominationConfirm': '⚠️ Confirm DM all registered for Domination?',
            'ranking.responses.notify.standbyConfirm': '⚠️ Confirm DM all registered for Standby?',
            'ranking.responses.notify.sendingDms': '📧 Sending DMs to {count} members...',
            'ranking.responses.notify.cancelled': '❌ Notification cancelled.',
            'ranking.responses.notify.unregDm': 'Hello {displayName}, please register at <#{channelId}>',
            'ranking.responses.notify.unregResult': '📧 Complete! Sent: {sent} ✅ Failed: {failed}',
            'ranking.responses.notify.dominationDm': '⚔️ {displayName}, join <#{channelId}> for Domination!',
            'ranking.responses.notify.dominationResult': '⚔️ Domination done! Sent: {sent} ✅ Failed: {failed}',
            'ranking.responses.notify.standbyDm': '⏳ {displayName}, join <#{channelId}> for Standby!',
            'ranking.responses.notify.standbyResult': '⏳ Standby done! Sent: {sent} ✅ Failed: {failed}'
        };
        let msg = templates[key] || key;
        if (vars) {
            for (const [k, v] of Object.entries(vars)) {
                msg = msg.replace(`{${k}}`, v);
            }
        }
        return msg;
    })
}));

import {
    handleNotifyCommand,
    handleNotifySelect,
    handleNotifyButton
} from '../src/handlers/ranking-notify.js';

// ──────────────────────────────────────────
// handleNotifyCommand tests
// ──────────────────────────────────────────

describe('handleNotifyCommand', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    beforeEach(() => {
        vi.clearAllMocks();
        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            reply: vi.fn().mockResolvedValue()
        };
    });

    it('replies with a select menu containing 3 options', async () => {
        await handleNotifyCommand(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.reply).toHaveBeenCalledOnce();
        const replyArgs = interaction.reply.mock.calls[0][0];

        // Ephemeral
        expect(replyArgs.flags).toBe(64);

        // Contains prompt message
        expect(replyArgs.content).toBe('📧 **Select the type of notification to send:**');

        // Contains one action row with a select menu
        expect(replyArgs.components).toHaveLength(1);
        const row = replyArgs.components[0];

        // Verify option values by serializing to JSON
        const json = row.toJSON();
        expect(json.components[0].custom_id).toBe('notify_select_action');
        const options = json.components[0].options;
        expect(options).toHaveLength(3);
        const values = options.map(o => o.value);
        expect(values).toContain('notify_unregistered');
        expect(values).toContain('notify_domination');
        expect(values).toContain('notify_standby');
        expect(options[0].emoji?.name).toBe('📧');
        expect(options[1].emoji?.name).toBe('⚔️');
        expect(options[2].emoji?.name).toBe('⏳');
    });
});

// ──────────────────────────────────────────
// handleNotifySelect tests
// ──────────────────────────────────────────

describe('handleNotifySelect', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    beforeEach(() => {
        vi.clearAllMocks();
        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            user: { id: 'admin-user-id' },
            values: [],
            update: vi.fn().mockResolvedValue()
        };
    });

    it('shows unregistered confirmation with Danger buttons', async () => {
        interaction.values = ['notify_unregistered'];

        await handleNotifySelect(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.update).toHaveBeenCalledOnce();
        const args = interaction.update.mock.calls[0][0];

        expect(args.content).toBe('⚠️ Confirm DM all unregistered?');
        expect(args.components).toHaveLength(1);

        const json = args.components[0].toJSON();
        const btnJson = json.components;
        expect(btnJson).toHaveLength(2);
        expect(btnJson[0].custom_id).toBe('notify_confirm_unreg');
        expect(btnJson[0].label).toBe('✅ Yes, notify');
        expect(btnJson[0].style).toBe(4); // Danger
        expect(btnJson[1].custom_id).toBe('notify_cancel');
        expect(btnJson[1].label).toBe('❌ Cancel');
    });

    it('shows domination confirmation with Danger buttons', async () => {
        interaction.values = ['notify_domination'];

        await handleNotifySelect(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.update).toHaveBeenCalledOnce();
        const args = interaction.update.mock.calls[0][0];

        expect(args.content).toBe('⚠️ Confirm DM all registered for Domination?');
        expect(args.components).toHaveLength(1);

        const json = args.components[0].toJSON();
        const btnJson = json.components;
        expect(btnJson).toHaveLength(2);
        expect(btnJson[0].custom_id).toBe('notify_confirm_domination');
        expect(btnJson[0].style).toBe(4); // Danger
        expect(btnJson[1].custom_id).toBe('notify_cancel');
    });

    it('shows standby confirmation with Danger buttons', async () => {
        interaction.values = ['notify_standby'];

        await handleNotifySelect(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.update).toHaveBeenCalledOnce();
        const args = interaction.update.mock.calls[0][0];

        expect(args.content).toBe('⚠️ Confirm DM all registered for Standby?');
        expect(args.components).toHaveLength(1);

        const json = args.components[0].toJSON();
        const btnJson = json.components;
        expect(btnJson).toHaveLength(2);
        expect(btnJson[0].custom_id).toBe('notify_confirm_standby');
        expect(btnJson[0].style).toBe(4); // Danger
        expect(btnJson[1].custom_id).toBe('notify_cancel');
    });
});

// ──────────────────────────────────────────
// handleNotifyButton tests
// ──────────────────────────────────────────

describe('handleNotifyButton — cancel', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    beforeEach(() => {
        vi.clearAllMocks();
        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: 'notify_cancel',
            user: { id: 'admin-user-id' },
            update: vi.fn().mockResolvedValue()
        };
    });

    it('updates with cancelled message and clears components', async () => {
        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.update).toHaveBeenCalledOnce();
        const args = interaction.update.mock.calls[0][0];
        expect(args.content).toBe('❌ Notification cancelled.');
        expect(args.components).toEqual([]);
    });
});

// ──────────────────────────────────────────
// handleNotifyButton — unregistered
// ──────────────────────────────────────────

describe('handleNotifyButton — notify unregistered', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const ADMIN_TAG = 'AdminUser#0001';
    const UNREG_ID_1 = '111111111111111111';
    const UNREG_ID_2 = '222222222222222222';
    const UNREG_TAG_1 = 'UnregOne#1234';
    const UNREG_TAG_2 = 'UnregTwo#5678';
    const REG_ID = '333333333333333333';

    function makeMember(id, tag, displayName, hasRole = true, isBot = false) {
        return {
            id,
            user: { id, tag, bot: isBot, username: displayName },
            displayName,
            roles: {
                cache: {
                    has: vi.fn().mockReturnValue(hasRole)
                }
            },
            send: vi.fn().mockResolvedValue()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        constants.adminChannelId = null;

        db = {
            users: {
                [REG_ID]: { nickname: 'RegUser', registeredAt: new Date().toISOString() }
            }
        };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: 'notify_confirm_unreg',
            user: { id: 'admin-user-id', tag: ADMIN_TAG },
            guild: {
                members: { fetch: vi.fn() },
                channels: { cache: { get: vi.fn() } }
            },
            deferUpdate: vi.fn().mockResolvedValue(),
            editReply: vi.fn().mockResolvedValue()
        };
    });

    it('replies error when members.fetch returns null', async () => {
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ Could not fetch guild members.'
        });
    });

    it('replies error when members.fetch returns empty collection', async () => {
        interaction.guild.members.fetch.mockResolvedValue(new Map());

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ Could not fetch guild members.'
        });
    });

    it('returns early when all members with role are already registered', async () => {
        const regMember = makeMember(REG_ID, 'RegUser#0001', 'RegUser');
        const membersMap = new Map([[REG_ID, regMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} tried to notify unregistered — none found`
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '✅ **All members with the role are already registered!**'
        });
    });

    it('skips bots when collecting unregistered members', async () => {
        const botMember = makeMember('bot-id', 'Bot#0001', 'Bot', true, true);
        const membersMap = new Map([['bot-id', botMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} tried to notify unregistered — none found`
        );
    });

    it('skips members without the role', async () => {
        const noRoleMember = makeMember(UNREG_ID_1, UNREG_TAG_1, 'UnregOne', false);
        const membersMap = new Map([[UNREG_ID_1, noRoleMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} tried to notify unregistered — none found`
        );
    });

    it('sends DMs to unregistered members with 5s delay and reports result', { timeout: 30000 }, async () => {
        const unreg1 = makeMember(UNREG_ID_1, UNREG_TAG_1, 'UnregOne');
        const unreg2 = makeMember(UNREG_ID_2, UNREG_TAG_2, 'UnregTwo');
        const regMember = makeMember(REG_ID, 'RegUser#0001', 'RegUser');
        const membersMap = new Map([
            [UNREG_ID_1, unreg1],
            [UNREG_ID_2, unreg2],
            [REG_ID, regMember]
        ]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(unreg1.send).toHaveBeenCalledWith(
            `Hello UnregOne, please register at <#mock-reg-channel>`
        );
        expect(unreg2.send).toHaveBeenCalledWith(
            `Hello UnregTwo, please register at <#mock-reg-channel>`
        );
        expect(regMember.send).not.toHaveBeenCalled();

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '📧 Complete! Sent: 2 ✅ Failed: 0',
            components: []
        });

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} started notifying 2 unregistered members...`
        );
        expect(logEvent).toHaveBeenCalledWith(
            `✅ DM sent to ${UNREG_TAG_1} (${UNREG_ID_1}) — 1/2`
        );
        expect(logEvent).toHaveBeenCalledWith(
            `✅ DM sent to ${UNREG_TAG_2} (${UNREG_ID_2}) — 2/2`
        );
        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} finished — 2 sent, 0 failed`
        );
    });

    it('handles DM failures gracefully and reports failed count', { timeout: 30000 }, async () => {
        const unreg1 = makeMember(UNREG_ID_1, UNREG_TAG_1, 'UnregOne');
        unreg1.send.mockRejectedValue(new Error('Cannot DM this user'));
        const unreg2 = makeMember(UNREG_ID_2, UNREG_TAG_2, 'UnregTwo');
        const membersMap = new Map([
            [UNREG_ID_1, unreg1],
            [UNREG_ID_2, unreg2]
        ]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(unreg1.send).toHaveBeenCalledOnce();
        expect(unreg2.send).toHaveBeenCalledOnce();

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '📧 Complete! Sent: 1 ✅ Failed: 1',
            components: []
        });

        expect(logEvent).toHaveBeenCalledWith(
            `❌ DM failed for ${UNREG_TAG_1} (${UNREG_ID_1}) — Cannot DM this user`
        );
    });

    it('sends report to admin channel when adminChannelId is set', async () => {
        constants.adminChannelId = 'admin-ch-123';

        const unreg1 = makeMember(UNREG_ID_1, UNREG_TAG_1, 'UnregOne');
        const membersMap = new Map([[UNREG_ID_1, unreg1]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        const adminChSend = vi.fn().mockResolvedValue();
        interaction.guild.channels = {
            cache: { get: vi.fn().mockReturnValue({ send: adminChSend }) }
        };

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(adminChSend).toHaveBeenCalledOnce();
        const report = adminChSend.mock.calls[0][0].content;
        expect(report).toContain('Bulk DM Report');
        expect(report).toContain(ADMIN_TAG);
        expect(report).toContain('1');
    });

    it('handles admin channel send failure gracefully', async () => {
        constants.adminChannelId = 'admin-ch-123';

        const unreg1 = makeMember(UNREG_ID_1, UNREG_TAG_1, 'UnregOne');
        const membersMap = new Map([[UNREG_ID_1, unreg1]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);
        interaction.guild.channels = {
            cache: { get: vi.fn().mockReturnValue(null) }
        };

        await expect(
            handleNotifyButton(interaction, db, saveLocalStorage, logEvent)
        ).resolves.toBeUndefined();
    });
});

// ──────────────────────────────────────────
// handleNotifyButton — domination
// ──────────────────────────────────────────

describe('handleNotifyButton — notify domination', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const ADMIN_TAG = 'AdminUser#0001';
    const MEMBER_ID_1 = '111111111111111111';
    const MEMBER_ID_2 = '222222222222222222';
    const UNREG_ID = '444444444444444444';

    function makeMember(id, tag, displayName, isRegistered = true, isBot = false) {
        return {
            id,
            user: { id, tag, bot: isBot, username: displayName },
            displayName,
            send: vi.fn().mockResolvedValue()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        constants.adminChannelId = null;

        db = {
            users: {
                [MEMBER_ID_1]: { nickname: 'PlayerOne', registeredAt: new Date().toISOString() },
                [MEMBER_ID_2]: { nickname: 'PlayerTwo', registeredAt: new Date().toISOString() }
            }
        };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: 'notify_confirm_domination',
            user: { id: 'admin-user-id', tag: ADMIN_TAG },
            guild: {
                members: { fetch: vi.fn() },
                channels: { cache: { get: vi.fn() } }
            },
            deferUpdate: vi.fn().mockResolvedValue(),
            editReply: vi.fn().mockResolvedValue()
        };
    });

    it('replies error when members.fetch returns null', async () => {
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ Could not fetch guild members.'
        });
    });

    it('returns early when no registered members found', async () => {
        const unregMember = makeMember(UNREG_ID, 'Unreg#0001', 'Unreg', false);
        const membersMap = new Map([[UNREG_ID, unregMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `⚔️ Admin ${ADMIN_TAG} tried to notify Domination — no registered members found`
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ **No registered members found to notify.**'
        });
    });

    it('skips bots when collecting registered members', async () => {
        const botMember = makeMember('bot-id', 'Bot#0001', 'Bot', true, true);
        const membersMap = new Map([['bot-id', botMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('no registered members found')
        );
    });

    it('DMs all registered members and reports result', { timeout: 30000 }, async () => {
        const member1 = makeMember(MEMBER_ID_1, 'PlayerOne#1234', 'PlayerOne');
        const member2 = makeMember(MEMBER_ID_2, 'PlayerTwo#5678', 'PlayerTwo');
        const unregMember = makeMember(UNREG_ID, 'Unreg#0001', 'Unreg', false);
        const membersMap = new Map([
            [MEMBER_ID_1, member1],
            [MEMBER_ID_2, member2],
            [UNREG_ID, unregMember]
        ]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(member1.send).toHaveBeenCalledWith(
            `⚔️ PlayerOne, join <#mock-dom-channel> for Domination!`
        );
        expect(member2.send).toHaveBeenCalledWith(
            `⚔️ PlayerTwo, join <#mock-dom-channel> for Domination!`
        );
        expect(unregMember.send).not.toHaveBeenCalled();

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '⚔️ Domination done! Sent: 2 ✅ Failed: 0',
            components: []
        });
    });

    it('handles manual=true as registered as well', async () => {
        db.users = {
            [MEMBER_ID_1]: { nickname: 'ManualPlayer', manual: true }
        };
        const member1 = makeMember(MEMBER_ID_1, 'Manual#1234', 'ManualPlayer');
        const membersMap = new Map([[MEMBER_ID_1, member1]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(member1.send).toHaveBeenCalledOnce();
    });

    it('handles DM failures and reports failed count', { timeout: 30000 }, async () => {
        const member1 = makeMember(MEMBER_ID_1, 'PlayerOne#1234', 'PlayerOne');
        member1.send.mockRejectedValue(new Error('DMs disabled'));
        const member2 = makeMember(MEMBER_ID_2, 'PlayerTwo#5678', 'PlayerTwo');
        const membersMap = new Map([
            [MEMBER_ID_1, member1],
            [MEMBER_ID_2, member2]
        ]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '⚔️ Domination done! Sent: 1 ✅ Failed: 1',
            components: []
        });

        expect(logEvent).toHaveBeenCalledWith(
            `❌ DM failed for PlayerOne#1234 (${MEMBER_ID_1}) — DMs disabled`
        );
    });

    it('sends report to admin channel when configured', async () => {
        constants.adminChannelId = 'admin-ch-456';

        const member1 = makeMember(MEMBER_ID_1, 'PlayerOne#1234', 'PlayerOne');
        const membersMap = new Map([[MEMBER_ID_1, member1]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        const adminChSend = vi.fn().mockResolvedValue();
        interaction.guild.channels = {
            cache: { get: vi.fn().mockReturnValue({ send: adminChSend }) }
        };

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(adminChSend).toHaveBeenCalledOnce();
        const report = adminChSend.mock.calls[0][0].content;
        expect(report).toContain('Domination DM Report');
        expect(report).toContain(ADMIN_TAG);
    });
});

// ──────────────────────────────────────────
// handleNotifyButton — standby
// ──────────────────────────────────────────

describe('handleNotifyButton — notify standby', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const ADMIN_TAG = 'AdminUser#0001';
    const MEMBER_ID = '555555555555555555';

    function makeMember(id, tag, displayName) {
        return {
            id,
            user: { id, tag, bot: false, username: displayName },
            displayName,
            send: vi.fn().mockResolvedValue()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        constants.adminChannelId = null;

        db = {
            users: {
                [MEMBER_ID]: { nickname: 'StandbyPlayer', registeredAt: new Date().toISOString() }
            }
        };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: 'notify_confirm_standby',
            user: { id: 'admin-user-id', tag: ADMIN_TAG },
            guild: {
                members: { fetch: vi.fn() },
                channels: { cache: { get: vi.fn() } }
            },
            deferUpdate: vi.fn().mockResolvedValue(),
            editReply: vi.fn().mockResolvedValue()
        };
    });

    it('replies error when members.fetch returns null', async () => {
        interaction.guild.members.fetch.mockResolvedValue(null);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ Could not fetch guild members.'
        });
    });

    it('returns early when no registered members found', async () => {
        // Non-registered member (in guild but not in db.users)
        const nonRegMember = makeMember('999999999999999999', 'NonReg#0001', 'NonReg');
        const membersMap = new Map([['999999999999999999', nonRegMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `⏳ Admin ${ADMIN_TAG} tried to notify Standby — no registered members found`
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ **No registered members found to notify.**'
        });
    });

    it('DMs registered member with standby message', async () => {
        const member = makeMember(MEMBER_ID, 'Standby#0001', 'StandbyPlayer');
        const membersMap = new Map([[MEMBER_ID, member]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(member.send).toHaveBeenCalledWith(
            `⏳ StandbyPlayer, join <#mock-standby-channel> for Standby!`
        );

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '⏳ Standby done! Sent: 1 ✅ Failed: 0',
            components: []
        });
    });

    it('handles DM failure and reports correctly', async () => {
        const member = makeMember(MEMBER_ID, 'Standby#0001', 'StandbyPlayer');
        member.send.mockRejectedValue(new Error('Blocked DMs'));
        const membersMap = new Map([[MEMBER_ID, member]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '⏳ Standby done! Sent: 0 ✅ Failed: 1',
            components: []
        });
    });

    it('sends report to admin channel when configured', async () => {
        constants.adminChannelId = 'admin-ch-789';

        const member = makeMember(MEMBER_ID, 'Standby#0001', 'StandbyPlayer');
        const membersMap = new Map([[MEMBER_ID, member]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        const adminChSend = vi.fn().mockResolvedValue();
        interaction.guild.channels = {
            cache: { get: vi.fn().mockReturnValue({ send: adminChSend }) }
        };

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(adminChSend).toHaveBeenCalledOnce();
        const report = adminChSend.mock.calls[0][0].content;
        expect(report).toContain('Standby DM Report');
        expect(report).toContain(ADMIN_TAG);
    });
});
