// ==========================================
// 🏗️ FLOOR INTERACTION HANDLERS
// Death mark, Claim (normal/peak/fixed),
// Cancel, Next queue, Fixed type (Fury/Frenzy)
// ==========================================

import { getMsg, getArray } from "../lang.js";
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
    buildActiveClaimMessage,
    getAntidemonRoomKeys,
    getAntidemonRoomName,
    getSummonRoomKeys,
    getEventGroupKeys
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

// Summon room keys are now resolved via getSummonRoomKeys(panelKey)

// ⏳ Track death confirmation timeouts so they can be cancelled on button click
const deathConfirmTimeouts = new Map();

// Track event group summon ticket selections (uid → { panelId, event })
const egSummonCache = new Map();

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleFloorInteraction(interaction) {
    const cid = interaction.customId;
    
    // Event group slide menus (select menus, not buttons)
    if (interaction.isStringSelectMenu()) {
        if (cid.startsWith("egslide-") || cid.startsWith("egticket-") || cid.startsWith("egnextside-")) return true;
        // Antidemon 2-level menu: version selection first
        if (cid.startsWith("antiversion-")) return true;
        return false;
    }
    
    // Individual fixed-event claim buttons (Fury/Frenzy/Random Event)
    if (cid.startsWith("egfixclaim-")) return true;
    
    if (!interaction.isButton()) return false;

    const parts = cid.split("-");
    const actionPrefix = parts[0];

    // Event group death marks: egdeath-{key}-{event}
    // Event group death marks
    if ("egdeath" === actionPrefix) return true;
    if ("egdeathconfirm" === actionPrefix || "egdeathcancel" === actionPrefix) return true;
    if ("egticket" === actionPrefix) return true;

    // Death mark: death-{key}-{prop}
    if ("death" === actionPrefix) return true;

    // Death confirm/cancel: deathconfirm-{key}-{prop}, deathcancel-{key}-{prop}
    if ("deathconfirm" === actionPrefix || "deathcancel" === actionPrefix) return true;

    // Floor actions: floor-{key}-{claim|next|cancel}
    if ("floor" === actionPrefix) return true;

    return false;
}

export async function handleFloorInteraction(interaction, uid, uName) {
    // Handle String Select Menus for event group and antidemon versions
    if (interaction.isStringSelectMenu()) {
        const cid = interaction.customId;
        if (cid.startsWith("egslide-")) return handleEGSlide(interaction, uid, uName);
        if (cid.startsWith("egticket-")) return handleEGTicket(interaction, uid, uName);
        if (cid.startsWith("egnextside-")) return handleEGNextSide(interaction, uid, uName);
        if (cid.startsWith("antiversion-")) return handleAntiVersionSlide(interaction, uid, uName);
        return false;
    }
    
    if (!interaction.isButton()) return false;

    // Individual fixed-event claim buttons (Fury/Frenzy/Random Event)
    if (interaction.customId.startsWith("egfixclaim-")) {
        return handleEGFixClaim(interaction, uid, uName);
    }

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
    // 💀 EVENT GROUP DEATH MARK (egdeath-{key}-{event})
    // ==========================================
    if ("egdeath" === actionPrefix) {
        return handleEGDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp);
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
    
    // ==========================================
    // ✅ EVENT GROUP DEATH CONFIRM / CANCEL
    // ==========================================
    if ("egdeathconfirm" === actionPrefix) {
        return handleEGDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp);
    }
    if ("egdeathcancel" === actionPrefix) {
        return handleEGDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp);
    }

    // ── All floor-level actions below ──

    // ==========================================
    // 🎯 EVENT GROUP ACTIONS (claim, next, cancel)
    // ==========================================
    if ("event_group" === targetObj.type) {
        if ("claim" === specificProp) {
            return handleEventGroupClaim(interaction, uid, uName, targetObj, panelKey);
        }
        if ("next" === specificProp) {
            return handleEventGroupNext(interaction, uid, uName, targetObj, panelKey);
        }
        if ("cancel" === specificProp) {
            return handleEventGroupCancel(interaction, uid, uName, targetObj, panelKey);
        }
    }

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
// ✅ EVENT GROUP DEATH CONFIRM / CANCEL
// ==========================================

