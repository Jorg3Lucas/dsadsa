import {
    EmbedBuilder as e,
    ActionRowBuilder as t,
    ButtonBuilder as n,
    ButtonStyle as a,
    StringSelectMenuBuilder as i
} from "discord.js";
import { getLocalTime, isRoomOpen, getFormattedTime12h, getDynamicQueueETA, getEndLimitCountdown, calculateNextOpening, getNextScheduleAfter, usesScheduleRespawn, getBossSchedules, parseStringToDate } from "./time-utils.js";
import { getMsg } from "./lang.js";
import { db } from "./state.js";
import { getContinentLabel } from "./setup-config.js";

// ==========================================
// 🎨 RENDERING (Embeds & Buttons)
// ==========================================

export function getEmbedColor(current) {
    if (!current) return "#2b2d31";
    if (current.ownerId) return "#5865F2"; // Occupied - Discord Blurple
    if (current.next) return "#FEE75C"; // Has queue - Discord Yellow
    if ("antidemon" === current.type || "summon" === current.type) {
        const props = "summon" === current.type ? ["sp2", "sp4", "sp7", "ms11", "sp11"] : ["left", "mid", "right"];
        let hasClaimed = props.some(p => current[p] && current[p].status.startsWith("🔴"));
        if (hasClaimed) return "#5865F2";
        let hasQueue = props.some(p => current[p] && current[p].nextId);
        if (hasQueue) return "#FEE75C"; // Has queue
    }
    if ("fixed" === current.type) {
        return isRoomOpen(current.schedules) ? "#57F287" : "#2b2d31"; // Green if open
    }
    return "#2b2d31"; // Default neutral
}

