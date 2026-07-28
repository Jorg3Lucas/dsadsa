// ==========================================
// 👑 ADMIN INTERACTION HANDLERS
// admin-reset-menu, admin-kick-menu, confirm-resetlogs,
// reserve-select-event, reserve-select-floors, reserve-select-hours
// ==========================================

import { getMsg } from "../core/lang.js";
import { db, dailyLogs, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, resetPanelData, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs, saveDailyLogs } from "../core/daily-logs.js";
import { getFormattedTime12h } from "../core/time-utils.js";
import { freeFloorAndActivateNextGracePeriod, freeAntidemonRoom } from "../handlers/claim-core.js";

import { noop } from "../core/config.js";
import { canHandleReserveInteraction, handleReserveInteraction, reserveFlowCache } from "./admin-reserve.js";

export { reserveFlowCache };

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

/** Check if an interaction customId matches admin/reserve handlers. @param {import('discord.js').Interaction} interaction @returns {boolean} */
export function canHandleAdminInteraction(interaction) {
    const cid = interaction.customId;
    return cid === "admin-reset-menu" ||
        cid === "admin-kick-menu" ||
        (interaction.isButton() && cid.startsWith("confirm-resetlogs-")) ||
        canHandleReserveInteraction(interaction);
}

/** Route an admin interaction to the appropriate handler (reset, kick, logs, or reserve flow). @param {import('discord.js').Interaction} interaction @param {string} uid @returns {Promise<boolean>} */
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

    // Reserve flow → admin-reserve.js
    if (canHandleReserveInteraction(interaction)) {
        return handleReserveInteraction(interaction);
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
        }).catch(noop);
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
        }).catch(noop);
    }

    if (!db[resetKey]) {return await interaction.update({
        content: getMsg("system.resetPanelNotFound", { key: resetKey }),
        components: [],
        flags: 64
    }).catch(noop);}

    resetPanelData(resetKey);
    await refreshVisualPanel(resetKey);
    return await interaction.update({
        content: getMsg("system.resetPanelSuccess", { key: resetKey }),
        components: []
    }).catch(noop);
}

// ==========================================
// 👢 ADMIN KICK MENU
// ==========================================

async function handleAdminKickMenu(interaction, _uid) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [],
            flags: 64
        }).catch(noop);
    }

    const [, , roomType, targetUid] = interaction.values[0].split("-");
    const pKey = interaction.values[0].split("-")[1];
    const targetFloor = db[pKey];

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
                }).catch(noop);
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
            }).catch(noop);
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
        }).catch(noop);
    }

    return await interaction.update({
        content: getMsg("rooms.antidemonTimeoutCache"),
        components: [],
        flags: 64
    }).catch(noop);
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
        }).catch(noop);
    }

    const action = interaction.customId.replace("confirm-resetlogs-", "");
    if ("yes" === action) {
        const oldCount = (dailyLogs.queue || []).length;
        dailyLogs.queue = [];
        saveDailyLogs();
        await interaction.update({
            content: getMsg("system.resetLogsSuccess", { count: oldCount }),
            components: []
        }).catch(noop);
    } else {
        await interaction.update({
            content: getMsg("system.resetLogsCancel"),
            components: []
        }).catch(noop);
    }
}
