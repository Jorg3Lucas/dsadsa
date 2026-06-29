// ==========================================
// 🏗️ FLOOR INTERACTION HANDLERS
// Death mark, Claim (normal/peak/fixed),
// Cancel, Next queue, Fixed type (Fury/Frenzy)
// ==========================================

import { getMsg } from "../lang.js";
import { db, saveLocalStorage } from "../state.js";
import { refreshVisualPanel, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs } from "../daily-logs.js";
import {
    hasActiveClaim,
    hasActiveQueue,
    checkPunishment,
    applyFiveMinCooldown,
    removeUserFromQueue,
    freeFloorAndActivateNextGracePeriod,
    freeAntidemonRoom,
    buildAntiClaimOptions,
    buildAntiQueueOptions,
    buildActiveClaimMessage
} from "../claim-core.js";
import {
    EmbedBuilder as e,
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import {
    getLocalTime,
    getFormattedTime12h,
    parseStringToDate,
    calculateNextOpening,
    isRoomOpen
} from "../time-utils.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN, STATUS_KILLED, STATUS_KILLED_PREFIX } from "../constants.js";

const SUMMON_PROPS = ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"];

// ⏳ Track death confirmation timeouts so they can be cancelled on button click
const deathConfirmTimeouts = new Map();

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleFloorInteraction(interaction) {
    const cid = interaction.customId;
    if (!interaction.isButton()) return false;

    const parts = cid.split("-");
    const actionPrefix = parts[0];
    const specificProp = parts[2];

    // Death mark: death-{key}-{prop}
    if ("death" === actionPrefix) return true;

    // Death confirm/cancel: deathconfirm-{key}-{prop}, deathcancel-{key}-{prop}
    if ("deathconfirm" === actionPrefix || "deathcancel" === actionPrefix) return true;

    // Floor actions: floor-{key}-{claim|next|cancel}
    if ("floor" === actionPrefix) return true;

    return false;
}

export async function handleFloorInteraction(interaction, uid, uName) {
    if (!interaction.isButton()) return false;

    const [actionPrefix, panelKey, specificProp] = interaction.customId.split("-");
    const targetObj = db[panelKey];

    if (!targetObj) return false;

    // ==========================================
    // 💀 DEATH MARK
    // ==========================================
    if ("death" === actionPrefix) {
        return handleDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp);
    }

    // ==========================================
    // ✅ DEATH CONFIRM / CANCEL (update existing death time)
    // ==========================================
    if ("deathconfirm" === actionPrefix) {
        return handleDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp);
    }
    if ("deathcancel" === actionPrefix) {
        return handleDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp);
    }

    // ── All floor-level actions below ──

    // ==========================================
    // 🌀 SUMMON SPECIFIC ACTIONS (claim, next, cancel)
    // ==========================================
    if ("summon" === targetObj.type) {
        if ("claim" === specificProp) {
            return handleSummonClaim(interaction, uid, uName, targetObj, panelKey);
        }
        if ("next" === specificProp) {
            return handleSummonNext(interaction, uid, uName, targetObj, panelKey);
        }
        if ("cancel" === specificProp) {
            return handleSummonCancel(interaction, uid, uName, targetObj, panelKey);
        }
    }

    // ==========================================
    // 👹 ANTIDEMON SPECIFIC ACTIONS (claim, next, cancel)
    // ==========================================
    if ("antidemon" === targetObj.type) {
        if ("claim" === specificProp) {
            return handleAntiClaim(interaction, uid, uName, targetObj, panelKey);
        }
        if ("next" === specificProp) {
            return handleAntiNext(interaction, uid, uName, targetObj, panelKey);
        }
        if ("cancel" === specificProp) {
            return handleAntiCancel(interaction, uid, uName, targetObj, panelKey);
        }
    }

    // ==========================================
    // ❌ CANCEL (floor-level: normal/peak/fixed)
    // ==========================================
    if ("cancel" === specificProp) {
        return handleFloorCancel(interaction, uid, uName, targetObj, panelKey);
    }

    // ==========================================
    // 🔑 CLAIM (floor-level: normal/peak/fixed)
    // ==========================================
    if ("claim" === specificProp) {
        // SPECIAL CASE: Fixed type (Fury/Frenzy)
        if ("fixed" === targetObj.type) {
            return handleFixedClaim(interaction, uid, uName, targetObj, panelKey);
        }
        // General claim (normal/peak)
        return handleGeneralClaim(interaction, uid, uName, targetObj, panelKey);
    }

    // ==========================================
    // ⏭️ NEXT QUEUE (normal/peak)
    // ==========================================
    if ("next" === specificProp) {
        return handleGeneralNext(interaction, uid, uName, targetObj, panelKey);
    }

    return false;
}

