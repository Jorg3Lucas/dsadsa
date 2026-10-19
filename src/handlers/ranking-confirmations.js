import fs from 'node:fs';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getMsg } from '../lang/lang.js';
import {
    MEMBER_ROLE_ID,
    SUPER_ADMIN_USER_ID,
    MAX_PILOTS_PER_OWNER,
    confirmationCache
} from '../core/ranking-constants.js';
import { buildPrefixedNickname, assignMemberRole, setMemberNickname } from '../core/ranking-utils.js';
import { deferUpdateSafe } from '../core/interaction-utils.js';
import { findNicknameOwner, unlinkPilotLinks } from '../core/ranking-dedup.js';

// ==========================================
// ✅ CONFIRMATION BUTTON HANDLERS
// ==========================================
// Handles confirm-* button clicks from /manual* commands
// Extracted from ranking-handlers.js

// ── Restore Backup: Select menu handler ──
export async function handleRestoreBackupSelect(interaction, db, saveLocalStorage, logEvent) {
    // Acknowledge first: reading and parsing a full backup can exceed Discord's
    // 3s window, which used to show "<bot> didn't respond in time" on a click
    // that was actually being processed.
    if (!await deferUpdateSafe(interaction)) return;

    const userId = interaction.user.id;

    // Super admin only
    if (userId !== SUPER_ADMIN_USER_ID) {
        return interaction.editReply({ content: '❌ **Access denied.**', components: [] }).catch(() => {});
    }

    const cacheKey = `${userId}-restorebackup`;
    const cached = confirmationCache[cacheKey];

    if (!cached) {
        return interaction.editReply({ content: '⌛ Session expired. Run /restorebackup again.', components: [] }).catch(() => {});
    }

    const selectedFile = interaction.values[0];
    const BACKUP_DIR = './backups';
    const backupPath = `${BACKUP_DIR}/${selectedFile}`;

    if (!fs.existsSync(backupPath)) {
        return interaction.editReply({ content: '❌ Backup file not found.', components: [] }).catch(() => {});
    }

    // Show confirmation with details
    const stats = fs.statSync(backupPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    const ageMs = Date.now() - stats.mtimeMs;
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

    let data;
    try {
        data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    } catch (e) {
        return interaction.editReply({ content: `❌ Invalid backup file: ${e.message}`, components: [] }).catch(() => {});
    }

    const userCount = data.users ? Object.keys(data.users).length : 0;

    // Store selected backup info
    cached.selectedBackup = selectedFile;
    cached.backupData = data;
    cached.backupStats = { sizeKB, ageHours, userCount };
    cached.timestamp = Date.now();

    const confirmContent = `⚠️ **CONFIRM RESTORE**\n\n` +
        `📦 **Backup:** ${selectedFile}\n` +
        `📊 Size: ${sizeKB} KB\n` +
        `🕐 Age: ${ageHours}h ago\n` +
        `👥 Users in backup: **${userCount}**\n\n` +
        `🔴 **This will OVERWRITE the current database!**\n` +
        `A backup of the current state will be created first.`;

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('restorebackup-confirm').setLabel('✅ YES, RESTORE').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('restorebackup-cancel').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary)
        )
    ];

    return interaction.editReply({ content: confirmContent, components }).catch(() => {});
}

// ── Restore Backup: Cancel handler ──
export async function handleRestoreBackupCancel(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferUpdateSafe(interaction)) return;

    const cacheKey = `${interaction.user.id}-restorebackup`;
    delete confirmationCache[cacheKey];

    return interaction.editReply({ content: '❌ **Restore cancelled.**', components: [] }).catch(() => {});
}

