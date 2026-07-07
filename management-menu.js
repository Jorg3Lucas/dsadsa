// ==========================================
// 🛠️ MANAGEMENT PANEL — Unified Bot Control
// /manage command opens a multi-category menu
// ==========================================

import {
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i,
    EmbedBuilder as e,
    ModalBuilder as m,
    TextInputBuilder as ti,
    TextInputStyle as tis
} from "discord.js";
import { execSync, exec } from "child_process";
import { getMsg } from "./lang.js";
import { db, dailyLogs, saveLocalStorage } from "./state.js";
import { refreshVisualPanel, resetPanelData, notifyUserDM } from "./panel-utils.js";
import { pushToDailyLogs, saveDailyLogs, dispatchDailyLogs } from "./daily-logs.js";
import { setupTicketPanel } from "./ticket-system.js";
import {
    setSalaryChannelId,
    setSalarySpreadsheetId,
    createOrUpdatePollMessage,
    forceExportToSheets,
    postSalaryReport,
    getSalaryState
} from "./salary-poll.js";
import { getLocalTime } from "./time-utils.js";
import { STATUS_CLAIMED } from "./constants.js";
import { freeAntidemonRoom, getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";

const confirmTimeouts = new Map();

// ==========================================
// ⏰ TIMED CONFIRMATION HELPER
// Auto-expires after 30s and disables buttons
// ==========================================

async function sendTimedConfirm(interaction, content, buttons, timeoutMs = 30000) {
    await interaction.update({ content, components: buttons, flags: 64 }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });

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
                content: content + "\n\n" + getMsg("management.promptExpired"),
                components: disabledRows
            }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
        } catch (e) {
        // Silently ignored — non-critical operation
    }
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
    try {
        const hasPerm = interaction.member?.permissions?.has("ManageMessages");
        if (!hasPerm) {
            return await interaction.reply({
                content: getMsg("system.permissionDeniedAdminDropped"),
                flags: 64
            });
        }

        const embed = new e()
            .setTitle(getMsg("management.title"))
            .setColor("#2b2d31")
            .setDescription(getMsg("management.mainDesc"))
            .setTimestamp();

        return await interaction.reply({
            embeds: [embed],
            components: [
                new t().addComponents(
                    new n().setCustomId("mgmt-panels").setEmoji("🏗️").setLabel(getMsg("management.btnPanels")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnReservations")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-channels").setEmoji("📢").setLabel(getMsg("management.btnChannels")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnPlayers")).setStyle(a.Primary),
                    new n().setCustomId("mgmt-logs").setEmoji("📋").setLabel(getMsg("management.btnLogs")).setStyle(a.Secondary)
                ),
                new t().addComponents(
                    new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnSalary")).setStyle(a.Secondary),
                    new n().setCustomId("mgmt-tickets").setEmoji("🎫").setLabel(getMsg("management.btnTickets")).setStyle(a.Secondary),
                    new n().setCustomId("mgmt-update").setEmoji("🔄").setLabel(getMsg("management.btnUpdate")).setStyle(a.Danger)
                )
            ],
            flags: 64
        });
    } catch (err) {
        console.error("❌ [handleMgmtSlash] CRASH:", err);
        if (err.stack) console.error("📋 [Stack]:", err.stack);
        try {
            const errContent = getMsg("management.errorBody", { error: (err.message || String(err)).slice(0, 1500) });
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errContent, flags: 64 });
            } else {
                await interaction.followUp({ content: errContent, flags: 64 });
            }
        } catch (e) {
        // Silently ignored — non-critical operation
    }
    }
}

export function canHandleManagementInteraction(interaction) {
    const cid = interaction.customId;
    return cid === "mgmt-main" ||
        cid.startsWith("mgmt-");
}

