// ==========================================
// 🛰️ GATEWAY WATCHDOG
// ==========================================
// Prevents the classic "PM2 is green but the bot is offline" zombie state.
//
// Why this exists: discord.js only auto-reconnects for RECOVERABLE gateway
// closes. When a shard hits an unrecoverable close code (4004 auth failed,
// 4010/4011 sharding, 4012 API version, 4013/4014 intents) the shard is parked
// in `Disconnected` and will never reconnect — but the process stays alive,
// the WebSocketManager still reports `status === Ready`, and PM2 keeps showing
// a healthy app while the bot sits offline forever. The same zombie state is
// reached when the websocket manager is destroyed or when the connection stops
// acknowledging heartbeats.
//
// The watchdog:
//  1. logs every gateway event (ready / resume / reconnecting / disconnect /
//     error / warn) so the log always says WHY the connection died;
//  2. evaluates gateway health on a fixed interval;
//  3. emits a periodic liveness line — "no logs" then becomes evidence instead
//     of a mystery (it proves the process is alive and shows memory usage);
//  4. calls onUnhealthy(reason) after the offline limit so the caller can save
//     and exit(1), letting PM2 bring the bot back with a fresh session.

import { Status } from 'discord.js';

// Health evaluation cadence — fast enough to restart within a couple of
// minutes of a failure, slow enough to cost nothing.
export const GATEWAY_CHECK_INTERVAL_MS = 60 * 1000;
// How long the gateway may stay down before the process is restarted.
export const GATEWAY_OFFLINE_LIMIT_MS = 3 * 60 * 1000;
// Do not judge health during the first minutes (login + READY + slash-command
// registration are all legitimately "not ready" for a while).
export const GATEWAY_STARTUP_GRACE_MS = 2 * 60 * 1000;
// Heartbeats are sent every ~41s; 3 minutes without a single acknowledged
// heartbeat means the connection is a zombie even if the status still says
// Ready.
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
// Periodic "still alive" line.
export const LIVENESS_LOG_INTERVAL_MS = 15 * 60 * 1000;

// Gateway close codes discord.js never reconnects from (see WebSocketManager's
// UNRECOVERABLE_CLOSE_CODES).
export const UNRECOVERABLE_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

/** Human-readable name for a discord.js Status enum value. */
export function statusName(status) {
    const name = Status[status];
    return typeof name === 'string' ? name : `#${status}`;
}

/** Translate a gateway close code into "will it come back on its own?". */
export function describeCloseCode(code) {
    if (code === 1000) return 'normal closure — auto-reconnect';
    if (code === 1001) return 'going away — auto-reconnect';
    if (code === 1006) return 'abnormal closure (connection dropped) — auto-reconnect';
    if (UNRECOVERABLE_CLOSE_CODES.has(code)) {
        return `UNRECOVERABLE close code ${code} — discord.js will NOT reconnect, a process restart is required`;
    }
    return 'auto-reconnect';
}

/**
 * Evaluate whether the Discord gateway connection is actually usable.
 * Returns { healthy: boolean, reason: string|null }.
 *
 * `client.isReady()` alone is not enough: the manager keeps `status === Ready`
 * after an unrecoverable shard disconnect, so the shard statuses and the last
 * acknowledged heartbeat are checked too.
 */
export function checkGatewayHealth(client, now = Date.now(), heartbeatStaleMs = HEARTBEAT_STALE_MS) {
    if (!client) return { healthy: false, reason: 'client is missing' };

    const ws = client.ws;
    if (ws?.destroyed) return { healthy: false, reason: 'websocket manager destroyed' };

    if (typeof client.isReady === 'function' && !client.isReady()) {
        return { healthy: false, reason: 'client is not ready (no active session)' };
    }

    const shards = ws?.shards;
    if (!shards || typeof shards.values !== 'function') {
        return { healthy: false, reason: 'gateway shards unavailable' };
    }

    let shardCount = 0;
    let oldestAck = null;

    for (const shard of shards.values()) {
        shardCount++;

        // A shard parked in Disconnected (unrecoverable close) or sitting in
        // Identifying/Resuming/Connecting for minutes means no usable session.
        if (typeof shard.status === 'number' && shard.status !== Status.Ready) {
            return {
                healthy: false,
                reason: `shard ${shard.id ?? 0} stuck in ${statusName(shard.status)}`
            };
        }

        // lastPingTimestamp is Date.now() of the last acknowledged heartbeat
        // (-1 until the first one arrives).
        const ack = shard.lastPingTimestamp;
        if (typeof ack === 'number' && ack > 0) {
            oldestAck = oldestAck === null ? ack : Math.min(oldestAck, ack);
        }
    }

    if (shardCount === 0) return { healthy: false, reason: 'no gateway shards connected' };

    if (oldestAck !== null && now - oldestAck > heartbeatStaleMs) {
        const staleSeconds = Math.round((now - oldestAck) / 1000);
        return { healthy: false, reason: `no heartbeat acknowledged for ${staleSeconds}s` };
    }

    return { healthy: true, reason: null };
}

/** Format a millisecond duration as e.g. "4m 12s". */
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

/**
 * Attach gateway listeners + a periodic health check to a discord.js Client.
 *
 * @param {import('discord.js').Client} client
 * @param {Object} [options]
 * @param {(message: string) => void} [options.logEvent]  sink for log lines (defaults to console.log)
 * @param {(reason: string) => void} [options.onUnhealthy] called ONCE when the gateway stays down past the limit
 * @param {() => number} [options.now] clock (tests inject a fake one)
 * @returns {{ stop: () => void, getState: () => Object }}
 */
