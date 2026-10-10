// ==========================================
// 📋 FLOOR — General Claim / Next / Cancel
// Extracted from floor-interactions.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    checkPunishment,
    hasActiveClaim,
    hasActiveQueue,
    applyFiveMinCooldown,
    removeUserFromQueue,
    freeFloorAndActivateNextGracePeriod,
    buildActiveClaimMessage
} from "../handlers/claim-core.js";
import { getFormattedTime12h, getLocalTime, parseStringToDate, isClaimWindowOpen, calculateNextOpening, getBrazilDailyCycleKey } from "../core/time-utils.js";
import { noop } from "../core/config.js";

// ==========================================
// ❌ FLOOR-LEVEL CANCEL (normal/peak/fixed)
// ==========================================

/** Cancel user's claim/queue for a normal/peak/fixed floor panel. Owner cancels with cooldown; mods can force-cancel; queue members can leave the queue. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleFloorCancel(interaction, uid, uName, targetObj, panelKey) {
    const isMod = interaction.member.permissions.has("ManageMessages");
    const isOwner = targetObj.ownerId === uid;

    let inQueue = false;
    let pointer = targetObj.next;
    for (; pointer;) {
        if (pointer.userId === uid) { inQueue = true; break; }
        pointer = pointer.nextQueue;
    }

    if (isOwner) {
        pushToDailyLogs("CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.voluntaryLeave"));
        notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.voluntaryLeave") }));
        freeFloorAndActivateNextGracePeriod(targetObj);
        if (!isMod) applyFiveMinCooldown(uid);
        refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("cooldowns.canceledClaimFeedback"), flags: 64 }).catch(noop);
    }

    if (isMod && targetObj.ownerId) {
        pushToDailyLogs("CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.staffCancel"));
        notifyUserDM(targetObj.ownerId, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.staffCancel") }));
        freeFloorAndActivateNextGracePeriod(targetObj);
        refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("rooms.floorReleasedSuccess"), flags: 64 }).catch(noop);
    }

    if (inQueue) {
        pushToDailyLogs("CANCEL", uName, targetObj.title, getMsg("logs.queueLeave"));
        notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.queueLeave") }));
        removeUserFromQueue(targetObj, uid);
        saveLocalStorage();
        refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("rooms.removedFromQueueFeedback"), flags: 64 }).catch(noop);
    }

    return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(noop);
}

// ==========================================
// 🔥 FIXED TYPE CLAIM (Fury/Frenzy)
// ==========================================

/** Claim a fixed-type event (Fury/Frenzy/Random Event). Calculates the 1-hour window from the current/next schedule slot, honoring the configurable pre-claim window and, when `claimOncePerDay` is set, the 1-per-day limit. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleFixedClaim(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}

    // ── One claim per day (resets 13:00 Brazil time) ──
    if (targetObj.claimOncePerDay) {
        const cycle = getBrazilDailyCycleKey(13);
        if (!db._dailyClaims) db._dailyClaims = {};
        for (const k in db._dailyClaims) {
            if (db._dailyClaims[k] !== cycle) delete db._dailyClaims[k];
        }
        if (db._dailyClaims[`${panelKey}:${uid}`] === cycle) {
            return await interaction.reply({ content: getMsg("rooms.randomEventDailyLimit"), flags: 64 }).catch(noop);
        }
    }

    const now = getLocalTime();
    const minuteOffset = targetObj.scheduleMinutes || 0;
    const preMinutes = targetObj.claimBeforeMinutes || 0;
    let eventStart;

    if (isClaimWindowOpen(targetObj.schedules, minuteOffset, preMinutes)) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        let foundHour = null;
        for (const h of targetObj.schedules) {
            const startMin = h * 60 + minuteOffset;
            const endMin = startMin + 60;
            if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
        }
        if (foundHour !== null) {
            eventStart = new Date(now.getTime());
            eventStart.setHours(foundHour, minuteOffset, 0, 0);
        } else {
            eventStart = calculateNextOpening(targetObj.schedules, minuteOffset);
        }
    } else {
        eventStart = calculateNextOpening(targetObj.schedules, minuteOffset);
        // Claims open preMinutes before the event starts
        const claimOpenAt = eventStart.getTime() - preMinutes * 6e4;
        if (now.getTime() < claimOpenAt) {
            const diffMins = Math.ceil((claimOpenAt - now.getTime()) / 6e4);
            return await interaction.reply({
                content: getMsg("rooms.eventOpensIn", { minutes: diffMins }),
                flags: 64
            }).catch(noop);
        }
    }

    if (targetObj.ownerId) {
        return await interaction.reply({
            content: getMsg("system.accessDenied", { ownerName: targetObj.ownerName || getMsg("render.unknownUser") }),
            flags: 64
        }).catch(noop);
    }

    const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
    const windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;

    targetObj.ownerId = uid;
    targetObj.ownerName = uName;
    targetObj.timeWindow = windowStr;
    targetObj._claimTimestamp = now.getTime();

    if (targetObj.claimOncePerDay) {
        if (!db._dailyClaims) db._dailyClaims = {};
        db._dailyClaims[`${panelKey}:${uid}`] = getBrazilDailyCycleKey(13);
    }

    pushToDailyLogs("CLAIM_START", uName, targetObj.title, `${getMsg("render.windowPrefix")}: ${targetObj.timeWindow}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: targetObj.title, window: windowStr }));

    saveLocalStorage();
    refreshVisualPanel(panelKey);
    return await interaction.reply({
        content: getMsg("rooms.eventClaimedFixed", { title: targetObj.title }),
        flags: 64
    }).catch(noop);
}

// ==========================================
// 📋 GENERAL CLAIM (normal/peak floors)
// ==========================================

/** Claim a normal/peak floor. Sets a 30-minute claim window. Verifies no active queue reservation. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleGeneralClaim(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}

    if (targetObj.next && targetObj.next.userId !== uid) {
        let timeRemainingStr = "";
        if (targetObj.next.endLimit) {
            const limitTime = parseStringToDate(targetObj.next.endLimit);
            if (limitTime) {
                const diffMs = limitTime.getTime() - getLocalTime().getTime();
                const diffMins = Math.ceil(diffMs / 6e4);
                if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
            }
        }
        return await interaction.reply({
            content: getMsg("cooldowns.floorReservedNotice", { userName: targetObj.next.userName, timeRemaining: timeRemainingStr }),
            flags: 64
        }).catch(noop);
    }

    if (targetObj.ownerId) {
        return await interaction.reply({
            content: getMsg("system.accessDenied", { ownerName: targetObj.ownerName || getMsg("render.unknownUser") }),
            flags: 64
        }).catch(noop);
    }

    const start = getLocalTime();
    const end = new Date(start.getTime() + 18e5);
    const windowStr = `${getFormattedTime12h(start)} ~ ${getFormattedTime12h(end)}`;

    targetObj.ownerId = uid;
    targetObj.ownerName = uName;
    targetObj.timeWindow = windowStr;
    targetObj._claimTimestamp = start.getTime();

    pushToDailyLogs("CLAIM_START", uName, targetObj.title, `${getMsg("render.windowPrefix")}: ${targetObj.timeWindow}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: targetObj.title, window: windowStr }));

    if (targetObj.next && targetObj.next.userId === uid) {
        targetObj.next = targetObj.next.nextQueue || null;
    }

    saveLocalStorage();
    refreshVisualPanel(panelKey);
    return await interaction.reply({
        content: getMsg("rooms.floorClaimSuccess"),
        flags: 64
    }).catch(noop);
}

// ==========================================
// ⏭️ GENERAL NEXT QUEUE (normal/peak)
// ==========================================

/** Join the queue for a normal/peak floor. Peak floors are excluded from queuing. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleGeneralNext(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if ("peak" === targetObj.type) {return await interaction.reply({ content: getMsg("rooms.alreadyOwner"), flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}
    if (targetObj.ownerId === uid) {return await interaction.reply({ content: getMsg("rooms.alreadyOwner"), flags: 64 }).catch(noop);}

    let pointer = targetObj.next;
    let inQueue = false;
    for (; pointer;) {
        if (pointer.userId === uid) { inQueue = true; break; }
        pointer = pointer.nextQueue;
    }
    if (inQueue) {return await interaction.reply({ content: getMsg("rooms.alreadyInQueue"), flags: 64 }).catch(noop);}

    const nowTime = getLocalTime();
    let expectedTime = nowTime;
    if (targetObj.timeWindow) {
        const endOfClaim = parseStringToDate(targetObj.timeWindow.split(" ~ ")[1]);
        if (endOfClaim) expectedTime = endOfClaim;
    }
    const node = {
        userId: uid,
        userName: uName,
        formattedTime: getFormattedTime12h(expectedTime),
        endLimit: null,
        nextQueue: null
    };

    if (targetObj.next) {
        let lastNode = targetObj.next;
        for (; lastNode.nextQueue;) lastNode = lastNode.nextQueue;
        lastNode.nextQueue = node;
    } else {
        targetObj.next = node;
    }

    pushToDailyLogs("QUEUE_JOIN", uName, targetObj.title, getMsg("render.joinedNextLine"));
    notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: targetObj.title }));

    saveLocalStorage();
    refreshVisualPanel(panelKey);
    return await interaction.reply({
        content: getMsg("rooms.queueJoinedSuccess"),
        flags: 64
    }).catch(noop);
}
