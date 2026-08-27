import {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits
} from 'discord.js';
import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { registerMir4SlashCommands } from './core/ranking-deploy.js';
import { destroyRankingScraperAgents } from './core/ranking-scraper.js';
import { initMir4BotEvents } from './core/ranking-events.js';
import { handleMir4Interactions } from './core/ranking-handlers.js';
import { runDailySynchronization } from './core/ranking-sync-engine.js';
import { handleOwnerRegistrationModal, handleUserSelectRegistrationNickname } from './handlers/ranking-registration.js';
import { handleWelcomeRegisterOwner, handleWelcomeRegisterPilot, handleWelcomeRemoveRegistration, handleSelfRemoveConfirm, handleWelcomeRemovePilot } from './handlers/ranking-welcome.js';
import { handleApproveOwner, handleRejectOwner, handleApprovePilot, handleAdminApprovePilot } from './handlers/ranking-approvals.js';
import { handlePilotRegistrationModal, handlePilotRemoveSelect, handleOwnerRemovePilotDm, handleUserSelectPilotOwner } from './handlers/ranking-pilot.js';
import { handleConfirmAction, handleRestoreBackupSelect, handleRestoreBackupCancel, handleRestoreBackupConfirm } from './handlers/ranking-confirmations.js';
import { handleRankingCommand, handleSelectManualNickname, handleSelectPendingNickname, handleSelectPendingPilotOwner } from './handlers/ranking-commands.js';
import {
    handleNotifyCommand,
    handleNotifySelect,
    handleNotifyButton
} from './handlers/ranking-notify.js';
import {
    handleManageUserPage,
    handleManageAction,
    handleManagePilotRemove,
    handleManageAllied,
    handleManageAlliedRegion,
    handleManageAlliedWorld,
    handleManageAlliedPage,
    handleManageAlliedAdd,
    handleManageAlliedAddModal,
    handleManageAlliedRemove,
    handleManageNav,
    handleAddClanSuggestion
} from './handlers/ranking-management.js';
import { startAutoBackup, getBackupStats } from './auto-backup.js';
import { DISCORD_SERVER_ID, ensureConfig, migrateAlliedClans } from './core/ranking-constants.js';
import { getLocalRankingCache } from './core/ranking-cache.js';
import { logRankingEvent } from './core/ranking-logger.js';
import { saveRankingStorage, saveRankingStorageSync, loadLocalStorageRanking, getStorageStats } from './core/ranking-storage.js';
import { isExpiredError } from './core/interaction-utils.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    rest: {
        timeout: 60000
    }
});

let rankingDb = {
    users: {}
};

// Handlers/events call save with no arguments — wrap so the current in-memory db is saved
const saveRankingStorageWrapped = (db) => saveRankingStorage(db || rankingDb);

// ==========================================
// 🚀 STARTUP VALIDATION
// ==========================================

console.log('========================================');
console.log('🤖 MIR4 Ranking Bot Starting...');
console.log('========================================');

