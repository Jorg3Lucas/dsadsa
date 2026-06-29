// ==========================================
// 👹 ANTIDEMON INTERACTION HANDLERS
// antislide-, antiticket-, antinextside-
// ==========================================

import { getMsg, getArray } from "../lang.js";
import { db, antiDemonSelectionCache, saveLocalStorage } from "../state.js";
import { refreshVisualPanel, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs } from "../daily-logs.js";
import {
    hasActiveClaim,
    hasActiveQueue,
    checkPunishment,
    applyFiveMinCooldown,
    freeAntidemonRoom,
    buildActiveClaimMessage,
    getAntidemonRoomKeys
} from "../claim-core.js";
import {
    ActionRowBuilder as t,
    StringSelectMenuBuilder as i,
    ButtonBuilder as n,
    ButtonStyle as a,
    ModalBuilder as m,
    TextInputBuilder as ti,
    TextInputStyle as tis
} from "discord.js";
import {
    getLocalTime,
    getFormattedTime12h,
    parseStringToDate
} from "../time-utils.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN } from "../constants.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleAntidemonInteraction(interaction) {
    const cid = interaction.customId;
    return cid.startsWith("antislide-") ||
        cid.startsWith("antiticket-") ||
        cid.startsWith("antinextside-") ||
        cid.startsWith("antipwd-");
}

export function canHandleAntidemonModal(interaction) {
    return interaction.isModalSubmit() && interaction.customId.startsWith("antipwdmodal-");
}

export async function handleAntidemonInteraction(interaction, uid, uName) {
    const cid = interaction.customId;

    if (cid.startsWith("antislide-")) {
        return handleAntiSlide(interaction, uid);
    }
    if (cid.startsWith("antiticket-")) {
        return handleAntiTicket(interaction, uid, uName);
    }
    if (cid.startsWith("antinextside-")) {
        return handleAntiNextSide(interaction, uid, uName);
    }
    if (cid.startsWith("antipwd-")) {
        return handleAntiPassword(interaction, uid, uName);
    }

    return false;
}

export async function handleAntidemonModal(interaction) {
    const cid = interaction.customId;
    if (cid.startsWith("antipwdmodal-")) {
        return handleAntiPasswordModal(interaction);
    }
    return false;
}

// ==========================================
// 🎯 ANTIDEMON SLIDE — Room Selection
// ==========================================

async function handleAntiSlide(interaction, uid) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

    let pKey = interaction.customId.replace("antislide-", ""),
        targetFloor = db[pKey],
        configSelected = interaction.values[0];

    let roomsToCheck = [];
    const roomKeys = getAntidemonRoomKeys(pKey);
    if (roomKeys.length > 3) {
        // 11/12: support combo values (e.g. "v1l+v1m")
        roomsToCheck = configSelected.includes("+") ? configSelected.split("+") : [configSelected];
    } else if ("mid-left" === configSelected) roomsToCheck = ["left", "mid"];
    else if ("mid-right" === configSelected) roomsToCheck = ["mid", "right"];
    else roomsToCheck = [configSelected];

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) {
        const hasPriority = getAntidemonRoomKeys(pKey).some(rm => targetFloor[rm] && targetFloor[rm].nextId === uid);
        if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
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
    }).catch(() => {});
}

// ==========================================
// 🎟️ ANTIDEMON TICKET — Time Selection
// ==========================================

