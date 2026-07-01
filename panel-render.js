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
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_OPEN, STATUS_KILLED, STATUS_KILLED_PREFIX, STATUS_ANY_MOMENT, STATUS_NOW, COLOR_OCCUPIED, COLOR_HAS_QUEUE, COLOR_DEFAULT, COLOR_OPEN } from "./constants.js";
import { getAntidemonRoomKeys, getAntidemonRoomName, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";

// ==========================================
// 🎨 RENDERING (Embeds & Buttons)
// ==========================================

export function getEmbedColor(current, key) {
    if (!current) return COLOR_DEFAULT;
    if (current.ownerId) return COLOR_OCCUPIED;
    if (current.next) return COLOR_HAS_QUEUE;
    if ("event_group" === current.type) {
        const events = getEventGroupKeys(current);
        let anyClaimed = events.some(e => current[e] && current[e].ownerId);
        if (anyClaimed) return COLOR_OCCUPIED;
        let anyQueued = events.some(e => current[e] && current[e].nextId);
        if (anyQueued) return COLOR_HAS_QUEUE;
    }
    if ("antidemon" === current.type || "summon" === current.type) {
        const props = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
        let hasClaimed = props.some(p => current[p] && current[p].status.startsWith("🔴"));
        if (hasClaimed) return COLOR_OCCUPIED;
        let hasQueue = props.some(p => current[p] && current[p].nextId);
        if (hasQueue) return COLOR_HAS_QUEUE;
    }
    if ("fixed" === current.type) {
        return isRoomOpen(current.schedules, current.scheduleMinutes || 0) ? COLOR_OPEN : COLOR_DEFAULT;
    }
    return COLOR_DEFAULT;
}

export function renderEmbed(key) {
    let current = db[key];
    if (!current) return new e().setTitle(getMsg("system.errorTitle"));
    
    let embedColor = getEmbedColor(current, key),
        now = getLocalTime();
    let embed = new e().setColor(embedColor);
    
    // Dynamic title with time window
    "antidemon" !== current.type && current.timeWindow 
        ? embed.setTitle(`${current.title} \u200B \u200B \u200B \u200B \` ⏱️ ${current.timeWindow} \``) 
        : embed.setTitle(current.title);
    
    // Footer with update timestamp
    embed.setTimestamp();

    if ("event_group" === current.type) {
        const eventKeys = getEventGroupKeys(current);
        embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
        for (let ev of eventKeys) {
            let evData = current[ev];
            let block = "";
            
            if (evData.type === "schedule") {
                // Schedule-based event (Red Boss)
                // Block 1: claim owner or available
                // Block 2: respawn timer (same format as regular SP peaks)
                let displayStatus = evData.status;
                
                let claimLine = evData.ownerId && evData.ownerName
                    ? `👑 ${evData.ownerName}`
                    : "🟢 Available";
                
                let timerLine = "";
                if (displayStatus && displayStatus.startsWith(STATUS_KILLED)) {
                    let killedTime;
                    if (evData._lastKilledAt) {
                        killedTime = new Date(evData._lastKilledAt);
                    } else {
                        let killedTimeStr = displayStatus.replace(STATUS_KILLED_PREFIX, "").trim();
                        killedTime = parseStringToDate(killedTimeStr);
                    }
                    if (killedTime) {
                        let schedules = evData.schedules || [];
                        let nextSpawn = getNextScheduleAfter(killedTime, schedules);
                        if (nextSpawn) {
                            let remainingMs = nextSpawn.getTime() - now.getTime();
                            if (remainingMs > 0) {
                                let totalMins = Math.ceil(remainingMs / 6e4);
                                let hrs = Math.floor(totalMins / 60);
                                let mins = totalMins % 60;
                                timerLine = hrs > 0
                                    ? `🔴 Respawn in ${hrs}h ${mins}m`
                                    : `🔴 Respawn in ${mins}m`;
                            } else {
                                timerLine = "🟢 Any moment";
                            }
                        }
                    }
                }
                
                block = `\`\`\`yaml\n${claimLine}\n\`\`\``;
                if (timerLine) block += `\n\`\`\`yaml\n${timerLine}\n\`\`\``;
            } else if (evData.type === "summon") {
                // Summon-type event (Goblin) — show owner/queue info
                if (evData.ownerId && evData.ownerName) {
                    let timerLine = "";
                    if (evData.timeWindow) {
                        let endTimeStr = evData.timeWindow.split(" ~ ")[1];
                        let endTime = parseStringToDate(endTimeStr);
                        if (endTime) {
                            let remainingSecs = Math.floor((endTime.getTime() - now.getTime()) / 1e3);
                            if (remainingSecs > 0) {
                                let mins = Math.floor(remainingSecs / 60);
                                let secs = remainingSecs % 60;
                                timerLine = `⏱️ Remaining: ${mins}m ${secs}s`;
                            } else {
                                timerLine = "⏱️ Expiring...";
                            }
                        }
                    }
                    block = `\`\`\`md\n# 👑 ${evData.ownerName}\n\`\`\``;
                    if (timerLine) block += `\n\`\`\`yaml\n${timerLine}\n\`\`\``;
                    if (evData.nextId && evData.nextName) {
                        block += `\n\`\`\`md\n⏭️ ${evData.nextName}\n\`\`\``;
                    }
                } else {
                    block = `\`\`\`yaml\n🟢 Available\n\`\`\``;
                }
            } else if (evData.type === "fixed") {
                // Fixed event (Fury/Frenzy/Random Event) — show open/closed with countdown
                // Format: status line, "Next in:" label, timer value — separate lines
                let minuteOffset = evData.scheduleMinutes || 0;
                let statusLine, timerLabel, timerValue;
                
                if (isRoomOpen(evData.schedules, minuteOffset)) {
                    let nowMinutes = now.getHours() * 60 + now.getMinutes();
                    let endMinute = Math.ceil((nowMinutes - minuteOffset + 1) / 60) * 60 + minuteOffset;
                    let endOfEvent = new Date(now.getTime());
                    endOfEvent.setHours(Math.floor(endMinute / 60) % 24, endMinute % 60, 0, 0);
                    if (endOfEvent <= now) endOfEvent.setHours(endOfEvent.getHours() + 1);
                    let closeMins = Math.floor((endOfEvent.getTime() - now.getTime()) / 6e4);
                    
                    if (evData.ownerId && evData.ownerName) {
                        statusLine = `👑 ${evData.ownerName}`;
                    } else {
                        statusLine = "🟢 Open now";
                    }
                    timerLabel = "Closes in:";
                    timerValue = closeMins <= 0 ? "Expiring..." : `${closeMins}m`;
                } else {
                    let nextOpenDate = calculateNextOpening(evData.schedules, minuteOffset);
                    let diffMs = nextOpenDate.getTime() - now.getTime();
                    let diffMins = Math.floor(diffMs / 6e4);
                    
                    statusLine = "🔴 Closed";
                    timerLabel = "Next in:";
                    timerValue = diffMins < 60
                        ? `${diffMins}m`
                        : `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
                }
                
                block = `\`\`\`yaml\n${statusLine}\n\`\`\`\n\`\`\`yaml\n${timerLabel} ${timerValue}\n\`\`\``;
            } else {
                block = `\`\`\`yaml\n${evData.status || STATUS_AVAILABLE}\n\`\`\``;
            }
            embed.addFields({ name: evData.name, value: block, inline: !0 });
        }
    } else if ("summon" === current.type) {
        // 🌀 SUMMON PANEL — Standard code-block layout (consistent with antidemon)
        const summonProps = getSummonRoomKeys(key);
        const isSingle = summonProps.length === 1;
        embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
        for (let loc of summonProps) {
            let rData = current[loc];
            let block = "";
            
            if (STATUS_CLAIMED === rData.status && rData.ownerName) {
                let timerStr = "";
                if (rData.timeWindow) {
                    let endTimeStr = rData.timeWindow.split(" ~ ")[1];
                    let endTime = parseStringToDate(endTimeStr);
                    if (endTime) {
                        let remainingSecs = Math.floor((endTime.getTime() - now.getTime()) / 1e3);
                        if (remainingSecs > 0) {
                            let mins = Math.floor(remainingSecs / 60);
                            let secs = remainingSecs % 60;
                            timerStr = `⏱️ ${mins}m ${secs}s`;
                        } else {
                            timerStr = "⏱️ Expiring...";
                        }
                    }
                }
                block = `\`\`\`md\n# 👑 ${rData.ownerName}\n${timerStr || ""}\n\`\`\``;
                if (rData.nextId && rData.nextName) {
                    block += `\n\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
                }
            } else if (rData.nextId && rData.nextName && rData.endLimit) {
                // Grace period
                block = `\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\`\n${getEndLimitCountdown(rData.endLimit)}`;
            } else if (rData.nextName) {
                block = `\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
            } else {
                block = `\`\`\`yaml\n${STATUS_AVAILABLE}\n\`\`\``;
            }
            
            embed.addFields({
                name: isSingle ? `\u200B` : rData.name,
                value: block,
                inline: !isSingle
            });
        }
    } else if ("antidemon" === current.type) {
        const antiRoomKeys = getAntidemonRoomKeys(key);
        embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
        for (let room of antiRoomKeys) {
            let rData = current[room];
            let remainingClaimStr = "";
            if (STATUS_CLAIMED === rData.status && rData.timeWindow) {
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
            let block = STATUS_CLAIMED === rData.status && rData.ownerName 
                ? `\`\`\`md\n# 👑 ${rData.ownerName}\n${remainingClaimStr || rData.time}\n${rData.password ? `🎮 PT Password: ${rData.password}` : ""}\n\`\`\`` 
                : rData.endLimit && rData.nextName 
                    ? `\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\`\n${getEndLimitCountdown(rData.endLimit)}` 
                    : `\`\`\`yaml\n${STATUS_AVAILABLE}\n\`\`\``;
            if (STATUS_CLAIMED === rData.status && rData.nextName) {
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
                    : `\`\`\`md\n⏭️ ${current.next.userName} — 🕒 ${getMsg("rooms.expectedAt", { formattedTime: getDynamicQueueETA(current), timezone: "Berlin" })}\n\`\`\`\n`;
            }
        } else if (current.next && current.next.endLimit) {
            desc += `\`\`\`md\n⏭️ ${current.next.userName} — ${getEndLimitCountdown(current.next.endLimit)}\n\`\`\`\n`;
        } else if ("fixed" === current.type) {
            desc += isRoomOpen(current.schedules, current.scheduleMinutes || 0) 
                ? `\`\`\`fix\n🟢 ${getMsg("rooms.roomIsOpen")}\n\`\`\`\n` 
                : `\`\`\`yaml\n🔴 ${getMsg("rooms.eventEnded")}\n\`\`\`\n`;
        } else if (current.next) {
            desc += `\`\`\`md\n⏭️ ${current.next.userName} — 🕒 ${getMsg("rooms.expectedAt", { formattedTime: getDynamicQueueETA(current), timezone: "Berlin" })}\n\`\`\`\n`;
        } else {
            desc += `\`\`\`yaml\n${STATUS_AVAILABLE}\n\`\`\`\n`;
        }
        embed.setDescription(desc);

        if ("fixed" === current.type) {
            let now = getLocalTime();
            
            let minuteOffset = current.scheduleMinutes || 0;
            if (isRoomOpen(current.schedules, minuteOffset)) {
                // Room is currently open — show close countdown
                let nowMinutes = now.getHours() * 60 + now.getMinutes();
                let endMinute = Math.ceil((nowMinutes - minuteOffset + 1) / 60) * 60 + minuteOffset;
                let endOfEvent = new Date(now.getTime());
                endOfEvent.setHours(Math.floor(endMinute / 60) % 24, endMinute % 60, 0, 0);
                if (endOfEvent <= now) endOfEvent.setHours(endOfEvent.getHours() + 1);
                let closeMins = Math.floor((endOfEvent.getTime() - now.getTime()) / 6e4);
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
                let nextOpenDate = calculateNextOpening(current.schedules, minuteOffset);
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
                if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp", "scheduleMinutes"].includes(prop)) {
                    let displayStatus = current[prop].status;

                    // Show countdown for killed bosses instead of static time
                    if (displayStatus.startsWith(STATUS_KILLED) && current[prop].cooldown) {
                        // Prefer stored millisecond timestamp (timezone-safe), fall back to parsing string
                        let killedTime;
                        if (current[prop]._lastKilledAt) {
                            killedTime = new Date(current[prop]._lastKilledAt);
                        } else {
                            let killedTimeStr = displayStatus.replace(STATUS_KILLED_PREFIX, "").trim();
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
                                        displayStatus = STATUS_ANY_MOMENT;
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
                                    displayStatus = STATUS_ANY_MOMENT;
                                }
                            }
                        }
                    }
                    
                    // Show elapsed time since respawn (progressive counter from _freeSince)
                    if (displayStatus === STATUS_AVAILABLE && current[prop]._freeSince > 0) {
                        let freeDate = new Date(current[prop]._freeSince);
                        let diffMs = now.getTime() - freeDate.getTime();
                        if (diffMs < 0) {
                            displayStatus = STATUS_AVAILABLE;
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
                    } else if (displayStatus === STATUS_AVAILABLE && !current[prop]._freeSince && (current[prop]._lastKilledAt || current[prop]._lastKilledTimeStr)) {
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
                                displayStatus = STATUS_AVAILABLE;
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
                    
                    embed.addFields({
                        name: current[prop].name,
                        value: `\`\`\`yaml\n${displayStatus}\n\`\`\``,
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
    if (!current) return componentsList;
    
    if ("event_group" === current.type) {
        // All event_group buttons combined into minimum rows (Discord max 5 per row)
        const eventKeys = getEventGroupKeys(current);
        const hasNonFixedEvents = eventKeys.some(ev => current[ev] && current[ev].type !== "fixed");
        const schedEvents = eventKeys.filter(ev => current[ev].type === "schedule");
        const fixedEvents = eventKeys.filter(ev => current[ev].type === "fixed");
        let anySummonQueue = eventKeys.some(ev => current[ev].type === "summon" && current[ev].nextId);
        
        // Build one combined row (all fit within 5-button limit)
        let mainRow = new t();
        
        // 1. Death mark buttons for schedule events
        schedEvents.forEach(ev => {
            mainRow.addComponents(new n()
                .setCustomId(`egdeath-${key}-${ev}`)
                .setEmoji("🟥")
                .setStyle(a.Secondary));
        });
        
        // 2. Individual claim buttons for fixed events (Fury/Frenzy only, not Random Event)
        fixedEvents.filter(ev => ev !== "randomevent").forEach(ev => {
            const isClaimed = !!current[ev].ownerId;
            mainRow.addComponents(new n()
                .setCustomId(`egfixclaim-${key}-${ev}`)
                .setLabel(isClaimed ? `👑 ${current[ev].ownerName || "Claimed"}` : current[ev].name)
                .setDisabled(isClaimed)
                .setStyle(isClaimed ? a.Secondary : a.Success));
        });
        
        // 3. Core action buttons
        if (hasNonFixedEvents) {
            mainRow.addComponents(new n()
                .setCustomId(`floor-${key}-claim`)
                .setLabel(getMsg("buttons.claimLabel"))
                .setStyle(a.Success));
        }
        if (anySummonQueue) {
            mainRow.addComponents(new n()
                .setCustomId(`floor-${key}-next`)
                .setLabel(getMsg("buttons.nextLabel"))
                .setStyle(a.Primary));
        }
        mainRow.addComponents(new n()
            .setCustomId(`floor-${key}-cancel`)
            .setLabel(getMsg("buttons.cancelLabel"))
            .setStyle(a.Danger));
        
        if (mainRow.components.length > 0) componentsList.push(mainRow);
        
    } else if ("fixed" !== current.type && "antidemon" !== current.type && "summon" !== current.type) {
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
    
    if ("event_group" === current.type) {
        // Already handled above in combined row
    } else if ("antidemon" === current.type || "summon" === current.type) {
        const summonProps = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
        let anyClaimed = summonProps.some(p => current[p] && current[p].status === STATUS_CLAIMED);
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
        // Party password buttons for antidemon rooms (one per claimed room, with improved labels)
        if ("antidemon" === current.type) {
            let pwdRow = new t();
            getAntidemonRoomKeys(key).forEach(rm => {
                if (current[rm] && current[rm].status === STATUS_CLAIMED) {
                    const hasPwd = current[rm].password;
                    pwdRow.addComponents(
                        new n()
                            .setCustomId(`antipwd-${key}-${rm}`)
                            .setEmoji(hasPwd ? "🎮" : "🔒")
                            .setLabel(`${hasPwd ? "PT" : "Set PT"} ${getAntidemonRoomName(key, rm)}`)
                            .setStyle(a.Secondary)
                    );
                }
            });
            if (pwdRow.components.length > 0) componentsList.push(pwdRow);
        }
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
    
    if (coreRow.components.length > 0) componentsList.push(coreRow);
    return componentsList;
}