// ==========================================
// 🚀 READY EVENT
// ==========================================
client.once('ready', async () => {
    console.log(`\n🤖 Bot connected successfully as: ${client.user.tag}\n`);

    // Load database with recovery
    rankingDb = loadLocalStorageRanking();
    
    // Log storage status
    const storageStats = getStorageStats();
    const backupStats = getBackupStats();
    
    console.log('\n📊 Startup Status:');
    console.log(`   Database loaded: ${storageStats.databaseLoaded ? '✅' : '❌'}`);
    console.log(`   Users in memory: ${Object.keys(rankingDb.users || {}).length}`);
    console.log(`   Backups available: ${backupStats.count}`);
    console.log('========================================\n');

    logRankingEvent(`[Ranking Bot] Connected successfully as ${client.user.tag}`);

    // Ensure db.config and alliedClans are initialized before any system runs
    ensureConfig(rankingDb);

    // Migrate allied clans from absorbed servers to surviving servers (one-time)
    const mergeResult = migrateAlliedClans(rankingDb);
    if (mergeResult.migrated > 0) {
        saveRankingStorageWrapped();
        logRankingEvent(`🔄 [Server Merge] Migrated allied clans from ${mergeResult.migrated} absorbed server(s): ${mergeResult.clansMoved} clan(s) moved`);
    }

    // Register interaction listeners + kick off the async startup restores
    // (welcome panel + admin approval messages) FIRST, so their Discord API
    // calls run CONCURRENTLY with the slash-command registration below — both
    // are independent REST work and neither blocks the other. (The sync
    // setAdminChannelId/config step inside runs before any restore fires.)
    initMir4BotEvents(client, rankingDb, saveRankingStorageWrapped, logRankingEvent);

    // Pre-warm the ranking cache into memory during idle startup. The first
    // getLocalRankingCache() parses ~76k players (a ~100-300ms blocking read);
    // doing it here — off the critical path of the +15s sync and any early
    // interaction — means no command or sync ever pays that parse cost again
    // (the in-memory reference is reused via the mtime-based cache). The timer
    // starts BEFORE the slash registration await below, so it fires at ~1s from
    // ready regardless of how long that network call takes.
    setTimeout(() => {
        const cache = getLocalRankingCache();
        if (cache && Object.keys(cache).length > 0) {
            console.log(`⚡ [Startup] Ranking cache pre-warmed (${Object.keys(cache).length} worlds)`);
        }
    }, 1000);

    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    if (guild) {
        await registerMir4SlashCommands(guild);
    } else {
        console.error('❌ Error: Invalid Server ID configuration.');
    }

    // Start sync after 15 seconds (give time for everything to initialize)
    setTimeout(async () => {
        console.log('🧪 [Startup] Checking if ranking needs sync...');
        await runDailySynchronization(client, rankingDb, saveRankingStorageWrapped, logRankingEvent, false);
    }, 15000);

    // Start auto-backup every 30 minutes
    startAutoBackup(30);
});

// ==========================================
// 🛑 GRACEFUL SHUTDOWN
// ==========================================

let isShuttingDown = false;

function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n🛑 [${signal}] Shutting down gracefully...`);
    logRankingEvent(`[Ranking Bot] Shutting down (${signal})`);
    
    // Save with sync version for critical shutdown
    const saved = saveRankingStorageSync(rankingDb);
    if (saved) {
        console.log('💾 Database saved successfully');
    } else {
        console.error('❌ Failed to save database on shutdown!');
    }
    
    // Release keep-alive sockets held by the ranking scraper so the process
    // exits cleanly without lingering idle connections.
    destroyRankingScraperAgents();
    
    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    logRankingEvent(`[FATAL] Uncaught exception: ${error.message}`);
    
    // Try to save before crashing
    try {
        saveRankingStorageSync(rankingDb);
        console.log('💾 Emergency save completed');
    } catch (e) {
        console.error('❌ Emergency save failed:', e.message);
    }
    
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    logRankingEvent(`[ERROR] Unhandled rejection: ${reason}`);
});

// ==========================================
// 🔄 UPDATE COMMAND HANDLER
// ==========================================

async function handleUpdateCommand(interaction, db, saveLocalStorage, logEvent) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: 64 }).catch(() => {});
    }

    try {
        await interaction.reply({ content: '🔄 Pulling latest code and restarting bot...', flags: 64 });
    } catch (e) {
        return;
    }

    try {
        const { stdout: pullOut, stderr: pullErr } = await execAsync('git pull', { timeout: 30000 });
        const pullResult = (pullOut || '').trim();
        console.log(`🔄 [Update] git pull: ${pullResult}`);

        await interaction.editReply({ content: `✅ **Update complete!**

📥 **git pull:**
\`\`\`
${pullResult}
\`\`\`

🔄 Restarting bot via PM2...` }).catch(() => {});

        // Give time for the reply to be sent before restart kills the process
        setTimeout(() => {
            exec('pm2 restart gear', (err) => {
                if (err) console.error('❌ PM2 restart failed:', err.message);
            });
        }, 1000);
    } catch (error) {
        const errMsg = error.stdout || error.stderr || error.message || String(error);
        await interaction.editReply({
            content: `❌ **Update failed:**\n\`\`\`
${String(errMsg).substring(0, 1800)}
\`\`\``
        }).catch(() => {});
    }
}

// ==========================================
// 🖱️ INTERACTION ROUTER
// ==========================================
// Map-based router: exact match (O(1)) first, prefix match as fallback.
// This replaces the old if/else chain for faster routing.


