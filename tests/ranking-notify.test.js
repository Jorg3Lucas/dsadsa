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
            'ranking.responses.notify.optionNoRole.label': '📧 No Role',
            'ranking.responses.notify.optionNoRole.description': 'Notify members with no roles via DM to register',
            'ranking.responses.notify.optionDomination.label': '⚔️ Domination',
            'ranking.responses.notify.optionDomination.description': 'Call all members to Domination',
            'ranking.responses.notify.optionStandby.label': '⏳ Standby',
            'ranking.responses.notify.optionStandby.description': 'Call all members to the Standby channel',
            'ranking.responses.notify.confirmBtn': '✅ Yes, notify',
            'ranking.responses.notify.cancelBtn': '❌ Cancel',
            'ranking.responses.notify.noRoleConfirm': '⚠️ Confirm DM all no-role members?',
            'ranking.responses.notify.dominationConfirm': '⚠️ Confirm DM all registered for Domination?',
            'ranking.responses.notify.standbyConfirm': '⚠️ Confirm DM all registered for Standby?',
            'ranking.responses.notify.sendingDms': '📧 Sending DMs to {count} members...',
            'ranking.responses.notify.cancelled': '❌ Notification cancelled.',
            'ranking.responses.notify.noRoleDm': 'Hello {displayName}, you have no roles! Register at <#{channelId}>',
            'ranking.responses.notify.noRoleResult': '📧 Complete! Sent: {sent} ✅ Failed: {failed}',
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
        expect(values).toContain('notify_no_role');
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

    it('shows no-role confirmation with Danger buttons', async () => {
        interaction.values = ['notify_no_role'];

        await handleNotifySelect(interaction, db, saveLocalStorage, logEvent);

        expect(interaction.update).toHaveBeenCalledOnce();
        const args = interaction.update.mock.calls[0][0];

        expect(args.content).toBe('⚠️ Confirm DM all no-role members?');
        expect(args.components).toHaveLength(1);

        const json = args.components[0].toJSON();
        const btnJson = json.components;
        expect(btnJson).toHaveLength(2);
        expect(btnJson[0].custom_id).toBe('notify_confirm_no_role');
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
// handleNotifyButton — no-role members
// ──────────────────────────────────────────

describe('handleNotifyButton — notify no-role members', () => {
    let interaction;
    let db;
    let saveLocalStorage;
    let logEvent;

    const ADMIN_TAG = 'AdminUser#0001';
    const NO_ROLE_ID_1 = '111111111111111111';
    const NO_ROLE_ID_2 = '222222222222222222';
    const NO_ROLE_TAG_1 = 'NoRoleOne#1234';
    const NO_ROLE_TAG_2 = 'NoRoleTwo#5678';
    const WITH_ROLE_ID = '333333333333333333';

    function makeMember(id, tag, displayName, rolesSize = 0, isBot = false) {
        return {
            id,
            user: { id, tag, bot: isBot, username: displayName },
            displayName,
            roles: {
                cache: { size: rolesSize }
            },
            send: vi.fn().mockResolvedValue()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        constants.adminChannelId = null;

        db = { users: {} };
        saveLocalStorage = vi.fn();
        logEvent = vi.fn();

        interaction = {
            customId: 'notify_confirm_no_role',
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

    it('returns early when all members have at least one role', async () => {
        const memberWithRole = makeMember(WITH_ROLE_ID, 'WithRole#0001', 'WithRole', 1);
        const membersMap = new Map([[WITH_ROLE_ID, memberWithRole]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} tried to notify no-role members — none found`
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '✅ **All members already have at least one role!**'
        });
    });

    it('skips bots when collecting no-role members', async () => {
        const botMember = makeMember('bot-id', 'Bot#0001', 'Bot', 0, true);
        const membersMap = new Map([['bot-id', botMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} tried to notify no-role members — none found`
        );
    });

    it('skips members that have any role', async () => {
        const withRoleMember = makeMember(WITH_ROLE_ID, 'WithRole#0001', 'WithRole', 2);
        const membersMap = new Map([[WITH_ROLE_ID, withRoleMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} tried to notify no-role members — none found`
        );
    });

    it('sends DMs to no-role members with 5s delay and reports result', { timeout: 30000 }, async () => {
        const noRole1 = makeMember(NO_ROLE_ID_1, NO_ROLE_TAG_1, 'NoRoleOne', 0);
        const noRole2 = makeMember(NO_ROLE_ID_2, NO_ROLE_TAG_2, 'NoRoleTwo', 0);
        const withRoleMember = makeMember(WITH_ROLE_ID, 'WithRole#0001', 'WithRole', 1);
        const membersMap = new Map([
            [NO_ROLE_ID_1, noRole1],
            [NO_ROLE_ID_2, noRole2],
            [WITH_ROLE_ID, withRoleMember]
        ]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(noRole1.send).toHaveBeenCalledWith(
            `Hello NoRoleOne, you have no roles! Register at <#mock-reg-channel>`
        );
        expect(noRole2.send).toHaveBeenCalledWith(
            `Hello NoRoleTwo, you have no roles! Register at <#mock-reg-channel>`
        );
        expect(withRoleMember.send).not.toHaveBeenCalled();

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '📧 Complete! Sent: 2 ✅ Failed: 0',
            components: []
        });

        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} started notifying 2 members with no roles...`
        );
        expect(logEvent).toHaveBeenCalledWith(
            `✅ DM sent to ${NO_ROLE_TAG_1} (${NO_ROLE_ID_1}) — 1/2`
        );
        expect(logEvent).toHaveBeenCalledWith(
            `✅ DM sent to ${NO_ROLE_TAG_2} (${NO_ROLE_ID_2}) — 2/2`
        );
        expect(logEvent).toHaveBeenCalledWith(
            `📧 Admin ${ADMIN_TAG} finished — 2 sent, 0 failed`
        );
    });

    it('handles DM failures gracefully and reports failed count', { timeout: 30000 }, async () => {
        const noRole1 = makeMember(NO_ROLE_ID_1, NO_ROLE_TAG_1, 'NoRoleOne', 0);
        noRole1.send.mockRejectedValue(new Error('Cannot DM this user'));
        const noRole2 = makeMember(NO_ROLE_ID_2, NO_ROLE_TAG_2, 'NoRoleTwo', 0);
        const membersMap = new Map([
            [NO_ROLE_ID_1, noRole1],
            [NO_ROLE_ID_2, noRole2]
        ]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(noRole1.send).toHaveBeenCalledOnce();
        expect(noRole2.send).toHaveBeenCalledOnce();

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '📧 Complete! Sent: 1 ✅ Failed: 1',
            components: []
        });

        expect(logEvent).toHaveBeenCalledWith(
            `❌ DM failed for ${NO_ROLE_TAG_1} (${NO_ROLE_ID_1}) — Cannot DM this user`
        );
    });

    it('sends report to admin channel when adminChannelId is set', async () => {
        constants.adminChannelId = 'admin-ch-123';

        const noRole1 = makeMember(NO_ROLE_ID_1, NO_ROLE_TAG_1, 'NoRoleOne', 0);
        const membersMap = new Map([[NO_ROLE_ID_1, noRole1]]);
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

        const noRole1 = makeMember(NO_ROLE_ID_1, NO_ROLE_TAG_1, 'NoRoleOne', 0);
        const membersMap = new Map([[NO_ROLE_ID_1, noRole1]]);
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
    const NO_MEMBER_ROLE_ID = '444444444444444444';

    function makeMember(id, tag, displayName, hasMemberRole = true, isBot = false) {
        return {
            id,
            user: { id, tag, bot: isBot, username: displayName },
            displayName,
            roles: {
                cache: {
                    has: vi.fn((roleId) => roleId === 'mock-member-role' && hasMemberRole)
                }
            },
            send: vi.fn().mockResolvedValue()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        constants.adminChannelId = null;

        db = { users: {} };
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

    it('returns early when no members with member role found', async () => {
        const noRoleMember = makeMember(NO_MEMBER_ROLE_ID, 'NoRole#0001', 'NoRole', false);
        const membersMap = new Map([[NO_MEMBER_ROLE_ID, noRoleMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `⚔️ Admin ${ADMIN_TAG} tried to notify Domination — no members with member role found`
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ **No members with the member role found to notify.**'
        });
    });

    it('skips bots when collecting members with member role', async () => {
        const botMember = makeMember('bot-id', 'Bot#0001', 'Bot', true, true);
        const membersMap = new Map([['bot-id', botMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            expect.stringContaining('no members with member role found')
        );
    });

    it('DMs all members with member role and reports result', { timeout: 30000 }, async () => {
        const member1 = makeMember(MEMBER_ID_1, 'PlayerOne#1234', 'PlayerOne', true);
        const member2 = makeMember(MEMBER_ID_2, 'PlayerTwo#5678', 'PlayerTwo', true);
        const noMemberRole = makeMember(NO_MEMBER_ROLE_ID, 'NoRole#0001', 'NoRole', false);
        const membersMap = new Map([
            [MEMBER_ID_1, member1],
            [MEMBER_ID_2, member2],
            [NO_MEMBER_ROLE_ID, noMemberRole]
        ]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(member1.send).toHaveBeenCalledWith(
            `⚔️ PlayerOne, join <#mock-dom-channel> for Domination!`
        );
        expect(member2.send).toHaveBeenCalledWith(
            `⚔️ PlayerTwo, join <#mock-dom-channel> for Domination!`
        );
        expect(noMemberRole.send).not.toHaveBeenCalled();

        expect(interaction.editReply).toHaveBeenLastCalledWith({
            content: '⚔️ Domination done! Sent: 2 ✅ Failed: 0',
            components: []
        });
    });

    it('does NOT check db.users — only checks member role', async () => {
        // Member is NOT in db.users but HAS the member role — should still receive DM
        const member1 = makeMember(MEMBER_ID_1, 'PlayerOne#1234', 'PlayerOne', true);
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

    function makeMember(id, tag, displayName, hasMemberRole = true) {
        return {
            id,
            user: { id, tag, bot: false, username: displayName },
            displayName,
            roles: {
                cache: {
                    has: vi.fn((roleId) => roleId === 'mock-member-role' && hasMemberRole)
                }
            },
            send: vi.fn().mockResolvedValue()
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        constants.adminChannelId = null;

        db = { users: {} };
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

    it('returns early when no members with member role found', async () => {
        const noRoleMember = makeMember('999999999999999999', 'NoRole#0001', 'NoRole', false);
        const membersMap = new Map([['999999999999999999', noRoleMember]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(logEvent).toHaveBeenCalledWith(
            `⏳ Admin ${ADMIN_TAG} tried to notify Standby — no members with member role found`
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            content: '❌ **No members with the member role found to notify.**'
        });
    });

    it('DMs member with member role using standby message', async () => {
        const member = makeMember(MEMBER_ID, 'Standby#0001', 'StandbyPlayer', true);
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

    it('does NOT check db.users — only checks member role', async () => {
        // Member has the role but is NOT in db.users — should still receive DM
        const member = makeMember(MEMBER_ID, 'Standby#0001', 'StandbyPlayer', true);
        const membersMap = new Map([[MEMBER_ID, member]]);
        interaction.guild.members.fetch.mockResolvedValue(membersMap);

        await handleNotifyButton(interaction, db, saveLocalStorage, logEvent);

        expect(member.send).toHaveBeenCalledOnce();
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
