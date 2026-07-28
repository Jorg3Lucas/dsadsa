// ==========================================
// 🌀 SUMMON INTERACTION HANDLERS
// summonslide-, summonticket-, summonnextside-
// ==========================================

import { getMsg, getArray } from "../core/lang.js";
import { db, summonSelectionCache, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    hasActiveClaim,
    hasActiveQueue,
    checkPunishment,
    buildActiveClaimMessage,
    getSummonRoomKeys
} from "../handlers/claim-core.js";
import {
    ActionRowBuilder as t,
    StringSelectMenuBuilder as i
} from "discord.js";
import {
    getLocalTime,
    getFormattedTime12h,
    parseStringToDate
} from "../core/time-utils.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN } from "../core/constants.js";
import { noop } from "../core/config.js";


// Dynamic helper — uses panel key to determine which locations belong to this panel

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

/** Check if an interaction customId matches summon slide/ticket/next handlers. @param {import('discord.js').Interaction} interaction @returns {boolean} */
export function canHandleSummonInteraction(interaction) {
    const cid = interaction.customId;
    return cid.startsWith("summonslide-") ||
        cid.startsWith("summonticket-") ||
        cid.startsWith("summonnextside-");
}

/** Route a summon interaction to the appropriate handler (slide, ticket, next side). @param {import('discord.js').Interaction} interaction @param {string} uid @param {string} uName @returns {Promise<boolean>} */
export async function handleSummonInteraction(interaction, uid, uName) {
    const cid = interaction.customId;

    if (cid.startsWith("summonslide-")) {
        return handleSummonSlide(interaction, uid);
    }
    if (cid.startsWith("summonticket-")) {
        return handleSummonTicket(interaction, uid, uName);
    }
    if (cid.startsWith("summonnextside-")) {
        return handleSummonNextSide(interaction, uid, uName);
    }

    return false;
}

// ==========================================
// 🎯 SUMMON SLIDE — Location Selection
// ==========================================