// ── Slash commands ──
const COMMAND_ROUTES = new Map([
    ['notify', handleNotifyCommand],
    ['update', handleUpdateCommand],
]);

// ── Exact match routes ──
const BUTTON_EXACT = new Map([
    ['welcome_register_owner', handleWelcomeRegisterOwner],
    ['welcome_register_pilot', handleWelcomeRegisterPilot],
    ['welcome_remove_registration', handleWelcomeRemoveRegistration],
    ['welcome_remove_pilot', handleWelcomeRemovePilot],
    ['selfremove_yes', handleSelfRemoveConfirm],
    ['selfremove_no', handleSelfRemoveConfirm],
    ['restorebackup-confirm', handleRestoreBackupConfirm],
    ['restorebackup-cancel', handleRestoreBackupCancel],
    ['manage_allied', handleManageAllied],
    ['manage_allied_region', handleManageAlliedRegion],
    ['manage_allied_world', handleManageAlliedWorld],
    ['manage_allied_remove', handleManageAlliedRemove],
    ['manage_back', handleManageNav],
    ['manage_allied_back', handleManageNav],
]);

const SELECT_EXACT = new Map([
    ['notify_select_action', handleNotifySelect],
    ['select_pilot_to_remove', handlePilotRemoveSelect],
    ['restorebackup_select', handleRestoreBackupSelect],
    ['manage_allied_region', handleManageAlliedRegion],
    ['manage_allied_world', handleManageAlliedWorld],
    ['manage_allied_remove', handleManageAlliedRemove],
]);

const MODAL_EXACT = new Map([
    ['register_owner_modal', handleOwnerRegistrationModal],
    ['register_pilot_modal', handlePilotRegistrationModal],
    ['manage_allied_add_modal', handleManageAlliedAddModal],
]);

// ── Prefix match routes (order matters: longest prefix first) ──
const BUTTON_PREFIX = [
    ['admin_approve_pilot_', handleAdminApprovePilot],
    ['owner_remove_pilot_', handleOwnerRemovePilotDm],
    ['approve_owner_', handleApproveOwner],
    ['approve_pilot_', handleApprovePilot],
    ['manage_user_prev_', handleManageNav],
    ['manage_user_next_', handleManageNav],
    ['manage_allied_add_', handleManageAlliedAdd],
    ['confirm-addclan-', handleAddClanSuggestion],
    ['confirm-', handleConfirmAction],
    ['notify_', handleNotifyButton],
    ['manage_', handleMir4Interactions],  // fallback for manage_
];

const SELECT_PREFIX = [
    ['user_select_pilot_owner_', handleUserSelectPilotOwner],
    ['user_select_reg_nickname_', handleUserSelectRegistrationNickname],
    ['select_manual_nickname_', handleSelectManualNickname],
    ['select_pending_nickname_', handleSelectPendingNickname],
    ['select_pending_pilot_owner_', handleSelectPendingPilotOwner],
    ['manage_user_page_', handleManageUserPage],
    ['manage_action_', handleManageAction],
    ['manage_pilot_', handleManagePilotRemove],
    ['manage_allied_page_', handleManageAlliedPage],
];

const MODAL_PREFIX = [
    ['reject_owner_', handleRejectOwner],
];

// ── Route resolver ──
function resolveHandler(customId, exactMap, prefixList) {
    // Fast path: exact match
    const exact = exactMap.get(customId);
    if (exact) return exact;

    // Slow path: prefix match
    for (const [prefix, handler] of prefixList) {
        if (customId.startsWith(prefix)) return handler;
    }

    return null;
}

