import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Status } from 'discord.js';
import {
    checkGatewayHealth,
    startGatewayWatchdog,
    describeCloseCode,
    HEARTBEAT_STALE_MS
} from '../src/core/ranking-gateway-watchdog.js';

// ==========================================
// Helpers — a fake discord.js Client
// ==========================================

function makeClient({
    ready = true,
    destroyed = false,
    shardStatus = Status.Ready,
    lastPingTimestamp = Date.now(),
    shardCount = 1
} = {}) {
    const client = new EventEmitter();
    client.isReady = () => ready && !destroyed;

    const shardList = Array.from({ length: shardCount }, (_, id) => ({
        id,
        status: shardStatus,
        lastPingTimestamp,
        ping: 42
    }));

    client.ws = {
        destroyed,
        shards: {
            values: () => shardList[Symbol.iterator](),
            find: (fn) => shardList.find(fn)
        }
    };

    return client;
}

/** Manual interval driver: tests decide when each tick runs. */
function manualTimers() {
    const timers = new Map();
    let nextId = 1;
    return {
        setIntervalFn: (fn) => {
            const id = nextId++;
            timers.set(id, fn);
            return id;
        },
        clearIntervalFn: (id) => timers.delete(id),
        runAll: () => {
            for (const fn of [...timers.values()]) fn();
        },
        count: () => timers.size
    };
}

describe('checkGatewayHealth', () => {
    it('is healthy for a ready client with a ready shard and a fresh heartbeat', () => {
        const health = checkGatewayHealth(makeClient(), Date.now());
        expect(health.healthy).toBe(true);
        expect(health.reason).toBeNull();
    });

    it('is unhealthy when the client is not ready', () => {
        const health = checkGatewayHealth(makeClient({ ready: false }), Date.now());
        expect(health.healthy).toBe(false);
        expect(health.reason).toMatch(/not ready/);
    });

    it('is unhealthy when the websocket manager was destroyed', () => {
        const health = checkGatewayHealth(makeClient({ destroyed: true }), Date.now());
        expect(health.healthy).toBe(false);
        expect(health.reason).toMatch(/destroyed/);
    });

    it('is unhealthy when a shard is parked in Disconnected (unrecoverable close)', () => {
        const health = checkGatewayHealth(makeClient({ shardStatus: Status.Disconnected }), Date.now());
        expect(health.healthy).toBe(false);
        expect(health.reason).toMatch(/stuck in Disconnected/);
    });

    it('is unhealthy while a shard is still identifying', () => {
        const health = checkGatewayHealth(makeClient({ shardStatus: Status.Identifying }), Date.now());
        expect(health.healthy).toBe(false);
        expect(health.reason).toMatch(/stuck in Identifying/);
    });

    it('is unhealthy when heartbeats stop being acknowledged', () => {
        const now = Date.now();
        const stale = now - HEARTBEAT_STALE_MS - 1000;
        const health = checkGatewayHealth(makeClient({ lastPingTimestamp: stale }), now);
        expect(health.healthy).toBe(false);
        expect(health.reason).toMatch(/no heartbeat acknowledged/);
    });

    it('ignores the heartbeat check until the first heartbeat arrives (-1)', () => {
        const health = checkGatewayHealth(makeClient({ lastPingTimestamp: -1 }), Date.now());
        expect(health.healthy).toBe(true);
    });

    it('is unhealthy when no shards are connected', () => {
        const health = checkGatewayHealth(makeClient({ shardCount: 0 }), Date.now());
        expect(health.healthy).toBe(false);
        expect(health.reason).toMatch(/no gateway shards/);
    });

    it('is unhealthy when the client is missing entirely', () => {
        expect(checkGatewayHealth(null).healthy).toBe(false);
    });
});

describe('describeCloseCode', () => {
    it('marks auth/sharding/intent close codes as unrecoverable', () => {
        for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) {
            expect(describeCloseCode(code)).toMatch(/UNRECOVERABLE/);
            expect(describeCloseCode(code)).toMatch(/restart is required/);
        }
    });

    it('marks dropped connections as auto-reconnect', () => {
        expect(describeCloseCode(1006)).toMatch(/auto-reconnect/);
        expect(describeCloseCode(1000)).toMatch(/auto-reconnect/);
    });
});

