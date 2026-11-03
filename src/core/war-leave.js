// ==========================================
// 🛡️ WAR LEAVE — KEEP THE MEMBER ROLE WHILE
// A MEMBER FIGHTS WARS OUTSIDE THE ALLIED CLANS
// ==========================================
// Members that leave the allied clans to fight wars on another server disappear
// from the ranking, and the sync would remove the member role after the grace
// window. This module keeps the role while an approver decides:
//
//   1. The member is no longer found in the allied-clan ranking.
//   2. The exact character name is searched on the MIR4 forum ranking.
//   3. When the forum has an exact hit, approvers get a message in the approvals
//      channel with that result and [Keep role] / [Remove role].
//      No hit → the normal validation removes the role; forum unreachable → the
//      role is kept until the next sync.
//   4. While the request is pending (and after "Keep role") the role is kept.
//      "Remove role" revokes it immediately.
//   5. On every sync the forum is searched again for members with an active
//      war leave: a clan or server change raises a new request.
//   6. An approved war leave is reviewed again after 30 days (configurable).
//
// The state lives in db.users[userId].warLeave:
//   { status: 'pending'|'approved'|'denied', since, lastClan, lastServer,
//     lastSeen, lastCheckedAt, lastAskedAt, lastReviewAt, channelId, messageId,
//     decidedBy, decidedAt }

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { MEMBER_ROLE_ID, APPROVER_ROLE_IDS, adminChannelId } from './ranking-constants.js';
import { isAlliedClanName, searchRankingForumDetailed } from './ranking-service.js';
import { cleanNickname } from './ranking-cache.js';
import { deferUpdateSafe } from './interaction-utils.js';

const ACTIVE_STATUSES = new Set(['pending', 'approved']);

/** Days between reviews of an approved war leave when nothing is configured. */
export const WAR_LEAVE_DEFAULT_REVIEW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const WARLEAVE_KEEP_PREFIX = 'warleave_keep_';
export const WARLEAVE_REMOVE_PREFIX = 'warleave_remove_';

/** True while the member role must be kept for this user (pending or approved). */
export function isWarLeaveActive(userData) {
    const warLeave = userData?.warLeave;
    return !!warLeave && ACTIVE_STATUSES.has(warLeave.status);
}

/** True when an approver already refused the war leave (role is removed, no new ask). */
export function isWarLeaveDenied(userData) {
    return userData?.warLeave?.status === 'denied';
}

/** Drop the war-leave record (e.g. the member is back in an allied clan). */
export function clearWarLeave(userData) {
    if (userData && userData.warLeave) delete userData.warLeave;
}

// ==========================================
// ⏳ REVIEW WINDOW
// ==========================================

/**
 * Days between reviews of an approved war leave. Read from
 * `db.config.warLeaveReviewDays`, then the WAR_LEAVE_REVIEW_DAYS env var, then
 * the default. `0` disables the periodic review.
 */
export function getWarLeaveReviewDays(db) {
    const raw = db?.config?.warLeaveReviewDays ?? process.env.WAR_LEAVE_REVIEW_DAYS;
    if (raw === undefined || raw === null || raw === '') return WAR_LEAVE_DEFAULT_REVIEW_DAYS;
    const days = Number(raw);
    if (!Number.isFinite(days) || days < 0) return WAR_LEAVE_DEFAULT_REVIEW_DAYS;
    return Math.floor(days);
}

/** When the next review of this war leave is due (null when disabled/not approved). */
export function warLeaveReviewDueDate(warLeave, db) {
    if (!warLeave || warLeave.status !== 'approved') return null;
    const days = getWarLeaveReviewDays(db);
    if (days <= 0) return null;
    const anchor = warLeave.lastReviewAt || warLeave.decidedAt || warLeave.since;
    const anchorDate = anchor ? new Date(anchor) : null;
    if (!anchorDate || Number.isNaN(anchorDate.getTime())) return null;
    return new Date(anchorDate.getTime() + days * DAY_MS);
}