// ── Main interaction handler ──
client.on('interactionCreate', async (interaction) => {
    try {
        const { customId } = interaction;

        // A. SLASH COMMANDS
        if (interaction.isCommand()) {
            const handler = COMMAND_ROUTES.get(interaction.commandName);
            if (handler) {
                return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            }
            const result = await handleRankingCommand(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            // Safety net: if the command was not recognized/acknowledged, reply
            // so Discord never shows "The application did not respond".
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({ content: '❌ Comando não reconhecido.', flags: 64 }).catch(() => {});
                } catch { /* interaction already gone — nothing to do */ }
            }
            return result !== false ? result : await handleMir4Interactions(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
        }

        // B. STRING SELECT MENUS
        if (interaction.isStringSelectMenu()) {
            const handler = resolveHandler(customId, SELECT_EXACT, SELECT_PREFIX);
            if (handler) return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            // Unhandled select — acknowledge so Discord never shows "The application did not respond"
            try { await interaction.deferUpdate().catch(() => {}); } catch { /* gone */ }
            return;
        }

        // C. MODAL SUBMITS
        if (interaction.isModalSubmit()) {
            const handler = resolveHandler(customId, MODAL_EXACT, MODAL_PREFIX);
            if (handler) return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            // Unhandled modal — acknowledge so Discord never shows "The application did not respond"
            try { await interaction.deferUpdate().catch(() => {}); } catch { /* gone */ }
            return;
        }

        // D. BUTTON CLICKS
        if (interaction.isButton()) {
            const handler = resolveHandler(customId, BUTTON_EXACT, BUTTON_PREFIX);
            if (handler) return await handler(interaction, rankingDb, saveRankingStorageWrapped, logRankingEvent);
            // Unhandled button — acknowledge so Discord never shows "The application did not respond"
            try { await interaction.deferUpdate().catch(() => {}); } catch { /* gone */ }
            return;
        }

    } catch (error) {
        // 10062 = interaction already expired / already handled — nothing to respond to, keep to one log line
        if (isExpiredError(error)) {
            const target = interaction.customId || interaction.commandName || 'unknown interaction';
            console.warn(`⚠️ [Router] Interaction expired on "${target}" (${error.code || 10062}) — skipping`);
            return;
        }
        console.error('❌ Error caught in interaction router:', error);
        if (error.stack) console.error('📋 [Stack]:', error.stack);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An unexpected error occurred. Please try again.', flags: 64 }).catch(() => {});
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: '❌ An unexpected error occurred. Please try again.' }).catch(() => {});
            }
        } catch {
            // Silently fail
        }
    }
});

// ==========================================
// 🔌 RESILIENT LOGIN (retry + backoff)
// ==========================================
// Discord's /gateway/bot endpoint can briefly return 503 (Service Unavailable)
// during API outages. Without a catch here, the login promise rejects and falls
// into the unhandledRejection handler — which only logs — leaving the process
// alive but disconnected forever (PM2 shows green, but the bot is dead).
// Retry transient failures with exponential backoff, then exit(1) after the max
// attempts so PM2 restarts the process cleanly.

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BASE_DELAY_MS = 5000;

const TRANSIENT_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNREFUSED']);

function isTransientLoginError(err) {
    // 429 + any 5xx (ex.: o 503 do gateway em outage) — transitório
    if (err.status === 429 || (err.status >= 500 && err.status < 600)) return true;
    // Falhas de rede puras (sem status HTTP, com code do Node) — transitório
    if (!err.status && err.code && TRANSIENT_NETWORK_CODES.has(err.code)) return true;
    // 401/403, TOKEN_MISSING, intents inválidos, etc. — permanente, falha rápido
    return false;
}

async function loginWithRetry() {
    for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt++) {
        try {
            await client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
            console.log('✅ Bot login successful.');
            return;
        } catch (err) {
            console.error(`❌ Login failed (attempt ${attempt}/${LOGIN_MAX_ATTEMPTS}): ${err.message}`);
            logRankingEvent(`[ERROR] Login failed (attempt ${attempt}/${LOGIN_MAX_ATTEMPTS}): ${err.message}`);

            if (!isTransientLoginError(err) || attempt === LOGIN_MAX_ATTEMPTS) {
                console.error('🛑 Giving up on login — exiting so PM2 can restart the process.');
                try { saveRankingStorageSync(rankingDb); } catch (e) { /* best-effort */ }
                process.exit(1);
            }

            const delayMs = LOGIN_BASE_DELAY_MS * 2 ** (attempt - 1); // 5s, 10s, 20s, 40s
            console.log(`⏳ Retrying login in ${delayMs / 1000}s... (attempt ${attempt + 1}/${LOGIN_MAX_ATTEMPTS})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

loginWithRetry();
