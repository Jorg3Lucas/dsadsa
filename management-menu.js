// ==========================================
// 🛠️ MANAGEMENT PANEL — Unified Bot Control
// /manage command opens a multi-category menu
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i,
    EmbedBuilder as e
} from "discord.js";
import { execSync, exec } from "child_process";
import { getMsg } from "./lang.js";
import { db, dailyLogs, saveLocalStorage } from "./state.js";
import { refreshVisualPanel, resetPanelData, notifyUserDM } from "./panel-utils.js";
import { pushToDailyLogs, saveDailyLogs, dispatchDailyLogs } from "./daily-logs.js";
import { setupTicketPanel } from "./ticket-system.js";
import { STATUS_CLAIMED } from "./constants.js";
import { freeAntidemonRoom, getAntidemonRoomKeys, getAntidemonRoomName, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";

const confirmTimeouts = new Map();

// ==========================================
// ⏰ TIMED CONFIRMATION HELPER
// Auto-expires after 30s and disables buttons
// ==========================================

async function sendTimedConfirm(interaction, content, buttons, timeoutMs = 30000) {
    await interaction.update({ content, components: buttons, flags: 64 }).catch(() => {});

    const key = interaction.id;
    const timeout = setTimeout(async () => {
        try {
            const reply = await interaction.fetchReply();
            const disabledRows = reply.components.map(row =>
                new t().addComponents(
                    ...row.components.map(btn =>
                        n.from(btn).setDisabled(true)
                    )
                )
            );
            await interaction.editReply({
                content: content + "\n\n⏰ **Prompt expired (30s). Please try again.**",
                components: disabledRows
            }).catch(() => {});
        } catch (e) {}
        confirmTimeouts.delete(key);
    }, timeoutMs);

    confirmTimeouts.set(key, timeout);
}

function clearConfirmTimeout(interaction) {
    const key = interaction.message?.interaction?.id || interaction.id;
    if (confirmTimeouts.has(key)) {
        clearTimeout(confirmTimeouts.get(key));
        confirmTimeouts.delete(key);
    }
}

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

// ==========================================
// 🎯 SLASH COMMAND — /manage
// ==========================================

export async function handleMgmtSlash(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.reply({
            content: getMsg("system.permissionDeniedAdminDropped"),
            flags: 64
        }).catch(() => {});
    }

    const embed = new e()
        .setTitle("🛠️ Bot Management Panel")
        .setColor("#2b2d31")
        .setDescription(
            "Select a category below to manage that system.\n\n" +
            "**🏗️ Panels** — Reset panels, kick users\n" +
            "**🔒 Reservations** — View/clear Fury/Frenzy reservations\n" +
            "**📢 Channels** — Configure log/event channels\n" +
            "**👥 Players** — Ranking user management\n" +
            "**📋 Logs** — Dispatch daily reports\n" +
            "**💰 Salary** — Manage salary polls\n" +
            "**🎫 Tickets** — Create ticket panel\n" +
            "**🔄 Update** — Git pull and restart"
        )
        .setTimestamp();

    return await interaction.reply({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🏗️").setLabel("Panels").setStyle(a.Primary),
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel("Reservations").setStyle(a.Primary),
                new n().setCustomId("mgmt-channels").setEmoji("📢").setLabel("Channels").setStyle(a.Primary),
                new n().setCustomId("mgmt-players").setEmoji("👥").setLabel("Players").setStyle(a.Primary),
                new n().setCustomId("mgmt-logs").setEmoji("📋").setLabel("Logs").setStyle(a.Secondary),
                new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel("Salary").setStyle(a.Secondary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-tickets").setEmoji("🎫").setLabel("Tickets").setStyle(a.Secondary),
                new n().setCustomId("mgmt-update").setEmoji("🔄").setLabel("Update Bot").setStyle(a.Danger)
            )
        ],
        flags: 64
    }).catch(() => {});
}