// ==========================================
// 💀 DEATH MARK HANDLER
// ==========================================

async function handleDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp) {
    let currTimeStr = getFormattedTime12h(getLocalTime());
    let nowTs = getLocalTime().getTime();

    // If boss is already marked as killed, ask for confirmation to update the time
    if (targetObj[specificProp].status.startsWith(STATUS_KILLED)) {
        let oldTimeStr = targetObj[specificProp].status.replace(STATUS_KILLED_PREFIX, "").trim();
        const timeoutKey = `death-${panelKey}-${specificProp}`;

        // Clear any stale timeout for this boss
        if (deathConfirmTimeouts.has(timeoutKey)) {
            clearTimeout(deathConfirmTimeouts.get(timeoutKey));
            deathConfirmTimeouts.delete(timeoutKey);
        }

        await interaction.reply({
            content: getMsg("rooms.deathUpdateConfirm", { oldTime: oldTimeStr, newTime: currTimeStr }),
            components: [
                new t().addComponents(
                    new n()
                        .setCustomId(`deathconfirm-${panelKey}-${specificProp}`)
                        .setLabel("✅ Update")
                        .setStyle(a.Success),
                    new n()
                        .setCustomId(`deathcancel-${panelKey}-${specificProp}`)
                        .setLabel("❌ Cancel")
                        .setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(() => {});

        // Auto-expire after 30 seconds
        const timeoutId = setTimeout(async () => {
            try {
                await interaction.editReply({
                    content: getMsg("rooms.deathUpdateExpired"),
                    components: []
                });
            } catch (e) {}
            deathConfirmTimeouts.delete(timeoutKey);
        }, 30000);

        deathConfirmTimeouts.set(timeoutKey, timeoutId);
        return;
    }

    targetObj[specificProp].status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    targetObj[specificProp]._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${targetObj[specificProp].name}`, `Killed at ${currTimeStr}`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.reply({ content: getMsg("rooms.deathLogged"), flags: 64 }).catch(() => {});
}

// ==========================================
// ✅ DEATH UPDATE CONFIRM HANDLER
// ==========================================

async function handleDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp) {
    // Clear the auto-expire timeout
    const timeoutKey = `death-${panelKey}-${specificProp}`;
    if (deathConfirmTimeouts.has(timeoutKey)) {
        clearTimeout(deathConfirmTimeouts.get(timeoutKey));
        deathConfirmTimeouts.delete(timeoutKey);
    }

    let currTimeStr = getFormattedTime12h(getLocalTime());
    let nowTs = getLocalTime().getTime();

    targetObj[specificProp].status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    targetObj[specificProp]._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${targetObj[specificProp].name}`, `Killed at ${currTimeStr} (updated)`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.update({
        content: getMsg("rooms.deathUpdateConfirmed", { newTime: currTimeStr }),
        components: [],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// ❌ DEATH UPDATE CANCEL HANDLER
// ==========================================

async function handleDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp) {
    // Clear the auto-expire timeout
    const timeoutKey = `death-${panelKey}-${specificProp}`;
    if (deathConfirmTimeouts.has(timeoutKey)) {
        clearTimeout(deathConfirmTimeouts.get(timeoutKey));
        deathConfirmTimeouts.delete(timeoutKey);
    }

    return await interaction.update({
        content: getMsg("rooms.deathUpdateCancelled"),
        components: [],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 🌀 SUMMON CLAIM (via select menu)
// ==========================================

async function handleSummonClaim(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) {
        const hasPriority = SUMMON_PROPS.some(loc => targetObj[loc].nextId === uid);
        if (!hasPriority) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    }

    // Find available locations
    const priorityLocs = SUMMON_PROPS.filter(loc => targetObj[loc].nextId === uid && targetObj[loc].status !== STATUS_CLAIMED);
    const freeLocs = SUMMON_PROPS.filter(loc => targetObj[loc].status !== STATUS_CLAIMED && !targetObj[loc].nextId);
    const showLocs = priorityLocs.length > 0 ? priorityLocs : freeLocs;

    const locOptions = showLocs.map(loc => ({
        label: targetObj[loc].name,
        value: loc,
        emoji: "🌀"
    }));

    if (locOptions.length === 0) return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(() => {});
    return await interaction.reply({
        content: `🌀 **${getMsg("rooms.summonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`summonslide-${panelKey}`).setPlaceholder(getMsg("rooms.summonSelectPlaceholder")).addOptions(locOptions)
        )],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 🌀 SUMMON NEXT QUEUE (via select menu)
// ==========================================

async function handleSummonNext(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});

    const queueOpts = SUMMON_PROPS.filter(loc => targetObj[loc].status === STATUS_CLAIMED && !targetObj[loc].nextId).map(loc => ({
        label: targetObj[loc].name,
        value: loc,
        emoji: "🌀"
    }));

    if (queueOpts.length === 0) return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(() => {});
    return await interaction.reply({
        content: `🌀 **${getMsg("rooms.summonMenuSelectNext")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`summonnextside-${panelKey}`).setPlaceholder(getMsg("rooms.summonSelectPlaceholder")).addOptions(queueOpts)
        )],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 🌀 SUMMON CANCEL
// ==========================================

async function handleSummonCancel(interaction, uid, uName, targetObj, panelKey) {
    let isMod = interaction.member.permissions.has("ManageMessages");
    let isOwner = SUMMON_PROPS.some(p => targetObj[p].ownerId === uid);
    let isInQueue = SUMMON_PROPS.some(p => targetObj[p].nextId === uid);

    if (isOwner || isInQueue || isMod) {
        let penalized = !1;
        let anyAction = !1;

        SUMMON_PROPS.forEach(loc => {
            if (targetObj[loc].ownerId === uid) {
                anyAction = !0;
                let currentLoggedName = targetObj[loc].ownerName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${targetObj[loc].name}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
                notifyUserDM(targetObj[loc].ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${targetObj[loc].name}`,
                    reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel")
                }));
                freeAntidemonRoom(targetObj, loc);
                isMod || penalized || (applyFiveMinCooldown(uid), penalized = !0);
            }
            if (targetObj[loc].nextId === uid) {
                anyAction = !0;
                let currentLoggedName = targetObj[loc].nextName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${targetObj[loc].name} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
                notifyUserDM(targetObj[loc].nextId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${targetObj[loc].name} (Queue)`,
                    reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel")
                }));
                targetObj[loc].nextId = null;
                targetObj[loc].nextName = null;
                targetObj[loc].endLimit = null;
                targetObj[loc].formattedTimeNext = "";
                STATUS_OPEN === targetObj[loc].status && (targetObj[loc].status = STATUS_AVAILABLE);
            }
        });

        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({
            content: anyAction
                ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback"))
                : getMsg("rooms.noActiveClaimsFeedback"),
            flags: 64
        }).catch(() => {});
    }
    return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(() => {});
}

// ==========================================
// 👹 ANTIDEMON CLAIM (via select menu)
// ==========================================

async function handleAntiClaim(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) {
        const hasPriority = ["left", "mid", "right"].some(rm => targetObj[rm].nextId === uid);
        if (!hasPriority) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    }
    return await interaction.reply({
        content: `👹 **${getMsg("rooms.antidemonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`antislide-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiClaimOptions(targetObj, uid))
        )],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// ⏭️ ANTIDEMON NEXT QUEUE (via select menu)
// ==========================================

async function handleAntiNext(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    return await interaction.reply({
        content: `⚔️ **${getMsg("rooms.antidemonMenuSelectNext")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`antinextside-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiQueueOptions(targetObj))
        )],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 👹 ANTIDEMON CANCEL
// ==========================================

async function handleAntiCancel(interaction, uid, uName, targetObj, panelKey) {
    let isMod = interaction.member.permissions.has("ManageMessages");
    let isOwner = targetObj.left.ownerId === uid || targetObj.mid.ownerId === uid || targetObj.right.ownerId === uid;
    let isInQueue = targetObj.left.nextId === uid || targetObj.mid.nextId === uid || targetObj.right.nextId === uid;

    if (isOwner || isInQueue || isMod) {
        let penalized = !1;
        let anyAction = !1;

        ["left", "mid", "right"].forEach(rm => {
            if (targetObj[rm].ownerId === uid) {
                anyAction = !0;
                let currentLoggedName = targetObj[rm].ownerName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - Room ${rm.toUpperCase()}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
                notifyUserDM(targetObj[rm].ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - Room ${rm.toUpperCase()}`,
                    reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel")
                }));
                freeAntidemonRoom(targetObj, rm);
                isMod || penalized || (applyFiveMinCooldown(uid), penalized = !0);
            }
            if (targetObj[rm].nextId === uid) {
                anyAction = !0;
                let currentLoggedName = targetObj[rm].nextName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - Room ${rm.toUpperCase()} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
                notifyUserDM(targetObj[rm].nextId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - Room ${rm.toUpperCase()} (Queue)`,
                    reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel")
                }));
                targetObj[rm].nextId = null;
                targetObj[rm].nextName = null;
                targetObj[rm].endLimit = null;
                targetObj[rm].formattedTimeNext = "";
                STATUS_OPEN === targetObj[rm].status && (targetObj[rm].status = STATUS_AVAILABLE);
            }
        });

        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({
            content: anyAction
                ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback"))
                : getMsg("rooms.noActiveClaimsFeedback"),
            flags: 64
        }).catch(() => {});
    }
    return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(() => {});
}

// ==========================================
// ❌ FLOOR-LEVEL CANCEL (normal/peak/fixed)
// ==========================================

async function handleFloorCancel(interaction, uid, uName, targetObj, panelKey) {
    let isMod = interaction.member.permissions.has("ManageMessages");
    let isOwner = targetObj.ownerId === uid;

    let inQueue = !1;
    let pointer = targetObj.next;
    for (; pointer;) {
        if (pointer.userId === uid) { inQueue = !0; break; }
        pointer = pointer.nextQueue;
    }

    if (isOwner) {
        pushToDailyLogs("CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.voluntaryLeave"));
        notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.voluntaryLeave") }));
        freeFloorAndActivateNextGracePeriod(targetObj);
        if (!isMod) applyFiveMinCooldown(uid);
        await refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("cooldowns.canceledClaimFeedback"), flags: 64 }).catch(() => {});
    }

    if (isMod && targetObj.ownerId) {
        pushToDailyLogs("CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.staffCancel"));
        notifyUserDM(targetObj.ownerId, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.staffCancel") }));
        freeFloorAndActivateNextGracePeriod(targetObj);
        await refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("rooms.floorReleasedSuccess"), flags: 64 }).catch(() => {});
    }

    if (inQueue) {
        pushToDailyLogs("CANCEL", uName, targetObj.title, getMsg("logs.queueLeave"));
        notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", { title: targetObj.title, reason: getMsg("logs.queueLeave") }));
        removeUserFromQueue(targetObj, uid);
        saveLocalStorage();
        await refreshVisualPanel(panelKey);
        return await interaction.reply({ content: getMsg("rooms.removedFromQueueFeedback"), flags: 64 }).catch(() => {});
    }

    return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(() => {});
}

