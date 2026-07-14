// ==========================================
// 🎟️ FLOOR — Event Group Ticket Handler
// Summon-type ticket (time selection) handler
// Extracted from floor-eventgroup.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    checkPunishment,
    hasActiveClaim,
    hasActiveQueue,
    getEventGroupKeys,
    buildActiveClaimMessage
} from "../handlers/claim-core.js";
import { getFormattedTime12h, getLocalTime } from "../core/time-utils.js";
import { STATUS_CLAIMED } from "../core/constants.js";
import { noop } from "../core/config.js";
import { egSummonCache } from "./floor-eventgroup-cache.js";

/** Handle ticket (time selection) for summon-type event claim. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @returns {Promise<void>} */
export async function handleEGTicket(interaction, uid, uName) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);}

    const pKey = interaction.customId.replace("egticket-", ""),
        targetFloor = db[pKey],
        cacheEntry = egSummonCache.get(uid);

    if (!cacheEntry || cacheEntry.panelId !== pKey) {
        return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);
    }

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {
        const eventKeys = getEventGroupKeys(targetFloor);
        const hasPriority = eventKeys.some(ev => targetFloor[ev] && targetFloor[ev].nextId === uid);
        if (!hasPriority) {return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);}
    }

    const selectedEvent = cacheEntry.event,
        evData = targetFloor[selectedEvent],
        calcMinutes = 30 * parseInt(interaction.values[0]),
        startTime = getLocalTime(),
        endTime = new Date(startTime.getTime() + 6e4 * calcMinutes),
        rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;

    if (!evData || evData.ownerId) {
        egSummonCache.delete(uid);
        return await interaction.update({
            content: getMsg("rooms.slotAlreadyClaimed", { room: evData?.name || "", ownerName: evData?.ownerName || getMsg("render.unknownUser") }),
            components: [], flags: 64
        }).catch(noop);
    }

    if (evData.nextId === uid) {
        evData.nextId = null;
        evData.nextName = null;
        evData.endLimit = null;
        evData.formattedTimeNext = "";
    }

    evData.status = STATUS_CLAIMED;
    evData.ownerId = uid;
    evData.ownerName = uName;
    evData.time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
    evData.timeWindow = rangeStr;

    pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${evData.name}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} (${evData.name})`, window: rangeStr }));

    egSummonCache.delete(uid);
    saveLocalStorage();
    await refreshVisualPanel(pKey);
    return await interaction.update({
        content: getMsg("rooms.summonClaimSuccessEphemeral"),
        components: [], flags: 64
    }).catch(noop);
}