export function canHandleManagementInteraction(interaction) {
    const cid = interaction.customId;
    return cid === "mgmt-main" ||
        cid.startsWith("mgmt-");
}

export async function handleManagementInteraction(interaction, uid, extra) {
    const cid = interaction.customId;

    if (cid === "mgmt-main") return handleMgmtMain(interaction);
    if (cid === "mgmt-panels") return handleMgmtPanels(interaction);
    if (cid === "mgmt-panels-reset-menu") return handleMgmtPanelsResetMenu(interaction);
    if (cid === "mgmt-panels-kick-menu") return handleMgmtPanelsKickMenu(interaction);
    if (cid === "mgmt-reservations") return handleMgmtReservations(interaction);
    if (cid === "mgmt-reservations-clear") return handleMgmtReservationsClear(interaction);
    if (cid === "mgmt-reservations-clear-confirm") return handleMgmtReservationsClearExecute(interaction);
    if (cid === "mgmt-reservations-clear-cancel") return handleMgmtReservationsClearCancel(interaction);
    if (cid === "mgmt-channels") return handleMgmtChannels(interaction);
    if (cid === "mgmt-channels-logs") return handleMgmtChannelsLogs(interaction);
    if (cid === "mgmt-channels-boss") return handleMgmtChannelsBoss(interaction);
    if (cid === "mgmt-channels-events") return handleMgmtChannelsEvents(interaction);
    if (cid === "mgmt-update") return handleMgmtUpdate(interaction);
    if (cid === "mgmt-update-confirm") return handleMgmtUpdateConfirm(interaction);
    if (cid === "mgmt-update-cancel") return handleMgmtUpdateCancel(interaction);
    if (cid === "mgmt-tickets") return handleMgmtTickets(interaction);
    if (cid === "mgmt-logs") return handleMgmtLogs(interaction);
    if (cid === "mgmt-salary") return handleMgmtSalary(interaction);
    if (cid === "mgmt-players") return handleMgmtPlayers(interaction);
    if (cid === "mgmt-logs-dispatch") return handleMgmtLogsDispatch(interaction);
    if (cid === "mgmt-panels-reset-execute") return handleMgmtPanelsResetExecute(interaction);
    if (cid === "mgmt-panels-kick-execute") return handleMgmtPanelsKickExecute(interaction);

    return false;
}

// ==========================================
// 🏠 MAIN MENU
// ==========================================

