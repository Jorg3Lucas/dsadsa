// ==========================================
// 🏗️ MANAGEMENT — Panel Kick
// Extracted from management-panels.js
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import { getMsg } from "../core/lang.js";
import { db, saveLocalStorage, setCurrentWorld, worldDbs } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "./panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import { STATUS_CLAIMED } from "../core/constants.js";
import { freeAntidemonRoom, getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";
import { noop } from "../core/config.js";

/** Show the kick menu with a select of all active claims grouped by panel across ALL worlds. */
export async function handleMgmtPanelsKickMenu(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const optionsList = [];
    const seenValues = new Set();

    for (const world of Object.keys(worldDbs)) {
        if (world === '_boot') continue;
        setCurrentWorld(world);

        for (const key in db) {
            const current = db[key];
            if (!current || key.startsWith("_")) continue;
            const cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
            if ("event_group" === current.type) {
                const egKeys = getEventGroupKeys(current);
                for (const ev of egKeys) {
                    const evData = current[ev];
                    if (evData.ownerId) {
                        const val = `kick-${key}-${ev}-${evData.ownerId}`;
                        if (!seenValues.has(val)) {
                            seenValues.add(val);
                            optionsList.push({
                                label: `[${world}] ${cleanedTitle} - ${evData.name}`,
                                description: `👑 ${evData.ownerName}`,
                                value: val
                            });
                        }
                    }
                }
            } else if ("antidemon" === current.type) {
                const antiRoomKeys = getAntidemonRoomKeys(key);
                for (const room of antiRoomKeys) {
                    if (current[room].status === STATUS_CLAIMED && current[room].ownerId) {
                        const val = `kick-${key}-${room}-${current[room].ownerId}`;
                        if (!seenValues.has(val)) {
                            seenValues.add(val);
                            optionsList.push({
                                label: `[${world}] ${cleanedTitle} - ${room.toUpperCase()} Room`,
                                description: `👑 ${current[room].ownerName}`,
                                value: val
                            });
                        }
                    }
                }
            } else if ("summon" === current.type) {
                const summonProps = getSummonRoomKeys(key);
                for (const loc of summonProps) {
                    if (current[loc].status === STATUS_CLAIMED && current[loc].ownerId) {
                        const val = `kick-${key}-${loc}-${current[loc].ownerId}`;
                        if (!seenValues.has(val)) {
                            seenValues.add(val);
                            optionsList.push({
                                label: `[${world}] ${cleanedTitle} - ${current[loc].name}`,
                                description: `👑 ${current[loc].ownerName}`,
                                value: val
                            });
                        }
                    }
                }
            } else {
                if (current.ownerId) {
                    const val = `kick-${key}-floor-${current.ownerId}`;
                    if (!seenValues.has(val)) {
                        seenValues.add(val);
                        optionsList.push({
                            label: `[${world}] ${cleanedTitle}`,
                            description: `👑 ${current.ownerName}`,
                            value: val
                        });
                    }
                }
            }
        }
    }

    setCurrentWorld(null);

    if (optionsList.length === 0) {
        return await interaction.update({
            content: getMsg("system.kickNoClaims"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(noop);
    }

    return await interaction.update({
        content: getMsg("system.kickPanelTitle"),
        components: [
            new t().addComponents(
                new i().setCustomId("mgmt-panels-kick-execute").setPlaceholder(getMsg("system.kickPanelPlaceholder")).addOptions(optionsList.slice(0, 25))
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(noop);
}

/** Execute the panel kick for the selected claim — removes owner, logs event, refreshes panel. Searches all worlds. */
export async function handleMgmtPanelsKickExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(noop);
    }

    const value = interaction.values[0];
    const parts = value.split("-");
    const pKey = parts[1];
    const roomType = parts[2];
    const targetUid = parts.slice(3).join("-");

    // Search for the panel key in all worlds
    let targetFloor = null;
    let foundWorld = null;
    for (const world of Object.keys(worldDbs)) {
        if (world === '_boot') continue;
        setCurrentWorld(world);
        targetFloor = db[pKey];
        if (targetFloor) {
            foundWorld = world;
            break;
        }
    }

    if (targetFloor && foundWorld) {
        setCurrentWorld(foundWorld);

        if ("event_group" === targetFloor.type) {
            const evData = targetFloor[roomType];
            if (evData && evData.ownerId) {
                pushToDailyLogs("CANCEL", evData.ownerName || "Unknown", `${targetFloor.title} - ${evData.name}`, getMsg("logs.adminRemove"));
                notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetFloor.title} - ${evData.name}`,
                    reason: getMsg("logs.adminRemove")
                }));
                evData.ownerId = null;
                evData.ownerName = null;
                evData.timeWindow = "";
                if (evData._claimTimestamp) delete evData._claimTimestamp;
                saveLocalStorage();
                await refreshVisualPanel(pKey);
            }
        } else if ("floor" === roomType) {
            pushToDailyLogs("CANCEL", targetFloor.ownerName || "Unknown",
                targetFloor.title, getMsg("logs.adminRemove"));
            notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                title: targetFloor.title,
                reason: getMsg("logs.adminRemove")
            }));
            targetFloor.ownerId = null;
            targetFloor.ownerName = null;
            targetFloor.timeWindow = "";
            if (targetFloor._claimTimestamp) delete targetFloor._claimTimestamp;
            if (targetFloor.next) targetFloor.next = null;
            saveLocalStorage();
            await refreshVisualPanel(pKey);
        } else {
            if (targetFloor[roomType]) {
                pushToDailyLogs("CANCEL", targetFloor[roomType].ownerName || "Unknown",
                    `${targetFloor.title} - Room ${roomType.toUpperCase()}`, getMsg("logs.adminRemove"));
                notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetFloor.title} - Room ${roomType.toUpperCase()}`,
                    reason: getMsg("logs.adminRemove")
                }));
                freeAntidemonRoom(targetFloor, roomType);
                saveLocalStorage();
                await refreshVisualPanel(pKey);
            }
        }
    }

    setCurrentWorld(null);
    return await interaction.update({
        content: getMsg("system.kickSuccess"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
        ]
    }).catch(noop);
}