// ── Restore Backup: Confirm handler ──
export async function handleRestoreBackupConfirm(interaction, db, saveLocalStorage, logEvent) {
    if (!await deferUpdateSafe(interaction)) return;

    const userId = interaction.user.id;

    // Super admin only
    if (userId !== SUPER_ADMIN_USER_ID) {
        return interaction.editReply({ content: '❌ **Access denied.**', components: [] }).catch(() => {});
    }

    const cacheKey = `${userId}-restorebackup`;
    const cached = confirmationCache[cacheKey];

    if (!cached || !cached.selectedBackup) {
        return interaction.editReply({ content: '⌛ Session expired. Run /restorebackup again.', components: [] }).catch(() => {});
    }

    const DB_RANKING_PATH = './database_ranking.json';
    const BACKUP_DIR = './backups';

    await interaction.editReply({ content: '💾 **Restoring backup...**', components: [] }).catch(() => {});

    try {
        // 1. Create backup of current state
        // Persist the in-memory database first: the snapshot below copies the FILE,
        // so any unsaved change would otherwise be lost by the restore.
        saveLocalStorage();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const preRestoreBackup = `${BACKUP_DIR}/database_ranking_PRE_RESTORE_${timestamp}.json`;
        if (fs.existsSync(DB_RANKING_PATH)) {
            fs.copyFileSync(DB_RANKING_PATH, preRestoreBackup);
            logEvent(`💾 Pre-restore backup created: ${preRestoreBackup}`);
        }

        // 2. Restore the selected backup
        const backupPath = `${BACKUP_DIR}/${cached.selectedBackup}`;
        fs.copyFileSync(backupPath, DB_RANKING_PATH);
        logEvent(`✅ Backup restored: ${cached.selectedBackup}`);

        // 3. Reload the in-memory database
        const newData = JSON.parse(fs.readFileSync(DB_RANKING_PATH, 'utf8'));
        Object.assign(db, newData);
        if (!db.users) db.users = {};
        saveLocalStorage();

        const userCount = Object.keys(db.users).length;
        logEvent(`🔄 Database reloaded — ${userCount} users in memory`);

        // Clean up cache
        delete confirmationCache[cacheKey];

        const successMsg = `✅ **Backup Restored Successfully!**\n\n` +
            `📦 Restored: ${cached.selectedBackup}\n` +
            `👥 Users loaded: **${userCount}**\n` +
            `💾 Pre-restore backup saved: ${preRestoreBackup.split('/').pop()}\n\n` +
            `🔄 The in-memory database has been updated. Run /manage to verify.`;

        return interaction.editReply({ content: successMsg }).catch(() => {});

    } catch (e) {
        logEvent(`❌ Backup restore failed: ${e.message}`);
        return interaction.editReply({ content: `❌ **Restore failed:** ${e.message}` }).catch(() => {});
    }
}

