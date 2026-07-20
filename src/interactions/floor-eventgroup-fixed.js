// ==========================================
// 🎯 FLOOR — Event Group Fixed Claim
// Direct button handler for Fury/Frenzy/Random Event
// Extracted from floor-eventgroup.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage, isEarlyClaimUser } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    checkPunishment,
    hasActiveClaim,
    buildActiveClaimMessage
} from "../handlers/claim-core.js";
import {
    getFormattedTime12h,
    getLocalTime,
    calculateNextOpening,
    isRoomOpen
} from "../core/time-utils.js";
import { noop } from "../core/config.js";

/** Claim a fixed-type event (Fury/Frenzy/Random Event) via direct button handler. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @returns {Promise<void>} */
export async function handleEGFixClaim(interaction, uid, uName) {
    const [, panelKey, eventName] = interaction.customId.split("-");
    const targetFloor = db[panelKey];
    if (!targetFloor || !targetFloor[eventName]) {return await interaction.reply({ content: getMsg("rooms.antidemonTimeoutCache"), flags: 64 }).catch(noop);}

    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }

    const evData = targetFloor[eventName];
    if (evData.ownerId) {
        return await interaction.reply({
            content: getMsg("rooms.slotAlreadyClaimed", { room: evData.name, ownerName: evData.ownerName || getMsg("render.unknownUser") }),
            flags: 64
        }).catch(noop);
    }

    const now = getLocalTime();
    const minuteOffset = evData.scheduleMinutes || 0;
    let eventStart;
    let claimedHour;

    if (isRoomOpen(evData.schedules, minuteOffset)) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        let foundHour = null;
        for (const h of evData.schedules) {
            const startMin = h * 60 + minuteOffset;
            const endMin = startMin + 60;
            if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
        }
        if (foundHour !== null) {
            eventStart = new Date(now.getTime());
            eventStart.setHours(foundHour, minuteOffset, 0, 0);
            claimedHour = foundHour;
        } else {
            eventStart = calculateNextOpening(evData.schedules, minuteOffset);
            claimedHour = eventStart.getHours();
        }
    } else {
        eventStart = calculateNextOpening(evData.schedules, minuteOffset);
        claimedHour = eventStart.getHours();
        const fiveMinBefore = new Date(eventStart.getTime() - 5 * 60 * 1000);
        // ── Early claim check: only authorized users can claim within the 5-min pre-window ──
        if (now < fiveMinBefore) {
            const diffMs = eventStart.getTime() - now.getTime();
            const diffMins = Math.ceil(diffMs / 6e4);
            return await interaction.reply({
                content: getMsg("rooms.eventOpensIn", { minutes: diffMins }),
                flags: 64
            }).catch(noop);
        }
        // Within 5 min pre-window — only allow if user is authorized for early claim
        if (!isEarlyClaimUser(uid)) {
            return await interaction.reply({
                content: getMsg("rooms.eventEarlyClaimDenied", { time: getFormattedTime12h(eventStart) }),
                flags: 64
            }).catch(noop);
        }
    }

    const hourKey = String(claimedHour);
    if (typeof evData.reservedFor === "string" && evData.reservedFor !== uid) {
        return await interaction.reply({
            content: getMsg("reserve.blockedOther", { event: evData.name, userName: evData.reservedByName || evData.reservedFor }),
            flags: 64
        }).catch(noop);
    }
    if (evData.reservations) {
        if (evData.reservations._all && evData.reservations._all.userId !== uid) {
            return await interaction.reply({
                content: getMsg("reserve.blockedOther", { event: evData.name, userName: evData.reservations._all.userName }),
                flags: 64
            }).catch(noop);
        }
        const slotRes = evData.reservations[hourKey];
        if (slotRes && slotRes.userId !== uid) {
            return await interaction.reply({
                content: getMsg("reserve.blockedSlot", { event: evData.name, userName: slotRes.userName }),
                flags: 64
            }).catch(noop);
        }
    }

    const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
    const windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;

    evData.ownerId = uid;
    evData.ownerName = uName;
    evData.timeWindow = windowStr;
    evData._claimTimestamp = now.getTime();

    pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${evData.name}`, `${getMsg("render.windowPrefix")}: ${windowStr}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} - ${evData.name}`, window: windowStr }));

    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.reply({
        content: getMsg("rooms.eventClaimedFixed", { title: evData.name }),
        flags: 64
    }).catch(noop);
}
