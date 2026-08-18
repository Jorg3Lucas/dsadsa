// ==========================================
// 📝 RANKING LOGGER
// ==========================================

import fs from 'node:fs';

const RANKING_LOGS_PATH = './ranking_logs.txt';

// Log lines are buffered and flushed periodically (every 500ms) instead of
// calling appendFileSync on EVERY event. The sync engine emits hundreds of
// events per run, so this turns hundreds of synchronous disk writes per sync
// into a handful, keeping the event loop free for Discord interactions.
let logBuffer = '';
let flushTimer = null;

function flushLogBuffer() {
    flushTimer = null;
    if (!logBuffer) return;
    const chunk = logBuffer;
    logBuffer = '';
    try {
        fs.appendFileSync(RANKING_LOGS_PATH, chunk, 'utf8');
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
