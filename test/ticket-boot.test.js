// ==========================================
// 🧪 UNIT TESTS — src/handlers/ticket-core.js (boot behavior)
// Run: npm test
// ==========================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// config.js refuses to load without DISCORD_SERVER_ID (a boot-time guard), so
// provide a dummy guild id before importing the modules under test.
process.env.DISCORD_SERVER_ID ||= '000000000000000000';
// Point the ticket category at a fixed id so the fakes can build it.
process.env.TICKET_CATEGORY_ID = '999000999000999000';

// ticket-core resolves tickets.json / backups relative to the cwd at import
// time — run from a temp dir so tests never touch real bot state.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-boot-'));
process.chdir(TMP_DIR);

const { Collection, ChannelType } = await import('discord.js');
const { initState } = await import('../src/core/state.js');
const {
    setupTicketChannels,
    reconcileOpenTickets,
    TICKET_CATEGORY_ID,
    openTickets
} = await import('../src/handlers/ticket-core.js');

const GUILD_ID = '000000000000000000';

/** Build a minimal fake text channel, wired to remove itself from the cache on delete(). */
function makeTextChannel({ id, name, parentId = null, topic = null, cache }) {
    return {
        id,
        name,
        topic,
        type: ChannelType.GuildText,
        parentId,
        deleted: false,
        sent: false,
        permissionOverwrites: { cache: new Collection() },
        messages: { fetch: async () => new Collection() },
        async delete() {
            this.deleted = true;
            cache.delete(this.id);
        },
        async send() {
            this.sent = true;
            return { id: `msg-${id}` };
        }
    };
}

function buildWorld() {
    const cache = new Collection();
    let seq = 0;

    const category = {
        id: TICKET_CATEGORY_ID,
        name: '🎫 Tickets',
        type: ChannelType.GuildCategory,
        parentId: null,
        permissionOverwrites: { cache: new Collection() }
    };
    cache.set(category.id, category);

    const guild = {
        id: GUILD_ID,
        channels: {
            cache,
            async create({ name, type, parent }) {
                const ch = makeTextChannel({ id: `new-${++seq}`, name, parentId: parent, cache });
                cache.set(ch.id, ch);
                return ch;
            }
        }
    };

    const client = {
        user: { id: 'bot' },
        guilds: { cache: new Collection([[GUILD_ID, guild]]) },
        channels: { cache }
    };

    return { cache, guild, client, category };
}

function addChannel(cache, opts) {
    const ch = makeTextChannel({ ...opts, cache });
    cache.set(ch.id, ch);
    return ch;
}

test('boot rebuilds only the panel channel and keeps ticket-logs + open tickets', async () => {
    const { cache, client } = buildWorld();
    const oldPanel = addChannel(cache, { id: 'old-panel', name: '🎫 open-ticket', parentId: TICKET_CATEGORY_ID });
    const logs = addChannel(cache, { id: 'logs', name: '📜 ticket-logs', parentId: TICKET_CATEGORY_ID });
    const room = addChannel(cache, {
        id: 'room-1',
        name: 'ticket-support-john',
        parentId: TICKET_CATEGORY_ID,
        topic: 'Ticket for john#0001 (123456789012345678) — Support'
    });

    initState({ client, db: {}, saveLocalStorage: () => {}, logEvent: () => {}, lastMessages: {} });

    const handled = await setupTicketChannels(client, GUILD_ID);
    assert.equal(handled, true, 'panel inside the category should be handled');

    // Panel channel: deleted and recreated fresh.
    assert.equal(oldPanel.deleted, true, 'old panel channel must be deleted');
    const panels = cache.filter(c => c.type === ChannelType.GuildText && c.name === '🎫 open-ticket');
    assert.equal(panels.size, 1, 'exactly one fresh panel channel must exist');
    const newPanel = panels.first();
    assert.notEqual(newPanel.id, 'old-panel', 'panel channel must be a new channel');
    assert.equal(newPanel.sent, true, 'panel message must be posted');

    // Logs + open tickets: untouched.
    assert.equal(logs.deleted, false, 'ticket-logs must never be deleted/recreated');
    assert.equal(cache.get('logs'), logs, 'the same ticket-logs channel must remain');
    assert.equal(room.deleted, false, 'open ticket room must never be deleted');
    assert.equal(cache.get('room-1'), room, 'the same ticket room must remain');
});

test('reconcile re-adopts topic-tagged tickets and keeps the rest untouched', async () => {
    const { cache, client } = buildWorld();
    const withTopic = addChannel(cache, {
        id: 'room-a',
        name: 'ticket-support-ana',
        parentId: TICKET_CATEGORY_ID,
        topic: 'Ticket for ana#0002 (222222222222222222) — Support'
    });
    const noTopic = addChannel(cache, { id: 'room-b', name: 'ticket-doubt-mary', parentId: TICKET_CATEGORY_ID });
    // A managed channel whose name starts with "ticket-" must never be adopted.
    const legacyLogs = addChannel(cache, { id: 'logs-legacy', name: 'ticket-logs', parentId: TICKET_CATEGORY_ID });

    initState({ client, db: {}, saveLocalStorage: () => {}, logEvent: () => {}, lastMessages: {} });

    await reconcileOpenTickets(client);

    assert.equal(openTickets['222222222222222222'], 'room-a', 'existing ticket must be re-adopted');
    assert.equal(
        Object.values(openTickets).includes('logs-legacy'),
        false,
        'managed log channel must not be adopted'
    );
    assert.equal(withTopic.deleted, false);
    assert.equal(noTopic.deleted, false, 'untracked ticket room must be kept');
    assert.equal(cache.get('room-b'), noTopic);
    assert.equal(legacyLogs.deleted, false);
    assert.equal(cache.get('logs-legacy'), legacyLogs);
});