async function handleEGDeathConfirm(interaction, uid, uName, targetObj, panelKey, specificProp) {
    let evData = targetObj[specificProp];
    if (!evData) return await interaction.update({ content: getMsg("rooms.noActiveClaimsFeedback"), components: [], flags: 64 }).catch(() => {});
    
    let currTimeStr = getFormattedTime12h(getLocalTime());
    let nowTs = getLocalTime().getTime();
    
    evData.status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    evData._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${evData.name}`, `Killed at ${currTimeStr} (updated)`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.update({
        content: getMsg("rooms.deathUpdateConfirmed", { newTime: currTimeStr }),
        components: [], flags: 64
    }).catch(() => {});
}

async function handleEGDeathCancel(interaction, uid, uName, targetObj, panelKey, specificProp) {
    return await interaction.update({
        content: getMsg("rooms.deathUpdateCancelled"),
        components: [], flags: 64
    }).catch(() => {});
}

// ==========================================
// 💀 EVENT GROUP DEATH MARK (schedule-type events like Red Boss)
// ==========================================

async function handleEGDeathMark(interaction, uid, uName, targetObj, panelKey, specificProp) {
    let evData = targetObj[specificProp];
    if (!evData) return await interaction.reply({ content: getMsg("rooms.noActiveClaimsFeedback"), flags: 64 }).catch(() => {});
    
    let currTimeStr = getFormattedTime12h(getLocalTime());
    let nowTs = getLocalTime().getTime();
    
    if (evData.status && evData.status.startsWith(STATUS_KILLED)) {
        // Ask for confirmation to update
        let oldTimeStr = evData.status.replace(STATUS_KILLED_PREFIX, "").trim();
        await interaction.reply({
            content: getMsg("rooms.deathUpdateConfirm", { oldTime: oldTimeStr, newTime: currTimeStr }),
            components: [
                new t().addComponents(
                    new n().setCustomId(`egdeathconfirm-${panelKey}-${specificProp}`).setLabel("✅ Update").setStyle(a.Success),
                    new n().setCustomId(`egdeathcancel-${panelKey}-${specificProp}`).setLabel("❌ Cancel").setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(() => {});
        return;
    }
    
    evData.status = `${STATUS_KILLED_PREFIX}${currTimeStr}`;
    evData._lastKilledAt = nowTs;
    pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${evData.name}`, `Killed at ${currTimeStr}`);
    saveLocalStorage();
    await refreshVisualPanel(panelKey);
    return await interaction.reply({ content: getMsg("rooms.deathLogged"), flags: 64 }).catch(() => {});
}

// ==========================================
// 🎯 EVENT GROUP CLAIM (via select menu)
// ==========================================

