// ==========================================
// 👑 ADMIN INTERACTION HANDLERS
// admin-reset-menu, admin-kick-menu, confirm-resetlogs,
// reserve-select-event, reserve-select-floors, reserve-select-hours
// ==========================================

import { getMsg } from "../lang.js";
import { db, dailyLogs, saveLocalStorage } from "../state.js";
import { refreshVisualPanel, resetPanelData, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs, saveDailyLogs } from "../daily-logs.js";
import { getFormattedTime12h } from "../time-utils.js";
import { freeFloorAndActivateNextGracePeriod, freeAntidemonRoom } from "../claim-core.js";
import {
    ActionRowBuilder as t,
    StringSelectMenuBuilder as i,
    ButtonBuilder as n,
    ButtonStyle as a
} from "discord.js";

// 🔄 Reserve flow cache: adminUid → { targetUserId, targetUserName, eventName, floors, hours }
export const reserveFlowCache = {};

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleAdminInteraction(interaction) {
    const cid = interaction.customId;
    return cid === "admin-reset-menu" ||
        cid === "admin-kick-menu" ||
        (interaction.isButton() && cid.startsWith("confirm-resetlogs-")) ||
        cid === "reserve-select-event" ||
        cid === "reserve-select-floors" ||
        cid === "reserve-select-hours" ||
        cid === "reserve-confirm" ||
        cid === "reserve-cancel";
}

export async function handleAdminInteraction(interaction, uid) {
    const cid = interaction.customId;

    if (interaction.isStringSelectMenu() && cid === "admin-reset-menu") {
        return handleAdminResetMenu(interaction);
    }

    if (interaction.isStringSelectMenu() && cid === "admin-kick-menu") {
        return handleAdminKickMenu(interaction, uid);
    }

    if (interaction.isButton() && cid.startsWith("confirm-resetlogs-")) {
        return handleConfirmResetLogs(interaction);
    }

    // Reserve flow handlers
    if (cid === "reserve-select-event") {
        return handleReserveSelectEvent(interaction);
    }
    if (cid === "reserve-select-floors") {
        return handleReserveSelectFloors(interaction);
    }
    if (cid === "reserve-select-hours") {
        return handleReserveSelectHours(interaction);
    }
    if (cid === "reserve-confirm") {
        return handleReserveConfirm(interaction);
    }
    if (cid === "reserve-cancel") {
        return handleReserveCancel(interaction);
    }

    return false;
}

// ==========================================
// 🔄 ADMIN RESET MENU
// ==========================================

async function handleAdminResetMenu(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [],
            flags: 64
        }).catch(() => {});
    }

    const resetKey = interaction.values[0];

    if ("__all__" === resetKey) {
        let count = 0;
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            resetPanelData(key);
            await refreshVisualPanel(key);
            count++;
        }
        return await interaction.update({
            content: `✅ Reset ${count} panels to defaults.`,
            components: []
        }).catch(() => {});
    }

    if (!db[resetKey]) {return await interaction.update({
        content: getMsg("system.resetPanelNotFound", { key: resetKey }),
        components: [],
        flags: 64
    }).catch(() => {});}

    resetPanelData(resetKey);
    await refreshVisualPanel(resetKey);
    return await interaction.update({
        content: getMsg("system.resetPanelSuccess", { key: resetKey }),
        components: []
    }).catch(() => {});
}

// ==========================================
// 👢 ADMIN KICK MENU
// ==========================================