async function handleMgmtMain(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const embed = new e()
        .setTitle("🛠️ Bot Management Panel")
        .setColor("#2b2d31")
        .setDescription(
            "Select a category below to manage that system.\n\n" +
            "**🟢 Active** — System is configured and running\n" +
            "**🔴 Inactive** — System needs configuration\n" +
            "**ℹ️ Status** — Click to view details"
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🏗️").setLabel("Panels").setStyle(a.Primary),
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel("Reservations").setStyle(a.Primary),
                new n().setCustomId("mgmt-channels").setEmoji("📢").setLabel("Channels").setStyle(a.Primary),
                new n().setCustomId("mgmt-players").setEmoji("👥").setLabel("Players").setStyle(a.Primary),
                new n().setCustomId("mgmt-logs").setEmoji("📋").setLabel("Logs").setStyle(a.Secondary),
                new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel("Salary").setStyle(a.Secondary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-tickets").setEmoji("🎫").setLabel("Tickets").setStyle(a.Secondary),
                new n().setCustomId("mgmt-update").setEmoji("🔄").setLabel("Update Bot").setStyle(a.Danger)
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 🏗️ PANEL MANAGEMENT
// ==========================================

async function handleMgmtPanels(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    // Count total panels and active claims
    let totalPanels = 0;
    let activeClaims = 0;

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        totalPanels++;
        const current = db[key];
        if (current.ownerId) activeClaims++;
        if ("event_group" === current.type) {
            const egKeys = getEventGroupKeys(current);
            for (const ev of egKeys) {
                if (current[ev] && current[ev].ownerId) activeClaims++;
            }
        }
        if ("antidemon" === current.type || "summon" === current.type) {
            const props = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
            for (const p of props) {
                if (current[p] && (current[p].status === "🔴 Claimed" || current[p].ownerId)) activeClaims++;
            }
        }
    }

    const embed = new e()
        .setTitle("🏗️ Panel Management")
        .setColor("#2b2d31")
        .setDescription(
            `**📊 Overview**\n` +
            `• **${totalPanels}** total panels\n` +
            `• **${activeClaims}** active claims\n\n` +
            `**Actions:**\n` +
            `• **Reset Panel** — Select a panel to reset to defaults\n` +
            `• **Kick User** — Remove a user from a claim\n` +
            `• **Back** — Return to main menu`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-panels-reset-menu").setEmoji("🔄").setLabel("Reset Panel").setStyle(a.Danger),
                new n().setCustomId("mgmt-panels-kick-menu").setEmoji("👢").setLabel("Kick User").setStyle(a.Primary),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 🏗️ PANEL RESET MENU — Select a panel to reset
// ==========================================

async function handleMgmtPanelsResetMenu(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    // Re-use the existing admin-reset-menu logic
    const optionsList = [];
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        const cleanedTitle = current.title.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
        optionsList.push({ label: `${cleanedTitle}`, description: `Key: ${key}`, value: key });
    }
    if (optionsList.length === 0) {
        return await interaction.update({
            content: getMsg("system.resetNoPanels"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {});
    }
    if (optionsList.length > 1) {
        optionsList.unshift({ label: "🔄 Reset ALL Panels", description: "Reset all panels to defaults", value: "__all__" });
    }

    return await interaction.update({
        content: getMsg("system.resetMenuTitle"),
        components: [
            new t().addComponents(
                new i().setCustomId("mgmt-panels-reset-execute").setPlaceholder("Choose a panel...").addOptions(optionsList.slice(0, 25))
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(() => {});
}

async function handleMgmtPanelsKickMenu(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    // Build kick options (same logic as !kick command)
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
                        description: `👑 ${evData.ownerName}`,
                        value: `kick-${key}-${ev}-${evData.ownerId}`
                    });
                }
            }
        } else if ("antidemon" === current.type) {
            const antiRoomKeys = getAntidemonRoomKeys(key);
            for (const room of antiRoomKeys) {
                if (current[room].status === STATUS_CLAIMED && current[room].ownerId) {
                    optionsList.push({
                        label: `${cleanedTitle} - ${room.toUpperCase()} Room`,
                        description: `👑 ${current[room].ownerName}`,
                        value: `kick-${key}-${room}-${current[room].ownerId}`
                    });
                }
            }
        } else if ("summon" === current.type) {
            const summonProps = getSummonRoomKeys(key);
            for (const loc of summonProps) {
                if (current[loc].status === STATUS_CLAIMED && current[loc].ownerId) {
                    optionsList.push({
                        label: `${cleanedTitle} - ${current[loc].name}`,
                        description: `👑 ${current[loc].ownerName}`,
                        value: `kick-${key}-${loc}-${current[loc].ownerId}`
                    });
                }
            }
        } else {
            if (current.ownerId) {
                optionsList.push({
                    label: `${cleanedTitle}`,
                    description: `👑 ${current.ownerName}`,
                    value: `kick-${key}-floor-${current.ownerId}`
                });
            }
        }
    }

    if (optionsList.length === 0) {
        return await interaction.update({
            content: getMsg("system.kickNoClaims"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {});
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
    }).catch(() => {});
}

// ==========================================
// 🔒 RESERVATION MANAGEMENT
// ==========================================

async function handleMgmtReservations(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    // Scan all reservations
    const furyReservations = [];
    const frenzyReservations = [];

    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;

        const floor = key.includes("11") ? "MS11" : "MS12";

        for (const ev of ["fury", "frenzy"]) {
            const evData = current[ev];
            if (!evData || evData.type !== "fixed") continue;

            if (evData.reservedFor || evData.reservations) {
                const targetList = ev === "fury" ? furyReservations : frenzyReservations;
                let desc = `**${floor}** — `;
                
                if (evData.reservedFor) {
                    desc += `All hours → ${evData.reservedByName || evData.reservedFor}`;
                } else if (evData.reservations) {
                    if (evData.reservations._all) {
                        desc += `All hours → ${evData.reservations._all.userName}`;
                    } else {
                        const slots = Object.entries(evData.reservations)
                            .filter(([h]) => !h.startsWith("_"))
                            .sort(([a], [b]) => parseInt(a) - parseInt(b))
                            .map(([h, u]) => `${h}:00→${u.userName}`)
                            .join(", ");
                        desc += slots || "None";
                    }
                }
                targetList.push(desc);
            }
        }
    }

    const embed = new e()
        .setTitle("🔒 Reservation Management")
        .setColor("#2b2d31")
        .setDescription(
            `**🔴 Fury Reservations**\n${furyReservations.length > 0 ? furyReservations.map(r => `• ${r}`).join("\n") : "• No active reservations"}\n\n` +
            `**🟣 Frenzy Reservations**\n${frenzyReservations.length > 0 ? frenzyReservations.map(r => `• ${r}`).join("\n") : "• No active reservations"}\n\n` +
            `Use \`!reserve @user\` to create new reservations, or clear all below.`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations-clear").setEmoji("🗑️").setLabel("Clear All").setStyle(a.Danger),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(() => {});
}

async function handleMgmtReservationsClear(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    // Count how many reservations exist
    let totalCount = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        if ("event_group" !== db[key].type) continue;
        for (const ev of ["fury", "frenzy"]) {
            const evData = db[key][ev];
            if (evData && evData.type === "fixed" && (evData.reservedFor || evData.reservations)) {
                totalCount++;
            }
        }
    }

    if (totalCount === 0) {
        return await interaction.update({
            content: "ℹ️ No reservations to clear.",
            components: [
                new t().addComponents(
                    new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel("Back to Reservations").setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(() => {});
    }

    return sendTimedConfirm(
        interaction,
        `⚠️ **Are you sure?**\n\nThis will clear **${totalCount}** reservation(s) across Fury and Frenzy in all panels.\n\nThis action **cannot be undone** — all reserved slots will be opened for everyone.`,
        [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations-clear-confirm").setEmoji("✅").setLabel("Yes, clear all").setStyle(a.Danger),
                new n().setCustomId("mgmt-reservations-clear-cancel").setEmoji("❌").setLabel("Cancel").setStyle(a.Secondary)
            )
        ]
    );
}

async function handleMgmtReservationsClearExecute(interaction) {
    clearConfirmTimeout(interaction);
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    let clearedCount = 0;
    for (const key in db) {
        if (!db[key] || key.startsWith("_")) continue;
        const current = db[key];
        if ("event_group" !== current.type) continue;

        for (const ev of ["fury", "frenzy"]) {
            const evData = current[ev];
            if (!evData || evData.type !== "fixed") continue;
            if (evData.reservedFor || evData.reservations) {
                evData.reservedFor = null;
                evData.reservedByName = null;
                evData.reservations = null;
                clearedCount++;
            }
        }
    }

    if (clearedCount > 0) {
        for (const key in db) {
            if (!db[key] || key.startsWith("_")) continue;
            await refreshVisualPanel(key);
        }
    }

    return await interaction.update({
        content: `✅ Cleared **${clearedCount}** reservation(s). All events are now open.`,
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel("Back to Reservations").setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(() => {});
}

async function handleMgmtReservationsClearCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: "❌ Clear cancelled. No reservations were changed.",
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel("Back to Reservations").setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 📢 CHANNEL CONFIGURATION
// ==========================================

async function handleMgmtChannels(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const logsStatus = dailyLogs.configChannelId ? "✅ Configured" : "❌ Not set";
    const bossStatus = dailyLogs.bossSpawnChannelId ? "✅ Configured" : "❌ Not set";
    const eventStatus = dailyLogs.scheduledEventChannelId ? "✅ Configured" : "❌ Not set";

    const embed = new e()
        .setTitle("📢 Channel Configuration")
        .setColor("#2b2d31")
        .setDescription(
            `Click a button to set the current channel for that purpose.\n\n` +
            `**📜 Daily Report Logs:** ${logsStatus}\n` +
            `**🚨 Boss Spawn Alerts:** ${bossStatus}\n` +
            `**📅 Event Notifications:** ${eventStatus}\n\n` +
            `*Make sure you're in the desired channel before clicking.*`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-channels-logs").setEmoji("📜").setLabel("Set Logs Channel").setStyle(a.Primary),
                new n().setCustomId("mgmt-channels-boss").setEmoji("🚨").setLabel("Set Boss Channel").setStyle(a.Primary),
                new n().setCustomId("mgmt-channels-events").setEmoji("📅").setLabel("Set Event Channel").setStyle(a.Primary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(() => {});
}

async function handleMgmtChannelsLogs(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: "❌ You need **Manage Server** permission.",
            components: [], flags: 64
        }).catch(() => {});
    }
    dailyLogs.configChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: `✅ Daily report channel set to <#${interaction.channelId}>.`,
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {});
}

async function handleMgmtChannelsBoss(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: "❌ You need **Manage Server** permission.",
            components: [], flags: 64
        }).catch(() => {});
    }
    dailyLogs.bossSpawnChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: `✅ Boss spawn alert channel set to <#${interaction.channelId}>.`,
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {});
}

async function handleMgmtChannelsEvents(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: "❌ You need **Manage Server** permission.",
            components: [], flags: 64
        }).catch(() => {});
    }
    dailyLogs.scheduledEventChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: `✅ Event notification channel set to <#${interaction.channelId}>.`,
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 📋 DAILY LOGS
// ==========================================