describe('startGatewayWatchdog', () => {
    const T0 = 1_000_000;

    function setup(clientOptions = {}, watchOptions = {}) {
        const clock = { t: T0 };
        const logs = [];
        const timers = manualTimers();
        const onUnhealthy = vi.fn();

        const client = makeClient(clientOptions);
        const watchdog = startGatewayWatchdog(client, {
            logEvent: (message) => logs.push(message),
            onUnhealthy,
            now: () => clock.t,
            setIntervalFn: timers.setIntervalFn,
            clearIntervalFn: timers.clearIntervalFn,
            memoryUsage: () => ({ heapUsed: 100 * 1024 * 1024, rss: 200 * 1024 * 1024 }),
            uptime: () => 3600,
            ...watchOptions
        });

        return { client, clock, logs, timers, onUnhealthy, watchdog };
    }

    it('logs that it started and does not restart a healthy gateway', () => {
        const { logs, timers, onUnhealthy } = setup();

        timers.runAll(); // healthy — nothing to do

        expect(logs.some((l) => l.includes('[Watchdog] Started'))).toBe(true);
        expect(onUnhealthy).not.toHaveBeenCalled();
    });

    it('logs every gateway event so the failure cause is visible', () => {
        const { client, logs } = setup();

        client.emit('shardDisconnect', { code: 4004 }, 0);
        client.emit('shardError', new Error('socket hang up'), 0);
        client.emit('shardReconnecting', 0);
        client.emit('shardReady', 0);

        expect(logs.some((l) => l.includes('code 4004') && l.includes('UNRECOVERABLE'))).toBe(true);
        expect(logs.some((l) => l.includes('socket hang up'))).toBe(true);
        expect(logs.some((l) => l.includes('reconnecting'))).toBe(true);
        expect(logs.some((l) => l.includes('READY'))).toBe(true);
    });

    it('does not judge health during the startup grace period', () => {
        const { clock, logs, timers, onUnhealthy } = setup({ ready: false });

        clock.t = T0 + 60_000; // still inside the 2 min grace
        timers.runAll();

        expect(onUnhealthy).not.toHaveBeenCalled();
        expect(logs.some((l) => l.includes('Gateway unhealthy'))).toBe(false);
    });

    it('warns when the gateway goes down and restarts once the limit is exceeded', () => {
        const { client, clock, logs, timers, onUnhealthy } = setup({ shardStatus: Status.Disconnected });

        // Past the startup grace period
        clock.t = T0 + 121_000;
        timers.runAll();

        expect(logs.some((l) => l.includes('Gateway unhealthy') && l.includes('Disconnected'))).toBe(true);
        expect(onUnhealthy).not.toHaveBeenCalled();

        // Still inside the offline limit
        clock.t = T0 + 121_000 + 179_000;
        timers.runAll();
        expect(onUnhealthy).not.toHaveBeenCalled();

        // Offline limit reached → restart requested exactly once
        clock.t = T0 + 121_000 + 180_000;
        timers.runAll();
        expect(onUnhealthy).toHaveBeenCalledTimes(1);
        expect(onUnhealthy.mock.calls[0][0]).toMatch(/Disconnected/);

        clock.t = T0 + 121_000 + 400_000;
        timers.runAll();
        expect(onUnhealthy).toHaveBeenCalledTimes(1);
        expect(client.listenerCount('shardError')).toBe(1); // listeners kept for diagnostics
    });

    it('never restarts when the gateway recovers before the limit', () => {
        const { client, clock, logs, timers, onUnhealthy } = setup();

        // Go down
        client.ws.shards = {
            values: () => [{ id: 0, status: Status.Connecting, lastPingTimestamp: Date.now(), ping: -1 }],
            find: () => undefined
        };
        clock.t = T0 + 121_000;
        timers.runAll();
        expect(logs.some((l) => l.includes('Gateway unhealthy'))).toBe(true);

        // Recover before the 3-minute limit
        const fresh = { id: 0, status: Status.Ready, lastPingTimestamp: clock.t, ping: 45 };
        client.ws.shards = { values: () => [fresh].values(), find: () => fresh };
        clock.t = T0 + 121_000 + 120_000;
        timers.runAll();

        expect(onUnhealthy).not.toHaveBeenCalled();
        expect(logs.some((l) => l.includes('Gateway recovered'))).toBe(true);
    });

    it('emits a periodic liveness line with memory usage', () => {
        const { clock, logs, timers } = setup();

        clock.t = T0 + 15 * 60_000;
        timers.runAll();

        const liveness = logs.find((l) => l.includes('💓 [Watchdog] alive'));
        expect(liveness).toBeDefined();
        expect(liveness).toMatch(/heap 100\.0MB/);
        expect(liveness).toMatch(/rss 200\.0MB/);
        expect(liveness).toMatch(/gateway OK/);
    });

    it('stop() clears the interval and detaches the gateway listeners', () => {
        const { client, timers, watchdog } = setup();

        expect(client.listenerCount('shardError')).toBe(1);
        expect(timers.count()).toBe(1);

        watchdog.stop();

        expect(timers.count()).toBe(0);
        expect(client.listenerCount('shardError')).toBe(0);
        expect(watchdog.getState().stopped).toBe(true);
    });

    it('keeps watching (and logs) when no onUnhealthy handler is configured', () => {
        const { clock, logs, timers, watchdog } = setup(
            { shardStatus: Status.Disconnected },
            { onUnhealthy: undefined }
        );

        clock.t = T0 + 121_000;
        timers.runAll();
        clock.t = T0 + 121_000 + 180_000;
        timers.runAll();

        expect(logs.some((l) => l.includes('No onUnhealthy handler'))).toBe(true);
        expect(watchdog.getState().restartRequested).toBe(true);
    });
});
