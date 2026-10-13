// ==========================================
// 📝 RANKING LOGGER
// ==========================================

import fs from 'node:fs';

const RANKING_LOGS_PATH = './ranking_logs.txt';

// Without rotation the log file grows forever and can eventually fill the disk
// of the shared VPS, taking every bot on the box down with it. Past the size
// cap the file is rewritten keeping only the most recent lines.
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const KEEP_LINES = 2000;

// Log lines are buffered and flushed periodically (every 500ms) instead of
// calling appendFileSync on EVERY event. The sync engine emits hundreds of
// events per run, so this turns hundreds of synchronous disk writes per sync
// into a handful, keeping the event loop free for Discord interactions.
let logBuffer = '';
let flushTimer = null;

/**
 * Rewrite ranking_logs.txt keeping only the newest KEEP_LINES lines, but only
 * once the file has passed MAX_LOG_BYTES. Checked after each flush (a statSync
 * on a hot path is cheap; the read+rewrite only happens past the cap).
 */
function rotateLogIfNeeded() {
    try {
        const { size } = fs.statSync(RANKING_LOGS_PATH);
        if (size <= MAX_LOG_BYTES) return;

        const content = fs.readFileSync(RANKING_LOGS_PATH, 'utf8');
        const kept = content.split('\n').slice(-KEEP_LINES).join('\n');
        fs.writeFileSync(RANKING_LOGS_PATH, kept, 'utf8');
        console.log(`🗑️ [Logger] Rotated ranking_logs.txt (kept the last ${KEEP_LINES} lines)`);
    } catch (e) {
        if (e.code !== 'ENOENT') console.error('❌ [Logger] Failed to rotate log file:', e.message);
    }
}

function flushLogBuffer() {
    flushTimer = null;
    if (!logBuffer) return;
    const chunk = logBuffer;
    logBuffer = '';
    try {
        fs.appendFileSync(RANKING_LOGS_PATH, chunk, 'utf8');
        rotateLogIfNeeded();
    } catch (e) {
        // File writes are best-effort; console output still works.
        console.error('❌ [Logger] Failed to write log file:', e.message);
    }
}

export function logRankingEvent(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(`[Ranking] ${message}`);
    logBuffer += logMessage;
    if (!flushTimer) {
        flushTimer = setTimeout(flushLogBuffer, 500);
    }
}

// Make sure any buffered lines reach disk when the process exits.
process.on('exit', flushLogBuffer);