async function handleMgmtLogs(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const logCount = (dailyLogs.queue || []).length;
    const isConfigured = dailyLogs.configChannelId ? `✅ <#${dailyLogs.configChannelId}>` : "❌ Not configured";

    const embed = new e()
        .setTitle("📋 Daily Logs")
        .setColor("#2b2d31")
        .setDescription(
            `**Log Channel:** ${isConfigured}\n` +
            `**Pending Events:** ${logCount}\n\n` +
            `Click **Dispatch Now** to send the report to the configured channel.`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-logs-dispatch").setEmoji("📤").setLabel("Dispatch Now").setStyle(a.Success),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 💰 SALARY MANAGEMENT
// ==========================================

async function handleMgmtSalary(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const embed = new e()
        .setTitle("💰 Salary Poll Management")
        .setColor("#2b2d31")
        .setDescription(
            `Manage the weekly salary vote system.\n\n` +
            `• **Configure Channel** — Set up the salary poll in this channel\n` +
            `• Use \`!setsalary\` text command for detailed setup\n` +
            `• Use \`!salaryspreadsheet <ID>\` to link a Google Sheet\n\n` +
            `*The poll opens automatically every Monday at 12:30 (BRT).*`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 🎫 TICKETS
// ==========================================

async function handleMgmtTickets(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    await setupTicketPanel(interaction.channel);
    return await interaction.update({
        content: "✅ **Ticket panel created in this channel!**\n\nUsers can now open tickets for support.",
        components: [
            new t().addComponents(new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 👥 PLAYER MANAGEMENT (redirect to ranking /manage)
// ==========================================

async function handleMgmtPlayers(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const embed = new e()
        .setTitle("👥 Player Management")
        .setColor("#2b2d31")
        .setDescription(
            `This redirects to the ranking player management system.\n\n` +
            `Use the existing **/manage** slash command directly for:\n` +
            `• **Register** players via modal\n` +
            `• **Manage pilots** (add/remove)\n` +
            `• **Change clans**\n` +
            `• **Remove registrations**\n` +
            `• **Force sync** with the official ranking portal\n\n` +
            `Or use text commands:\n` +
            `• \`!kick\` — Remove a claim\n` +
            `• \`!logs\` — Dispatch daily reports`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ]
    }).catch(() => {});
}

// ==========================================
// 🔄 PANEL RESET EXECUTE
// ==========================================

async function handleMgmtPanelsResetExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
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
            content: `✅ Reset **${count}** panels to defaults.`,
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
            ]
        }).catch(() => {});
    }

    if (!db[resetKey]) {
        return await interaction.update({
            content: getMsg("system.resetPanelNotFound", { key: resetKey }),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {});
    }

    resetPanelData(resetKey);
    await refreshVisualPanel(resetKey);
    return await interaction.update({
        content: getMsg("system.resetPanelSuccess", { key: resetKey }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
        ]
    }).catch(() => {});
}

// ==========================================
// 👢 PANEL KICK EXECUTE
// ==========================================

async function handleMgmtPanelsKickExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    const value = interaction.values[0];
    // Re-use the same admin-kick-menu handling logic from admin-interactions.js
    // The value format is: kick-{key}-{roomType}-{targetUid}
    const parts = value.split("-");
    const pKey = parts[1];
    const roomType = parts[2];
    const targetUid = parts.slice(3).join("-");
    const targetFloor = db[pKey];

    if (targetFloor) {
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
            // Antidemon/summon room — use freeAntidemonRoom for proper queue handling
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

    return await interaction.update({
        content: getMsg("system.kickSuccess"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary))
        ]
    }).catch(() => {});
}

// ==========================================
// 📤 LOGS DISPATCH
// ==========================================

async function handleMgmtLogsDispatch(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    if (!dailyLogs.configChannelId) {
        return await interaction.update({
            content: getMsg("logs.noChannel"),
            components: [
                new t().addComponents(
                    new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(() => {});
    }

    if (!await dispatchDailyLogs(true)) {
        return await interaction.update({
            content: getMsg("logs.dispatchError"),
            components: [
                new t().addComponents(
                    new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(() => {});
    }

    return await interaction.update({
        content: getMsg("logs.dispatchSuccess"),
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(() => {});
}

// ==========================================
// 🔄 BOT UPDATE
// ==========================================

async function handleMgmtUpdate(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    return sendTimedConfirm(
        interaction,
        "⚠️ **Are you sure?**\n\nThis will:\n1. Pull the latest code from Git\n2. Run `npm install`\n3. **Restart the bot** via pm2\n\nThe bot will be **offline for a few seconds** during restart.\n\nProceed with the update?",
        [
            new t().addComponents(
                new n().setCustomId("mgmt-update-confirm").setEmoji("🔄").setLabel("Yes, update and restart").setStyle(a.Danger),
                new n().setCustomId("mgmt-update-cancel").setEmoji("❌").setLabel("Cancel").setStyle(a.Secondary)
            )
        ]
    );
}

async function handleMgmtUpdateConfirm(interaction) {
    clearConfirmTimeout(interaction);
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {});
    }

    await interaction.update({
        content: "🔄 **Updating bot...**\n\nPulling latest code and restarting.",
        components: []
    }).catch(() => {});

    try {
        const output = execSync("git pull --rebase", { encoding: "utf8", cwd: process.cwd() });
        execSync("npm install", { encoding: "utf8", cwd: process.cwd(), stdio: "pipe" });
        exec("pm2 restart bot", () => process.exit());
    } catch (e) {
        await interaction.followUp({
            content: `❌ **Update failed:**\n\`\`\`\n${(e.message || e).slice(0, 1900)}\n\`\`\``,
            flags: 64
        }).catch(() => {});
    }
}

async function handleMgmtUpdateCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: "❌ Update cancelled.",
        components: [
            new t().addComponents(new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel("Back to Menu").setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {});
}