/** True when an approved war leave must be confirmed by an approver again. */
export function isWarLeaveReviewDue(warLeave, db, now = new Date()) {
    const due = warLeaveReviewDueDate(warLeave, db);
    return !!due && now.getTime() >= due.getTime();
}

/** Human-readable review state ("next review in 12 days"). */
export function warLeaveReviewLabel(warLeave, db, now = new Date()) {
    const days = getWarLeaveReviewDays(db);
    if (warLeave?.status !== 'approved') return null;
    if (days <= 0) return 'review disabled';
    const due = warLeaveReviewDueDate(warLeave, db);
    if (!due) return null;
    const daysLeft = Math.ceil((due.getTime() - now.getTime()) / DAY_MS);
    return daysLeft > 0
        ? `next review in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
        : 'review due';
}

/** One-line war-leave state for the /manage list and the status screen. */
export function warLeaveStatusLabel(userData, db, now = new Date()) {
    const warLeave = userData?.warLeave;
    if (!warLeave) return null;
    if (warLeave.status === 'pending') return 'pending approver decision';
    if (warLeave.status === 'denied') return 'refused by an approver';
    const review = warLeaveReviewLabel(warLeave, db, now);
    return review ? `approved — ${review}` : 'approved';
}

/** Short marker appended to select-option descriptions in the /manage list. */
export function warLeaveBadge(userData, db) {
    const warLeave = userData?.warLeave;
    if (!warLeave) return '';
    if (warLeave.status === 'pending') return ' | 🛡️ WL pending';
    if (warLeave.status !== 'approved') return '';
    return isWarLeaveReviewDue(warLeave, db) ? ' | 🛡️ WL review' : ' | 🛡️ WL';
}

// ==========================================
// 🔍 FORUM TRACKING
// ==========================================

/** True when the clan belongs to any configured allied-clan list. */
function inAnyAlliedClan(clanName, db) {
    if (!clanName) return false;
    const lists = Object.values(db?.config?.alliedClans || {});
    return lists.some(list => isAlliedClanName(clanName, list));
}

/**
 * Search the MIR4 forum ranking for the character name and describe where the
 * player currently is. Never falls back to fuzzy cache matches — a war-leave
 * decision must be based on an exact hit.
 *
 * The same character name can exist on several servers, so when the forum
 * returns more than one exact hit prefer the clan we already know (avoids a
 * false "clan changed" alarm from a homonym), then an allied clan.
 *
 * @param {string} nickname
 * @param {object} db
 * @param {{clanName?: string|null}} [previous] - last known location
 * @returns {Promise<{found: boolean, clanName: string|null, serverName: string|null, inAlliedClan: boolean, forumOk: boolean}>}
 */
export async function detectMemberLocation(nickname, db, previous = null) {
    if (!nickname) return { found: false, clanName: null, serverName: null, inAlliedClan: false, forumOk: true };

    const { results, ok } = await searchRankingForumDetailed(nickname);
    if (!results || results.length === 0) {
        return { found: false, clanName: null, serverName: null, inAlliedClan: false, forumOk: ok };
    }

    const previousClan = previous?.clanName ? cleanNickname(previous.clanName) : null;
    const match = results.find(r => previousClan && r.clanName && cleanNickname(r.clanName) === previousClan)
        || results.find(r => inAnyAlliedClan(r.clanName, db))
        || results[0];

    const clanName = match.clanName && match.clanName !== 'No Clan' ? match.clanName : null;
    const serverName = match.serverName || null;

    return {
        found: true,
        clanName,
        serverName,
        inAlliedClan: inAnyAlliedClan(clanName, db),
        forumOk: ok
    };
}

/** Human-readable forum location ("Clan (EU021)" / "Not found ..."). */
export function locationLabel(location) {
    if (!location?.found) return 'not found on the forum ranking';
    const clan = location.clanName || 'no clan';
    const server = location.serverName ? ` (${location.serverName})` : '';
    return `${clan}${server}`;
}

/** Human-readable label for a stored war-leave record. */
export function recordLabel(warLeave) {
    if (!warLeave?.lastClan && !warLeave?.lastServer) return 'not found on the forum ranking';
    return locationLabel({ found: true, clanName: warLeave.lastClan, serverName: warLeave.lastServer });
}

/**
 * Same clan and server as the last remembered location? A missing value never
 * counts as a change (the forum does not always expose the server column).
 */
export function sameLocation(previous, current) {
    if (!current?.found) return true;

    const previousClan = previous?.clanName ? cleanNickname(previous.clanName) : null;
    const currentClan = current?.clanName ? cleanNickname(current.clanName) : null;
    if (previousClan !== currentClan) return false;

    const previousServer = (previous?.serverName || '').toLowerCase();
    const currentServer = (current?.serverName || '').toLowerCase();
    return !previousServer || !currentServer || previousServer === currentServer;
}

/** True when approvers must be asked (first detection or a clan/server change). */
export function shouldAskElders(warLeave, location) {
    if (!warLeave) return true;
    // The previous prompt could not be sent (no channel) — retry on this sync.
    if (!warLeave.lastAskedAt) return true;
    if (!location?.found) return false; // no new information — don't re-ask on every sync
    return !sameLocation({ clanName: warLeave.lastClan, serverName: warLeave.lastServer }, location);
}

/** Build the "clan A → clan B / server X → server Y" change description. */
export function buildChange(previous, location) {
    if (!previous?.clanName && !previous?.serverName) return null;
    const parts = [];

    const previousClan = previous.clanName ? cleanNickname(previous.clanName) : null;
    const currentClan = location.clanName ? cleanNickname(location.clanName) : null;
    if (previousClan !== currentClan) {
        parts.push(`clan **${previous.clanName || 'unknown'}** → **${location.clanName || 'unknown'}**`);
    }

    const previousServer = (previous.serverName || '').toLowerCase();
    const currentServer = (location.serverName || '').toLowerCase();
    if (previousServer && currentServer && previousServer !== currentServer) {
        parts.push(`server **${previous.serverName}** → **${location.serverName}**`);
    }

    return parts.length > 0 ? parts.join('\n') : null;
}

/** Close an active war leave without a new prompt (e.g. an admin ends it in /manage). */
export function closeWarLeave(userData, decidedBy, now = new Date()) {
    const warLeave = userData?.warLeave;
    if (!warLeave) return null;
    warLeave.status = 'denied';
    warLeave.decidedBy = decidedBy;
    warLeave.decidedAt = now.toISOString();
    return warLeave;
}

/** Create the initial (pending) war-leave record. */
export function createWarLeave(userData, location, now = new Date()) {
    userData.warLeave = {
        status: 'pending',
        since: now.toISOString(),
        lastClan: location?.clanName || null,
        lastServer: location?.serverName || null,
        lastSeen: location?.found ? now.toISOString() : null,
        lastCheckedAt: now.toISOString(),
        lastAskedAt: null,
        channelId: null,
        messageId: null
    };
    return userData.warLeave;
}

/** Store the latest forum location on the record. */
export function rememberLocation(userData, location, now = new Date()) {
    const warLeave = userData.warLeave || createWarLeave(userData, location, now);
    warLeave.lastClan = location?.clanName || null;
    warLeave.lastServer = location?.serverName || null;
    if (location?.found) warLeave.lastSeen = now.toISOString();
    warLeave.lastCheckedAt = now.toISOString();
    return warLeave;
}

// ==========================================
// 💬 APPROVER PROMPT
// ==========================================

/**
 * Channel where approvers answer war-leave requests: the same approvals channel
 * used for registrations (`db.config.adminChannelId`, set with
 * `!setadminchannel`), then the in-memory value set at boot.
 */
export async function resolveWarLeaveChannel(client, db) {
    const channelId = db?.config?.adminChannelId || adminChannelId;
    if (!channelId) return null;
    return client.channels.fetch(channelId).catch(() => null);
}

function buildWarLeaveEmbed(userId, userData, { location, change, review = false, ranking = null, hasRole = null, forumChecked = true } = {}) {
    const lines = [
        `<@${userId}> — **${userData.nickname}**`,
        ''
    ];

    // "With or without the role" — the approver must know whether access is
    // still granted while they decide.
    if (hasRole === true) lines.push('🎖️ **Member role:** ✅ has it');
    else if (hasRole === false) lines.push('🎖️ **Member role:** ❌ not assigned');

    // This branch tracks every server of the game, so show where the character
    // is listed, not only that it is outside the allied clans.
    if (ranking?.found) {
        lines.push(
            `📊 **Ranking (all servers):** **${ranking.clanName || 'no clan'}** on **${ranking.serverName || 'unknown server'}**`
            + (ranking.inAlliedClan ? ' — ✅ allied clan' : ' — ❌ not an allied clan')
        );
    } else {
        lines.push('📊 **Ranking (all servers):** not found in any server ranking');
    }

    if (forumChecked) {
        lines.push(`🌐 **Forum search:** ${locationLabel(location)}`);
    }

    if (change) {
        lines.push('', `🔄 **Change since the last check:**`, change);
    }
    if (review) {
        lines.push('', '🔁 **The review window for the previous approval has ended.** Confirm that this member still needs the role?');
    } else {
        lines.push('', 'Should this member keep the member role while they are away?');
    }

    return new EmbedBuilder()
        .setTitle(review
            ? '🛡️ War leave review — approver confirmation needed'
            : change
                ? '🛡️ War leave — clan/server changed outside the allied clans'
                : '🛡️ War leave — member outside the allied clans')
        .setColor(review ? '#5865f2' : '#f0b400')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Approvers only · Keep role keeps access while they fight wars outside the allied clans' })
        .setTimestamp();
}

function buildWarLeaveButtons(userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${WARLEAVE_KEEP_PREFIX}${userId}`)
            .setLabel('Keep role')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${WARLEAVE_REMOVE_PREFIX}${userId}`)
            .setLabel('Remove role')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
    );
}

/**
 * Post the approver prompt and remember where it was posted.
 * @returns {Promise<boolean>} true when the message was sent
 */
export async function sendWarLeaveRequest(client, db, userId, userData, { location, change, review = false, ranking = null, hasRole = null, forumChecked = true, logEvent } = {}) {
    const channel = await resolveWarLeaveChannel(client, db);
    if (!channel) {
        logEvent?.(`⚠️ [War Leave] No approvals channel available to ask about ${userData.nickname} (${userId}).`);
        return false;
    }

    const message = await channel.send({
        content: '🛡️ A member left the allied clans — an approver must decide.',
        embeds: [buildWarLeaveEmbed(userId, userData, { location, change, review, ranking, hasRole, forumChecked })],
        components: [buildWarLeaveButtons(userId)],
        allowedMentions: { parse: [] }
    }).catch(err => {
        logEvent?.(`❌ [War Leave] Failed to send the approver prompt for ${userData.nickname}: ${err.message}`);
        return null;
    });
    if (!message) return false;

    const warLeave = userData.warLeave || createWarLeave(userData, location);
    warLeave.status = 'pending';
    warLeave.lastAskedAt = new Date().toISOString();
    if (review) warLeave.lastReviewAt = warLeave.lastAskedAt;
    warLeave.channelId = channel.id;
    warLeave.messageId = message.id;

    logEvent?.(review
        ? `🔁 [War Leave] Review due — asked approvers to confirm ${userData.nickname} (${userId}) — ${locationLabel(location)}`
        : `🛡️ [War Leave] Asked approvers about ${userData.nickname} (${userId}) — ${locationLabel(location)}`);
    return true;
}

/**
 * First detection: a registered member is outside the allied clans.
 *
 * The location comes from the ranking of ANY server when the name is listed
 * there (this branch tracks every server of the game) and from the forum
 * ranking when it is not, so approvers always get the full picture: role state,
 * clan and server. The caller keeps the role unless an approver refuses.
 *
 * @param {{ranking?: object|null, hasRole?: boolean|null}} [options]
 * @returns {Promise<{location: object, asked: boolean, protected: boolean, warLeave: object|null}>}
 */
export async function openWarLeave(client, db, userId, userData, logEvent, { ranking = null, hasRole = null } = {}) {
    let location;
    let forumChecked = false;

    if (ranking?.found) {
        // Already located in the ranking of some server — no forum request needed.
        location = {
            found: true,
            clanName: ranking.clanName || null,
            serverName: ranking.serverName || null,
            inAlliedClan: !!ranking.inAlliedClan,
            forumOk: true
        };
    } else {
        location = await detectMemberLocation(userData.nickname, db);
        forumChecked = true;

        // Forum unreachable — never remove a role without information. Keep it and
        // ask again on the next sync.
        if (!location.forumOk) {
            logEvent(`⚠️ [War Leave] Forum lookup failed for ${userData.nickname} (${userId}) — role kept until the next sync`);
            return { location, asked: false, protected: true, warLeave: null };
        }

        // No exact hit anywhere: the character is not listed in any clan/server,
        // so there is nothing to ask about — the normal validation decides.
        if (!location.found) {
            logEvent(`🔎 [War Leave] ${userData.nickname} (${userId}) has no exact match on the forum ranking — no approver prompt`);
            return { location, asked: false, protected: false, warLeave: null };
        }
    }

    const warLeave = createWarLeave(userData, location);
    const asked = await sendWarLeaveRequest(client, db, userId, userData, {
        location,
        change: null,
        ranking,
        hasRole,
        forumChecked,
        logEvent
    });
    return { location, asked, protected: true, warLeave };
}

/**
 * Re-check an active war leave: refresh the forum location and ask again when
 * the clan or server changed, or when the review window (30 days by default)
 * ended after a "Keep role".
 */
export async function trackWarLeaveMember(client, db, userId, userData, logEvent, { ranking = null, hasRole = null } = {}) {
    const warLeave = userData.warLeave;
    if (!warLeave || !ACTIVE_STATUSES.has(warLeave.status)) return false;

    let location;
    let forumChecked = false;

    if (ranking?.found && !ranking.inAlliedClan) {
        // Listed on a server ranking — the cache is cheaper and more precise
        // than a forum request, and it is what the approvers must see.
        location = {
            found: true,
            clanName: ranking.clanName || null,
            serverName: ranking.serverName || null,
            inAlliedClan: false,
            forumOk: true
        };
    } else {
        location = await detectMemberLocation(userData.nickname, db, { clanName: warLeave.lastClan });
        forumChecked = true;

        // Forum unreachable: keep the last known location and retry on the next sync.
        if (!location.forumOk) {
            warLeave.lastCheckedAt = new Date().toISOString();
            logEvent?.(`⚠️ [War Leave] Forum lookup failed for ${userData.nickname} — keeping the last known location`);
            return false;
        }
    }

    if (shouldAskElders(warLeave, location) || isWarLeaveReviewDue(warLeave, db)) {
        const previous = { clanName: warLeave.lastClan, serverName: warLeave.lastServer };
        const change = buildChange(previous, location);
        const review = !change && isWarLeaveReviewDue(warLeave, db);
        rememberLocation(userData, location);
        await sendWarLeaveRequest(client, db, userId, userData, {
            location,
            change,
            review,
            ranking,
            hasRole,
            forumChecked,
            logEvent
        });
        return false;
    }

    rememberLocation(userData, location);
    return false;
}

// ==========================================
// 🖱️ APPROVER DECISION (buttons)
// ==========================================

/** True when the interaction is a war-leave keep/remove button. */
export function isWarLeaveInteraction(interaction) {
    if (!interaction?.isButton?.()) return false;
    return interaction.customId.startsWith(WARLEAVE_KEEP_PREFIX) ||
        interaction.customId.startsWith(WARLEAVE_REMOVE_PREFIX);
}

function canDecideWarLeave(member) {
    if (!member) return false;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    const roles = member.roles?.cache;
    if (!roles) return false;
    return roles.some(r => APPROVER_ROLE_IDS.includes(r.id));
}

async function removeMemberRole(member) {
    if (!member?.roles?.cache?.has(MEMBER_ROLE_ID)) return false;
    await member.roles.remove(MEMBER_ROLE_ID).catch(() => {});
    return true;
}

/**
 * Handle [Keep role] / [Remove role]. Only approvers (and admins) may decide.
 */
export async function handleWarLeaveDecision(interaction, db, saveLocalStorage, logEvent) {
    const keep = interaction.customId.startsWith(WARLEAVE_KEEP_PREFIX);
    const userId = interaction.customId.slice((keep ? WARLEAVE_KEEP_PREFIX : WARLEAVE_REMOVE_PREFIX).length);

    if (!canDecideWarLeave(interaction.member)) {
        return interaction.reply({
            content: '❌ Only an approver can decide whether a member keeps the role.',
            flags: 64
        }).catch(() => {});
    }

    const userData = db?.users?.[userId];
    const warLeave = userData?.warLeave;
    if (!userData || !warLeave) {
        return interaction.update({
            content: '⌛ This war-leave request is no longer active.',
            embeds: [],
            components: []
        }).catch(() => {});
    }

    if (!await deferUpdateSafe(interaction)) return;

    if (keep) {
        const decidedAt = new Date().toISOString();
        warLeave.status = 'approved';
        warLeave.decidedBy = interaction.user.id;
        warLeave.decidedAt = decidedAt;
        // Restart the review window from this confirmation.
        warLeave.lastReviewAt = decidedAt;

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.add(MEMBER_ROLE_ID).catch(() => {});

        logEvent?.(`✅ [War Leave] ${interaction.user.tag} kept the role for ${userData.nickname} (${userId}) — ${recordLabel(warLeave)}`);
    } else {
        warLeave.status = 'denied';
        warLeave.decidedBy = interaction.user.id;
        warLeave.decidedAt = new Date().toISOString();

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member) await removeMemberRole(member);

        for (const pilotId of userData.pilotIds || []) {
            const pilotMember = await interaction.guild.members.fetch(pilotId).catch(() => null);
            if (pilotMember) await removeMemberRole(pilotMember);
        }

        logEvent?.(`❌ [War Leave] ${interaction.user.tag} removed the role from ${userData.nickname} (${userId}) — war leave refused.`);
    }

    saveLocalStorage?.();

    const decidedLabel = keep
        ? '✅ **Role kept** — this member keeps access while away from the allied clans.'
        : '❌ **Role removed** — this member no longer has the member role.';
    const reviewLine = keep && getWarLeaveReviewDays(db) > 0
        ? `\n🔁 **Review:** in ${getWarLeaveReviewDays(db)} day${getWarLeaveReviewDays(db) === 1 ? '' : 's'}`
        : '';
    const embed = new EmbedBuilder()
        .setTitle(keep ? '🛡️ War leave approved' : '🛡️ War leave refused')
        .setColor(keep ? '#57f287' : '#ed4245')
        .setDescription(
            `${decidedLabel}\n\n` +
            `👤 <@${userId}> — **${userData.nickname}**\n` +
            `🌐 **Forum search:** ${recordLabel(warLeave)}\n` +
            `🛡️ **Decided by:** <@${interaction.user.id}>${reviewLine}`
        )
        .setTimestamp();

    return interaction.editReply({ content: '', embeds: [embed], components: [] }).catch(() => {});
}
