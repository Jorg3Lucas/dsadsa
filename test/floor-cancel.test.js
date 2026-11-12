// ==========================================
// 🧪 UNIT TESTS — handleFloorCancel (src/interactions/floor-claim.js)
// Run: npm test
// ==========================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The dependencies of the cancel handler talk to Discord and to the filesystem
// (panel refresh, DMs, daily logs, state persistence), so they are replaced by
// in-memory stubs that only record what the handler asked them to do.
const calls = {
    cooldowns: [],
    removed: [],
    freed: [],
    logs: [],
    dms: [],
    refresh: [],
    saves: 0
};

const SUT = '../src/interactions/floor-claim.js';
const STUB_URL = 'stub:floor-cancel-deps';
const STUBBED = new Set([
    '../core/lang.js',
    '../core/state.js',
    '../handlers/panel-utils.js',
    '../core/daily-logs.js',
    '../handlers/claim-core.js',
    '../core/time-utils.js',
    '../core/config.js'
]);

const STUB_SOURCE = `
const calls = globalThis.__floorCancelCalls;
export const getMsg = key => key;
export const db = {};
export const saveLocalStorage = () => { calls.saves++; };
export const refreshVisualPanel = key => { calls.refresh.push(key); };
export const notifyUserDM = (uid, msg) => { calls.dms.push({ uid, msg }); };
export const pushToDailyLogs = (type, user, room, context = "") => { calls.logs.push({ type, user, room, context }); };
export const checkPunishment = () => null;
export const isImmune = () => false;
export const hasActiveClaim = () => false;
export const hasActiveQueue = () => false;
export const buildActiveClaimMessage = () => null;
export const applyFiveMinCooldown = uid => { calls.cooldowns.push(uid); };
export const removeUserFromQueue = (obj, uid) => { calls.removed.push({ obj, uid }); return true; };
export const freeFloorAndActivateNextGracePeriod = obj => { calls.freed.push(obj); };
export const getFormattedTime12h = () => "10:00 PM";
export const getLocalTime = () => new Date(0);
export const parseStringToDate = () => null;
export const isClaimWindowOpen = () => true;
export const calculateNextOpening = () => null;
export const getBrazilDailyCycleKey = () => "test";
export const noop = () => {};
`;