export async function handleManagementInteraction(interaction, _uid, _extra) {
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
    if (cid === "mgmt-salary-channel") return handleMgmtSalaryChannel(interaction);
    if (cid === "mgmt-salary-spreadsheet") return handleMgmtSalarySpreadsheet(interaction);
    if (cid === "mgmt-salary-spreadsheet-modal") return handleMgmtSalarySpreadsheetSubmit(interaction);
    if (cid === "mgmt-salary-export") return handleMgmtSalaryExport(interaction);
    if (cid === "mgmt-salary-report") return handleMgmtSalaryReport(interaction);
    if (cid === "mgmt-players") return handleMgmtPlayers(interaction);
    if (cid === "mgmt-players-register") return handleMgmtPlayersRegister(interaction);
    if (cid === "mgmt-players-sync") return handleMgmtPlayersSync(interaction);
    if (cid === "mgmt-players-sync-confirm") return handleMgmtPlayersSyncConfirm(interaction);
    if (cid === "mgmt-players-pilot") return handleMgmtPlayersPilot(interaction);
    if (cid === "mgmt-players-remove-pilot") return handleMgmtPlayersRemovePilot(interaction);
    if (cid === "mgmt-players-sync-cancel") return handleMgmtPlayersSyncCancel(interaction);
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
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const embed = new e()
        .setTitle(getMsg("management.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.mainDescCompact"))
        .setTimestamp();        return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-panels").setEmoji("🏗️").setLabel(getMsg("management.btnPanels")).setStyle(a.Primary),
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnReservations")).setStyle(a.Primary),
                new n().setCustomId("mgmt-channels").setEmoji("📢").setLabel(getMsg("management.btnChannels")).setStyle(a.Primary),
                new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnPlayers")).setStyle(a.Primary),
                new n().setCustomId("mgmt-logs").setEmoji("📋").setLabel(getMsg("management.btnLogs")).setStyle(a.Secondary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnSalary")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-tickets").setEmoji("🎫").setLabel(getMsg("management.btnTickets")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-update").setEmoji("🔄").setLabel(getMsg("management.btnUpdate")).setStyle(a.Danger)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🏗️ PANEL MANAGEMENT
// ==========================================

async function handleMgmtPanels(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
        .setTitle(getMsg("management.panels.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.panels.desc", { total: totalPanels, active: activeClaims }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-panels-reset-menu").setEmoji("🔄").setLabel(getMsg("management.panels.btnReset")).setStyle(a.Danger),
                new n().setCustomId("mgmt-panels-kick-menu").setEmoji("👢").setLabel(getMsg("management.panels.btnKick")).setStyle(a.Primary),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🏗️ PANEL RESET MENU — Select a panel to reset
// ==========================================

async function handleMgmtPanelsResetMenu(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    if (optionsList.length > 1) {
        optionsList.unshift({ label: getMsg("management.panels.resetAll"), description: getMsg("management.panels.resetAllDesc"), value: "__all__" });
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
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtPanelsKickMenu(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🔒 RESERVATION MANAGEMENT
// ==========================================

async function handleMgmtReservations(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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

    const noRes = getMsg("management.reservations.noRes");
    const embed = new e()
        .setTitle(getMsg("management.reservations.title"))
        .setColor("#2b2d31")
        .setDescription(
            `**🔴 Fury Reservations**\n${furyReservations.length > 0 ? furyReservations.map(r => `• ${r}`).join("\n") : noRes}\n\n` +
            `**🟣 Frenzy Reservations**\n${frenzyReservations.length > 0 ? frenzyReservations.map(r => `• ${r}`).join("\n") : noRes}\n\n` +
            `Use \`!reserve @user\` to create new reservations, or clear all below.`
        )
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations-clear").setEmoji("🗑️").setLabel(getMsg("management.reservations.btnClearAll")).setStyle(a.Danger),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtReservationsClear(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
            content: getMsg("management.reservations.clearNone"),
            components: [
                new t().addComponents(
                    new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnBackReservations")).setStyle(a.Secondary)
                )
            ],
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    return sendTimedConfirm(
        interaction,
        getMsg("management.reservations.clearConfirm", { count: totalCount }),
        [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations-clear-confirm").setEmoji("✅").setLabel(getMsg("management.reservations.clearYes")).setStyle(a.Danger),
                new n().setCustomId("mgmt-reservations-clear-cancel").setEmoji("❌").setLabel(getMsg("management.reservations.clearCancel")).setStyle(a.Secondary)
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
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
        content: getMsg("management.reservations.clearDone", { count: clearedCount }),
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnBackReservations")).setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtReservationsClearCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: getMsg("management.reservations.clearCancelled"),
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-reservations").setEmoji("🔒").setLabel(getMsg("management.btnBackReservations")).setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 📢 CHANNEL CONFIGURATION
// ==========================================

async function handleMgmtChannels(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const logsStatus = dailyLogs.configChannelId ? getMsg("management.channels.configYes") : getMsg("management.channels.configNo");
    const bossStatus = dailyLogs.bossSpawnChannelId ? getMsg("management.channels.configYes") : getMsg("management.channels.configNo");
    const eventStatus = dailyLogs.scheduledEventChannelId ? getMsg("management.channels.configYes") : getMsg("management.channels.configNo");

    const embed = new e()
        .setTitle(getMsg("management.channels.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.channels.desc", { logsStatus, bossStatus, eventStatus }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-channels-logs").setEmoji("📜").setLabel(getMsg("management.channels.btnSetLogs")).setStyle(a.Primary),
                new n().setCustomId("mgmt-channels-boss").setEmoji("🚨").setLabel(getMsg("management.channels.btnSetBoss")).setStyle(a.Primary),
                new n().setCustomId("mgmt-channels-events").setEmoji("📅").setLabel(getMsg("management.channels.btnSetEvents")).setStyle(a.Primary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtChannelsLogs(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    dailyLogs.configChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: getMsg("management.channels.logsDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel(getMsg("management.btnBackChannels")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtChannelsBoss(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    dailyLogs.bossSpawnChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: getMsg("management.channels.bossDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel(getMsg("management.btnBackChannels")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtChannelsEvents(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    dailyLogs.scheduledEventChannelId = interaction.channelId;
    saveDailyLogs();
    return await interaction.update({
        content: getMsg("management.channels.eventsDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-channels").setEmoji("🔙").setLabel(getMsg("management.btnBackChannels")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 📋 DAILY LOGS
// ==========================================

async function handleMgmtLogs(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const logCount = (dailyLogs.queue || []).length;
    const isConfigured = dailyLogs.configChannelId
        ? `<#${dailyLogs.configChannelId}>`
        : getMsg("management.logs.notConfigured");

    const embed = new e()
        .setTitle(getMsg("management.logs.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.logs.desc", { channel: isConfigured, count: logCount }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-logs-dispatch").setEmoji("📤").setLabel(getMsg("management.logs.btnDispatch")).setStyle(a.Success),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 💰 SALARY MANAGEMENT — Interactive
// ==========================================

async function handleMgmtSalary(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const state = getSalaryState();
    const statusEmoji = state.status === "open" ? "🟢" : state.status === "closed" ? "🔴" : "⚪";
    const weekStr = state.currentWeek || "—";
    const channelStr = state.channelId ? `<#${state.channelId}>` : getMsg("management.salary.channelNotSet");
    const spreadsheetStr = state.spreadsheetId
        ? getMsg("management.salary.sheetSet", { id: state.spreadsheetId.slice(0, 12) })
        : getMsg("management.salary.sheetNotSet");
    const voteCount = Object.keys(state.votes).length;
    const statusLabel = state.status === "open" ? getMsg("management.salary.statusOpen") : state.status === "closed" ? getMsg("management.salary.statusClosed") : getMsg("management.salary.statusIdle");

    // Calculate next event
    const now = getLocalTime();
    const day = now.getDay();
    const currMin = now.getHours() * 60 + now.getMinutes();
    let nextEvent;
    if (day <= 1 && (day < 1 || currMin < 12*60+30)) {
        nextEvent = getMsg("management.salary.nextOpen");
    } else if (day < 3 || (day === 3 && currMin < 13*60)) {
        nextEvent = getMsg("management.salary.nextClose");
    } else if (day === 3 && currMin < 16*60) {
        nextEvent = getMsg("management.salary.nextReport");
    } else {
        nextEvent = getMsg("management.salary.nextPoll");
    }

    const embed = new e()
        .setTitle(getMsg("management.salary.title"))
        .setColor(state.status === "open" ? "#57F287" : "#2b2d31")
        .setDescription(getMsg("management.salary.desc", {
            statusEmoji,
            status: statusLabel,
            week: weekStr,
            votes: voteCount,
            channel: channelStr,
            spreadsheet: spreadsheetStr,
            nextEvent
        }))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-salary-channel").setEmoji("📢").setLabel(getMsg("management.salary.btnSetChannel")).setStyle(a.Primary),
                new n().setCustomId("mgmt-salary-spreadsheet").setEmoji("📈").setLabel(getMsg("management.salary.btnSetSpreadsheet")).setStyle(a.Primary),
                new n().setCustomId("mgmt-salary-export").setEmoji("📤").setLabel(getMsg("management.salary.btnExport")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-salary-report").setEmoji("📊").setLabel(getMsg("management.salary.btnPostReport")).setStyle(a.Secondary),
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtSalaryChannel(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.salary.channelPermDenied"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    setSalaryChannelId(interaction.channelId);
    await createOrUpdatePollMessage(true);
    return await interaction.update({
        content: getMsg("management.salary.channelDone", { channel: interaction.channelId }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtSalarySpreadsheet(interaction) {
    if (!interaction.member.permissions.has("ManageGuild")) {
        return await interaction.update({
            content: getMsg("management.channels.permDenied"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const state = getSalaryState();
    const notSetLabel = getMsg("management.salary.spreadsheetNotSet");
    const currentId = state.spreadsheetId || notSetLabel;

    const modal = new m()
        .setCustomId("mgmt-salary-spreadsheet-modal")
        .setTitle(getMsg("management.salary.spreadsheetTitle"));

    const input = new ti()
        .setCustomId("spreadsheet_id")
        .setLabel(getMsg("management.salary.spreadsheetLabel"))
        .setStyle(tis.Short)
        .setPlaceholder(getMsg("management.salary.spreadsheetPlaceholder"))
        .setValue(currentId !== notSetLabel ? currentId : "")
        .setRequired(true);

    modal.addComponents(new t().addComponents(input));
    return await interaction.showModal(modal).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtSalarySpreadsheetSubmit(interaction) {
    const sid = interaction.fields.getTextInputValue("spreadsheet_id").trim();
    if (!sid) {
        return await interaction.reply({
            content: getMsg("management.salary.spreadsheetEmpty"),
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
    setSalarySpreadsheetId(sid);
    return await interaction.reply({
        content: getMsg("management.salary.spreadsheetDone", { id: sid }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtSalaryExport(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const result = await forceExportToSheets();
    return await interaction.update({
        content: result.message,
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtSalaryReport(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!getSalaryState().channelId) {
        return await interaction.update({
            content: getMsg("management.salary.reportNoChannel"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    await postSalaryReport();
    return await interaction.update({
        content: getMsg("management.salary.reportDone"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-salary").setEmoji("💰").setLabel(getMsg("management.btnBackSalary")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🎫 TICKETS
// ==========================================

async function handleMgmtTickets(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    await setupTicketPanel(interaction.channel);
    return await interaction.update({
        content: getMsg("management.tickets.done"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 👥 PLAYER MANAGEMENT — Interactive
// ==========================================

async function handleMgmtPlayers(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    const embed = new e()
        .setTitle(getMsg("management.players.title"))
        .setColor("#2b2d31")
        .setDescription(getMsg("management.players.desc"))
        .setTimestamp();

    return await interaction.update({
        embeds: [embed],
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-players-register").setEmoji("📝").setLabel(getMsg("management.players.btnRegister")).setStyle(a.Primary),
                new n().setCustomId("mgmt-players-pilot").setEmoji("👤").setLabel(getMsg("management.players.btnPilot")).setStyle(a.Primary),
                new n().setCustomId("mgmt-players-remove-pilot").setEmoji("🗑️").setLabel(getMsg("management.players.btnRemovePilot")).setStyle(a.Danger),
                new n().setCustomId("mgmt-players-sync").setEmoji("🔄").setLabel(getMsg("management.players.btnForceSync")).setStyle(a.Secondary)
            ),
            new t().addComponents(
                new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary)
            )
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtPlayersRegister(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    // Show the same register modal as /register command
    const modal = new m()
        .setCustomId("register_modal")
        .setTitle(getMsg("management.players.registerTitle"));

    const nicknameInput = new ti()
        .setCustomId("character_nickname")
        .setLabel(getMsg("management.players.registerLabel"))
        .setStyle(tis.Short)
        .setPlaceholder(getMsg("management.players.registerPlaceholder"))
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

    modal.addComponents(new t().addComponents(nicknameInput));
    return await interaction.showModal(modal).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtPlayersSync(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    return sendTimedConfirm(
        interaction,
        getMsg("management.players.syncConfirm"),
        [
            new t().addComponents(
                new n().setCustomId("mgmt-players-sync-confirm").setEmoji("🔄").setLabel(getMsg("management.players.syncYes")).setStyle(a.Danger),
                new n().setCustomId("mgmt-players-sync-cancel").setEmoji("❌").setLabel(getMsg("management.players.syncCancel")).setStyle(a.Secondary)
            )
        ]
    );
}

async function handleMgmtPlayersSyncConfirm(interaction) {
    clearConfirmTimeout(interaction);
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    await interaction.update({
        content: getMsg("management.players.syncProgress"),
        components: []
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });

    // Import and run daily sync as a forced sync
    try {
        const { runDailySynchronization } = await import("./ranking-sync-engine.js");
        const { client, rankingDb: rDb } = await import("./state.js");
        await runDailySynchronization(client, rDb, () => {}, () => {}, true);
        await interaction.editReply({
            content: getMsg("management.players.syncDone"),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
            ]
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    } catch (e) {
        await interaction.editReply({
            content: getMsg("management.players.syncFailed", { error: (e.message || String(e)).slice(0, 1900) }),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
            ]
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
}

async function handleMgmtPlayersPilot(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    return await interaction.update({
        content: getMsg("management.players.pilotInfo"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("🔙").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtPlayersRemovePilot(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    return await interaction.update({
        content: getMsg("management.players.removePilotInfo"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("🔙").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

async function handleMgmtPlayersSyncCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: getMsg("management.players.syncCancelled"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-players").setEmoji("👥").setLabel(getMsg("management.btnBackPlayers")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🔄 PANEL RESET EXECUTE
// ==========================================

async function handleMgmtPanelsResetExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
            content: getMsg("management.panels.resetDone", { count }),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ]
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!db[resetKey]) {
        return await interaction.update({
            content: getMsg("system.resetPanelNotFound", { key: resetKey }),
            components: [
                new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    resetPanelData(resetKey);
    await refreshVisualPanel(resetKey);
    return await interaction.update({
        content: getMsg("system.resetPanelSuccess", { key: resetKey }),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 👢 PANEL KICK EXECUTE
// ==========================================

async function handleMgmtPanelsKickExecute(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
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
            new t().addComponents(new n().setCustomId("mgmt-panels").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
        ]
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 📤 LOGS DISPATCH
// ==========================================

async function handleMgmtLogsDispatch(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!dailyLogs.configChannelId) {
        return await interaction.update({
            content: getMsg("logs.noChannel"),
            components: [            new t().addComponents(new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    if (!await dispatchDailyLogs(true)) {
        return await interaction.update({
            content: getMsg("logs.dispatchError"),
            components: [            new t().addComponents(new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel(getMsg("management.btnBack")).setStyle(a.Secondary))
            ],
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    return await interaction.update({
        content: getMsg("logs.dispatchSuccess"),
        components: [
            new t().addComponents(
                new n().setCustomId("mgmt-logs").setEmoji("🔙").setLabel("Back").setStyle(a.Secondary)
            )
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}

// ==========================================
// 🔄 BOT UPDATE
// ==========================================

async function handleMgmtUpdate(interaction) {
    if (!interaction.member.permissions.has("ManageMessages")) {
        return await interaction.update({
            content: getMsg("system.permissionDeniedAdminDropped"),
            components: [], flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    return sendTimedConfirm(
        interaction,
        getMsg("management.update.confirm"),
        [
            new t().addComponents(
                new n().setCustomId("mgmt-update-confirm").setEmoji("🔄").setLabel(getMsg("management.update.btnConfirm")).setStyle(a.Danger),
                new n().setCustomId("mgmt-update-cancel").setEmoji("❌").setLabel(getMsg("management.update.btnCancel")).setStyle(a.Secondary)
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
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }

    await interaction.update({
        content: getMsg("management.update.progress"),
        components: []
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });

    try {
        execSync("git pull --rebase", { encoding: "utf8", cwd: process.cwd() });
        execSync("npm install", { encoding: "utf8", cwd: process.cwd(), stdio: "pipe" });
        exec("pm2 restart bot", () => process.exit());
    } catch (e) {
        await interaction.followUp({
            content: getMsg("management.update.failed", { error: (e.message || e).slice(0, 1900) }),
            flags: 64
        }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
    }
}

async function handleMgmtUpdateCancel(interaction) {
    clearConfirmTimeout(interaction);
    return await interaction.update({
        content: getMsg("management.update.cancelled"),
        components: [
            new t().addComponents(new n().setCustomId("mgmt-main").setEmoji("🔙").setLabel(getMsg("management.btnBackMenu")).setStyle(a.Secondary))
        ],
        flags: 64
    }).catch(() => {
        // Silently ignore — Discord API errors are non-critical
    });
}