async function handleAntiTicket(interaction, uid, uName) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

    let pKey = interaction.customId.replace("antiticket-", ""),
        targetFloor = db[pKey],
        cacheObj = antiDemonSelectionCache[uid];

    if (!cacheObj || cacheObj.panelId !== pKey) {
        return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
    }

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) {
        const hasPriority = getAntidemonRoomKeys(pKey).some(rm => targetFloor[rm] && targetFloor[rm].nextId === uid);
        if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
    }

    let configSelected = cacheObj.roomConfig,
        calcMinutes = 30 * parseInt(interaction.values[0]),
        startTime = getLocalTime(),
        endTime = new Date(startTime.getTime() + 6e4 * calcMinutes),
        rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`,
        roomsToClaim = [];

    const roomKeys = getAntidemonRoomKeys(pKey);
    if (roomKeys.length > 3) {
        roomsToClaim = configSelected.includes("+") ? configSelected.split("+") : [configSelected];
    } else if ("mid-left" === configSelected) roomsToClaim = ["left", "mid"];
    else if ("mid-right" === configSelected) roomsToClaim = ["mid", "right"];
    else roomsToClaim = [configSelected];

    // Check priority reservation for each room
    for (let roomKey of roomsToClaim) {
        if (targetFloor[roomKey].nextId && targetFloor[roomKey].nextId !== uid) {
            let timeRemainingStr = "";
            if (targetFloor[roomKey].endLimit) {
                let limitTime = parseStringToDate(targetFloor[roomKey].endLimit);
                if (limitTime) {
                    let diffMins = Math.ceil((limitTime.getTime() - getLocalTime().getTime()) / 6e4);
                    if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
                }
            }
            if (timeRemainingStr) {
                delete antiDemonSelectionCache[uid];
                return await interaction.update({
                    content: getMsg("cooldowns.floorReservedNotice", { userName: targetFloor[roomKey].nextName, timeRemaining: timeRemainingStr }),
                    components: [],
                    flags: 64
                }).catch(() => {});
            }
            // endLimit expired - clear queue
            targetFloor[roomKey].nextId = null;
            targetFloor[roomKey].nextName = null;
            targetFloor[roomKey].endLimit = null;
            targetFloor[roomKey].formattedTimeNext = "";
            STATUS_OPEN === targetFloor[roomKey].status && (targetFloor[roomKey].status = STATUS_AVAILABLE);
        }
    }

    // RACE CONDITION GUARD: Re-verify each room is still available before claiming
    for (let roomKey of roomsToClaim) {
        if (targetFloor[roomKey].ownerId) {
            delete antiDemonSelectionCache[uid];
            return await interaction.update({
                content: getMsg("rooms.slotAlreadyClaimed", { room: roomKey.toUpperCase(), ownerName: targetFloor[roomKey].ownerName || getMsg("render.unknownUser") }),
                components: [],
                flags: 64
            }).catch(() => {});
        }
    }

    let applyClaim = roomKey => {
        targetFloor[roomKey].nextId === uid && (targetFloor[roomKey].nextId = null, targetFloor[roomKey].nextName = null, targetFloor[roomKey].endLimit = null);
        targetFloor[roomKey].status = STATUS_CLAIMED;
        targetFloor[roomKey].ownerId = uid;
        targetFloor[roomKey].ownerName = uName;
        targetFloor[roomKey].time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
        targetFloor[roomKey].timeWindow = rangeStr;
    };

    roomsToClaim.forEach(roomKey => applyClaim(roomKey));
    pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - Config: ${configSelected.toUpperCase()}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} (${configSelected.toUpperCase()})`, window: rangeStr }));

    delete antiDemonSelectionCache[uid];
    saveLocalStorage();
    await refreshVisualPanel(pKey);
    return await interaction.update({
        content: getMsg("rooms.antidemonClaimSuccessEphemeral"),
        components: [],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// ⏭️ ANTIDEMON NEXT / QUEUE
// ==========================================

async function handleAntiNextSide(interaction, uid, uName) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});

    let pKey = interaction.customId.replace("antinextside-", ""),
        targetFloor = db[pKey];
    if (!targetFloor) return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});

    let tryJoinQueue = roomKey => {
        if (!targetFloor[roomKey] || targetFloor[roomKey].nextId) return !1;
        // Guard: only allow queue for rooms that are currently claimed
        if (targetFloor[roomKey].status !== STATUS_CLAIMED) return !1;
        let baseTime = getLocalTime();
        if (targetFloor[roomKey].timeWindow) {
            let calcLimit = parseStringToDate(targetFloor[roomKey].timeWindow.split(" ~ ")[1]);
            calcLimit && (baseTime = calcLimit);
        }
        targetFloor[roomKey].nextId = uid;
        targetFloor[roomKey].nextName = uName;
        targetFloor[roomKey].formattedTimeNext = getFormattedTime12h(baseTime);
        targetFloor[roomKey].endLimit = null;
        return !0;
    };

    let choice = interaction.values[0],
        joinedRooms = [];
    const roomKeys = getAntidemonRoomKeys(pKey);

    if (roomKeys.length > 3) {
        // 11/12: support combo values (e.g. "v1l+v1m")
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
        let roomsLabel = joinedRooms.join(" + ");
        pushToDailyLogs("QUEUE_JOIN", uName, `${targetFloor.title} - Room ${roomsLabel}`, getMsg("render.joinedAsNext"));
        notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", { title: `${targetFloor.title} - Room ${roomsLabel}` }));
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: getMsg("rooms.antidemonQueueSuccessEphemeral"),
            components: [],
            flags: 64
        }).catch(() => {});
    }

    return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 🔑 ANTIDEMON PASSWORD — Show Modal
