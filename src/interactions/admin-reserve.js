// ==========================================
// 🔒 ADMIN — Reserve Flow Handlers
// Multi-step interactive reservation system
// Extracted from admin-interactions.js
// ==========================================

import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel } from "../handlers/panel-utils.js";
import {
    ActionRowBuilder as t,
    StringSelectMenuBuilder as i,
    ButtonBuilder as n,
    ButtonStyle as a
} from "discord.js";
import { noop } from "../core/config.js";

// ── Reserve flow cache ──
export const reserveFlowCache = {};

// ── Step 1: Select Event ──
async function handleReserveSelectEvent(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({ content: getMsg("system.permissionDeniedAdminDropped"), components: [], flags: 64 }).catch(noop);
    }
    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache) { return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop); }
    cache.eventName = interaction.values[0];
    cache.step = "floors";
    return await interaction.update({
        content: getMsg("reserve.interactive.selectFloors"),
        components: [new t().addComponents(new i().setCustomId("reserve-select-floors").setPlaceholder("Choose floor(s)...").setMinValues(1).setMaxValues(2).addOptions([{ label: "MS11 Events", value: "11", emoji: "🏛️" }, { label: "MS12 Events", value: "12", emoji: "🏛️" }]))]
    }).catch(noop);
}

// ── Step 2: Select Floors ──
async function handleReserveSelectFloors(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({ content: getMsg("system.permissionDeniedAdminDropped"), components: [], flags: 64 }).catch(noop);
    }
    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache || !cache.eventName) { return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop); }
    cache.floors = interaction.values;
    cache.step = "hours";

    const isFury = cache.eventName === "fury";
    const scheduleHours = isFury ? [0, 3, 6, 9, 12, 15, 18, 21] : [2, 5, 8, 11, 14, 17, 20, 23];
    const hourOptions = [
        { label: getMsg("reserve.interactive.optAll"), value: "_all", emoji: "⏰" },
        ...scheduleHours.map(h => ({ label: getMsg("reserve.interactive.hourFormat", { hour: h, nextHour: (h + 1) % 24 }), value: String(h), emoji: "🕐" }))
    ];
    const eventLabel = cache.eventName.charAt(0).toUpperCase() + cache.eventName.slice(1);
    const floorsLabel = cache.floors.includes("11") && cache.floors.includes("12") ? "MS11 + MS12" : cache.floors.map(f => `MS${f}`).join(", ");

    return await interaction.update({
        content: getMsg("reserve.interactive.selectHours", { event: eventLabel, floors: floorsLabel, userName: cache.targetUserName }),
        components: [new t().addComponents(new i().setCustomId("reserve-select-hours").setPlaceholder("Choose time slot(s)...").setMinValues(1).setMaxValues(scheduleHours.length + 1).addOptions(hourOptions))]
    }).catch(noop);
}

// ── Step 3: Select Hours + Confirm ──
async function handleReserveSelectHours(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({ content: getMsg("system.permissionDeniedAdminDropped"), components: [], flags: 64 }).catch(noop);
    }
    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache || !cache.floors) { return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop); }
    cache.hours = interaction.values;
    cache.step = "confirm";

    const eventLabel = cache.eventName.charAt(0).toUpperCase() + cache.eventName.slice(1);
    const floorsLabel = cache.floors.includes("11") && cache.floors.includes("12") ? "MS11 + MS12" : cache.floors.map(f => `MS${f}`).join(", ");
    let hoursLabel;
    if (cache.hours.includes("_all")) { hoursLabel = "All hours"; }
    else { hoursLabel = cache.hours.sort((a, b) => parseInt(a) - parseInt(b)).map(h => `${h}:00-${(parseInt(h) + 1) % 24}:00`).join(", "); }

    return await interaction.update({
        content: getMsg("reserve.interactive.confirm", { event: eventLabel, floors: floorsLabel, hours: hoursLabel, userName: cache.targetUserName }),
        components: [new t().addComponents(new n().setCustomId("reserve-confirm").setLabel(getMsg("reserve.interactive.btnConfirm")).setStyle(a.Success), new n().setCustomId("reserve-cancel").setLabel(getMsg("reserve.interactive.btnCancel")).setStyle(a.Danger))]
    }).catch(noop);
}

// ── Confirm: Apply Reservations ──
async function handleReserveConfirm(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({ content: getMsg("system.permissionDeniedAdminDropped"), components: [], flags: 64 }).catch(noop);
    }
    const uid = interaction.user.id;
    const cache = reserveFlowCache[uid];
    if (!cache || !cache.hours) { return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop); }

    const { eventName, floors, hours, targetUserId, targetUserName } = cache;
    let appliedCount = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;
        const floorMatch = floors.some(f => key.includes(`${f}squareevents`));
        if (!floorMatch) continue;
        const evData = current[eventName];
        if (!evData || evData.type !== "fixed") continue;

        if (hours.includes("_all")) {
            evData.reservedFor = targetUserId;
            evData.reservedByName = targetUserName;
            evData.reservations = null;
        } else {
            evData.reservedFor = null;
            evData.reservedByName = null;
            evData.reservations = evData.reservations || {};
            for (const h of hours) { evData.reservations[h] = { userId: targetUserId, userName: targetUserName }; }
        }
        appliedCount++;
    }

    delete reserveFlowCache[uid];
    if (appliedCount === 0) { return await interaction.update({ content: getMsg("reserve.noEvent", { event: eventName.charAt(0).toUpperCase() + eventName.slice(1) }), components: [], flags: 64 }).catch(noop); }
    for (const key in db) { if (!db[key] || key.startsWith("_")) continue; await refreshVisualPanel(key); }

    const eventLabel = eventName.charAt(0).toUpperCase() + eventName.slice(1);
    const floorsLabel = floors.includes("11") && floors.includes("12") ? "MS11 + MS12" : floors.map(f => `MS${f}`).join(", ");
    const hoursLabel = hours.includes("_all") ? "All hours" : hours.sort((a, b) => parseInt(a) - parseInt(b)).map(h => `${h}:00`).join(", ");

    saveLocalStorage();
    return await interaction.update({ content: getMsg("reserve.interactive.applied", { event: eventLabel, floors: floorsLabel, hours: hoursLabel, userName: targetUserName }), components: [] }).catch(noop);
}

// ── Cancel ──
async function handleReserveCancel(interaction) {
    const uid = interaction.user.id;
    delete reserveFlowCache[uid];
    return await interaction.update({ content: getMsg("reserve.interactive.cancelled"), components: [] }).catch(noop);
}

// ── Reserve customId dispatch ──
const reserveCustomIds = ["reserve-select-event", "reserve-select-floors", "reserve-select-hours", "reserve-confirm", "reserve-cancel"];

/** Check if an interaction customId matches the reserve flow. @param {import('discord.js').Interaction} interaction @returns {boolean} */
export function canHandleReserveInteraction(interaction) {
    return reserveCustomIds.includes(interaction.customId);
}

/** Route a reserve flow interaction (select-event → select-floors → select-hours → confirm/cancel). @param {import('discord.js').Interaction} interaction @returns {Promise<boolean>} */
export async function handleReserveInteraction(interaction) {
    const cid = interaction.customId;
    switch (cid) {
        case "reserve-select-event": return handleReserveSelectEvent(interaction);
        case "reserve-select-floors": return handleReserveSelectFloors(interaction);
        case "reserve-select-hours": return handleReserveSelectHours(interaction);
        case "reserve-confirm": return handleReserveConfirm(interaction);
        case "reserve-cancel": return handleReserveCancel(interaction);
        default: return false;
    }
}