registerHooks({
    resolve(specifier, context, nextResolve) {
        const fromSut = Boolean(context.parentURL) && context.parentURL.endsWith('/src/interactions/floor-claim.js');
        if (fromSut && STUBBED.has(specifier)) {
            return { url: STUB_URL, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url === STUB_URL) {
            return { format: 'module', source: STUB_SOURCE, shortCircuit: true };
        }
        return nextLoad(url, context);
    }
});

globalThis.__floorCancelCalls = calls;

const { handleFloorCancel } = await import(SUT);

/** Panel shaped like a normal/peak floor. */
function makePanel(overrides = {}) {
    return {
        type: 'normal',
        title: 'Secret Peak 8F',
        ownerId: 'owner-1',
        ownerName: 'Owner',
        timeWindow: '10:00 PM ~ 11:00 PM',
        next: null,
        ...overrides
    };
}

/** Button interaction whose reply is captured instead of sent to Discord. */
function makeInteraction({ isMod = false } = {}) {
    const replies = [];
    return {
        replies,
        member: { permissions: { has: perm => perm === 'ManageMessages' && isMod } },
        reply: async payload => { replies.push(payload); }
    };
}

function resetCalls() {
    for (const key of ['cooldowns', 'removed', 'freed', 'logs', 'dms', 'refresh']) calls[key].length = 0;
    calls.saves = 0;
}

test('owner pressing Leave releases the floor and takes the 5-minute cooldown', async () => {
    resetCalls();
    const panel = makePanel();
    const interaction = makeInteraction();

    await handleFloorCancel(interaction, 'owner-1', 'Owner', panel, '8peak');

    assert.equal(calls.freed.length, 1);
    assert.equal(calls.freed[0], panel);
    assert.deepEqual(calls.cooldowns, ['owner-1']);
    assert.deepEqual(calls.logs, [{
        type: 'CANCEL',
        user: 'Owner',
        room: 'Secret Peak 8F',
        context: 'logs.voluntaryLeave'
    }]);
    assert.deepEqual(calls.refresh, ['8peak']);
    assert.equal(interaction.replies.length, 1);
    assert.equal(interaction.replies[0].content, 'cooldowns.canceledClaimFeedback');
    assert.equal(interaction.replies[0].flags, 64);
});

test('staff owner pressing Leave releases the floor without the cooldown', async () => {
    resetCalls();
    const panel = makePanel();
    const interaction = makeInteraction({ isMod: true });

    await handleFloorCancel(interaction, 'owner-1', 'Owner', panel, '8peak');

    assert.equal(calls.freed.length, 1);
    assert.deepEqual(calls.cooldowns, []);
    assert.equal(interaction.replies[0].content, 'cooldowns.canceledClaimFeedback');
});

test('queue member pressing Leave leaves the queue and leaves the claim alone', async () => {
    resetCalls();
    const panel = makePanel({ next: { userId: 'queue-1', nextQueue: null } });
    const interaction = makeInteraction();

    await handleFloorCancel(interaction, 'queue-1', 'QueueUser', panel, '8peak');

    assert.equal(calls.freed.length, 0);
    assert.equal(calls.removed.length, 1);
    assert.equal(calls.removed[0].obj, panel);
    assert.equal(calls.removed[0].uid, 'queue-1');
    assert.equal(calls.saves, 1);
    assert.deepEqual(calls.cooldowns, []);
    assert.deepEqual(calls.refresh, ['8peak']);
    assert.equal(panel.ownerId, 'owner-1');
    assert.equal(interaction.replies[0].content, 'rooms.removedFromQueueFeedback');
});

test('staff with no claim does not cancel the current owner\'s claim', async () => {
    resetCalls();
    const panel = makePanel();
    const interaction = makeInteraction({ isMod: true });

    await handleFloorCancel(interaction, 'staff-1', 'Staff', panel, '8peak');

    assert.equal(calls.freed.length, 0, 'staff Leave must not free someone else\'s claim');
    assert.equal(calls.cooldowns.length, 0);
    assert.equal(calls.logs.length, 0);
    assert.equal(calls.dms.length, 0);
    assert.equal(calls.removed.length, 0);
    assert.equal(panel.ownerId, 'owner-1');
    assert.equal(interaction.replies[0].content, 'rooms.noActiveClaimsFeedback');
});

test('user with no claim gets feedback and changes nothing', async () => {
    resetCalls();
    const panel = makePanel();
    const interaction = makeInteraction();

    await handleFloorCancel(interaction, 'user-1', 'User', panel, '8peak');

    assert.equal(calls.freed.length, 0);
    assert.equal(calls.cooldowns.length, 0);
    assert.equal(calls.logs.length, 0);
    assert.equal(calls.removed.length, 0);
    assert.equal(panel.ownerId, 'owner-1');
    assert.equal(interaction.replies[0].content, 'rooms.noActiveClaimsFeedback');
});

test('staff who is only in the queue leaves the queue instead of cancelling the owner\'s claim', async () => {
    resetCalls();
    const panel = makePanel({ next: { userId: 'staff-1', nextQueue: null } });
    const interaction = makeInteraction({ isMod: true });

    await handleFloorCancel(interaction, 'staff-1', 'Staff', panel, '8peak');

    assert.equal(calls.freed.length, 0);
    assert.equal(calls.removed.length, 1);
    assert.equal(calls.removed[0].uid, 'staff-1');
    assert.equal(panel.ownerId, 'owner-1');
    assert.equal(interaction.replies[0].content, 'rooms.removedFromQueueFeedback');
});
