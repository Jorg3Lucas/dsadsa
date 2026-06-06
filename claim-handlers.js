import {
    EmbedBuilder as e,
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import { execSync, exec } from "child_process";
import { getLocalTime, getFormattedTime12h, parseStringToDate } from "./time-utils.js";
import { getMsg, getArray } from "./lang.js";
import { db, dailyLogs, antiDemonSelectionCache, summonSelectionCache, saveLocalStorage, defaultFloors, lastMessages } from "./state.js";
import { pushToDailyLogs, saveDailyLogs, dispatchDailyLogs } from "./daily-logs.js";
import { renderEmbed, renderButtons } from "./panel-render.js";
import { refreshVisualPanel, notifyUserDM, resetPanelData } from "./panel-utils.js";
import { hasActiveClaim, hasActiveQueue, checkPunishment, applyFiveMinCooldown, removeUserFromQueue, freeFloorAndActivateNextGracePeriod, freeAntidemonRoom, buildAntiClaimOptions, buildAntiQueueOptions } from "./claim-core.js";

// ==========================================
// 💬 TEXT COMMAND HANDLERS (!ms, !sp, !setlogs, etc.)
// ==========================================

export async function handleClaimMessages(msg) {
    if (msg.author.bot) return;
    let lowerContent = msg.content.toLowerCase().trim();

    if ("!setlogs" === lowerContent) {
        if (msg.member.permissions.has("ManageGuild")) {
            dailyLogs.configChannelId = msg.channel.id;
            saveDailyLogs();
            return msg.reply({
                content: getMsg("logs.setupSuccess")
            }).catch(() => {});
        } else {
            return msg.reply({
                content: getMsg("logs.setupError")
            }).catch(() => {});
        }
    }

    if ("!logs" === lowerContent) {
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply({
            content: getMsg("logs.modRequired")
        }).catch(() => {});
        if (!dailyLogs.configChannelId) return msg.reply({
            content: getMsg("logs.noChannel")
        }).catch(() => {});
        if (!await dispatchDailyLogs(!0)) return msg.reply({
            content: getMsg("logs.dispatchError")
        }).catch(() => {});
        if (msg.channel.id !== dailyLogs.configChannelId) return msg.reply({
            content: getMsg("logs.dispatchSuccess")
        }).catch(() => {});
        try {
            await msg.delete()
        } catch (r) {}
        return;
    }

    if ("!resetlogs" === lowerContent) {
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply({
            content: getMsg("system.permissionDeniedManageMessages")
        }).catch(() => {});
        const oldCount = (dailyLogs.queue || []).length;
        await msg.reply({
            content: getMsg("system.resetLogsConfirm", { count: oldCount }),
            components: [
                new t().addComponents(
                    new n().setCustomId("confirm-resetlogs-yes").setLabel("✅ Yes, clear logs").setStyle(a.Success),
                    new n().setCustomId("confirm-resetlogs-no").setLabel("❌ No, cancel").setStyle(a.Danger)
                )
            ]
        }).catch(() => {});
        try {
            await msg.delete()
        } catch (e) {}
        return;
    }

    if ("!kick" === lowerContent) {
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply({
            content: getMsg("system.permissionDeniedManageMessages")
        }).catch(() => {});
        let optionsList = [];
        for (let key in db) {
            let current = db[key];
            if (!current || key.startsWith("_")) continue;
            let cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
            if ("antidemon" === current.type) {
                for (let room of ["left", "mid", "right"]) {
                    "🔴 Claimed" === current[room].status && current[room].ownerId && optionsList.push({
                        label: `${cleanedTitle} - ${room.toUpperCase()} Room`,
                        description: `${getMsg("system.kickCurrentLabel")} ${current[room].ownerName}`,
                        value: `kick-${key}-${room}-${current[room].ownerId}`
                    });
                }
            } else if ("summon" === current.type) {
                const summonProps = ["sp2", "sp4", "sp7", "ms11", "sp11"];
                for (let loc of summonProps) {
                    "🔴 Claimed" === current[loc].status && current[loc].ownerId && optionsList.push({
                        label: `${cleanedTitle} - ${current[loc].name}`,
                        description: `${getMsg("system.kickCurrentLabel")} ${current[loc].ownerName}`,
                        value: `kick-${key}-${loc}-${current[loc].ownerId}`
                    });
                }
            } else {
                current.ownerId && optionsList.push({
                    label: `${cleanedTitle}`,
                    description: `${getMsg("system.kickCurrentLabel")} ${current.ownerName}`,
                    value: `kick-${key}-floor-${current.ownerId}`
                });
            }
        }
        if (0 === optionsList.length) return msg.reply({
            content: getMsg("system.kickNoClaims")
        }).catch(() => {});
        await msg.reply({
            content: getMsg("system.kickPanelTitle"),
            components: [new t().addComponents(new i().setCustomId("admin-kick-menu").setPlaceholder(getMsg("system.kickPanelPlaceholder")).addOptions(optionsList.slice(0, 25)))]
        });
        try {
            await msg.delete()
        } catch (p) {}
        return;
    }

    if (lowerContent.startsWith("!ms")) {
        let sub = lowerContent.replace("!ms", "").trim();
        if ("11" === sub || "12" === sub) {
            let list = [`${sub}squareleaders`, `${sub}squarefury`, `${sub}squarefrenzy`];
            db._panelMapping || (db._panelMapping = {});
            for (let item of list) {
                if (db._panelMapping[item] && db._panelMapping[item].channelId === msg.channel.id) {
                    try {
                        let oldMsg = await msg.channel.messages.fetch(db._panelMapping[item].messageId).catch(() => null);
                        oldMsg && await oldMsg.delete().catch(() => {});
                    } catch (M) {}
                }
                let sent = await msg.channel.send({
                    embeds: [renderEmbed(item)],
                    components: renderButtons(item)
                });
                lastMessages[item] = sent;
                db._panelMapping[item] = {
                    channelId: msg.channel.id,
                    messageId: sent.id
                };
            }
            saveLocalStorage();
            try {
                await msg.delete()
            } catch (M) {}
            return;
        }
        if (!defaultFloors.includes(sub)) return;
        let norm = `${sub}squarenormal`,
            anti = `${sub}squareantidemon`;
        db._panelMapping || (db._panelMapping = {});

        for (let key of [norm, anti]) {
            if (db._panelMapping[key] && db._panelMapping[key].channelId === msg.channel.id) {
                try {
                    let oldMsg = await msg.channel.messages.fetch(db._panelMapping[key].messageId).catch(() => null);
                    oldMsg && await oldMsg.delete().catch(() => {});
                } catch (L) {}
            }
        }

        let m1 = await msg.channel.send({
            embeds: [renderEmbed(norm)],
            components: renderButtons(norm)
        });
        lastMessages[norm] = m1;
        db._panelMapping[norm] = {
            channelId: msg.channel.id,
            messageId: m1.id
        };

        let m2 = await msg.channel.send({
            embeds: [renderEmbed(anti)],
            components: renderButtons(anti)
        });
        lastMessages[anti] = m2;
        db._panelMapping[anti] = {
            channelId: msg.channel.id,
            messageId: m2.id
        };

        saveLocalStorage();
        try {
            await msg.delete()
        } catch (L) {}
    }

    if (lowerContent.startsWith("!sp")) {
        let floorNum = lowerContent.replace("!sp", "").trim();
        if (!defaultFloors.includes(floorNum)) return;
        let pKey = `${floorNum}peak`;
        db._panelMapping || (db._panelMapping = {});

        if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
            try {
                let oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
                oldMsg && await oldMsg.delete().catch(() => {});
            } catch (C) {}
        }

        let pMsg = await msg.channel.send({
            embeds: [renderEmbed(pKey)],
            components: renderButtons(pKey)
        });
        lastMessages[pKey] = pMsg;
        db._panelMapping[pKey] = {
            channelId: msg.channel.id,
            messageId: pMsg.id
        };
        saveLocalStorage();
        try {
            await msg.delete()
        } catch (C) {}
    }

    if ("!summon" === lowerContent) {
        let pKey = "summon";
        db._panelMapping || (db._panelMapping = {});

        if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
            try {
                let oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
                oldMsg && await oldMsg.delete().catch(() => {});
            } catch (C) {}
        }

        let pMsg = await msg.channel.send({
            embeds: [renderEmbed(pKey)],
            components: renderButtons(pKey)
        });
        lastMessages[pKey] = pMsg;
        db._panelMapping[pKey] = {
            channelId: msg.channel.id,
            messageId: pMsg.id
        };
        saveLocalStorage();
        try {
            await msg.delete()
        } catch (C) {}
        return;
    }

    if ("!update" === lowerContent) {
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply({
            content: getMsg("system.permissionDeniedManageMessages")
        }).catch(() => {});
        let updateReply = await msg.reply({ content: getMsg("system.updateRunningGit") }).catch(() => {});
        try {
            let output = execSync("git pull", { encoding: "utf8", cwd: process.cwd() });
            if (updateReply) await updateReply.edit({ content: getMsg("system.updateSuccess", { output: output.slice(0, 1900) }) }).catch(() => {});
            // Install any new dependencies
            execSync("npm install", { encoding: "utf8", cwd: process.cwd(), stdio: "pipe" });
            exec("pm2 restart bot", () => process.exit());
        } catch (e) {
            if (updateReply) await updateReply.edit({ content: getMsg("system.updateError", { error: (e.message || e).slice(0, 1900) }) }).catch(() => {});
        }
        return;
    }

    if ("!reset" === lowerContent) {
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply({
            content: getMsg("system.permissionDeniedManageMessages")
        }).catch(() => {});
        let optionsList = [];
        for (let key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            let current = db[key];
            let cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
            optionsList.push({ label: `${cleanedTitle}`, description: `Key: ${key}`, value: key });
        }
        if (0 === optionsList.length) return msg.reply({ content: getMsg("system.resetNoPanels") }).catch(() => {});
        if (optionsList.length > 1) {
            optionsList.unshift({ label: "🔄 Reset ALL Panels", description: "Reset all panels to defaults", value: "__all__" });
        }
        await msg.reply({
            content: getMsg("system.resetMenuTitle"),
            components: [new t().addComponents(new i()
                .setCustomId("admin-reset-menu")
                .setPlaceholder(getMsg("system.resetMenuPlaceholder"))
                .addOptions(optionsList.slice(0, 25))
            )]
        });
        try { await msg.delete() } catch (C) {}
        return;
    }

    if (lowerContent.startsWith("!reset ")) {
        if (!msg.member.permissions.has("ManageMessages")) return msg.reply({
            content: getMsg("system.permissionDeniedManageMessages")
        }).catch(() => {});
        let resetKey = lowerContent.replace("!reset ", "").trim();
        
        if ("all" === resetKey) {
            let count = 0;
            for (let key in db) {
                if (!db[key] || key.startsWith("_")) continue;
                resetPanelData(key);
                await refreshVisualPanel(key);
                count++;
            }
            saveLocalStorage();
            return msg.reply({ content: `✅ Reset ${count} panels to defaults.` }).catch(() => {});
        }
        
        if (!db[resetKey]) return msg.reply({ content: getMsg("system.resetPanelNotFound", { key: resetKey }) }).catch(() => {});
        resetPanelData(resetKey);
        await refreshVisualPanel(resetKey);
        saveLocalStorage();
        return msg.reply({ content: getMsg("system.resetPanelSuccess", { key: resetKey }) }).catch(() => {});
    }
}