export async function handleConfirmAction(interaction, db, saveLocalStorage, logEvent) {
    // Acknowledge the click immediately. Registering a player fetches the member,
    // sets the nickname and assigns the role — easily more than Discord's 3s reply
    // window, and without this the click shows "<bot> didn't respond in time" even
    // though the registration itself succeeds.
    if (!await deferUpdateSafe(interaction)) return;

    const [_, action, result] = interaction.customId.split('-');
    const cacheKey = `${interaction.user.id}-${action}`;
    const cached = confirmationCache[cacheKey];

    if (!cached) {
        return interaction.editReply({
            content: '⌛ This confirmation has expired. Please run the command again.',
            components: []
        }).catch(() => {});
    }

    if (result === 'no') {
        delete confirmationCache[cacheKey];
        return interaction.editReply({
            content: '❌ Action cancelled.',
            components: []
        }).catch(() => {});
    }

    delete confirmationCache[cacheKey];

    // ── manualremove: Remove a user's registration ──
    if (action === 'manualremove') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);
        if (!targetMember || !db.users[cached.targetId]) {
            return interaction.editReply({ content: '❌ Target user no longer available.', components: [] }).catch(() => {});
        }

        const userData = db.users[cached.targetId];
        // Fetch + clean up the target AND every linked pilot concurrently —
        // each member's role removal + nickname reset are independent calls.
        const pilotCleanups = (userData.pilotIds || []).map(async (pId) => {
            const pilotMember = await guild.members.fetch(pId).catch(() => null);
            if (!pilotMember) return;
            if (pilotMember.roles.cache.has(MEMBER_ROLE_ID)) {
                await pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
            }
            await setMemberNickname(pilotMember, pilotMember.user.username, logEvent);
        });
        const targetCleanup = (async () => {
            if (targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
                await targetMember.roles.remove(MEMBER_ROLE_ID).catch(() => {});
            }
            await setMemberNickname(targetMember, targetMember.user.username, logEvent);
        })();
        await Promise.all([...pilotCleanups, targetCleanup]);
        // The removed member may also be a pilot of another account — drop the
        // stale link, otherwise it keeps counting against that owner's cap.
        unlinkPilotLinks(db.users, cached.targetId);
        delete db.users[cached.targetId];
        saveLocalStorage();

        logEvent(`Admin ${interaction.user.tag} manually removed user ${cached.targetId}`);
        return interaction.editReply({
            content: getMsg('ranking.responses.manualremove.success', { username: cached.targetName }),
            components: []
        }).catch(() => {});
    }

    // ── manualremovepilot: Remove a specific pilot from an owner ──
    if (action === 'manualremovepilot') {
        const guild = interaction.guild;
        // Fetch owner + pilot concurrently (independent member lookups).
        const [ownerMember, pilotMember] = await Promise.all([
            guild.members.fetch(cached.ownerId).catch(() => null),
            guild.members.fetch(cached.pilotId).catch(() => null)
        ]);

        if (!ownerMember || !db.users[cached.ownerId]) {
            return interaction.editReply({ content: '❌ Owner no longer available.', components: [] }).catch(() => {});
        }

        if (!db.users[cached.ownerId].pilotIds || !db.users[cached.ownerId].pilotIds.includes(cached.pilotId)) {
            return interaction.editReply({ content: '❌ This pilot is no longer linked.', components: [] }).catch(() => {});
        }

        db.users[cached.ownerId].pilotIds = db.users[cached.ownerId].pilotIds.filter(id => id !== cached.pilotId);
        saveLocalStorage();

        if (pilotMember) {
            await Promise.all([
                pilotMember.roles.cache.has(MEMBER_ROLE_ID)
                    ? pilotMember.roles.remove(MEMBER_ROLE_ID).catch(() => {})
                    : Promise.resolve(),
                setMemberNickname(pilotMember, pilotMember.user.username, logEvent)
            ]);
        }

        logEvent(`Admin ${interaction.user.tag} removed pilot ${cached.pilotName} from ${cached.ownerName}`);
        return interaction.editReply({
            content: getMsg('ranking.responses.manualremovepilot.success', { ownerDisplay: cached.ownerName, pilotDisplay: cached.pilotName }),
            components: []
        }).catch(() => {});
    }

    // ── manualpilot: Link a pilot to an owner ──
    if (action === 'manualpilot') {
        const guild = interaction.guild;
        // Fetch owner + pilot concurrently (independent member lookups).
        const [ownerMember, pilotMember] = await Promise.all([
            guild.members.fetch(cached.ownerId).catch(() => null),
            guild.members.fetch(cached.pilotId).catch(() => null)
        ]);

        if (!ownerMember || !db.users[cached.ownerId]) {
            return interaction.editReply({ content: '❌ Owner no longer available.', components: [] }).catch(() => {});
        }

        if (cached.ownerId === cached.pilotId) {
            return interaction.editReply({ content: '❌ A member cannot be their own pilot.', components: [] }).catch(() => {});
        }

        const ownerData = db.users[cached.ownerId];
        if (!ownerData.pilotIds) ownerData.pilotIds = [];
        // The cap may have been reached between /manualpilot and this click.
        if (!ownerData.pilotIds.includes(cached.pilotId) && ownerData.pilotIds.length >= MAX_PILOTS_PER_OWNER) {
            return interaction.editReply({ content: `❌ This owner already has the maximum of ${MAX_PILOTS_PER_OWNER} pilots.`, components: [] }).catch(() => {});
        }
        if (!ownerData.pilotIds.includes(cached.pilotId)) {
            ownerData.pilotIds.push(cached.pilotId);
        }
        saveLocalStorage();

        // Nickname + role are independent — run them concurrently. Both results
        // are reported instead of swallowed, so a hierarchy/permission refusal is
        // visible (see assignMemberRole / setMemberNickname in ranking-utils).
        if (pilotMember) {
            const [nickOutcome, roleOutcome] = await Promise.all([
                setMemberNickname(pilotMember, buildPrefixedNickname(cached.ownerNick, db, 'Pilot'), logEvent),
                assignMemberRole(pilotMember, logEvent, guild)
            ]);
            if (!roleOutcome.ok || !nickOutcome.ok) {
                const warnings = [
                    !nickOutcome.ok ? `⚠️ **The nickname could NOT be applied by the bot.**\n**Discord said:** ${nickOutcome.reason}` : '',
                    !roleOutcome.ok ? `⚠️ **The member role could NOT be applied by the bot.**\n**Discord said:** ${roleOutcome.reason}` : ''
                ].filter(Boolean).join('\n\n');
                logEvent(`⚠️ [ManualPilot] Failed to fully apply the pilot registration to ${pilotMember.user?.tag || cached.pilotId} — nick.ok=${nickOutcome.ok}, role.ok=${roleOutcome.ok}`);
                return interaction.editReply({
                    content: `${getMsg('ranking.responses.manualpilot.success', { pilotMember: cached.pilotName, nick: cached.ownerNick })}\n\n${warnings}`,
                    components: []
                }).catch(() => {});
            }
        }

        logEvent(`Admin ${interaction.user.tag} manually linked pilot ${cached.pilotName} to ${cached.ownerName}`);
        return interaction.editReply({
            content: getMsg('ranking.responses.manualpilot.success', { pilotMember: cached.pilotName, nick: cached.ownerNick }),
            components: []
        }).catch(() => {});
    }

    // ── manualregister: Register a user directly ──
    if (action === 'manualregister') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: '❌ Member no longer available.', components: [] }).catch(() => {});
        }

        const finalNickname = cached.selectedNickname || cached.nickname;

        // Safety net: the name may have been taken by ANOTHER account while the
        // confirmation was open. Re-registering the same member is an explicit
        // admin override and stays allowed.
        const takenBy = findNicknameOwner(db.users, finalNickname, cached.targetId);
        if (takenBy) {
            return interaction.editReply({ content: `❌ The nickname **${finalNickname}** is already registered by <@${takenBy.id}>.`, components: [] }).catch(() => {});
        }

        db.users[cached.targetId] = {
            ...db.users[cached.targetId],
            nickname: finalNickname,
            registeredAt: new Date().toISOString(),
            ...(cached.fromForumSearch ? { fromForumSearch: true } : {})
        };

        if (cached.needsTempApproval) {
            const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
            db.users[cached.targetId].tempUntil = threeDaysFromNow.toISOString();
            db.users[cached.targetId].tempRegisteredAt = db.users[cached.targetId].registeredAt;
        }

        if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
        if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;
        saveLocalStorage();

        // Nickname + role are independent — run them concurrently. Both results
        // are reported instead of swallowed (see assignMemberRole in ranking-utils).
        const [registerNickOutcome, registerRoleOutcome] = await Promise.all([
            setMemberNickname(targetMember, buildPrefixedNickname(finalNickname, db), logEvent),
            assignMemberRole(targetMember, logEvent, guild)
        ]);

        const tempLabel = cached.needsTempApproval ? ' (temporary — 3 days)' : '';
        logEvent(`Admin ${interaction.user.tag} manually registered ${cached.targetId} as ${finalNickname} in ${cached.clan}${tempLabel}${registerRoleOutcome.ok && registerNickOutcome.ok ? '' : ` — ⚠️ nick.ok=${registerNickOutcome.ok}, role.ok=${registerRoleOutcome.ok}`}`);

        const responseMsg = cached.needsTempApproval
            ? `⏳ **${finalNickname}** registered as temporary (3 days) in **${cached.clan}**. Will be converted to permanent once found in an allied clan.`
            : getMsg('ranking.responses.manualregister.cacheFound', { nickname: finalNickname, clan: cached.clan });

        const registerWarnings = [
            registerNickOutcome.ok ? '' : `\n\n⚠️ **The nickname could NOT be applied by the bot.**\n**Discord said:** ${registerNickOutcome.reason}\nSet the nickname manually, then run \`/forcesync\`.`,
            registerRoleOutcome.ok ? '' : `\n\n⚠️ **The member role could NOT be applied by the bot.**\n**Discord said:** ${registerRoleOutcome.reason}\nGive the role manually or fix the bot's role position, then run \`/forcesync\`.`
        ].join('');

        return interaction.editReply({
            content: responseMsg + registerWarnings,
            components: []
        }).catch(() => {});
    }

    // ── manualforce: Force-register a user as permanent (no ranking check) ──
    if (action === 'manualforce') {
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(cached.targetId).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: '❌ Member no longer available.', components: [] }).catch(() => {});
        }

        const takenBy = findNicknameOwner(db.users, cached.nickname, cached.targetId);
        if (takenBy) {
            return interaction.editReply({ content: `❌ The nickname **${cached.nickname}** is already registered by <@${takenBy.id}>.`, components: [] }).catch(() => {});
        }

        // Register immediately as permanent — no tempUntil, no ranking check
        db.users[cached.targetId] = {
            ...db.users[cached.targetId],
            nickname: cached.nickname,
            registeredAt: new Date().toISOString(),
            manualPermanent: true
        };

        // Clean up any stale temp fields if they exist
        if (db.users[cached.targetId].tempUntil) delete db.users[cached.targetId].tempUntil;
        if (db.users[cached.targetId].tempRegisteredAt) delete db.users[cached.targetId].tempRegisteredAt;
        if (db.users[cached.targetId].clanManual) delete db.users[cached.targetId].clanManual;

        if (!db.users[cached.targetId].pilotIds) db.users[cached.targetId].pilotIds = [];
        saveLocalStorage();

        // Nickname + role are independent — run them concurrently. Both results
        // are reported instead of swallowed (see assignMemberRole in ranking-utils).
        const [forceNickOutcome, forceRoleOutcome] = await Promise.all([
            setMemberNickname(targetMember, buildPrefixedNickname(cached.nickname, db), logEvent),
            assignMemberRole(targetMember, logEvent, guild)
        ]);

        logEvent(`👑 Admin ${interaction.user.tag} force-registered ${cached.targetId} as ${cached.nickname} (permanent — no ranking check)${forceRoleOutcome.ok && forceNickOutcome.ok ? '' : ` — ⚠️ nick.ok=${forceNickOutcome.ok}, role.ok=${forceRoleOutcome.ok}`}`);

        const forceWarnings = [
            forceNickOutcome.ok ? '' : `\n\n⚠️ **The nickname could NOT be applied by the bot.**\n**Discord said:** ${forceNickOutcome.reason}\nSet the nickname manually, then run \`/forcesync\`.`,
            forceRoleOutcome.ok ? '' : `\n\n⚠️ **The member role could NOT be applied by the bot.**\n**Discord said:** ${forceRoleOutcome.reason}\nGive the role manually or fix the bot's role position, then run \`/forcesync\`.`
        ].join('');

        return interaction.editReply({
            content: getMsg('ranking.responses.manualforce.success', { username: cached.targetName, nickname: cached.nickname }) + forceWarnings,
            components: []
        }).catch(() => {});
    }

    return interaction.editReply({ content: '❌ Unknown action.', components: [] }).catch(() => {});
}