export function renderEmbed(key) {
    let current = db[key];
    if (!current) return new e().setTitle(getMsg("system.errorTitle"));
    
    let embedColor = getEmbedColor(current),
        now = getLocalTime();
    let embed = new e().setColor(embedColor);
    
    // Dynamic title with time window (já está no horário local do continente)
    "antidemon" !== current.type && current.timeWindow 
        ? embed.setTitle(`${current.title} \u200B \u200B \u200B \u200B \` ⏱️ ${current.timeWindow} \``) 
        : embed.setTitle(current.title);
    
    // Footer with update timestamp
    embed.setTimestamp();

    if ("antidemon" === current.type || "summon" === current.type) {
        const summonProps = "summon" === current.type ? ["sp2", "sp4", "sp7", "ms11", "sp11"] : ["left", "mid", "right"];
        embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
        for (let room of summonProps) {
            let rData = current[room];
            // Calculate remaining claim time for claimed rooms
            let remainingClaimStr = "";
            if ("🔴 Claimed" === rData.status && rData.timeWindow) {
                let endTimeStr = rData.timeWindow.split(" ~ ")[1];
                let endTime = parseStringToDate(endTimeStr);
                if (endTime) {
                    let remainingSecs = Math.floor((endTime.getTime() - now.getTime()) / 1e3);
                    if (remainingSecs > 0) {
                        let mins = Math.floor(remainingSecs / 60);
                        let secs = remainingSecs % 60;
                        remainingClaimStr = `⏱️ ${mins}m ${secs}s (${getMsg("render.countdownUntil")} ${endTimeStr})`;
                    } else {
                        remainingClaimStr = "⏱️ Expiring...";
                    }
                }
            }
            // Time já está no horário local do continente
            let displayTimeField = rData.timeWindow || rData.time;
            let block = "🔴 Claimed" === rData.status && rData.ownerName 
                ? `\`\`\`md\n# 👑 ${rData.ownerName}\n${remainingClaimStr || displayTimeField}\n\`\`\`` 
                : rData.endLimit && rData.nextName 
                    ? `\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\`\n${getEndLimitCountdown(rData.endLimit)}` 
                    : `\`\`\`yaml\n🟢 Available\n\`\`\``;
            
            // Show queue info below claimed rooms too — in code block
            if ("🔴 Claimed" === rData.status && rData.nextName) {
                block += `\n\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
            } else if (rData.nextName && !rData.endLimit) {
                block += `\n\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
            }
            embed.addFields({
                name: rData.name,
                value: block,
                inline: !0
            });
        }
    } else {
        let desc = "";
        
        // Status header — code block style
        if (current.ownerId) {
            desc += `\`\`\`md\n# ${current.ownerName || getMsg("render.unknownUser")}\n\`\`\`\n`;
            // Show queue info below owner when someone is in queue
            if (current.next) {
                desc += current.next.endLimit
                    ? `\`\`\`md\n⏭️ ${current.next.userName} — ${getEndLimitCountdown(current.next.endLimit)}\n\`\`\`\n`
                    : `\`\`\`md\n⏭️ ${current.next.userName} — 🕒 ${getMsg("rooms.expectedAt", { formattedTime: getDynamicQueueETA(current), timezone: getContinentLabel() })}\n\`\`\`\n`;
            }
        } else if (current.next && current.next.endLimit) {
            desc += `\`\`\`md\n⏭️ ${current.next.userName} — ${getEndLimitCountdown(current.next.endLimit)}\n\`\`\`\n`;
        } else if ("fixed" === current.type) {
            desc += isRoomOpen(current.schedules) 
                ? `\`\`\`fix\n🟢 ${getMsg("rooms.roomIsOpen")}\n\`\`\`\n` 
                : `\`\`\`yaml\n🔴 ${getMsg("rooms.eventEnded")}\n\`\`\`\n`;
        } else if (current.next) {
            desc += `\`\`\`md\n⏭️ ${current.next.userName} — 🕒 ${getMsg("rooms.expectedAt", { formattedTime: getDynamicQueueETA(current), timezone: getContinentLabel() })}\n\`\`\`\n`;
        } else {
            desc += `\`\`\`yaml\n🟢 Available\n\`\`\`\n`;
        }
        embed.setDescription(desc);

        if ("fixed" === current.type) {
            let now = getLocalTime();
            
            if (isRoomOpen(current.schedules)) {
                // Room is currently open — show close countdown (end of current hour)
                let endOfHour = new Date(now.getTime());
                endOfHour.setHours(now.getHours() + 1, 0, 0, 0);
                let closeMins = Math.floor((endOfHour.getTime() - now.getTime()) / 6e4);
                let countdownStr = closeMins <= 0
                    ? "🟢 Open now"
                    : `🟢 Closes in ${closeMins}m`;
                embed.addFields({
                    name: `⏰ ${getMsg("rooms.nextOpeningTitle")}`,
                    value: `\`\`\`yaml\n${countdownStr}\n\`\`\``,
                    inline: !1
                });
            } else {
                // Room is closed — show next opening countdown
                let nextOpenDate = calculateNextOpening(current.schedules);
                let diffMs = nextOpenDate.getTime() - now.getTime();
                let diffMins = Math.floor(diffMs / 6e4);
                let countdownStr = diffMins < 60
                    ? `Next in ${diffMins}m`
                    : `Next in ${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
                embed.addFields({
                    name: `⏰ ${getMsg("rooms.nextOpeningTitle")}`,
                    value: `\`\`\`yaml\n${countdownStr}\n\`\`\``,
                    inline: !1
                });
            }
        } else {
            for (let prop in current) {
                if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) {
                    let displayStatus = current[prop].status;

                    // Show countdown for killed bosses instead of static time
                    if (displayStatus.startsWith("🔴 Killed at") && current[prop].cooldown) {
                        // Prefer stored millisecond timestamp (timezone-safe), fall back to parsing string
                        let killedTime;
                        if (current[prop]._lastKilledAt) {
                            killedTime = new Date(current[prop]._lastKilledAt);
                        } else {
                            let killedTimeStr = displayStatus.replace("🔴 Killed at ", "").trim();
                            killedTime = parseStringToDate(killedTimeStr);
                        }
                        if (killedTime) {
                            // Schedule-based respawn (Red Boss, Leader 3) — based on fixed schedules
                            if (usesScheduleRespawn(current, prop)) {
                                let schedules = getBossSchedules(current, prop);
                                let nextSpawn = getNextScheduleAfter(killedTime, schedules);
                                if (nextSpawn) {
                                    let remainingMs = nextSpawn.getTime() - now.getTime();
                                    if (remainingMs > 0) {
                                        let totalMins = Math.ceil(remainingMs / 6e4);
                                        let hrs = Math.floor(totalMins / 60);
                                        let mins = totalMins % 60;
                                        displayStatus = hrs > 0
                                            ? `🔴 Respawn in ${hrs}h ${mins}m`
                                            : `🔴 Respawn in ${mins}m`;
                                    } else {
                                        displayStatus = "🔴 Any moment...";
                                    }
                                }
                            } else {
                                // Cooldown-based respawn for regular bosses (Left, Right, Plant, Ore, Leader 1, 2)
                                let totalCooldownSeconds = 60 * current[prop].cooldown;
                                let secondsPassed = Math.floor((now.getTime() - killedTime.getTime()) / 1e3);
                                let remainingSeconds = totalCooldownSeconds - secondsPassed;
                                if (remainingSeconds > 0) {
                                    let mins = Math.floor(remainingSeconds / 60);
                                    let secs = remainingSeconds % 60;
                                    displayStatus = `🔴 Respawn in ${mins}m ${secs}s`;
                                } else {
                                    displayStatus = "🔴 Any moment...";
                                }
                            }
                        }
                    }
                    
                    // Show elapsed time since respawn (progressive counter from _freeSince)
                    if (displayStatus === "🟢 Available" && current[prop]._freeSince > 0) {
                        let freeDate = new Date(current[prop]._freeSince);
                        let diffMs = now.getTime() - freeDate.getTime();
                        if (diffMs < 0) {
                            displayStatus = "🟢 Available";
                        } else {
                            let diffMins = Math.floor(diffMs / 6e4);
                            let diffHours = Math.floor(diffMs / 36e5);
                            if (diffMins < 1) {
                                displayStatus = `🟢 Now`;
                            } else if (diffHours < 1) {
                                displayStatus = `🟢 ${diffMins}m ago`;
                            } else {
                                let remainingMins = diffMins % 60;
                                displayStatus = remainingMins > 0
                                    ? `🟢 ${diffHours}h ${remainingMins}m ago`
                                    : `🟢 ${diffHours}h ago`;
                            }
                        }
                    } else if (displayStatus === "🟢 Available" && !current[prop]._freeSince && (current[prop]._lastKilledAt || current[prop]._lastKilledTimeStr)) {
                        // Fallback: use _lastKilledAt if _freeSince is not available
                        let killedDate;
                        if (current[prop]._lastKilledAt) {
                            killedDate = new Date(current[prop]._lastKilledAt);
                        } else {
                            killedDate = parseStringToDate(current[prop]._lastKilledTimeStr);
                        }
                        if (killedDate && !isNaN(killedDate.getTime())) {
                            let diffMs = now.getTime() - killedDate.getTime();
                            if (diffMs < 0) {
                                displayStatus = "🟢 Available";
                            } else {
                                let diffMins = Math.floor(diffMs / 6e4);
                                let diffHours = Math.floor(diffMs / 36e5);
                                if (diffMins < 1) {
                                    displayStatus = `🟢 Now`;
                                } else if (diffHours < 1) {
                                    displayStatus = `🟢 ${diffMins}m ago`;
                                } else {
                                    let remainingMins = diffMins % 60;
                                    displayStatus = remainingMins > 0
                                        ? `🟢 ${diffHours}h ${remainingMins}m ago`
                                        : `🟢 ${diffHours}h ago`;
                                }
                            }
                        }
                    }
                    
                    let codeLang = displayStatus.startsWith("🔴") ? "yaml" : displayStatus.startsWith("🟢") ? "yaml" : "yaml";
                    embed.addFields({
                        name: current[prop].name,
                        value: `\`\`\`${codeLang}\n${displayStatus}\n\`\`\``,
                        inline: !0
                    });
                }
            }
        }
    }
    return embed;
}

