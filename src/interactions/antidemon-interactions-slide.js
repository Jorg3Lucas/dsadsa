// ==========================================
// 👹 ANTIDEMON — Slide & Ticket Handlers
// Extracted from antidemon-interactions.js
// ==========================================

import { getMsg, getArray } from "../core/lang.js";
import { db, antiDemonSelectionCache } from "../core/state.js";
import {
    hasActiveClaim,
    hasActiveQueue,
    checkPunishment,
    buildActiveClaimMessage,
    getAntidemonRoomKeys
} from "../handlers/claim-core.js";
import {
    ActionRowBuilder as t,
    StringSelectMenuBuilder as i,
    ButtonBuilder as n,
    ButtonStyle as a
} from "discord.js";
import {
    getLocalTime,
    getFormattedTime12h,
    parseStringToDate
} from "../core/time-utils.js";
import { STATUS_AVAILABLE, STATUS_OPEN } from "../core/constants.js";
import { noop } from "../core/config.js";

/** Handle antidemon room selection slide menu. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @returns {Promise<boolean>} */
export async function handleAntiSlide(interaction, uid) {
    const pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);

    const pKey = interaction.customId.replace("antislide-", ""),
        targetFloor = db[pKey],
        configSelected = interaction.values[0];

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {
        const hasPriority = getAntidemonRoomKeys(pKey).some(rm => targetFloor[rm] && targetFloor[rm].nextId === uid);
        if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);
    }

    antiDemonSelectionCache[uid] = { panelId: pKey, roomConfig: configSelected };

    return await interaction.update({
        content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
        components: [new t().addComponents(
            new i()
                .setCustomId(`antiticket-${pKey}`)
                .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
                .addOptions(getArray("tickets").map(e => ({ label: e.label, value: e.value, emoji: "🎫" })))
        )],
        flags: 64
    }).catch(noop);
}

/** Handle antidemon ticket (time selection) after room is chosen. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @returns {Promise<boolean>} */
export async function handleAntiTicket(interaction, uid, uName) {
    const pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);

    const pKey = interaction.customId.replace("antiticket-", ""),
        targetFloor = db[pKey],
        cacheObj = antiDemonSelectionCache[uid];

    if (!cacheObj || cacheObj.panelId !== pKey) {
        return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);
    }

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {
        const hasPriority = getAntidemonRoomKeys(pKey).some(rm => targetFloor[rm] && targetFloor[rm].nextId === uid);
        if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);
    }

    const configSelected = cacheObj.roomConfig;
    const calcMinutes = 30 * parseInt(interaction.values[0]);
    const startTime = getLocalTime();
    const endTime = new Date(startTime.getTime() + 6e4 * calcMinutes);
    const rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;
    let roomsToClaim;

    const roomKeys = getAntidemonRoomKeys(pKey);
    if (roomKeys.length > 3) {
        roomsToClaim = configSelected.includes("+") ? configSelected.split("+") : [configSelected];
    } else if ("mid-left" === configSelected) roomsToClaim = ["left", "mid"];
    else if ("mid-right" === configSelected) roomsToClaim = ["mid", "right"];
    else roomsToClaim = [configSelected];

    // Check priority reservation for each room
    for (const roomKey of roomsToClaim) {
        if (targetFloor[roomKey].nextId && targetFloor[roomKey].nextId !== uid) {
            let timeRemainingStr = "";
            if (targetFloor[roomKey].endLimit) {
                const limitTime = parseStringToDate(targetFloor[roomKey].endLimit);
                if (limitTime) {
                    const diffMins = Math.ceil((limitTime.getTime() - getLocalTime().getTime()) / 6e4);
                    if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
                }
            }
            if (timeRemainingStr) {
                delete antiDemonSelectionCache[uid];
                return await interaction.update({
                    content: getMsg("cooldowns.floorReservedNotice", { userName: targetFloor[roomKey].nextName, timeRemaining: timeRemainingStr }),
                    components: [], flags: 64
                }).catch(noop);
            }
            targetFloor[roomKey].nextId = null;
            targetFloor[roomKey].nextName = null;
            targetFloor[roomKey].endLimit = null;
            targetFloor[roomKey].formattedTimeNext = "";
            if (STATUS_OPEN === targetFloor[roomKey].status) targetFloor[roomKey].status = STATUS_AVAILABLE;
        }
    }

    // RACE CONDITION GUARD
    for (const roomKey of roomsToClaim) {
        if (targetFloor[roomKey].ownerId) {
            delete antiDemonSelectionCache[uid];
            return await interaction.update({
                content: getMsg("rooms.slotAlreadyClaimed", { room: roomKey.toUpperCase(), ownerName: targetFloor[roomKey].ownerName || getMsg("render.unknownUser") }),
                components: [], flags: 64
            }).catch(noop);
        }
    }

    // Store claim data in cache for the password prompt
    antiDemonSelectionCache[uid] = {
        ...cacheObj,
        calcMinutes,
        startTime,
        endTime,
        rangeStr,
        roomsToClaim,
        uName
    };

    return await interaction.update({
        content: `🎮 **Did you create a private party (PT)?**\n\nLeaving the password helps other members find the room easily!`,
        components: [
            new t().addComponents(
                new n().setCustomId(`antipwdask-yes-${pKey}`).setLabel("✅ Yes, I have a password").setStyle(a.Success),
                new n().setCustomId(`antipwdask-no-${pKey}`).setLabel("❌ No, claim without password").setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(noop);
}
