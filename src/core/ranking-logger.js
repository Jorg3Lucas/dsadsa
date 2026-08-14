// ==========================================
// 📝 RANKING LOGGER
// ==========================================

import fs from 'node:fs';

const RANKING_LOGS_PATH = './ranking_logs.txt';

export function logRankingEvent(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(`[Ranking] ${message}`);
    fs.appendFileSync(RANKING_LOGS_PATH, logMessage, 'utf8');
}