// ==========================================
// 🖱️ INTERACTION HANDLERS (Buttons, Menus, Modals)
// ==========================================

export async function handleClaimInteractions(interaction) {
    let uid = interaction.user.id,
        uName = interaction.member ? interaction.member.displayName : interaction.user.username;

    if (interaction.isStringSelectMenu() && "admin-reset-menu" === interaction.customId) {
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
            saveLocalStorage();
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
        saveLocalStorage();
        return await interaction.update({
            content: getMsg("system.resetPanelSuccess", { key: resetKey }),
            components: []
        }).catch(() => {});
    }

    if (interaction.isStringSelectMenu() && "admin-kick-menu" === interaction.customId) {
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
            let finalUserLabel = getMsg("render.memberLabel");
            if ("floor" === roomType) {
                finalUserLabel = targetFloor.ownerName || getMsg("render.memberLabel");
                pushToDailyLogs("CANCEL", finalUserLabel, targetFloor.title, getMsg("logs.adminRemove"));
                notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                    title: targetFloor.title,
                    reason: getMsg("logs.adminRemove")
                }));
                freeFloorAndActivateNextGracePeriod(targetFloor);
            } else {
                finalUserLabel = targetFloor[roomType].ownerName || getMsg("render.memberLabel");
                pushToDailyLogs("CANCEL", finalUserLabel, `${targetFloor.title} - Room ${roomType.toUpperCase()}`, getMsg("logs.adminRemove"));
                notifyUserDM(targetUid, getMsg("rooms.dmRemovedNotice", {
                    title: `${targetFloor.title} - Room ${roomType.toUpperCase()}`,
                    reason: getMsg("logs.adminRemove")
                }));
                freeAntidemonRoom(targetFloor, roomType);
            }
            saveLocalStorage();
            await refreshVisualPanel(pKey);
            notifyUserDM(targetUid, getMsg("system.kickDMNotice", {
                title: targetFloor.title
            }));
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
    }        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("antislide-")) {
        let pStr = checkPunishment(uid);
        if (pStr) return await interaction.update({
            content: pStr,
            components: [],
            flags: 64
        }).catch(() => {});
        let pKey = interaction.customId.replace("antislide-", ""),
            targetFloor = db[pKey],
            configSelected = interaction.values[0];
        
        let roomsToCheck = [];
        if ("mid-left" === configSelected) roomsToCheck = ["left", "mid"];
        else if ("mid-right" === configSelected) roomsToCheck = ["mid", "right"];
        else roomsToCheck = [configSelected];
        
        if (hasActiveClaim(uid)) return await interaction.update({
            content: getMsg("rooms.limitReached"),
            components: [],
            flags: 64
        }).catch(() => {});
        // Allow claiming if user has priority reservation (nextId) on this panel
        if (hasActiveQueue(uid)) {
            const hasPriority = ["left", "mid", "right"].some(rm => targetFloor[rm].nextId === uid);
            if (!hasPriority) return await interaction.update({
                content: getMsg("rooms.limitReached"),
                components: [],
                flags: 64
            }).catch(() => {});
        }
        

        
        antiDemonSelectionCache[uid] = {
            panelId: pKey,
            roomConfig: configSelected
        };
        return await interaction.update({
            content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
            components: [new t().addComponents(new i()
                .setCustomId(`antiticket-${pKey}`)
                .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
                .addOptions(getArray("tickets").map(e => ({
                    label: e.label,
                    value: e.value,
                    emoji: "🎫"
                })))
            )],
            flags: 64
        }).catch(() => {});
    }        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("antiticket-")) {
        let pStr = checkPunishment(uid);
        if (pStr) return await interaction.update({
            content: pStr,
            components: [],
            flags: 64
        }).catch(() => {});
        let pKey = interaction.customId.replace("antiticket-", ""),
            targetFloor = db[pKey],
            cacheObj = antiDemonSelectionCache[uid];

        if (!cacheObj || cacheObj.panelId !== pKey) {
            return await interaction.update({
                content: getMsg("rooms.antidemonTimeoutCache"),
                components: [],
                flags: 64
            }).catch(() => {});
        }

        if (hasActiveClaim(uid)) return await interaction.update({
            content: getMsg("rooms.limitReached"),
            components: [],
            flags: 64
        }).catch(() => {});
        // Allow claiming if user has priority reservation (nextId) on this panel
        if (hasActiveQueue(uid)) {
            const hasPriority = ["left", "mid", "right"].some(rm => targetFloor[rm].nextId === uid);
            if (!hasPriority) return await interaction.update({
                content: getMsg("rooms.limitReached"),
                components: [],
                flags: 64
            }).catch(() => {});
        }
        
        let configSelected = cacheObj.roomConfig,
            calcMinutes = 30 * parseInt(interaction.values[0]),
            startTime = getLocalTime(),
            endTime = new Date(startTime.getTime() + 6e4 * calcMinutes),
            rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`,
            roomsToClaim = [];

        if ("mid-left" === configSelected) roomsToClaim = ["left", "mid"];
        else if ("mid-right" === configSelected) roomsToClaim = ["mid", "right"];
        else roomsToClaim = [configSelected];

        // Check priority reservation for each room being claimed — block if reserved for someone else
        for (let roomKey of roomsToClaim) {
            if (targetFloor[roomKey].nextId && targetFloor[roomKey].nextId !== uid) {
                let timeRemainingStr = "";
                if (targetFloor[roomKey].endLimit) {
                    let limitTime = parseStringToDate(targetFloor[roomKey].endLimit);
                    if (limitTime) {
                        let diffMins = Math.ceil((limitTime.getTime() - getLocalTime().getTime()) / 6e4);
                        if (diffMins > 0) {
                            timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
                        }
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
                // endLimit expired — clear the queue and proceed
                targetFloor[roomKey].nextId = null;
                targetFloor[roomKey].nextName = null;
                targetFloor[roomKey].endLimit = null;
                targetFloor[roomKey].formattedTimeNext = "";
                "🟢 Open" === targetFloor[roomKey].status && (targetFloor[roomKey].status = "🟢 Available");
            }
        }

        let applyClaim = roomKey => {
                targetFloor[roomKey].nextId === uid && (targetFloor[roomKey].nextId = null, targetFloor[roomKey].nextName = null, targetFloor[roomKey].endLimit = null);
                targetFloor[roomKey].status = "🔴 Claimed";
                targetFloor[roomKey].ownerId = uid;
                targetFloor[roomKey].ownerName = uName;
                targetFloor[roomKey].time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
                targetFloor[roomKey].timeWindow = rangeStr;
            };

        roomsToClaim.forEach(roomKey => applyClaim(roomKey));
        pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - Config: ${configSelected.toUpperCase()}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);

        notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", {
            title: `${targetFloor.title} (${configSelected.toUpperCase()})`,
            window: rangeStr
        }));

        delete antiDemonSelectionCache[uid];
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: getMsg("rooms.antidemonClaimSuccessEphemeral"),
            components: [],
            flags: 64
        }).catch(() => {});
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("antinextside-")) {
        let pStr = checkPunishment(uid);
        if (pStr) return await interaction.update({
            content: pStr,
            components: [],
            flags: 64
        }).catch(() => {});
        let pKey = interaction.customId.replace("antinextside-", ""),
            targetFloor = db[pKey];
        if (!targetFloor) return await interaction.update({
            content: getMsg("rooms.antidemonTimeoutCache"),
            components: [],
            flags: 64
        }).catch(() => {});

        if (hasActiveClaim(uid) || hasActiveQueue(uid)) return await interaction.update({
            content: getMsg("rooms.limitReached"),
            components: [],
            flags: 64
        }).catch(() => {});

        let tryJoinQueue = roomKey => {
                if (targetFloor[roomKey].nextId) return !1;
                let baseTime = getLocalTime();
                if (targetFloor[roomKey].timeWindow) {
                    let calcLimit = parseStringToDate(targetFloor[roomKey].timeWindow.split(" ~ ")[1]);
                    calcLimit && (baseTime = calcLimit);
                }
                return targetFloor[roomKey].nextId = uid, targetFloor[roomKey].nextName = uName, targetFloor[roomKey].formattedTimeNext = getFormattedTime12h(baseTime), targetFloor[roomKey].endLimit = null, !0;
            },
            choice = interaction.values[0];

        let joinedRooms = [];
        if ("mid-left" === choice) {
            let r1 = tryJoinQueue("left");
            let r2 = tryJoinQueue("mid");
            if (r1) joinedRooms.push("LEFT");
            if (r2) joinedRooms.push("MID");
        } else if ("mid-right" === choice) {
            let r1 = tryJoinQueue("mid");
            let r2 = tryJoinQueue("right");
            if (r1) joinedRooms.push("MID");
            if (r2) joinedRooms.push("RIGHT");
        } else if (tryJoinQueue(choice)) {
            joinedRooms.push(choice.toUpperCase());
        }

        if (joinedRooms.length > 0) {
            let roomsLabel = joinedRooms.join(" + ");
            pushToDailyLogs("QUEUE_JOIN", uName, `${targetFloor.title} - Room ${roomsLabel}`, getMsg("render.joinedAsNext"));
            notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", {
                title: `${targetFloor.title} - Room ${roomsLabel}`
            }));

            saveLocalStorage();
            await refreshVisualPanel(pKey);
            return await interaction.update({
                content: getMsg("rooms.antidemonQueueSuccessEphemeral"),
                components: [],
                flags: 64
            }).catch(() => {});
        } else {
            return await interaction.update({
                content: getMsg("rooms.antidemonQueueLocked"),
                components: [],
                flags: 64
            }).catch(() => {});
        }
    }

    // ==========================================
    // 🌀 SUMMON INTERACTION HANDLERS
    // ==========================================
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("summonslide-")) {
        let pStr = checkPunishment(uid);
        if (pStr) return await interaction.update({
            content: pStr,
            components: [],
            flags: 64
        }).catch(() => {});
        let pKey = interaction.customId.replace("summonslide-", ""),
            targetFloor = db[pKey],
            selectedLoc = interaction.values[0];

        if (hasActiveClaim(uid)) return await interaction.update({
            content: getMsg("rooms.limitReached"),
            components: [],
            flags: 64
        }).catch(() => {});
        // Allow claiming if user has priority reservation (nextId) on this panel
        if (hasActiveQueue(uid)) {
            const summonProps = ["sp2", "sp4", "sp7", "ms11", "sp11"];
            const hasPriority = summonProps.some(loc => targetFloor[loc].nextId === uid);
            if (!hasPriority) return await interaction.update({
                content: getMsg("rooms.limitReached"),
                components: [],
                flags: 64
            }).catch(() => {});
        }

        summonSelectionCache[uid] = {
            panelId: pKey,
            selectedLoc: selectedLoc
        };
        return await interaction.update({
            content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
            components: [new t().addComponents(new i()
                .setCustomId(`summonticket-${pKey}`)
                .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
                .addOptions(getArray("tickets").map(e => ({
                    label: e.label,
                    value: e.value,
                    emoji: "🎫"
                })))
            )],
            flags: 64
        }).catch(() => {});
    }        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("summonticket-")) {
        let pStr = checkPunishment(uid);
        if (pStr) return await interaction.update({
            content: pStr,
            components: [],
            flags: 64
        }).catch(() => {});
        let pKey = interaction.customId.replace("summonticket-", ""),
            targetFloor = db[pKey],
            cacheObj = summonSelectionCache[uid];

        if (!cacheObj || cacheObj.panelId !== pKey) {
            return await interaction.update({
                content: getMsg("rooms.antidemonTimeoutCache"),
                components: [],
                flags: 64
            }).catch(() => {});
        }

        if (hasActiveClaim(uid)) return await interaction.update({
            content: getMsg("rooms.limitReached"),
            components: [],
            flags: 64
        }).catch(() => {});
        // Allow claiming if user has priority reservation (nextId) on this panel
        if (hasActiveQueue(uid)) {
            const summonProps = ["sp2", "sp4", "sp7", "ms11", "sp11"];
            const hasPriority = summonProps.some(loc => targetFloor[loc].nextId === uid);
            if (!hasPriority) return await interaction.update({
                content: getMsg("rooms.limitReached"),
                components: [],
                flags: 64
            }).catch(() => {});
        }

        let selectedLoc = cacheObj.selectedLoc,
            calcMinutes = 30 * parseInt(interaction.values[0]),
            startTime = getLocalTime(),
            endTime = new Date(startTime.getTime() + 6e4 * calcMinutes),
            rangeStr = `${getFormattedTime12h(startTime)} ~ ${getFormattedTime12h(endTime)}`;

        // Check priority reservation — if someone is next in queue (not the current user), block claim
        if (targetFloor[selectedLoc].nextId && targetFloor[selectedLoc].nextId !== uid) {
            let timeRemainingStr = "";
            if (targetFloor[selectedLoc].endLimit) {
                let limitTime = parseStringToDate(targetFloor[selectedLoc].endLimit);
                if (limitTime) {
                    let diffMs = limitTime.getTime() - getLocalTime().getTime();
                    let diffMins = Math.ceil(diffMs / 6e4);
                    if (diffMins > 0) {
                        timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
                    }
                }
            }
            if (timeRemainingStr) {
                delete summonSelectionCache[uid];
                return await interaction.update({
                    content: getMsg("cooldowns.floorReservedNotice", { userName: targetFloor[selectedLoc].nextName, timeRemaining: timeRemainingStr }),
                    components: [],
                    flags: 64
                }).catch(() => {});
            }
            // endLimit expired — clear the queue and proceed
            targetFloor[selectedLoc].nextId = null;
            targetFloor[selectedLoc].nextName = null;
            targetFloor[selectedLoc].endLimit = null;
            targetFloor[selectedLoc].formattedTimeNext = "";
            "🟢 Open" === targetFloor[selectedLoc].status && (targetFloor[selectedLoc].status = "🟢 Available");
        }

        // Clear any existing next/queue for this user on this location
        if (targetFloor[selectedLoc].nextId === uid) {
            targetFloor[selectedLoc].nextId = null;
            targetFloor[selectedLoc].nextName = null;
            targetFloor[selectedLoc].endLimit = null;
            targetFloor[selectedLoc].formattedTimeNext = "";
        }

        targetFloor[selectedLoc].status = "🔴 Claimed";
        targetFloor[selectedLoc].ownerId = uid;
        targetFloor[selectedLoc].ownerName = uName;
        targetFloor[selectedLoc].time = `${getFormattedTime12h(startTime)}\nto  ${getFormattedTime12h(endTime)}`;
        targetFloor[selectedLoc].timeWindow = rangeStr;

        pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${targetFloor[selectedLoc].name}`, `Total Ticket: ${calcMinutes} min until ${getFormattedTime12h(endTime)}`);

        notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", {
            title: `${targetFloor.title} (${targetFloor[selectedLoc].name})`,
            window: rangeStr
        }));

        delete summonSelectionCache[uid];
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: getMsg("rooms.summonClaimSuccessEphemeral"),
            components: [],
            flags: 64
        }).catch(() => {});
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("summonnextside-")) {
        let pStr = checkPunishment(uid);
        if (pStr) return await interaction.update({
            content: pStr,
            components: [],
            flags: 64
        }).catch(() => {});
        let pKey = interaction.customId.replace("summonnextside-", ""),
            targetFloor = db[pKey];
        if (!targetFloor) return await interaction.update({
            content: getMsg("rooms.antidemonTimeoutCache"),
            components: [],
            flags: 64
        }).catch(() => {});

        if (hasActiveClaim(uid) || hasActiveQueue(uid)) return await interaction.update({
            content: getMsg("rooms.limitReached"),
            components: [],
            flags: 64
        }).catch(() => {});

        let selectedLoc = interaction.values[0];
        if (targetFloor[selectedLoc].nextId) return await interaction.update({
            content: getMsg("rooms.antidemonQueueLocked"),
            components: [],
            flags: 64
        }).catch(() => {});

        let baseTime = getLocalTime();
        if (targetFloor[selectedLoc].timeWindow) {
            let calcLimit = parseStringToDate(targetFloor[selectedLoc].timeWindow.split(" ~ ")[1]);
            calcLimit && (baseTime = calcLimit);
        }

        targetFloor[selectedLoc].nextId = uid;
        targetFloor[selectedLoc].nextName = uName;
        targetFloor[selectedLoc].formattedTimeNext = getFormattedTime12h(baseTime);
        targetFloor[selectedLoc].endLimit = null;

        pushToDailyLogs("QUEUE_JOIN", uName, `${targetFloor.title} - ${targetFloor[selectedLoc].name}`, getMsg("render.joinedAsNext"));
        notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", {
            title: `${targetFloor.title} - ${targetFloor[selectedLoc].name}`
        }));

        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({
            content: getMsg("rooms.summonQueueSuccessEphemeral"),
            components: [],
            flags: 64
        }).catch(() => {});
    }

    // Confirmation handler for !resetlogs
    if (interaction.isButton() && interaction.customId.startsWith("confirm-resetlogs-")) {
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
        return;
    }

    if (!interaction.isButton()) return;
    let [actionPrefix, panelKey, specificProp] = interaction.customId.split("-"),
        targetObj = db[panelKey];

    if (targetObj) {            if ("death" === actionPrefix) {
                if (targetObj[specificProp].status.startsWith("🔴 Killed")) return await interaction.reply({
                    content: getMsg("rooms.deathTimerRunning"),
                    flags: 64
                }).catch(() => {});
                if (targetObj.ownerId !== uid) return await interaction.reply({
                    content: getMsg("system.accessDenied", {
                        ownerName: targetObj.ownerName || getMsg("render.unknownUser")
                    }),
                    flags: 64
                }).catch(() => {});
                let currTimeStr = getFormattedTime12h(getLocalTime());
                let nowTs = getLocalTime().getTime();

                targetObj[specificProp].status = `🔴 Killed at ${currTimeStr}`;
                targetObj[specificProp]._lastKilledAt = nowTs;
                pushToDailyLogs("DEATH_MARK", uName, `${targetObj.title} - ${targetObj[specificProp].name}`, `Killed at ${currTimeStr}`);
                saveLocalStorage();
                await refreshVisualPanel(panelKey);
                return await interaction.reply({
                    content: getMsg("rooms.deathLogged"),
                    flags: 64
                }).catch(() => {});
            }
        if ("floor" === actionPrefix) {
            if ("summon" === targetObj.type) {
                if ("claim" === specificProp) {
                    let pStr = checkPunishment(uid);
                    if (pStr) return await interaction.reply({
                        content: pStr,
                        flags: 64
                    }).catch(() => {});
                    if (hasActiveClaim(uid)) return await interaction.reply({
                        content: getMsg("rooms.limitReached"),
                        flags: 64
                    }).catch(() => {});
                    // Allow claiming if user has priority reservation (nextId) on this panel
                    if (hasActiveQueue(uid)) {
                        const hasPriority = ["sp2", "sp4", "sp7", "ms11", "sp11"].some(loc => targetObj[loc].nextId === uid);
                        if (!hasPriority) return await interaction.reply({
                            content: getMsg("rooms.limitReached"),
                            flags: 64
                        }).catch(() => {});
                    }
                    // Build summon location options (available or reserved for this user)
                    const summonProps = ["sp2", "sp4", "sp7", "ms11", "sp11"];
                    // Find which locations the user has priority reservation on
                    const priorityLocs = summonProps.filter(loc => targetObj[loc].nextId === uid && targetObj[loc].status !== "🔴 Claimed");
                    // Find freely available locations
                    const freeLocs = summonProps.filter(loc => targetObj[loc].status !== "🔴 Claimed" && !targetObj[loc].nextId);
                    // If user has priority, ONLY show reserved locations — otherwise show all free ones
                    const showLocs = priorityLocs.length > 0 ? priorityLocs : freeLocs;
                    const locOptions = showLocs.map(loc => ({
                        label: targetObj[loc].name,
                        value: loc,
                        emoji: "🌀"
                    }));
                    if (locOptions.length === 0) return await interaction.reply({
                        content: getMsg("rooms.antidemonQueueLocked"),
                        flags: 64
                    }).catch(() => {});
                    return await interaction.reply({
                        content: `🌀 **${getMsg("rooms.summonMenuSelectClaim")}**`,
                        components: [new t().addComponents(new i()
                            .setCustomId(`summonslide-${panelKey}`)
                            .setPlaceholder(getMsg("rooms.summonSelectPlaceholder"))
                            .addOptions(locOptions)
                        )
                        ],
                        flags: 64
                    }).catch(() => {});
                }
                if ("next" === specificProp) {
                    let pStr = checkPunishment(uid);
                    if (pStr) return await interaction.reply({
                        content: pStr,
                        flags: 64
                    }).catch(() => {});
                    if (hasActiveClaim(uid) || hasActiveQueue(uid)) return await interaction.reply({
                        content: getMsg("rooms.limitReached"),
                        flags: 64
                    }).catch(() => {});
                    const summonProps = ["sp2", "sp4", "sp7", "ms11", "sp11"];
                    const queueOpts = summonProps.filter(loc => targetObj[loc].status === "🔴 Claimed" && !targetObj[loc].nextId).map(loc => ({
                        label: targetObj[loc].name,
                        value: loc,
                        emoji: "🌀"
                    }));
                    if (queueOpts.length === 0) return await interaction.reply({
                        content: getMsg("rooms.antidemonQueueLocked"),
                        flags: 64
                    }).catch(() => {});
                    return await interaction.reply({
                        content: `🌀 **${getMsg("rooms.summonMenuSelectNext")}**`,
                        components: [new t().addComponents(new i()
                            .setCustomId(`summonnextside-${panelKey}`)
                            .setPlaceholder(getMsg("rooms.summonSelectPlaceholder"))
                            .addOptions(queueOpts)
                        )
                        ],
                        flags: 64
                    }).catch(() => {});
                }
                if ("cancel" === specificProp) {
                    const summonProps = ["sp2", "sp4", "sp7", "ms11", "sp11"];
                    let isMod = interaction.member.permissions.has("ManageMessages"),
                        isOwner = summonProps.some(p => targetObj[p].ownerId === uid),
                        isInQueue = summonProps.some(p => targetObj[p].nextId === uid);

                    if (isOwner || isInQueue || isMod) {
                        let penalized = !1;
                        let anyAction = !1;
                        return summonProps.forEach(loc => {
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
                                "🟢 Open" === targetObj[loc].status && (targetObj[loc].status = "🟢 Available");
                            }
                        }), saveLocalStorage(), await refreshVisualPanel(panelKey), await interaction.reply({
                            content: anyAction 
                                ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback"))
                                : getMsg("rooms.noActiveClaimsFeedback"),
                            flags: 64
                        }).catch(() => {});
                    }
                    return await interaction.reply({
                        content: getMsg("rooms.noActiveClaimsFeedback"),
                        flags: 64
                    }).catch(() => {});
                }
            }
            if ("antidemon" === targetObj.type) {
                if ("claim" === specificProp) {
                    let pStr = checkPunishment(uid);
                    if (pStr) return await interaction.reply({
                        content: pStr,
                        flags: 64
                    }).catch(() => {});
                    if (hasActiveClaim(uid)) return await interaction.reply({
                        content: getMsg("rooms.limitReached"),
                        flags: 64
                    }).catch(() => {});
                    // Allow claiming if user has priority reservation (nextId) on this panel
                    if (hasActiveQueue(uid)) {
                        const hasPriority = ["left", "mid", "right"].some(rm => targetObj[rm].nextId === uid);
                        if (!hasPriority) return await interaction.reply({
                            content: getMsg("rooms.limitReached"),
                            flags: 64
                        }).catch(() => {});
                    }
                    return await interaction.reply({
                        content: `👹 **${getMsg("rooms.antidemonMenuSelectClaim")}**`,
                        components: [new t().addComponents(new i()
                            .setCustomId(`antislide-${targetObj.type === "antidemon" ? panelKey : ""}`)
                            .setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder"))
                            .addOptions(buildAntiClaimOptions(targetObj, uid))
                        )
                        ],
                        flags: 64
                    }).catch(() => {});
                }
                if ("next" === specificProp) {
                    let pStr = checkPunishment(uid);
                    if (pStr) return await interaction.reply({
                        content: pStr,
                        flags: 64
                    }).catch(() => {});
                    if (hasActiveClaim(uid) || hasActiveQueue(uid)) return await interaction.reply({
                        content: getMsg("rooms.limitReached"),
                        flags: 64
                    }).catch(() => {});
                    return await interaction.reply({
                        content: `⚔️ **${getMsg("rooms.antidemonMenuSelectNext")}**`,
                        components: [new t().addComponents(new i()
                            .setCustomId(`antinextside-${panelKey}`)
                            .setPlaceholder(getMsg("rooms.antidemonSelectPlaceholder"))
                            .addOptions(buildAntiQueueOptions(targetObj))
                        )
                        ],
                        flags: 64
                    }).catch(() => {});
                }
                if ("cancel" === specificProp) {
                    let isMod = interaction.member.permissions.has("ManageMessages"),
                        isOwner = targetObj.left.ownerId === uid || targetObj.mid.ownerId === uid || targetObj.right.ownerId === uid,
                        isInQueue = targetObj.left.nextId === uid || targetObj.mid.nextId === uid || targetObj.right.nextId === uid;

                    if (isOwner || isInQueue || isMod) {
                        let penalized = !1;
                        let anyAction = !1;
                        return ["left", "mid", "right"].forEach(rm => {
                            // Only cancel rooms where the user is the actual owner (not all rooms just because isMod)
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
                            // Only cancel queue where the user is actually in queue
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
                                "🟢 Open" === targetObj[rm].status && (targetObj[rm].status = "🟢 Available");
                            }
                        }), saveLocalStorage(), await refreshVisualPanel(panelKey), await interaction.reply({
                            content: anyAction 
                                ? (penalized ? getMsg("cooldowns.canceledClaimFeedback") : getMsg("rooms.actionsCanceledFeedback"))
                                : getMsg("rooms.noActiveClaimsFeedback"),
                            flags: 64
                        }).catch(() => {});
                    }
                    return await interaction.reply({
                        content: getMsg("rooms.noActiveClaimsFeedback"),
                        flags: 64
                    }).catch(() => {});
                }
            }
            if ("cancel" === specificProp) {
                let isMod = interaction.member.permissions.has("ManageMessages"),
                    isOwner = targetObj.ownerId === uid,
                    inQueue = !1,
                    pointer = targetObj.next;

                for (; pointer;) {
                    if (pointer.userId === uid) {
                        inQueue = !0;
                        break;
                    }
                    pointer = pointer.nextQueue;
                }

                if (isOwner) {
                    pushToDailyLogs("CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.voluntaryLeave"));
                    notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", {
                        title: targetObj.title,
                        reason: getMsg("logs.voluntaryLeave")
                    }));
                    freeFloorAndActivateNextGracePeriod(targetObj);
                    if (!isMod) applyFiveMinCooldown(uid);
                    await refreshVisualPanel(panelKey);
                    return await interaction.reply({
                        content: getMsg("cooldowns.canceledClaimFeedback"),
                        flags: 64
                    }).catch(() => {});
                }
                if (isMod && targetObj.ownerId) {
                    pushToDailyLogs("CANCEL", targetObj.ownerName, targetObj.title, getMsg("logs.staffCancel"));
                    notifyUserDM(targetObj.ownerId, getMsg("rooms.dmRemovedNotice", {
                        title: targetObj.title,
                        reason: getMsg("logs.staffCancel")
                    }));
                    freeFloorAndActivateNextGracePeriod(targetObj);
                    await refreshVisualPanel(panelKey);
                    return await interaction.reply({
                        content: getMsg("rooms.floorReleasedSuccess"),
                        flags: 64
                    }).catch(() => {});
                }
                if (inQueue) {
                    pushToDailyLogs("CANCEL", uName, targetObj.title, getMsg("logs.queueLeave"));
                    notifyUserDM(uid, getMsg("rooms.dmRemovedNotice", {
                        title: targetObj.title,
                        reason: getMsg("logs.queueLeave")
                    }));
                    removeUserFromQueue(targetObj, uid);
                    saveLocalStorage();
                    await refreshVisualPanel(panelKey);
                    return await interaction.reply({
                        content: getMsg("rooms.removedFromQueueFeedback"),
                        flags: 64
                    }).catch(() => {});
                }
                return await interaction.reply({
                    content: getMsg("rooms.noActiveClaimsFeedback"),
                    flags: 64
                }).catch(() => {});
            }

            if (targetObj.ownerId && targetObj.ownerId !== uid && !interaction.customId.endsWith("-next")) {
                return await interaction.reply({
                    content: getMsg("system.accessDenied", {
                        ownerName: targetObj.ownerName
                    }),
                    flags: 64
                }).catch(() => {});
            }

            if ("claim" === specificProp) {
                let pStr = checkPunishment(uid);
                if (pStr) return await interaction.reply({
                    content: pStr,
                    flags: 64
                }).catch(() => {});
                if (hasActiveClaim(uid)) return await interaction.reply({
                    content: getMsg("rooms.limitReached"),
                    flags: 64
                }).catch(() => {});
                if (hasActiveQueue(uid)) return await interaction.reply({
                    content: getMsg("rooms.limitReached"),
                    flags: 64
                }).catch(() => {});

                if (targetObj.next && targetObj.next.userId !== uid) {
                    let timeRemainingStr = "";

                    if (targetObj.next.endLimit) {
                        let limitTime = parseStringToDate(targetObj.next.endLimit);
                        if (limitTime) {
                            let diffMs = limitTime.getTime() - getLocalTime().getTime();
                            let diffMins = Math.ceil(diffMs / 6e4);

                            if (diffMins > 0) {
                                timeRemainingStr = getMsg("cooldowns.timeRemaining", { minutes: diffMins });
                            }
                        }
                    }

                    return await interaction.reply({
                        content: getMsg("cooldowns.floorReservedNotice", { userName: targetObj.next.userName, timeRemaining: timeRemainingStr }),
                        flags: 64
                    }).catch(() => {});
                }

                let start = getLocalTime(),
                    end = new Date(start.getTime() + 18e5),
                    windowStr = `${getFormattedTime12h(start)} ~ ${getFormattedTime12h(end)}`;

                targetObj.ownerId = uid;
                targetObj.ownerName = uName;
                targetObj.timeWindow = windowStr;
                targetObj._claimTimestamp = start.getTime();

                pushToDailyLogs("CLAIM_START", uName, targetObj.title, `${getMsg("render.windowPrefix")}: ${targetObj.timeWindow}`);
                notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", {
                    title: targetObj.title,
                    window: windowStr
                }));

                if (targetObj.next && targetObj.next.userId === uid) {
                    targetObj.next = targetObj.next.nextQueue || null;
                }
                return saveLocalStorage(), await refreshVisualPanel(panelKey), await interaction.reply({
                    content: getMsg("rooms.floorClaimSuccess"),
                    flags: 64
                }).catch(() => {});
            }

            if ("next" === specificProp) {
                let pStr = checkPunishment(uid);
                if (pStr) return await interaction.reply({
                    content: pStr,
                    flags: 64
                }).catch(() => {});
                if ("peak" === targetObj.type) return await interaction.reply({
                    content: getMsg("rooms.alreadyOwner"),
                    flags: 64
                }).catch(() => {});
                if (hasActiveClaim(uid) || hasActiveQueue(uid)) return await interaction.reply({
                    content: getMsg("rooms.limitReached"),
                    flags: 64
                }).catch(() => {});
                if (targetObj.ownerId === uid) return await interaction.reply({
                    content: getMsg("rooms.alreadyOwner"),
                    flags: 64
                }).catch(() => {});

                let pointer = targetObj.next,
                    inQueue = !1;
                for (; pointer;) {
                    if (pointer.userId === uid) {
                        inQueue = !0;
                        break;
                    }
                    pointer = pointer.nextQueue;
                }
                if (inQueue) return await interaction.reply({
                    content: getMsg("rooms.alreadyInQueue"),
                    flags: 64
                }).catch(() => {});

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
                notifyUserDM(uid, getMsg("rooms.dmQueueJoinedNotice", {
                    title: targetObj.title
                }));

                return saveLocalStorage(), await refreshVisualPanel(panelKey), await interaction.reply({
                    content: getMsg("rooms.queueJoinedSuccess"),
                    flags: 64
                }).catch(() => {});
            }
        }
    }
}
