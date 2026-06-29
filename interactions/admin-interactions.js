// ==========================================
// 👑 ADMIN INTERACTION HANDLERS
// admin-reset-menu, admin-kick-menu, confirm-resetlogs
// ==========================================

import { getMsg } from "../lang.js";
import { db, dailyLogs } from "../state.js";
import { saveDailyLogs } from "../daily-logs.js";
import { refreshVisualPanel, resetPanelData, notifyUserDM } from "../panel-utils.js";
import { pushToDailyLogs } from "../daily-logs.js";
import { freeFloorAndActivateNextGracePeriod, freeAntidemonRoom } from "../claim-core.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export function canHandleAdminInteraction(interaction) {
    const cid = interaction.customId;
    return cid === "admin-reset-menu" ||
        cid === "admin-kick-menu" ||
        (interaction.isButton() && cid.startsWith("confirm-resetlogs-"));
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

    let resetKey = interaction.values[0];

    if ("__all__" === resetKey) {
        let count = 0;
        for (let key in db) {
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

    if (!db[resetKey]) return await interaction.update({
        content: getMsg("system.resetPanelNotFound", { key: resetKey }),
        components: [],
        flags: 64
    }).catch(() => {});

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
        if ("floor" === roomType) {
            let finalUserLabel = targetFloor.ownerName || getMsg("render.memberLabel");
            pushToDailyLogs("CANCEL", finalUserLabel, targetFloor.title, getMsg("logs.adminRemove"));
            notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                title: targetFloor.title,
                reason: getMsg("logs.adminRemove")
            }));
            freeFloorAndActivateNextGracePeriod(targetFloor);
            await refreshVisualPanel(pKey);
            notifyUserDM(targetUid, getMsg("system.kickDMNotice", { title: targetFloor.title }));
            return await interaction.update({
                content: getMsg("system.kickSuccess"),
                components: []
            }).catch(() => {});
        }

        // Support combo values (e.g. "v1l+v1m")
        const roomsToFree = roomType.includes("+") ? roomType.split("+") : [roomType];
        let freedLabels = [];
        for (let rm of roomsToFree) {
            if (targetFloor[rm]) {
                let finalUserLabel = targetFloor[rm].ownerName || getMsg("render.memberLabel");
                freedLabels.push(rm.toUpperCase());
                pushToDailyLogs("CANCEL", finalUserLabel, `${targetFloor.title} - Room ${rm.toUpperCase()}`, getMsg("logs.adminRemove"));
                notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetFloor.title} - Room ${rm.toUpperCase()}`,
                    reason: getMsg("logs.adminRemove")
                }));
                freeAntidemonRoom(targetFloor, rm);
            }
        }
        let labelStr = freedLabels.join(" + ");
        await refreshVisualPanel(pKey);
        notifyUserDM(targetUid, getMsg("system.kickDMNotice", { title: `${targetFloor.title} - ${labelStr}` }));
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