async function handleSummonSlide(interaction, uid) {
    const pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);

    const pKey = interaction.customId.replace("summonslide-", ""),
        targetFloor = db[pKey],
        selectedLoc = interaction.values[0];

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {
        const summonProps = getSummonRoomKeys(pKey);
        const hasPriority = summonProps.some(loc => targetFloor[loc].nextId === uid);
        if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);
    }

    summonSelectionCache[uid] = { panelId: pKey, selectedLoc };

    return await interaction.update({
        content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
        components: [new t().addComponents(
            new i()
                .setCustomId(`summonticket-${pKey}`)
                .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
                .addOptions(getArray("tickets").map(e => ({ label: e.label, value: e.value, emoji: "🎫" })))
        )],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 🎟️ SUMMON TICKET — Time Selection
// ==========================================

async function handleSummonTicket(interaction, uid, uName) {
    const pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);

    const pKey = interaction.customId.replace("summonticket-", ""),
        targetFloor = db[pKey],
        cacheObj = summonSelectionCache[uid];

    if (!cacheObj || cacheObj.panelId !== pKey) {
        return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);
    }

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {
        const summonProps = getSummonRoomKeys(pKey);
        const hasPriority = summonProps.some(loc => targetFloor[loc].nextId === uid);
        if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);
    }

    const selectedLoc = cacheObj.selectedLoc,
        calcMinutes = 30 * parseInt(interaction.values[0]),
        startTime = getLocalTime(),
        endTime = new Date(startTime.getTime() + 6e4 * calcMinutes),
        rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;

    // Check priority reservation
    if (targetFloor[selectedLoc].nextId && targetFloor[selectedLoc].nextId !== uid) {
        let timeRemainingStr = "";
        if (targetFloor[selectedLoc].endLimit) {
            const limitTime = parseStringToDate(targetFloor[selectedLoc].endLimit);
            if (limitTime) {
                const diffMs = limitTime.getTime() - getLocalTime().getTime();
                const diffMins = Math.ceil(diffMs / 6e4);
                if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
            }
        }
        if (timeRemainingStr) {
            delete summonSelectionCache[uid];
            return await interaction.update({
                content: getMsg("cooldowns.floorReservedNotice", { userName: targetFloor[selectedLoc].nextName, timeRemaining: timeRemainingStr }),
                components: [],
                flags: 64
            }).catch(noop);
        }
        // endLimit expired — clear queue
        targetFloor[selectedLoc].nextId = null;
        targetFloor[selectedLoc].nextName = null;
        targetFloor[selectedLoc].endLimit = null;
        targetFloor[selectedLoc].formattedTimeNext = "";
        if (STATUS_OPEN === targetFloor[selectedLoc].status) targetFloor[selectedLoc].status = STATUS_AVAILABLE;
    }

    // RACE CONDITION GUARD: Re-verify location is still available before claiming
    if (targetFloor[selectedLoc].ownerId) {
        delete summonSelectionCache[uid];
        return await interaction.update({
            content: getMsg("rooms.slotAlreadyClaimed", { room: targetFloor[selectedLoc].name, ownerName: targetFloor[selectedLoc].ownerName || getMsg("render.unknownUser") }),
            components: [],
            flags: 64
        }).catch(noop);
    }

    // Clear any existing next/queue for this user
    if (targetFloor[selectedLoc].nextId === uid) {
        targetFloor[selectedLoc].nextId = null;
        targetFloor[selectedLoc].nextName = null;
        targetFloor[selectedLoc].endLimit = null;
        targetFloor[selectedLoc].formattedTimeNext = "";
    }

    targetFloor[selectedLoc].status = STATUS_CLAIMED;
    targetFloor[selectedLoc].ownerId = uid;
    targetFloor[selectedLoc].ownerName = uName;
    targetFloor[selectedLoc].time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
    targetFloor[selectedLoc].timeWindow = rangeStr;

    pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${targetFloor[selectedLoc].name}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} (${targetFloor[selectedLoc].name})`, window: rangeStr }));

    delete summonSelectionCache[uid];
    saveLocalStorage();
    await refreshVisualPanel(pKey);
    return await interaction.update({
        content: getMsg("rooms.summonClaimSuccessEphemeral"),
        components: [],
        flags: 64
    }).catch(noop);
}

// ==========================================
// ⏭️ SUMMON NEXT / QUEUE
// ==========================================

async function handleSummonNextSide(interaction, uid, uName) {
    const pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);

    const pKey = interaction.customId.replace("summonnextside-", ""),
        targetFloor = db[pKey];
    if (!targetFloor) return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);

    const selectedLoc = interaction.values[0];
    if (targetFloor[selectedLoc].nextId) {return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [],
        flags: 64
    }).catch(noop);}

    // Guard: only allow queue for locations that are currently claimed
    if (targetFloor[selectedLoc].status !== STATUS_CLAIMED) {return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [],
        flags: 64
    }).catch(noop);}

    let baseTime = getLocalTime();
    if (targetFloor[selectedLoc].timeWindow) {
        const calcLimit = parseStringToDate(targetFloor[selectedLoc].timeWindow.split(" ~ ")[1]);
        if (calcLimit) baseTime = calcLimit;
    }

    targetFloor[selectedLoc].nextId = uid;
    targetFloor[selectedLoc].nextName = uName;
    targetFloor[selectedLoc].formattedTimeNext = getFormattedTime12h(baseTime);
    targetFloor[selectedLoc].endLimit = null;

    pushToDailyLogs("QUEUE_JOIN", uName, `${targetFloor.title} - ${targetFloor[selectedLoc].name}`, getMsg("render.joinedAsNext"));
    notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: `${targetFloor.title} - ${targetFloor[selectedLoc].name}` }));

    saveLocalStorage();
    await refreshVisualPanel(pKey);
    return await interaction.update({
        content: getMsg("rooms.summonQueueSuccessEphemeral"),
        components: [],
        flags: 64
    }).catch(noop);
}