// ==========================================
// 🔥 FIXED TYPE CLAIM (Fury/Frenzy)
// ==========================================

async function handleFixedClaim(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});

    let now = getLocalTime();
    let minuteOffset = targetObj.scheduleMinutes || 0;
    let eventStart;

    if (isRoomOpen(targetObj.schedules, minuteOffset)) {
        // Event is currently open — use current event start
        let nowMinutes = now.getHours() * 60 + now.getMinutes();
        let foundHour = null;
        for (const h of targetObj.schedules) {
            let startMin = h * 60 + minuteOffset;
            let endMin = startMin + 60;
            if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
        }
        if (foundHour !== null) {
            eventStart = new Date(now.getTime());
            eventStart.setHours(foundHour, minuteOffset, 0, 0);
        } else {
            eventStart = calculateNextOpening(targetObj.schedules, minuteOffset);
        }
    } else {
        // Event not yet open — 5 min pre-window check
        eventStart = calculateNextOpening(targetObj.schedules, minuteOffset);
        let fiveMinBefore = new Date(eventStart.getTime() - 5 * 60 * 1000);
        if (now < fiveMinBefore) {
            let diffMs = eventStart.getTime() - now.getTime();
            let diffMins = Math.ceil(diffMs / 6e4);
            return await interaction.reply({
                content: getMsg("rooms.eventOpensIn", { minutes: diffMins }),
                flags: 64
            }).catch(() => {});
        }
    }

    // RACE CONDITION GUARD: Block if someone already claimed this event
    if (targetObj.ownerId) {
        return await interaction.reply({
            content: getMsg("system.accessDenied", { ownerName: targetObj.ownerName || getMsg("render.unknownUser") }),
            flags: 64
        }).catch(() => {});
    }

    let eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
    let windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;

    targetObj.ownerId = uid;
    targetObj.ownerName = uName;
    targetObj.timeWindow = windowStr;
    targetObj._claimTimestamp = now.getTime();

    pushToDailyLogs("CLAIM_START", uName, targetObj.title, `${getMsg("render.windowPrefix")}: ${targetObj.timeWindow}`);
    notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: targetObj.title, window: windowStr }));

    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.reply({
        content: getMsg("rooms.eventClaimedFixed", { title: targetObj.title }),
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 📋 GENERAL CLAIM (normal/peak floors)
// ==========================================

async function handleGeneralClaim(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});

    // Access denied if someone else reserved (next queue with endLimit active)
    if (targetObj.next && targetObj.next.userId !== uid) {
        let timeRemainingStr = "";
        if (targetObj.next.endLimit) {
            let limitTime = parseStringToDate(targetObj.next.endLimit);
            if (limitTime) {
                let diffMs = limitTime.getTime() - getLocalTime().getTime();
                let diffMins = Math.ceil(diffMs / 6e4);
                if (diffMins > 0) timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
            }
        }
        return await interaction.reply({
            content: getMsg("cooldowns.floorReservedNotice", { userName: targetObj.next.userName, timeRemaining: timeRemainingStr }),
            flags: 64
        }).catch(() => {});
    }

    // RACE CONDITION GUARD: Block if someone already claimed this floor
    if (targetObj.ownerId) {
        return await interaction.reply({
            content: getMsg("system.accessDenied", { ownerName: targetObj.ownerName || getMsg("render.unknownUser") }),
            flags: 64
        }).catch(() => {});
    }

    let start = getLocalTime();
    let end = new Date(start.getTime() + 18e5);
    let windowStr = `${getFormattedTime12h(start)} ~ ${getFormattedTime12h(end)}`;

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
    await refreshVisualPanel(panelKey);
    return await interaction.reply({
        content: getMsg("rooms.floorClaimSuccess"),
        flags: 64
    }).catch(() => {});
}

// ==========================================
// ⏭️ GENERAL NEXT QUEUE (normal/peak)
// ==========================================

async function handleGeneralNext(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if ("peak" === targetObj.type) return await interaction.reply({ content: getMsg("rooms.alreadyOwner"), flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    if (targetObj.ownerId === uid) return await interaction.reply({ content: getMsg("rooms.alreadyOwner"), flags: 64 }).catch(() => {});

    let pointer = targetObj.next;
    let inQueue = !1;
    for (; pointer;) {
        if (pointer.userId === uid) { inQueue = !0; break; }
        pointer = pointer.nextQueue;
    }
    if (inQueue) return await interaction.reply({ content: getMsg("rooms.alreadyInQueue"), flags: 64 }).catch(() => {});

    let nowTime = getLocalTime();
    let expectedTime = nowTime;
    if (targetObj.timeWindow) {
        let endOfClaim = parseStringToDate(targetObj.timeWindow.split(" ~ ")[1]);
        if (endOfClaim) expectedTime = endOfClaim;
    }
    let node = {
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
    await refreshVisualPanel(panelKey);
    return await interaction.reply({
        content: getMsg("rooms.queueJoinedSuccess"),
        flags: 64
    }).catch(() => {});
}
