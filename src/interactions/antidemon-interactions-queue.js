// ==========================================
// 👹 ANTIDEMON — Queue (Next) Handler
// Extracted from antidemon-interactions.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    hasActiveClaim,
    hasActiveQueue,
    checkPunishment,
    buildActiveClaimMessage,
    getAntidemonRoomKeys
} from "../handlers/claim-core.js";
import {
    getLocalTime,
    getFormattedTime12h,
    parseStringToDate
} from "../core/time-utils.js";
import { STATUS_CLAIMED } from "../core/constants.js";
import { noop } from "../core/config.js";

/** Handle antidemon queue (next) selection. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @returns {Promise<boolean>} */
export async function handleAntiNextSide(interaction, uid, uName) {
    const pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);

    const pKey = interaction.customId.replace("antinextside-", ""),
        targetFloor = db[pKey];
    if (!targetFloor) return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);

    const tryJoinQueue = roomKey => {
        if (!targetFloor[roomKey] || targetFloor[roomKey].nextId) return false;
        if (targetFloor[roomKey].status !== STATUS_CLAIMED) return false;
        let baseTime = getLocalTime();
        if (targetFloor[roomKey].timeWindow) {
            const calcLimit = parseStringToDate(targetFloor[roomKey].timeWindow.split(" ~ ")[1]);
            if (calcLimit) baseTime = calcLimit;
        }
        targetFloor[roomKey].nextId = uid;
        targetFloor[roomKey].nextName = uName;
        targetFloor[roomKey].formattedTimeNext = getFormattedTime12h(baseTime);
        targetFloor[roomKey].endLimit = null;
        return true;
    };

    const choice = interaction.values[0],
        joinedRooms = [];
    const roomKeys = getAntidemonRoomKeys(pKey);

    if (roomKeys.length > 3) {
        const roomsToJoin = choice.includes("+") ? choice.split("+") : [choice];
        roomsToJoin.forEach(rm => {
            if (tryJoinQueue(rm)) joinedRooms.push(rm.toUpperCase());
        });
    } else if ("mid-left" === choice) {
        if (tryJoinQueue("left")) joinedRooms.push("LEFT");
        if (tryJoinQueue("mid")) joinedRooms.push("MID");
    } else if ("mid-right" === choice) {
        if (tryJoinQueue("mid")) joinedRooms.push("MID");
        if (tryJoinQueue("right")) joinedRooms.push("RIGHT");
    } else if (tryJoinQueue(choice)) {
        joinedRooms.push(choice.toUpperCase());
    }

    if (joinedRooms.length > 0) {
        const roomsLabel = joinedRooms.join(" + ");
        pushToDailyLogs("QUEUE_JOIN", uName, `${targetFloor.title} - Room ${roomsLabel}`, getMsg("render.joinedAsNext"));
        notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: `${targetFloor.title} - Room ${roomsLabel}` }));
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: getMsg("rooms.antidemonQueueSuccessEphemeral"),
            components: [], flags: 64
        }).catch(noop);
    }

    return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [], flags: 64
    }).catch(noop);
}