export function renderButtons(key) {
    let current = db[key],
        componentsList = [];
    
    if ("fixed" !== current.type && "antidemon" !== current.type && "summon" !== current.type) {
        let row = new t();
        let hasProperties = !1;
        for (let prop in current) {
            if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;
            let emojiStr = "🎯";
            if (current[prop].name.includes("Left")) emojiStr = "⬅️";
            else if (current[prop].name.includes("Right")) emojiStr = "➡️";
            else if (current[prop].name.includes("Red")) emojiStr = "🟥";
            else if (current[prop].name.includes("Plant")) emojiStr = "🌱";
            else if (current[prop].name.includes("Ore")) emojiStr = "⛏️";
            else if (current[prop].name.includes("1")) emojiStr = "1️⃣";
            else if (current[prop].name.includes("2")) emojiStr = "2️⃣";
            else if (current[prop].name.includes("3")) emojiStr = "3️⃣";

            row.addComponents(new n()
                .setCustomId(`death-${key}-${prop}`)
                .setEmoji(emojiStr)
                .setStyle(a.Secondary));
            hasProperties = !0;
        }
        if (hasProperties) componentsList.push(row);
    }

    // Core action buttons
    let coreRow = new t();
    
    if ("antidemon" === current.type || "summon" === current.type) {
        const summonProps = "summon" === current.type ? ["sp2", "sp4", "sp7", "ms11", "sp11"] : ["left", "mid", "right"];
        let anyClaimed = summonProps.some(p => current[p] && current[p].status === "🔴 Claimed");
        coreRow.addComponents(
            new n()
                .setCustomId(`floor-${key}-claim`)
                .setLabel(getMsg("buttons.claimLabel"))
                .setStyle(a.Success),
            ...(anyClaimed ? [new n()
                .setCustomId(`floor-${key}-next`)
                .setLabel(getMsg("buttons.nextLabel"))
                .setStyle(a.Primary)] : []),
            new n()
                .setCustomId(`floor-${key}-cancel`)
                .setLabel(getMsg("buttons.cancelLabel"))
                .setStyle(a.Danger)
        );
    } else {
        coreRow.addComponents(
            new n()
                .setCustomId(`floor-${key}-claim`)
                .setLabel(getMsg("buttons.claimLabel"))
                .setStyle(a.Success),
            new n()
                .setCustomId(`floor-${key}-cancel`)
                .setLabel(getMsg("buttons.cancelLabel"))
                .setStyle(a.Danger)
        );
        
        // Magic Square / normal floors don't use the Next queue button
    }
    
    componentsList.push(coreRow);
    return componentsList;
}