async function handleAdminKickMenu(interaction, uid) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [],
            flags: 64
        }).catch(() => {});
    }

    let [, , roomType, targetUid] = interaction.values[0].split("-"),
        pKey = interaction.values[0].split("-")[1],
        targetFloor = db[pKey];

    if (targetFloor) {
        if ("event_group" === targetFloor.type) {
            // event_group kick: roomType is the sub-event key (e.g. "red", "goblin")
            const evData = targetFloor[roomType];
            if (evData && evData.ownerId) {
                const finalUserLabel = evData.ownerName || getMsg("render.memberLabel");
                pushToDailyLogs("CANCEL", finalUserLabel, `${targetFloor.title} - ${evData.name}`, getMsg("logs.adminRemove"));
                notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetFloor.title} - ${evData.name}`,
                    reason: getMsg("logs.adminRemove")
                }));
                
                // Reset based on event type
                if (evData.type === "summon") {
                    evData.ownerId = null;
                    evData.ownerName = null;
                    evData.time = "";
                    evData.timeWindow = "";
                    if (evData.nextId) {
                        const nid = evData.nextId, nname = evData.nextName;
                        evData.nextId = null;
                        evData.nextName = null;
                        evData.formattedTimeNext = "";
                        evData.ownerId = nid;
                        evData.ownerName = nname;
                        const grace = new Date(Date.now() + 3e5);
                        evData.timeWindow = `${getFormattedTime12h(new Date())} ~ ${getFormattedTime12h(grace)}`;
                        evData.status = "🟢 Open";
                    }
                } else {
                    // schedule/fixed: just clear
                    evData.ownerId = null;
                    evData.ownerName = null;
                    evData.timeWindow = "";
                    if (evData._claimTimestamp) delete evData._claimTimestamp;
                }
                
                saveLocalStorage();
                await refreshVisualPanel(pKey);
                return await interaction.update({
                    content: getMsg("system.kickSuccess"),
                    components: []
                }).catch(() => {});
            }
        } else if ("floor" === roomType) {
            const finalUserLabel = targetFloor.ownerName || getMsg("render.memberLabel");
            pushToDailyLogs("CANCEL", finalUserLabel, targetFloor.title, getMsg("logs.adminRemove"));
            notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                title: targetFloor.title,
                reason: getMsg("logs.adminRemove")
            }));
            freeFloorAndActivateNextGracePeriod(targetFloor);
            await refreshVisualPanel(pKey);
            return await interaction.update({
                content: getMsg("system.kickSuccess"),
                components: []
            }).catch(() => {});
        }

        // Support combo values (e.g. "v1l+v1m") — for antidemon/summon rooms
        const roomsToFree = roomType.includes("+") ? roomType.split("+") : [roomType];
        const freedLabels = [];
        for (const rm of roomsToFree) {
            if (targetFloor[rm]) {
                const finalUserLabel = targetFloor[rm].ownerName || getMsg("render.memberLabel");
                freedLabels.push(rm.toUpperCase());
                pushToDailyLogs("CANCEL", finalUserLabel, `${targetFloor.title} - Room ${rm.toUpperCase()}`, getMsg("logs.adminRemove"));
                notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetFloor.title} - Room ${rm.toUpperCase()}`,
                    reason: getMsg("logs.adminRemove")
                }));
                freeAntidemonRoom(targetFloor, rm);
            }
        }
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: getMsg("system.kickSuccess"),
            components: []
        }).catch(() => {});
    }

    return await interaction.update({
        content: getMsg("rooms.antidemonTimeoutCache"),
        components: [],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 🔒 RESERVE FLOW — Step 1: Select Event
// ==========================================

async function handleReserveSelectEvent(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache) {
        return await interaction.update({
            content: getMsg("rooms.antidemonTimeoutCache"),
            components: [], flags: 64
        }).catch(() => {});
    }

    cache.eventName = interaction.values[0];
    cache.step = "floors";

    // Show floor selection (multi-select)
    return await interaction.update({
        content: getMsg("reserve.interactive.selectFloors"),
        components: [
            new t().addComponents(
                new i()
                    .setCustomId("reserve-select-floors")
                    .setPlaceholder("Choose floor(s)...")
                    .setMinValues(1)
                    .setMaxValues(2)
                    .addOptions([
                        { label: "MS11 Events", value: "11", emoji: "🏛️" },
                        { label: "MS12 Events", value: "12", emoji: "🏛️" }
                    ])
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 🔒 RESERVE FLOW — Step 2: Select Floors
// ==========================================

async function handleReserveSelectFloors(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache || !cache.eventName) {
        return await interaction.update({
            content: getMsg("rooms.antidemonTimeoutCache"),
            components: [], flags: 64
        }).catch(() => {});
    }

    cache.floors = interaction.values;
    cache.step = "hours";

    // Build hour options based on event type
    const isFury = cache.eventName === "fury";
    const scheduleHours = isFury ? [0, 3, 6, 9, 12, 15, 18, 21] : [2, 5, 8, 11, 14, 17, 20, 23];
    const hourOptions = [
        { label: getMsg("reserve.interactive.optAll"), value: "_all", emoji: "⏰" },
        ...scheduleHours.map(h => ({
            label: getMsg("reserve.interactive.hourFormat", { hour: h, nextHour: (h + 1) % 24 }),
            value: String(h),
            emoji: "🕐"
        }))
    ];

    const eventLabel = cache.eventName.charAt(0).toUpperCase() + cache.eventName.slice(1);
    const floorsLabel = cache.floors.includes("11") && cache.floors.includes("12")
        ? "MS11 + MS12"
        : cache.floors.map(f => `MS${f}`).join(", ");

    return await interaction.update({
        content: getMsg("reserve.interactive.selectHours", {
            event: eventLabel,
            floors: floorsLabel,
            userName: cache.targetUserName
        }),
        components: [
            new t().addComponents(
                new i()
                    .setCustomId("reserve-select-hours")
                    .setPlaceholder("Choose time slot(s)...")
                    .setMinValues(1)
                    .setMaxValues(scheduleHours.length + 1)
                    .addOptions(hourOptions)
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 🔒 RESERVE FLOW — Step 3: Select Hours + Confirm
// ==========================================

async function handleReserveSelectHours(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache || !cache.floors) {
        return await interaction.update({
            content: getMsg("rooms.antidemonTimeoutCache"),
            components: [], flags: 64
        }).catch(() => {});
    }

    cache.hours = interaction.values;
    cache.step = "confirm";

    const eventLabel = cache.eventName.charAt(0).toUpperCase() + cache.eventName.slice(1);
    const floorsLabel = cache.floors.includes("11") && cache.floors.includes("12")
        ? "MS11 + MS12"
        : cache.floors.map(f => `MS${f}`).join(", ");

    let hoursLabel;
    if (cache.hours.includes("_all")) {
        hoursLabel = "All hours";
    } else {
        hoursLabel = cache.hours
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(h => `${h}:00-${(parseInt(h) + 1) % 24}:00`)
            .join(", ");
    }

    return await interaction.update({
        content: getMsg("reserve.interactive.confirm", {
            event: eventLabel,
            floors: floorsLabel,
            hours: hoursLabel,
            userName: cache.targetUserName
        }),
        components: [
            new t().addComponents(
                new n()
                    .setCustomId("reserve-confirm")
                    .setLabel(getMsg("reserve.interactive.btnConfirm"))
                    .setStyle(a.Success),
                new n()
                    .setCustomId("reserve-cancel")
                    .setLabel(getMsg("reserve.interactive.btnCancel"))
                    .setStyle(a.Danger)
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 🔒 RESERVE FLOW — Confirm: Apply Reservations
// ==========================================

async function handleReserveConfirm(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache || !cache.hours) {
        return await interaction.update({
            content: getMsg("rooms.antidemonTimeoutCache"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const { eventName, floors, hours, targetUserId, targetUserName } = cache;
    let appliedCount = 0;

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;

        // Check if this panel matches selected floors
        const floorMatch = floors.some(f => key.includes(`${f}squareevents`));
        if (!floorMatch) continue;

        const evData = current[eventName];
        if (!evData || evData.type !== "fixed") continue;

        if (hours.includes("_all")) {
            // Reserve ALL hours — use legacy approach
            evData.reservedFor = targetUserId;
            evData.reservedByName = targetUserName;
            evData.reservations = null;
        } else {
            // Reserve specific hours — use reservations object
            evData.reservedFor = null;
            evData.reservedByName = null;
            evData.reservations = evData.reservations || {};
            for (const h of hours) {
                evData.reservations[h] = { userId: targetUserId, userName: targetUserName };
            }
        }
        appliedCount++;
    }

    // Clean up cache
    delete reserveFlowCache[uid];

    if (appliedCount === 0) {
        return await interaction.update({
            content: getMsg("reserve.noEvent", { event: eventName.charAt(0).toUpperCase() + eventName.slice(1) }),
            components: [], flags: 64
        }).catch(() => {});
    }

    // Refresh all panels
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        await refreshVisualPanel(key);
    }

    const eventLabel = eventName.charAt(0).toUpperCase() + eventName.slice(1);
    const floorsLabel = floors.includes("11") && floors.includes("12")
        ? "MS11 + MS12"
        : floors.map(f => `MS${f}`).join(", ");
    const hoursLabel = hours.includes("_all")
        ? "All hours"
        : hours.sort((a, b) => parseInt(a) - parseInt(b)).map(h => `${h}:00`).join(", ");

    saveLocalStorage();
    return await interaction.update({
        content: getMsg("reserve.interactive.applied", {
            event: eventLabel,
            floors: floorsLabel,
            hours: hoursLabel,
            userName: targetUserName
        }),
        components: []
    }).catch(() => {});
}

// ==========================================
// 🔒 RESERVE FLOW — Cancel
// ==========================================

async function handleReserveCancel(interaction) {
    const uid = interaction.user.id;
    delete reserveFlowCache[uid];
    return await interaction.update({
        content: getMsg("reserve.interactive.cancelled"),
        components: []
    }).catch(() => {});
}

// ==========================================
// 🔄 CONFIRM RESET LOGS
// ==========================================

async function handleConfirmResetLogs(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [],
            flags: 64
        }).catch(() => {});
    }

    const action = interaction.customId.replace("confirm-resetlogs-", "");
    if ("yes" === action) {
        const oldCount = (dailyLogs.queue || []).length;
        dailyLogs.queue = [];
        saveDailyLogs();
        await interaction.update({
            content: getMsg("system.resetLogsSuccess", { count: oldCount }),
            components: []
        }).catch(() => {});
    } else {
        await interaction.update({
            content: getMsg("system.resetLogsCancel"),
            components: []
        }).catch(() => {});
    }
}