// ==========================================

async function handleAntiPassword(interaction, uid, uName) {
    if (!interaction.isButton()) return false;

    const [_, panelKey, room] = interaction.customId.split("-");
    // customId format: antipwd-{key}-{room}
    const targetFloor = db[panelKey];

    if (!targetFloor || !targetFloor[room]) {
        return await interaction.reply({
            content: getMsg("rooms.antidemonPasswordNotFound"),
            flags: 64
        }).catch(() => {});
    }

    if (targetFloor[room].ownerId !== uid) {
        return await interaction.reply({
            content: getMsg("rooms.antidemonPasswordNotOwner"),
            flags: 64
        }).catch(() => {});
    }

    const modal = new m()
        .setCustomId(`antipwdmodal-${panelKey}-${room}`)
        .setTitle(`🎮 Party Password — ${room.toUpperCase()}`)
        .addComponents(
            new t().addComponents(
                new ti()
                    .setCustomId("password")
                    .setLabel(getMsg("rooms.antidemonPasswordInputLabel"))
                    .setStyle(tis.Short)
                    .setPlaceholder(getMsg("rooms.antidemonPasswordInputPlaceholder"))
                    .setRequired(false)
                    .setValue(targetFloor[room].password || "")
            )
        );

    return await interaction.showModal(modal).catch(() => {});
}

// ==========================================
// 🔑 ANTIDEMON PASSWORD MODAL — Save
// ==========================================

async function handleAntiPasswordModal(interaction) {
    const cid = interaction.customId;
    const parts = cid.split("-");
    // customId format: antipwdmodal-{key}-{room}
    const panelKey = parts[1];
    const room = parts[2];
    const targetFloor = db[panelKey];

    if (!targetFloor || !targetFloor[room]) {
        return await interaction.reply({
            content: getMsg("rooms.antidemonPasswordNotFound"),
            flags: 64
        }).catch(() => {});
    }

    if (targetFloor[room].ownerId !== interaction.user.id) {
        return await interaction.reply({
            content: getMsg("rooms.antidemonPasswordNotOwner"),
            flags: 64
        }).catch(() => {});
    }

    const newPassword = interaction.fields.getTextInputValue("password").trim();
    const oldPassword = targetFloor[room].password;

    if (newPassword) {
        targetFloor[room].password = newPassword;
        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({
            content: getMsg("rooms.antidemonPasswordSet", { room: room.toUpperCase(), password: newPassword }),
            flags: 64
        }).catch(() => {});
    } else if (oldPassword) {
        targetFloor[room].password = "";
        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({
            content: getMsg("rooms.antidemonPasswordCleared", { room: room.toUpperCase() }),
            flags: 64
        }).catch(() => {});
    } else {
        return await interaction.reply({
            content: getMsg("rooms.antidemonPasswordNoChange"),
            flags: 64
        }).catch(() => {});
    }
}
