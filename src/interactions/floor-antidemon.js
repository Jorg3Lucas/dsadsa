// ==========================================
// 👹 FLOOR — Antidemon Handlers
// Extracted from floor-interactions.js
// ==========================================

import {
    ActionRowBuilder as t,
    StringSelectMenuBuilder as i
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    checkPunishment,
    hasActiveClaim,
    hasActiveQueue,
    applyFiveMinCooldown,
    freeAntidemonRoom,
    getAntidemonRoomKeys,
    getAntidemonRoomName,
    buildAntiClaimOptions,
    buildAntiQueueOptions,
    buildActiveClaimMessage
} from "../handlers/claim-core.js";
import { STATUS_OPEN, STATUS_AVAILABLE } from "../core/constants.js";
import { noop } from "../core/config.js";

// ==========================================
// 👹 ANTIDEMON CLAIM (via select menu)
// ==========================================

/** Show antidemon room selection menu for claiming. Shows version picker for MS11/12 (2-level menu). @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleAntiClaim(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {
        const antiRoomKeys = getAntidemonRoomKeys(panelKey);
        const hasPriority = antiRoomKeys.some(rm => targetObj[rm] && targetObj[rm].nextId === uid);
        if (!hasPriority) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}
    }

    const roomKeys = getAntidemonRoomKeys(panelKey);
    if (roomKeys.length > 3) {
        const versionOpts = [];
        const versions = ["v1", "v2", "v3"];
        versions.forEach(v => {
            const roomsInVer = roomKeys.filter(rk => rk.startsWith(v));
            const anyFree = roomsInVer.some(rk => targetObj[rk] && !targetObj[rk].ownerId);
            if (anyFree) {
                const verName = v === "v1" ? "1-1" : v === "v2" ? "1-2" : "1-3";
                versionOpts.push({ label: `🏛️ Version ${verName}`, value: v, emoji: "🏛️" });
            }
        });

        if (versionOpts.length === 0) {return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(noop);}

        return await interaction.reply({
            content: `👹 **Select a version to claim:**`,
            components: [new t().addComponents(
                new i().setCustomId(`antiversion-${panelKey}`).setPlaceholder("Choose a version...").addOptions(versionOpts)
            )],
            flags: 64
        }).catch(noop);
    }

    return await interaction.reply({
        content: `👹 **${getMsg("rooms.antidemonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`antislide-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiClaimOptions(targetObj, uid, panelKey))
        )],
        flags: 64
    }).catch(noop);
}

// ==========================================
// ⏭️ ANTIDEMON NEXT QUEUE (via select menu)
// ==========================================

/** Show antidemon room queue selection menu. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleAntiNext(interaction, uid, uName, targetObj, panelKey) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.reply({ content: pStr, flags: 64 }).catch(noop);}
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(noop);
    }
    if (hasActiveQueue(uid)) {return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(noop);}
    return await interaction.reply({
        content: `⚔️ **${getMsg("rooms.antidemonMenuSelectNext")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`antinextside-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiQueueOptions(targetObj, panelKey))
        )],
        flags: 64
    }).catch(noop);
}

// ==========================================
// 👹 ANTIDEMON CANCEL
// ==========================================

/** Cancel user's antidemon claim or queue across all rooms in the panel. Applies 5min cooldown for non-mod users. @param {import('discord.js').ButtonInteraction} interaction @param {string} uid @param {string} uName @param {object} targetObj @param {string} panelKey @returns {Promise<boolean>} */
export async function handleAntiCancel(interaction, uid, uName, targetObj, panelKey) {
    const isMod = interaction.member.permissions.has("ManageMessages");
    const antiRoomKeys = getAntidemonRoomKeys(panelKey);
    const isOwner = antiRoomKeys.some(rm => targetObj[rm] && targetObj[rm].ownerId === uid);
    const isInQueue = antiRoomKeys.some(rm => targetObj[rm] && targetObj[rm].nextId === uid);

    if (isOwner || isInQueue || isMod) {
        let penalized = false;
        let anyAction = false;

        antiRoomKeys.forEach(rm => {
            if (targetObj[rm].ownerId === uid) {
                anyAction = true;
                const currentLoggedName = targetObj[rm].ownerName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - Room ${rm.toUpperCase()}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
                notifyUserDM(targetObj[rm].ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - Room ${rm.toUpperCase()}`,
                    reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel")
                }));
                freeAntidemonRoom(targetObj, rm);
                if (!isMod && !penalized) {
                    applyFiveMinCooldown(uid);
                    penalized = true;
                }
            }
            if (targetObj[rm].nextId === uid) {
                anyAction = true;
                const currentLoggedName = targetObj[rm].nextName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - Room ${rm.toUpperCase()} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
                notifyUserDM(targetObj[rm].nextId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - Room ${rm.toUpperCase()} (Queue)`,
                    reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel")
                }));
                targetObj[rm].nextId = null;
                targetObj[rm].nextName = null;
                targetObj[rm].endLimit = null;
                targetObj[rm].formattedTimeNext = "";
                if (STATUS_OPEN === targetObj[rm].status) targetObj[rm].status = STATUS_AVAILABLE;
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

// ==========================================
// 🏛️ ANTIDEMON VERSION SLIDE (2-level menu for MS11/12)
// ==========================================

/** Handle version selection (1-1, 1-2, 1-3) for MS11/12 antidemon, then show room options for the chosen version. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @returns {Promise<boolean>} */
export async function handleAntiVersionSlide(interaction, uid, _uName) {
    const pKey = interaction.customId.replace("antiversion-", ""),
        targetFloor = db[pKey],
        selectedVersion = interaction.values[0];

    if (!targetFloor) {return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);}

    const roomKeys = getAntidemonRoomKeys(pKey);
    const versionRooms = roomKeys.filter(rk => rk.startsWith(selectedVersion));

    const roomOpts = [];
    for (const rk of versionRooms) {
        const rData = targetFloor[rk];
        if (!rData.ownerId && (!rData.nextId || rData.nextId === uid)) {
            roomOpts.push({ label: rData.name, value: rk, emoji: "👹" });
        }
    }

    if (roomOpts.some(o => o.value.endsWith("l")) && roomOpts.some(o => o.value.endsWith("m"))) {
        roomOpts.push({ label: `${getAntidemonRoomName(pKey, selectedVersion+"l")} + ${getAntidemonRoomName(pKey, selectedVersion+"m")}`, value: `${selectedVersion}l+${selectedVersion}m`, emoji: "🔵" });
    }
    if (roomOpts.some(o => o.value.endsWith("m")) && roomOpts.some(o => o.value.endsWith("r"))) {
        roomOpts.push({ label: `${getAntidemonRoomName(pKey, selectedVersion+"m")} + ${getAntidemonRoomName(pKey, selectedVersion+"r")}`, value: `${selectedVersion}m+${selectedVersion}r`, emoji: "🔵" });
    }

    if (roomOpts.length === 0) {return await interaction.update({ content: getMsg("rooms.antidemonQueueLocked"), components: [], flags: 64 }).catch(noop);}

    return await interaction.update({
        content: `👹 **${getMsg("rooms.antidemonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`antislide-${pKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(roomOpts)
        )],
        flags: 64
    }).catch(noop);
}