async function handleEventGroupClaim(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    
    const eventKeys = getEventGroupKeys(targetObj);
    
    // For summon-type events, check if user has priority queue
    if (hasActiveQueue(uid)) {
        const hasPriority = eventKeys.some(ev => targetObj[ev] && targetObj[ev].nextId === uid);
        if (!hasPriority) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    }
    
    // Build available options based on event type
    // Fixed-type events (Fury/Frenzy/Random Event) have their own individual buttons,
    // so they are excluded from the generic select menu.
    let now = getLocalTime();
    const options = [];
    
    for (let ev of eventKeys) {
        let evData = targetObj[ev];
        if (evData.ownerId) continue; // Already claimed
        
        if (evData.type === "schedule") {
            // Schedule-type event (Red Boss) — must be available (not killed) to claim
            if (!evData.status || evData.status === STATUS_AVAILABLE) {
                options.push({ label: `🟥 ${evData.name}`, value: ev, emoji: "🟥" });
            }
        } else if (evData.type === "fixed") {
            // Only randomevent uses the generic menu (fury/frenzy have individual buttons)
            if (ev !== "randomevent") continue;
            options.push({ label: evData.name, value: ev, emoji: "🔴" });
        } else if (evData.type === "summon") {
            // Summon-type event (Goblin) — check if available or user has priority queue
            const hasPriority = evData.nextId === uid;
            if (!evData.ownerId && (hasPriority || (!evData.nextId && evData.status !== STATUS_CLAIMED))) {
                options.push({ label: evData.name, value: ev, emoji: "⭐" });
            }
        }
    }
    
    if (options.length === 0) return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(() => {});
    
    return await interaction.reply({
        content: `🎯 **${getMsg("rooms.summonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`egslide-${panelKey}`).setPlaceholder("Choose an event...").addOptions(options)
        )],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// ⏭️ EVENT GROUP NEXT QUEUE (summon-type only)
// ==========================================

async function handleEventGroupNext(interaction, uid, uName, targetObj, panelKey) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    
    const eventKeys = getEventGroupKeys(targetObj);
    const summonEvents = eventKeys.filter(ev => targetObj[ev].type === "summon" && targetObj[ev].ownerId && !targetObj[ev].nextId);
    
    const queueOpts = summonEvents.map(ev => ({
        label: targetObj[ev].name,
        value: ev,
        emoji: "⭐"
    }));
    
    if (queueOpts.length === 0) return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(() => {});
    
    return await interaction.reply({
        content: `⭐ **${getMsg("rooms.summonMenuSelectNext")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`egnextside-${panelKey}`).setPlaceholder("Choose an event...").addOptions(queueOpts)
        )],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 🚪 EVENT GROUP CANCEL
// ==========================================

async function handleEventGroupCancel(interaction, uid, uName, targetObj, panelKey) {
    let isMod = interaction.member.permissions.has("ManageMessages");
    const eventKeys = getEventGroupKeys(targetObj);
    let isOwner = eventKeys.some(ev => targetObj[ev] && targetObj[ev].ownerId === uid);
    let isInQueue = eventKeys.some(ev => targetObj[ev] && targetObj[ev].nextId === uid);
    
    if (isOwner || isInQueue || isMod) {
        let penalized = !1;
        let anyAction = !1;
        
        for (let ev of eventKeys) {
            let evData = targetObj[ev];
            if (evData.ownerId === uid) {
                anyAction = !0;
                let currentLoggedName = evData.ownerName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${evData.name}`, isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel"));
                notifyUserDM(evData.ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${evData.name}`,
                    reason: isMod ? getMsg("logs.staffCancel") : getMsg("logs.userCancel")
                }));
                
                // Reset based on event type
                if (evData.type === "summon") {
                    evData.status = STATUS_AVAILABLE;
                    evData.ownerId = null;
                    evData.ownerName = null;
                    evData.time = "";
                    evData.timeWindow = "";
                    if (evData.nextId) {
                        let nid = evData.nextId, nname = evData.nextName;
                        evData.nextId = null;
                        evData.nextName = null;
                        evData.formattedTimeNext = "";
                        evData.ownerId = nid;
                        evData.ownerName = nname;
                        let grace = new Date(getLocalTime().getTime() + 3e5);
                        evData.timeWindow = `${getFormattedTime12h(new Date())} ~ ${getFormattedTime12h(grace)}`;
                        evData.status = STATUS_OPEN;
                        notifyUserDM(nid, getMsg("rooms.summonTurnArrivedDM", {
                            roomKey: evData.name,
                            title: targetObj.title
                        })).catch(() => {});
                    }
                } else {
                    // Schedule and fixed: just clear owner
                    evData.ownerId = null;
                    evData.ownerName = null;
                    evData.timeWindow = "";
                    if (evData._claimTimestamp) delete evData._claimTimestamp;
                }
                
                isMod || penalized || (applyFiveMinCooldown(uid), penalized = !0);
            }
            if (evData.nextId === uid) {
                anyAction = !0;
                let currentLoggedName = evData.nextName || uName;
                pushToDailyLogs("CANCEL", currentLoggedName, `${targetObj.title} - ${evData.name} (Next Queue)`, isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel"));
                notifyUserDM(evData.nextId, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetObj.title} - ${evData.name} (Queue)`,
                    reason: isMod ? getMsg("logs.staffQueueCancel") : getMsg("logs.userQueueCancel")
                }));
                evData.nextId = null;
                evData.nextName = null;
                evData.endLimit = null;
                evData.formattedTimeNext = "";
            }
        }
        
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
// 🎯 EVENT GROUP FIXED CLAIM — Direct button handler (Fury/Frenzy/Random Event)
// ==========================================

async function handleEGFixClaim(interaction, uid, uName) {
    let [, panelKey, eventName] = interaction.customId.split("-");
    let targetFloor = db[panelKey];
    if (!targetFloor || !targetFloor[eventName]) return await interaction.reply({ content: getMsg("rooms.antidemonTimeoutCache"), flags: 64 }).catch(() => {});

    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.reply({ content: pStr, flags: 64 }).catch(() => {});
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.reply({ content: claimMsg, flags: 64 }).catch(() => {});
    }

    let evData = targetFloor[eventName];
    // Race condition guard
    if (evData.ownerId) {
        return await interaction.reply({
            content: getMsg("rooms.slotAlreadyClaimed", { room: evData.name, ownerName: evData.ownerName || getMsg("render.unknownUser") }),
            flags: 64
        }).catch(() => {});
    }

    // 🚫 Check if reserved for another user
    if (evData.reservedFor && evData.reservedFor !== uid) {
        return await interaction.reply({
            content: getMsg("reserve.blockedOther", { event: evData.name, userName: evData.reservedByName || evData.reservedFor }),
            flags: 64
        }).catch(() => {});
    }

    let now = getLocalTime();
    let minuteOffset = evData.scheduleMinutes || 0;
    let eventStart;

    if (isRoomOpen(evData.schedules, minuteOffset)) {
        // Event is currently open — use current event start
        let nowMinutes = now.getHours() * 60 + now.getMinutes();
        let foundHour = null;
        for (const h of evData.schedules) {
            let startMin = h * 60 + minuteOffset;
            let endMin = startMin + 60;
            if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
        }
        if (foundHour !== null) {
            eventStart = new Date(now.getTime());
            eventStart.setHours(foundHour, minuteOffset, 0, 0);
        } else {
            eventStart = calculateNextOpening(evData.schedules, minuteOffset);
        }
    } else {
        // Event not yet open — 5 min pre-window check
        eventStart = calculateNextOpening(evData.schedules, minuteOffset);
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

    let eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
    let windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;

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
    }).catch(() => {});
}

// ==========================================
// 🎯 EVENT GROUP SLIDE — Selection handler
// ==========================================

async function handleEGSlide(interaction, uid, uName) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});
    
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(() => {});
    }
    
    let pKey = interaction.customId.replace("egslide-", ""),
        targetFloor = db[pKey],
        selectedEvent = interaction.values[0];
    
    if (!targetFloor || !targetFloor[selectedEvent]) return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
    
    let evData = targetFloor[selectedEvent];
    
    // Race condition guard
    if (evData.ownerId) {
        return await interaction.update({
            content: getMsg("rooms.slotAlreadyClaimed", { room: evData.name, ownerName: evData.ownerName || getMsg("render.unknownUser") }),
            components: [], flags: 64
        }).catch(() => {});
    }
    
    if (evData.type === "schedule") {
        // Schedule-type (Red Boss) — just claim it
        let now = getLocalTime();
        evData.ownerId = uid;
        evData.ownerName = uName;
        evData._claimTimestamp = now.getTime();
        
        pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${evData.name}`, "Claimed Red Boss");
        notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} - ${evData.name}`, window: "Until boss is killed" }));
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: `🏆 ${evData.name} claimed!`,
            components: [], flags: 64
        }).catch(() => {});
    } else if (evData.type === "fixed") {
        // Fixed-type (Fury/Frenzy/Random Event) — claim with 1 hour window
        let now = getLocalTime();
        let minuteOffset = evData.scheduleMinutes || 0;
        let eventStart;
        
        if (isRoomOpen(evData.schedules, minuteOffset)) {
            let nowMinutes = now.getHours() * 60 + now.getMinutes();
            let foundHour = null;
            for (const h of evData.schedules) {
                let startMin = h * 60 + minuteOffset;
                let endMin = startMin + 60;
                if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
            }
            if (foundHour !== null) {
                eventStart = new Date(now.getTime());
                eventStart.setHours(foundHour, minuteOffset, 0, 0);
            } else {
                eventStart = calculateNextOpening(evData.schedules, minuteOffset);
            }
        } else {
            eventStart = calculateNextOpening(evData.schedules, minuteOffset);
        }
        
        let eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
        let windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;
        
        evData.ownerId = uid;
        evData.ownerName = uName;
        evData.timeWindow = windowStr;
        evData._claimTimestamp = now.getTime();
        
        pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${evData.name}`, `${getMsg("render.windowPrefix")}: ${windowStr}`);
        notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} - ${evData.name}`, window: windowStr }));
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: `🏆 ${evData.name} secured!`,
            components: [], flags: 64
        }).catch(() => {});
    } else if (evData.type === "summon") {
        // Summon-type (Goblin) — show ticket selection
        egSummonCache.set(uid, { panelId: pKey, event: selectedEvent });
        
        return await interaction.update({
            content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
            components: [new t().addComponents(
                new i()
                    .setCustomId(`egticket-${pKey}`)
                    .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
                    .addOptions(getArray("tickets").map(e => ({ label: e.label, value: e.value, emoji: "🎫" })))
            )],
            flags: 64
        }).catch(() => {});
    }
    
    return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
}

// ==========================================
// ⏭️ EVENT GROUP NEXT SLIDE
// ==========================================

async function handleEGNextSide(interaction, uid, uName) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});
    
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
    
    let pKey = interaction.customId.replace("egnextside-", ""),
        targetFloor = db[pKey],
        selectedEvent = interaction.values[0];
    
    if (!targetFloor || !targetFloor[selectedEvent]) return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
    
    let evData = targetFloor[selectedEvent];
    if (evData.nextId) return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [], flags: 64
    }).catch(() => {});
    
    if (!evData.ownerId) return await interaction.update({
        content: getMsg("rooms.antidemonQueueLocked"),
        components: [], flags: 64
    }).catch(() => {});
    
    let baseTime = getLocalTime();
    if (evData.timeWindow) {
        let calcLimit = parseStringToDate(evData.timeWindow.split(" ~ ")[1]);
        calcLimit && (baseTime = calcLimit);
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
    }).catch(() => {});
}

// ==========================================
// 🎟️ EVENT GROUP TICKET (summon-type ticket selection)
// ==========================================

async function handleEGTicket(interaction, uid, uName) {
    let pStr = checkPunishment(uid);
    if (pStr) return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(() => {});
    
    let pKey = interaction.customId.replace("egticket-", ""),
        targetFloor = db[pKey],
        cacheEntry = egSummonCache.get(uid);
    
    if (!cacheEntry || cacheEntry.panelId !== pKey) {
        return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
    }
    
    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(() => {});
    }
    if (hasActiveQueue(uid)) {
        const eventKeys = getEventGroupKeys(targetFloor);
        const hasPriority = eventKeys.some(ev => targetFloor[ev] && targetFloor[ev].nextId === uid);
        if (!hasPriority) return await interaction.update({ content: getMsg("rooms.limitReached"), components: [], flags: 64 }).catch(() => {});
    }
    
    let selectedEvent = cacheEntry.event,
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
        }).catch(() => {});
    }
    
    // Clear any existing queue for this user in this event
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
    }).catch(() => {});
}

// ==========================================
// 🏛️ ANTIDEMON VERSION SLIDE (2-level menu for MS11/12)
// ==========================================

async function handleAntiVersionSlide(interaction, uid, uName) {
    // User selected a version (1-1, 1-2, 1-3) — now show rooms for that version
    let pKey = interaction.customId.replace("antiversion-", ""),
        targetFloor = db[pKey],
        selectedVersion = interaction.values[0]; // e.g. "v1", "v2", "v3"
    
    if (!targetFloor) return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(() => {});
    
    const roomKeys = getAntidemonRoomKeys(pKey);
    const versionRooms = roomKeys.filter(rk => rk.startsWith(selectedVersion));
    
    // Build room options for this version
    const roomOpts = [];
    for (let rk of versionRooms) {
        let rData = targetFloor[rk];
        if (!rData.ownerId && (!rData.nextId || rData.nextId === uid)) {
            roomOpts.push({ label: rData.name, value: rk, emoji: "👹" });
        }
    }
    
    // Add combo options
    if (roomOpts.some(o => o.value.endsWith("l")) && roomOpts.some(o => o.value.endsWith("m"))) {
        roomOpts.push({ label: `${getAntidemonRoomName(pKey, selectedVersion+"l")} + ${getAntidemonRoomName(pKey, selectedVersion+"m")}`, value: `${selectedVersion}l+${selectedVersion}m`, emoji: "🔵" });
    }
    if (roomOpts.some(o => o.value.endsWith("m")) && roomOpts.some(o => o.value.endsWith("r"))) {
        roomOpts.push({ label: `${getAntidemonRoomName(pKey, selectedVersion+"m")} + ${getAntidemonRoomName(pKey, selectedVersion+"r")}`, value: `${selectedVersion}m+${selectedVersion}r`, emoji: "🔵" });
    }
    
    if (roomOpts.length === 0) return await interaction.update({ content: getMsg("rooms.antidemonQueueLocked"), components: [], flags: 64 }).catch(() => {});
    
    return await interaction.update({
        content: `👹 **${getMsg("rooms.antidemonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`antislide-${pKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(roomOpts)
        )],
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
    const summonProps = getSummonRoomKeys(panelKey);
    if (hasActiveQueue(uid)) {
        const hasPriority = summonProps.some(loc => targetObj[loc].nextId === uid);
        if (!hasPriority) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    }

    // Find available locations
    const priorityLocs = summonProps.filter(loc => targetObj[loc].nextId === uid && targetObj[loc].status !== STATUS_CLAIMED);
    const freeLocs = summonProps.filter(loc => targetObj[loc].status !== STATUS_CLAIMED && !targetObj[loc].nextId);
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

    const summonProps = getSummonRoomKeys(panelKey);
    const queueOpts = summonProps.filter(loc => targetObj[loc].status === STATUS_CLAIMED && !targetObj[loc].nextId).map(loc => ({
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
    const summonProps = getSummonRoomKeys(panelKey);
    let isOwner = summonProps.some(p => targetObj[p].ownerId === uid);
    let isInQueue = summonProps.some(p => targetObj[p].nextId === uid);

    if (isOwner || isInQueue || isMod) {
        let penalized = !1;
        let anyAction = !1;

        summonProps.forEach(loc => {
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
        const antiRoomKeys = getAntidemonRoomKeys(panelKey);
        const hasPriority = antiRoomKeys.some(rm => targetObj[rm] && targetObj[rm].nextId === uid);
        if (!hasPriority) return await interaction.reply({ content: getMsg("rooms.limitReached"), flags: 64 }).catch(() => {});
    }
    
    // MS11/12 antidemon: show version selection first (2-level menu)
    const roomKeys = getAntidemonRoomKeys(panelKey);
    if (roomKeys.length > 3) {
        // Show version selection (1-1, 1-2, 1-3)
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
        
        if (versionOpts.length === 0) return await interaction.reply({ content: getMsg("rooms.antidemonQueueLocked"), flags: 64 }).catch(() => {});
        
        return await interaction.reply({
            content: `👹 **Select a version to claim:**`,
            components: [new t().addComponents(
                new i().setCustomId(`antiversion-${panelKey}`).setPlaceholder("Choose a version...").addOptions(versionOpts)
            )],
            flags: 64
        }).catch(() => {});
    }
    
    // MS7-10: show all rooms directly
    return await interaction.reply({
        content: `👹 **${getMsg("rooms.antidemonMenuSelectClaim")}**`,
        components: [new t().addComponents(
            new i().setCustomId(`antislide-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiClaimOptions(targetObj, uid, panelKey))
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
            new i().setCustomId(`antinextside-${panelKey}`).setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder")).addOptions(buildAntiQueueOptions(targetObj, panelKey))
        )],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 👹 ANTIDEMON CANCEL
// ==========================================

async function handleAntiCancel(interaction, uid, uName, targetObj, panelKey) {
    let isMod = interaction.member.permissions.has("ManageMessages");
    const antiRoomKeys = getAntidemonRoomKeys(panelKey);
    let isOwner = antiRoomKeys.some(rm => targetObj[rm] && targetObj[rm].ownerId === uid);
    let isInQueue = antiRoomKeys.some(rm => targetObj[rm] && targetObj[rm].nextId === uid);

    if (isOwner || isInQueue || isMod) {
        let penalized = !1;
        let anyAction = !1;

        antiRoomKeys.forEach(rm => {
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