export function startGatewayWatchdog(client, options = {}) {
    const {
        logEvent = (message) => console.log(message),
        onUnhealthy = null,
        now = () => Date.now(),
        checkIntervalMs = GATEWAY_CHECK_INTERVAL_MS,
        offlineLimitMs = GATEWAY_OFFLINE_LIMIT_MS,
        startupGraceMs = GATEWAY_STARTUP_GRACE_MS,
        heartbeatStaleMs = HEARTBEAT_STALE_MS,
        livenessLogIntervalMs = LIVENESS_LOG_INTERVAL_MS,
        setIntervalFn = setInterval,
        clearIntervalFn = clearInterval,
        memoryUsage = () => process.memoryUsage(),
        uptime = () => process.uptime()
    } = options;

    const startedAt = now();
    let offlineSince = null;
    let lastLivenessAt = startedAt;
    let restartRequested = false;
    let stopped = false;
    let firstReadySeen = false;

    // Logging must never be able to break the watchdog itself.
    const log = (message) => {
        try {
            logEvent(message);
        } catch {
            /* best-effort */
        }
    };

    // ── Gateway event listeners: the "why did it die?" evidence ──
    const listeners = {
        ready: (c) => {
            if (!firstReadySeen) {
                firstReadySeen = true;
                return;
            }
            log(`🔁 [Gateway] Session re-established as ${c?.user?.tag ?? 'unknown'}`);
        },
        shardReady: (shardId) => log(`✅ [Gateway] Shard ${shardId} is READY`),
        shardResume: (shardId, replayedEvents) =>
            log(`↩️ [Gateway] Shard ${shardId} resumed (${replayedEvents ?? 0} events replayed)`),
        shardReconnecting: (shardId) => log(`🔌 [Gateway] Shard ${shardId} reconnecting…`),
        shardDisconnect: (closeEvent, shardId) => {
            const code = closeEvent?.code ?? '?';
            log(`⚠️ [Gateway] Shard ${shardId} disconnected — code ${code} (${describeCloseCode(Number(code))})`);
        },
        shardError: (error, shardId) => log(`❌ [Gateway] Shard ${shardId} error: ${error?.message || error}`),
        invalidated: () => log('🛑 [Gateway] Session invalidated — restart will be requested if it does not recover'),
        warn: (message) => log(`⚠️ [Gateway] warn: ${message}`)
    };

    for (const [event, handler] of Object.entries(listeners)) {
        client.on(event, handler);
    }

    const detachListeners = () => {
        for (const [event, handler] of Object.entries(listeners)) {
            client.off?.(event, handler);
        }
    };

    const livenessLine = (health) => {
        let ping = 'n/a';
        const shard = client.ws?.shards?.find?.((s) => typeof s.ping === 'number' && s.ping >= 0);
        if (shard) ping = `${shard.ping}ms`;

        let heap = 'n/a';
        let rss = 'n/a';
        try {
            const mem = memoryUsage();
            heap = `${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`;
            rss = `${(mem.rss / 1024 / 1024).toFixed(1)}MB`;
        } catch {
            /* best-effort */
        }

        const gateway = health.healthy ? 'OK' : `DOWN (${health.reason})`;
        return `💓 [Watchdog] alive | uptime ${formatDuration(uptime())} | gateway ${gateway} | ping ${ping} | heap ${heap} | rss ${rss}`;
    };

    const tick = () => {
        if (stopped) return;

        const t = now();
        const health = checkGatewayHealth(client, t, heartbeatStaleMs);
        const inStartupGrace = t - startedAt < startupGraceMs;

        if (health.healthy) {
            if (offlineSince !== null) {
                log(`✅ [Watchdog] Gateway recovered after ${formatDuration(t - offlineSince)} down`);
                offlineSince = null;
            }
        } else if (!inStartupGrace) {
            if (offlineSince === null) {
                offlineSince = t;
                log(`⚠️ [Watchdog] Gateway unhealthy: ${health.reason} — restarting in ${formatDuration(offlineLimitMs)} unless it recovers`);
            } else if (t - offlineSince >= offlineLimitMs && !restartRequested) {
                restartRequested = true;
                const downFor = formatDuration(t - offlineSince);
                log(`🛑 [Watchdog] Gateway down for ${downFor} (${health.reason}) — requesting process restart`);

                if (typeof onUnhealthy === 'function') {
                    try {
                        onUnhealthy(health.reason);
                    } catch (error) {
                        log(`❌ [Watchdog] onUnhealthy handler failed: ${error?.message || error}`);
                    }
                } else {
                    log('⚠️ [Watchdog] No onUnhealthy handler configured — cannot restart, staying down');
                }
                return;
            }
        }

        if (t - lastLivenessAt >= livenessLogIntervalMs) {
            lastLivenessAt = t;
            log(livenessLine(health));
        }
    };

    const timer = setIntervalFn(tick, checkIntervalMs);

    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearIntervalFn(timer);
        detachListeners();
    };

    log(`🛰️ [Watchdog] Started — check every ${formatDuration(checkIntervalMs)}, restart after ${formatDuration(offlineLimitMs)} offline`);

    return {
        stop,
        getState: () => ({
            startedAt,
            offlineSince,
            restartRequested,
            stopped,
            health: checkGatewayHealth(client, now(), heartbeatStaleMs)
        })
    };
}
