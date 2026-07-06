// ==========================================
// 👑 ADMIN TEXT COMMANDS
// !setlogs, !setbosschannel, !seteventchannel,
// !testevent, !logs, !resetlogs, !kick, !update, !reset
// ==========================================

import {
    EmbedBuilder as e,
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import { execSync, exec } from "child_process";
import { getMsg } from "../lang.js";
import { db, dailyLogs } from "../state.js";
import { saveDailyLogs, dispatchDailyLogs } from "../daily-logs.js";
import { setupTicketPanel } from "../ticket-system.js";
import { refreshVisualPanel, resetPanelData } from "../panel-utils.js";
import { STATUS_CLAIMED } from "../constants.js";
import { getAntidemonRoomKeys, getAntidemonRoomName, getSummonRoomKeys, getEventGroupKeys } from "../claim-core.js";
import { reserveFlowCache } from "../interactions/admin-interactions.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export async function handleAdminCommand(msg) {
    const lowerContent = msg.content.toLowerCase().trim();

    if ("!setlogs" === lowerContent) {
        return handleSetLogs(msg);
    }
    if ("!setbosschannel" === lowerContent) {
        return handleSetBossChannel(msg);
    }
    if ("!seteventchannel" === lowerContent) {
        return handleSetEventChannel(msg);
    }
    if ("!testevent" === lowerContent) {
        return handleTestEvent(msg);
    }
    if ("!logs" === lowerContent) {
        return handleLogs(msg);
    }
    if ("!resetlogs" === lowerContent) {
        return handleResetLogs(msg);
    }
    if ("!setticket" === lowerContent) {
        return handleSetTicket(msg);
    }
    if ("!kick" === lowerContent) {
        return handleKick(msg);
    }
    if ("!update" === lowerContent) {
        return handleUpdate(msg);
    }
    if ("!reset" === lowerContent) {
        return handleResetMenu(msg);
    }
    if (lowerContent.startsWith("!reset ")) {
        return handleResetSpecific(msg, lowerContent.replace("!reset ", "").trim());
    }

    // ==========================================
    // 🔒 RESERVE COMMANDS (Fury/Frenzy)
    // ==========================================
    if ("!furyreserve" === lowerContent || lowerContent.startsWith("!furyreserve ")) {
        return handleReserveEvent(msg, "fury", lowerContent.replace("!furyreserve", "").trim());
    }
    if ("!frenzyreserve" === lowerContent || lowerContent.startsWith("!frenzyreserve ")) {
        return handleReserveEvent(msg, "frenzy", lowerContent.replace("!frenzyreserve", "").trim());
    }
    if ("!furyopen" === lowerContent) {
        return handleOpenEvent(msg, "fury");
    }
    if ("!frenzyopen" === lowerContent) {
        return handleOpenEvent(msg, "frenzy");
    }
    if ("!reserve" === lowerContent || lowerContent.startsWith("!reserve ")) {
        return handleReserveInteractive(msg);
    }

    return false; // not handled
}

// ==========================================
// 📋 SET LOGS CHANNEL
// ==========================================

