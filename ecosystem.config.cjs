// ==========================================
// 📦 PM2 — MIR4 Ranking Bot
// ==========================================
// Apply / re-apply:
//   pm2 delete gear && pm2 start ecosystem.config.cjs && pm2 save
// Watch:
//   pm2 logs gear        (gateway + watchdog lines)
//   pm2 describe gear    (memory in use vs max_memory_restart)
//
// ⚠️ The app name MUST stay "gear" — the /update slash command runs
// `pm2 restart gear` internally.
//
// ── Memory policy (box compartilhado: 5 bots no mesmo VPS) ─────────
// The limits are COMPUTED from the machine's real RAM (this file is evaluated
// by `pm2 start ecosystem.config.cjs`), so they never have to be re-tuned by
// hand when the box changes:
//
//   max_memory_restart = 30% of total RAM, clamped to 256M..512M   (RSS cap)
//   --max-old-space-size = RSS cap - 64MB, min 192                 (V8 heap cap)
//
//   e.g. 1 GB box → 307M RSS / 243M heap   ·   2 GB box → 512M RSS / 448M heap
//
// Two nested nets:
//   1. NODE_OPTIONS caps the V8 heap first, so a leak dies at the heap limit
//      with `FATAL ERROR: Reached heap limit` instead of pushing the whole box
//      into swap / the Linux OOM killer (which SIGKILLs with no chance to save
//      the database). That error is NOT catchable — PM2 is the safety net.
//   2. max_memory_restart is the outer net on total RSS, for memory V8 does
//      not count as heap (buffers, external memory, native leaks).
//
// Neither limit should ever fire during a healthy run — the measured baseline
// is 76k-player ranking cache ≈ 3.3 MB JSON / 31 MB heap for two copies, RSS
// ≈ 200 MB steady, ≈ 250-350 MB during the 20:00 scrape. If one fires, the
// `💓 [Watchdog] alive | … | rss …` line in ranking_logs.txt shows the real
// peak so the percentages above can be re-tuned.

const os = require('node:os');

const TOTAL_MB = Math.round(os.totalmem() / 1048576);
const RSS_LIMIT_MB = Math.min(512, Math.max(256, Math.round(TOTAL_MB * 0.3)));
const HEAP_LIMIT_MB = Math.max(192, RSS_LIMIT_MB - 64);

console.log(
    `📦 [PM2] ${TOTAL_MB}MB total RAM → max_memory_restart ${RSS_LIMIT_MB}M, heap cap ${HEAP_LIMIT_MB}MB`
);

module.exports = {
    apps: [
        {
            name: 'gear',
            script: 'npm',
            args: 'start',
            interpreter: 'none', // run `npm start` directly instead of `node npm`
            cwd: __dirname, // database_ranking.json, backups/ and logs/ are relative paths
            instances: 1,
            exec_mode: 'fork',

            // ── restart behaviour ──
            autorestart: true,
            restart_delay: 5000, // 5s between restarts — no hot crash loop
            min_uptime: '10s', // runs shorter than this count as failures
            max_restarts: 50, // flag as errored only after 50 rapid failures
            kill_timeout: 5000, // SIGINT → save DB + flush logs before SIGKILL

            // ── memory guard (computed from the machine's real RAM) ──
            max_memory_restart: `${RSS_LIMIT_MB}M`,
            env: {
                NODE_ENV: 'production',
                NODE_OPTIONS: `--max-old-space-size=${HEAP_LIMIT_MB}`
            },

            // ── logs ──
            time: true, // timestamp every PM2 line
            merge_logs: true,
            out_file: './logs/pm2-out.log',
            error_file: './logs/pm2-error.log'
        }
    ]
};
