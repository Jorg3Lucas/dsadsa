// ==========================================
// 🎯 FLOOR — Event Group Claim/Queue/Next
// Extracted from floor-eventgroup.js
// ==========================================

import { StringSelectMenuBuilder as i, ActionRowBuilder as t } from "discord.js";
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
import { getLocalTime, getFormattedTime12h, parseStringToDate } from "../core/time-utils.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED } from "../core/constants.js";
import { noop } from "../core/config.js";

/** Show event selection menu for claiming in an event_group panel. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<void>} */
export async function handleEventGroupClaim(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }

    const eventKeys = getEventGroupKeys(targetObj);

    if (hasActiveQueue(uid)) {
        const hasPriority = eventKeys.some(ev => targetObj[ev] && targetObj[ev].nextId === uid);
        if (!hasPriority) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}
    }
    const options = [];

    for (const ev of eventKeys) {
        const evData = targetObj[ev];
        if (evData.ownerId) continue;

        if (evData.type === "schedule") {
            if (!evData.status || evData.status === STATUS_AVAILABLE) {
                options.push({ label: `🟥 ${evData.name}`, value: ev, emoji: "🟥" });
            }
        } else if (evData.type === "fixed") {
            if (ev !== "randomevent") continue;
            options.push({ label: evData.name, value: ev, emoji: "🔴" });
        } else if (evData.type === "summon") {
            const hasPriority = evData.nextId === uid;
            if (!evData.ownerId && (hasPriority || (!evData.nextId && evData.status !== STATUS_CLAIMED))) {
                options.push({ label: evData.name, value: ev, emoji: "⭐" });
            }
        }
    }

    if (options.length === 0) {return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(noop);}

    return await interaction.reply({
        content: `🎯 **${getMsg("rooms.summonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`egslide-${panelKey}`).setPlaceholder("Choose an event...").addOptions(options)
        )],
        flags: 64
    }).catch(noop);
}

/** Show summon-type event queue selection menu. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<void>} */
export async function handleEventGroupNext(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}

    const eventKeys = getEventGroupKeys(targetObj);
    const summonEvents = eventKeys.filter(ev => targetObj[ev].type === "summon" && targetObj[ev].ownerId && !targetObj[ev].nextId);

    const queueOpts = summonEvents.map(ev => ({
        label: targetObj[ev].name,
        value: ev,
        emoji: "⭐"
    }));

    if (queueOpts.length === 0) {return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(noop);}

    return await interaction.reply({
        content: `⭐ **${getMsg("rooms.summonMenuSelectNext")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`egnextside-${panelKey}`).setPlaceholder("Choose an event...").addOptions(queueOpts)
        )],
        flags: 64
    }).catch(noop);
}

/** Handle queue selection from next-slide menu for summon-type events. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @returns {Promise<void>} */
export async function handleEGNextSide(interaction, uid, uName) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);}

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(noop);}

    const pKey = interaction.customId.replace("egnextside-", ""),
        targetFloor = db[pKey],
        selectedEvent = interaction.values[0];

    if (!targetFloor || !targetFloor[selectedEvent]) {return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);}

    const evData = targetFloor[selectedEvent];
    if (evData.nextId) {return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [], flags: 64
    }).catch(noop);}

    if (!evData.ownerId) {return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [], flags: 64
    }).catch(noop);}

    let baseTime = getLocalTime();
    if (evData.timeWindow) {
        const calcLimit = parseStringToDate(evData.timeWindow.split(" ~ ")[1]);
        if (calcLimit) baseTime = calcLimit;
    }

    evData.nextId = uid;
    evData.nextName = uName;
    evData.formattedTimeNext = getFormattedTime12h(baseTime);
    evData.endLimit = null;

    pushToDailyLogs("QUEUE_JOIN", uName, `${targetFloor.title} - ${evData.name}`, getMsg("render.joinedAsNext"));
    notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: `${targetFloor.title} - ${evData.name}` }));

    saveLocalStorage();
    await refreshVisualPanel(pKey);
    return await interaction.update({
        content: getMsg("rooms.summonQueueSuccessEphemeral"),
        components: [], flags: 64
    }).catch(noop);
}