async function handleSetLogs(msg) {
    if (msg.member.permissions.has("ManageGuild")) {
        dailyLogs.configChannelId = msg.channel.id;
        saveDailyLogs();
        return msg.reply({ content: getMsg("logs.setupSuccess") }).catch(() => {
                // Silently ignore — message may be deleted or channel unavailable
            });
    }
    return msg.reply({ content: getMsg("logs.setupError") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🎯 SET BOSS CHANNEL
// ==========================================

async function handleSetBossChannel(msg) {
    if (msg.member.permissions.has("ManageGuild")) {
        dailyLogs.bossSpawnChannelId = msg.channel.id;
        saveDailyLogs();
        return msg.reply({ content: "✅ Boss spawn notifications will be sent to this channel." }).catch(() => {
        // Silently ignore — message may be deleted or channel unavailable
    });
    }
    return msg.reply({ content: "❌ You need the Manage Server permission to configure this." }).catch(() => {
        // Silently ignore — message may be deleted or channel unavailable
    });
}

// ==========================================
// 🚨 SET EVENT CHANNEL
// ==========================================

async function handleSetEventChannel(msg) {
    if (msg.member.permissions.has("ManageGuild")) {
        dailyLogs.scheduledEventChannelId = msg.channel.id;
        saveDailyLogs();
        return msg.reply({ content: "✅ Event alerts (Red Boss, Leader 3, Purgatory, etc.) will be sent to this channel with @everyone." }).catch(() => {
        // Silently ignore — message may be deleted or channel unavailable
    });
    }
    return msg.reply({ content: "❌ You need the Manage Server permission to configure this." }).catch(() => {
        // Silently ignore — message may be deleted or channel unavailable
    });
}

// ==========================================
// 🧪 TEST EVENT
// ==========================================

async function handleTestEvent(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: "❌ You need the Manage Messages permission to use this." }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    if (!dailyLogs.scheduledEventChannelId) {
        return msg.reply({ content: "❌ No event channel configured. Use `!seteventchannel` first." }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    const targetChannel = msg.guild.channels.cache.get(dailyLogs.scheduledEventChannelId);
    if (!targetChannel) {
        return msg.reply({ content: "❌ Configured channel not found. Re-configure with `!seteventchannel`." }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    const testEmbed = new e()
        .setTitle("🚨 Event Alert! 🚨")
        .setColor("#ff6600")
        .setDescription(
            `🔔 **TEST NOTIFICATION** 🔔\n\n` +
            `This is a test alert to verify the event system is working correctly.\n\n` +
            `The following events would be announced here:\n` +
            `• **Red Boss (Secret Peak)**\n` +
            `• **Leader 3 (Magic Square)**\n` +
            `• **Purgatory**\n` +
            `• **World Boss Labyrinth**\n` +
            `• **World Boss Valley**\n` +
            `• **Mirage World Boss**\n` +
            `• **Golden Sphere (W1 Roaring Flame)**\n` +
            `• **Golden Sphere (W2 Nine Dragon)**\n` +
            `• **Red Boss (SP11 + SP12)** — 01:00, 07:00 AM/PM\n` +
            `• **Random Event (SP12)** — 03:00, 09:00 AM/PM\n` +
            `• **Krukan (Schackling Abbadon)** — Mon 23:00\n` +
            `• **Valley War** — Wed 22:00\n` +
            `• **Hellbar (7F Purgatory)** — Wed 23:00\n` +
            `• **Altar Defense + Living Wraiths Event** — Thu 22:00\n` +
            `• **Mirage Living Wraiths** — Thu 23:00\n` +
            `• **Heist** — Fri 22:00\n` +
            `• **Utukan (Crimson Abbadon)** — Fri 23:00\n\n` +
            `⏰ Notifications are sent 10 minutes before each spawn.\n\n` +
            `Get ready and **don't forget to do the mission!** 💪`
        )
        .setTimestamp();
    try {
        await targetChannel.send({ content: "@everyone", embeds: [testEmbed] });
        return msg.reply({ content: `✅ Test event alert sent to ${targetChannel}.` }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    } catch (err) {
        return msg.reply({ content: `❌ Failed to send test alert: ${err.message}` }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
}

// ==========================================
// 📄 LOGS DISPATCH
// ==========================================

async function handleLogs(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {return msg.reply({ content: getMsg("logs.modRequired") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    if (!dailyLogs.configChannelId) {return msg.reply({ content: getMsg("logs.noChannel") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    if (!await dispatchDailyLogs(!0)) {return msg.reply({ content: getMsg("logs.dispatchError") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    if (msg.channel.id !== dailyLogs.configChannelId) {return msg.reply({ content: getMsg("logs.dispatchSuccess") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    try { await msg.delete() } catch (r) {
        // Silently ignore — message may already be deleted
    }
}

// ==========================================
// 🔄 RESET LOGS
// ==========================================

async function handleResetLogs(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    const oldCount = (dailyLogs.queue || []).length;
    await msg.reply({
        content: getMsg("system.resetLogsConfirm", { count: oldCount }),
        components: [
            new t().addComponents(
                new n().setCustomId("confirm-resetlogs-yes").setLabel("✅ Yes, clear logs").setStyle(a.Success),
                new n().setCustomId("confirm-resetlogs-no").setLabel("❌ No, cancel").setStyle(a.Danger)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    try { await msg.delete() } catch (e) {
        // Silently ignore — message may already be deleted
    }
}

// ==========================================
// 🎫 SET TICKET PANEL
// ==========================================

async function handleSetTicket(msg) {
    if (!msg.member || !msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: "❌ You need the Manage Messages permission to use this." }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    await setupTicketPanel(msg.channel);
    return msg.reply({ content: "✅ Ticket panel created in this channel!" }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 👢 KICK MENU
// ==========================================

async function handleKick(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    const optionsList = [];
    for (const key in db) {
        const current = db[key];
        if (!current || key.startsWith("_")) continue;
        const cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
        if ("event_group" === current.type) {
            const egKeys = getEventGroupKeys(current);
            for (const ev of egKeys) {
                const evData = current[ev];
                if (evData.ownerId) {
                    optionsList.push({
                        label: `${cleanedTitle} - ${evData.name}`,
                        description: `${getMsg("system.kickCurrentLabel")} ${evData.ownerName}`,
                        value: `kick-${key}-${ev}-${evData.ownerId}`
                    });
                }
            }
        } else if ("antidemon" === current.type) {
            const antiRoomKeys = getAntidemonRoomKeys(key);
            // Individual room options
            for (const room of antiRoomKeys) {
                STATUS_CLAIMED === current[room].status && current[room].ownerId && optionsList.push({
                    label: `${cleanedTitle} - ${room.toUpperCase()} Room`,
                    description: `${getMsg("system.kickCurrentLabel")} ${current[room].ownerName}`,
                    value: `kick-${key}-${room}-${current[room].ownerId}`
                });
            }
            // Combo options for 11/12 panels: same-version rooms with same owner
            if (antiRoomKeys.length > 3) {
                const versions = ["v1", "v2", "v3"];
                for (const ver of versions) {
                    const l = `${ver}l`, m = `${ver}m`, r = `${ver}r`;
                    const lOwned = current[l] && current[l].status === STATUS_CLAIMED && current[l].ownerId;
                    const mOwned = current[m] && current[m].status === STATUS_CLAIMED && current[m].ownerId;
                    const rOwned = current[r] && current[r].status === STATUS_CLAIMED && current[r].ownerId;
                    // LEFT + MID combo (same owner)
                    if (lOwned && mOwned && current[l].ownerId === current[m].ownerId) {
                        optionsList.push({
                            label: `${cleanedTitle} - ${getAntidemonRoomName(key, l)} + ${getAntidemonRoomName(key, m)}`,
                            description: `${getMsg("system.kickCurrentLabel")} ${current[l].ownerName}`,
                            value: `kick-${key}-${l}+${m}-${current[l].ownerId}`
                        });
                    }
                    // MID + RIGHT combo (same owner)
                    if (mOwned && rOwned && current[m].ownerId === current[r].ownerId) {
                        optionsList.push({
                            label: `${cleanedTitle} - ${getAntidemonRoomName(key, m)} + ${getAntidemonRoomName(key, r)}`,
                            description: `${getMsg("system.kickCurrentLabel")} ${current[m].ownerName}`,
                            value: `kick-${key}-${m}+${r}-${current[m].ownerId}`
                        });
                    }
                }
            }
        } else if ("summon" === current.type) {
            const summonProps = getSummonRoomKeys(key);
            for (const loc of summonProps) {
                STATUS_CLAIMED === current[loc].status && current[loc].ownerId && optionsList.push({
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
    if (0 === optionsList.length) {return msg.reply({ content: getMsg("system.kickNoClaims") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    await msg.reply({
        content: getMsg("system.kickPanelTitle"),
        components: [new t().addComponents(
            new i().setCustomId("admin-kick-menu").setPlaceholder(getMsg("system.kickPanelPlaceholder")).addOptions(optionsList.slice(0, 25))
        )]
    });
    try { await msg.delete() } catch (p) {
        // Silently ignore — message may already be deleted
    }
}

// ==========================================
// 🔄 UPDATE (git pull + npm install)
// ==========================================

async function handleUpdate(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    const updateReply = await msg.reply({ content: getMsg("system.updateRunningGit") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    try {
        const output = execSync("git pull --rebase", { encoding: "utf8", cwd: process.cwd() });
        if (updateReply) {await updateReply.edit({ content: getMsg("system.updateSuccess", { output: output.slice(0, 1900) }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
        execSync("npm install", { encoding: "utf8", cwd: process.cwd(), stdio: "pipe" });
        exec("pm2 restart bot", () => process.exit());
    } catch (e) {
        if (updateReply) {await updateReply.edit({ content: getMsg("system.updateError", { error: (e.message || e).slice(0, 1900) }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    }
}

// ==========================================
// 🔄 RESET MENU
// ==========================================

async function handleResetMenu(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    const optionsList = [];
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        const cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
        optionsList.push({ label: `${cleanedTitle}`, description: `Key: ${key}`, value: key });
    }
    if (0 === optionsList.length) {return msg.reply({ content: getMsg("system.resetNoPanels") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    if (optionsList.length > 1) {
        optionsList.unshift({ label: "🔄 Reset ALL Panels", description: "Reset all panels to defaults", value: "__all__" });
    }
    await msg.reply({
        content: getMsg("system.resetMenuTitle"),
        components: [new t().addComponents(
            new i().setCustomId("admin-reset-menu").setPlaceholder(getMsg("system.resetMenuPlaceholder")).addOptions(optionsList.slice(0, 25))
        )]
    });
    try { await msg.delete() } catch (C) {
        // Silently ignore — message may already be deleted
    }
}

// ==========================================
// 🔄 RESET SPECIFIC PANEL
// ==========================================

async function handleResetSpecific(msg, resetKey) {
    if (!msg.member.permissions.has("ManageMessages")) {return msg.reply({ content: getMsg("system.permissionDeniedManageMessages") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}

    if ("all" === resetKey) {
        let count = 0;
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            resetPanelData(key);
            await refreshVisualPanel(key);
            count++;
        }
        return msg.reply({ content: `✅ Reset ${count} panels to defaults.` }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!db[resetKey]) {return msg.reply({ content: getMsg("system.resetPanelNotFound", { key: resetKey }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });}
    resetPanelData(resetKey);
    await refreshVisualPanel(resetKey);
    return msg.reply({ content: getMsg("system.resetPanelSuccess", { key: resetKey }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🔒 RESERVE EVENT (Fury/Frenzy)
// ==========================================

async function handleReserveEvent(msg, eventName, userArg) {
    if (!msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: getMsg("reserve.permissionDenied") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!userArg) {
        return msg.reply({ content: getMsg("reserve.userNotFound", { usage: getMsg(`reserve.usage${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`) }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // Extract user ID from mention or raw ID
    const targetId = userArg.replace(/[<@!>]/g, "").trim();
    let targetMember;
    try {
        targetMember = await msg.guild.members.fetch(targetId).catch(() => null);
    } catch (e) {
        // Silently ignored — non-critical operation
    }

    if (!targetMember) {
        return msg.reply({ content: getMsg("reserve.userNotFound", { usage: getMsg(`reserve.usage${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`) }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const targetName = targetMember.displayName;
    const eventLabel = eventName.charAt(0).toUpperCase() + eventName.slice(1);
    let reservedCount = 0;

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;
        const evData = current[eventName];
        if (!evData || evData.type !== "fixed") continue;

        evData.reservedFor = targetId;
        evData.reservedByName = targetName;
        reservedCount++;
    }

    if (reservedCount === 0) {
        return msg.reply({ content: getMsg("reserve.noEvent", { event: eventLabel }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // Refresh all panels
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        await refreshVisualPanel(key);
    }

    return msg.reply({ content: getMsg("reserve.success", { event: eventLabel, userName: targetName }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🔒 RESERVE INTERACTIVE — Multi-step menu
// ==========================================

async function handleReserveInteractive(msg) {
    if (!msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: getMsg("reserve.permissionDenied") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const userArg = msg.content.replace("!reserve", "").trim();
    if (!userArg) {
        return msg.reply({ content: getMsg("reserve.interactive.noUser") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const targetId = userArg.replace(/[<@!>]/g, "").trim();
    let targetMember;
    try {
        targetMember = await msg.guild.members.fetch(targetId).catch(() => null);
    } catch (e) {
        // Silently ignore — member may have left the guild
    }

    if (!targetMember) {
        return msg.reply({ content: getMsg("reserve.userNotFound", { usage: "`!reserve @user`" }) }).catch(() => {
            // Silently ignore — message may be deleted or channel unavailable
        });
    }

    // Initialize flow state
    reserveFlowCache[msg.author.id] = {
        targetUserId: targetId,
        targetUserName: targetMember.displayName,
        step: "event"
    };

    return msg.reply({
        content: getMsg("reserve.interactive.selectEvent"),
        components: [
            new t().addComponents(
                new i()
                    .setCustomId("reserve-select-event")
                    .setPlaceholder("Choose event...")
                    .addOptions([
                        { label: "🔴 Fury", value: "fury", emoji: "🔴" },
                        { label: "🟣 Frenzy", value: "frenzy", emoji: "🟣" }
                    ])
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🔓 OPEN EVENT (Fury/Frenzy)
// ==========================================

async function handleOpenEvent(msg, eventName) {
    if (!msg.member.permissions.has("ManageMessages")) {
        return msg.reply({ content: getMsg("reserve.permissionDenied") }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const eventLabel = eventName.charAt(0).toUpperCase() + eventName.slice(1);
    let openedCount = 0;
    let wasReserved = false;

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;
        const evData = current[eventName];
        if (!evData || evData.type !== "fixed") continue;

        if (evData.reservedFor) {
            wasReserved = true;
        }

        evData.reservedFor = null;
        evData.reservedByName = null;
        openedCount++;
    }

    if (openedCount === 0) {
        return msg.reply({ content: getMsg("reserve.noEvent", { event: eventLabel }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!wasReserved) {
        return msg.reply({ content: getMsg("reserve.notReserved", { event: eventLabel }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // Refresh all panels
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        await refreshVisualPanel(key);
    }

    return msg.reply({ content: getMsg("reserve.openSuccess", { event: eventLabel }) }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}
