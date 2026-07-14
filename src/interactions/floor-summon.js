// ==========================================
// 🌀 FLOOR — Summon Handlers
// Extracted from floor-interactions.js
// ==========================================

import {
    ActionRowBuilder as t,
    StringSelectMenuBuilder as i
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    checkPunishment,
    hasActiveClaim,
    hasActiveQueue,
    applyFiveMinCooldown,
    freeAntidemonRoom,
    getSummonRoomKeys,
    buildActiveClaimMessage
} from "../handlers/claim-core.js";
import { STATUS_CLAIMED, STATUS_OPEN, STATUS_AVAILABLE } from "../core/constants.js";
import { noop } from "../core/config.js";

// ==========================================
// 🌀 SUMMON CLAIM (via select menu)
// ==========================================

/** Show summon room selection menu for claiming. Defaults to available locations; shows priority queue slots first. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleSummonClaim(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    const summonProps = getSummonRoomKeys(panelKey);
    if (hasActiveQueue(uid)) {
        const hasPriority = summonProps.some(loc => targetObj[loc].nextId === uid);
        if (!hasPriority) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}
    }

    const priorityLocs = summonProps.filter(loc => targetObj[loc].nextId === uid && targetObj[loc].status !== STATUS_CLAIMED);
    const freeLocs = summonProps.filter(loc => targetObj[loc].status !== STATUS_CLAIMED && !targetObj[loc].nextId);
    const showLocs = priorityLocs.length > 0 ? priorityLocs : freeLocs;

    const locOptions = showLocs.map(loc => ({
        label: targetObj[loc].name,
        value: loc,
        emoji: "🌀"
    }));

    if (locOptions.length === 0) {return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(noop);}
    return await interaction.reply({
        content: `🌀 **${getMsg("rooms.summonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`summonslide-${panelKey}`).setPlaceholder(getMsg("rooms.summonSelectPlaceholder")).addOptions(locOptions)
        )],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 🌀 SUMMON NEXT QUEUE (via select menu)
// ==========================================

/** Show summon location queue selection menu. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleSummonNext(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}

    const summonProps = getSummonRoomKeys(panelKey);
    const queueOpts = summonProps.filter(loc => targetObj[loc].status === STATUS_CLAIMED && !targetObj[loc].nextId).map(loc => ({
        label: targetObj[loc].name,
        value: loc,
        emoji: "🌀"
    }));

    if (queueOpts.length === 0) {return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(noop);}
    return await interaction.reply({
        content: `🌀 **${getMsg("rooms.summonMenuSelectNext")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`summonnextside-${panelKey}`).setPlaceholder(getMsg("rooms.summonSelectPlaceholder")).addOptions(queueOpts)
        )],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 🌀 SUMMON CANCEL
// ==========================================

/** Cancel user's claim or queue for a summon location. Applies 5min cooldown for non-mod users. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleSummonCancel(interaction, uid, uName, targetObj, panelKey) {
    const isMod = interaction.member.permissions.has("ManageMessages");
    const summonProps = getSummonRoomKeys(panelKey);
    const isOwner = summonProps.some(p => targetObj[p].ownerId === uid);
    const isInQueue = summonProps.some(p => targetObj[p].nextId === uid);

    if (isOwner || isInQueue || isMod) {
        let penalized = false;
        let anyAction = false;

        summonProps.forEach(loc => {
            if (targetObj[loc].ownerId === uid) {
                anyAction = true;
                const currentLoggedName = targetObj[loc].ownerName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${targetObj[loc].name}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
                notifyUserDM(targetObj[loc].ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${targetObj[loc].name}`,
                    reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel")
                }));
                freeAntidemonRoom(targetObj, loc);
                if (!isMod && !penalized) {
                    applyFiveMinCooldown(uid);
                    penalized = true;
                }
            }
            if (targetObj[loc].nextId === uid) {
                anyAction = true;
                const currentLoggedName = targetObj[loc].nextName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${targetObj[loc].name} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
                notifyUserDM(targetObj[loc].nextId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${targetObj[loc].name} (Queue)`,
                    reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel")
                }));
                targetObj[loc].nextId = null;
                targetObj[loc].nextName = null;
                targetObj[loc].endLimit = null;
                targetObj[loc].formattedTimeNext = "";
                if (STATUS_OPEN === targetObj[loc].status) targetObj[loc].status = STATUS_AVAILABLE;
            }
        });

        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({
            content: anyAction
                ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback"))
                : getMsg("rooms.noActiveClaimsFeedback"),
            flags: 64
        }).catch(noop);
    }
    return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(noop);
}
