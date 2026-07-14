// ==========================================
// 🎨 EMBED — Panel Renderer
// All panel type rendering: event_group, summon, antidemon, normal/peak
// Extracted from render-embed.js
// ==========================================

import {
    EmbedBuilder as e
} from "discord.js";
import { getLocalTime, isRoomOpen, getDynamicQueueETA, getEndLimitCountdown, calculateNextOpening, getNextScheduleAfter, usesScheduleRespawn, getBossSchedules, parseStringToDate } from "../core/time-utils.js";
import { getMsg } from "../core/lang.js";
import { db } from "../core/state.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_KILLED, STATUS_KILLED_PREFIX, STATUS_ANY_MOMENT } from "../core/constants.js";
import { getAntidemonRoomKeys, getSummonRoomKeys, getEventGroupKeys } from "./claim-core.js";
import { getEmbedColor } from "./render-embed-core.js";

/** Build a complete Discord Embed for a panel, showing claim status, timers, and boss states. @param {string} key @returns {import('discord.js').EmbedBuilder} */
export function renderEmbed(key) {
    const current = db[key];
    if (!current) return new e().setTitle(getMsg("system.errorTitle"));

    const embedColor = getEmbedColor(current, key),
        now = getLocalTime();
    const embed = new e().setColor(embedColor);

    // Dynamic title with time window
    if ("antidemon" !== current.type && current.timeWindow) {
        embed.setTitle(`${current.title} \u200B \u200B \u200B \u200B \` ⏱️ ${current.timeWindow} \``);
    } else {
        embed.setTitle(current.title);
    }
    embed.setTimestamp();

    if ("event_group" === current.type) {
        renderEventGroupPanel(embed, current, now);
    } else if ("summon" === current.type) {
        renderSummonPanel(embed, current, key, now);
    } else if ("antidemon" === current.type) {
        renderAntidemonPanel(embed, current, key, now);
    } else {
        renderDefaultPanel(embed, current, now);
    }
    return embed;
}

function renderEventGroupPanel(embed, current, now) {
    const eventKeys = getEventGroupKeys(current);
    embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
    for (const ev of eventKeys) {
        const evData = current[ev];
        let block;

        if (evData.type === "schedule") {
            const displayStatus = evData.status;
            const claimLine = evData.ownerId && evData.ownerName
                ? `👑 ${evData.ownerName}`
                : "🟢 Available";
            let timerLine = "";
            if (displayStatus && displayStatus.startsWith(STATUS_KILLED)) {
                let killedTime;
                if (evData._lastKilledAt) {
                    killedTime = new Date(evData._lastKilledAt);
                } else {
                    const killedTimeStr = displayStatus.replace(STATUS_KILLED_PREFIX, "").trim();
                    killedTime = parseStringToDate(killedTimeStr);
                }
                if (killedTime) {
                    const schedules = evData.schedules || [];
                    const nextSpawn = getNextScheduleAfter(killedTime, schedules);
                    if (nextSpawn) {
                        const remainingMs = nextSpawn.getTime() - now.getTime();
                        if (remainingMs > 0) {
                            const totalMins = Math.ceil(remainingMs / 6e4);
                            const hrs = Math.floor(totalMins / 60);
                            const mins = totalMins % 60;
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
            if (evData.ownerId && evData.ownerName) {
                let timerLine = "";
                if (evData.timeWindow) {
                    const endTimeStr = evData.timeWindow.split(" ~ ")[1];
                    const endTime = parseStringToDate(endTimeStr);
                    if (endTime) {
                        const remainingSecs = Math.floor((endTime.getTime() - now.getTime()) / 1e3);
                        if (remainingSecs > 0) {
                            const mins = Math.floor(remainingSecs / 60);
                            const secs = remainingSecs % 60;
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
            const minuteOffset = evData.scheduleMinutes || 0;
            const lines = [];
            let timerLine = "";

            if (evData.ownerId && evData.ownerName) {
                lines.push(`# 👑 ${evData.ownerName}`);
            } else if (evData.reservedFor && !evData.ownerId) {
                const userName = evData.reservedByName || evData.reservedFor;
                lines.push(`# ${getMsg("reserve.reservedNotice", { userName })}`);
            } else if (evData.reservations && !evData.ownerId) {
                const nowHour = now.getHours();
                const hasAllRes = evData.reservations._all;
                if (hasAllRes) {
                    lines.push(`# ${getMsg("reserve.reservedNotice", { userName: hasAllRes.userName })}`);
                } else {
                    const resHours = Object.keys(evData.reservations).filter(k => !k.startsWith("_")).sort((a, b) => parseInt(a) - parseInt(b));
                    if (resHours.length > 0) {
                        const currentSlot = evData.reservations[String(nowHour)];
                        if (currentSlot) lines.push(`🟢 Now: ${currentSlot.userName}`);
                        const nextSlot = resHours.find(h => parseInt(h) > nowHour);
                        if (nextSlot) {
                            const slotUser = evData.reservations[nextSlot].userName;
                            lines.push(`⏭️ Next: ${nextSlot}:00 -> ${slotUser}`);
                        }
                        if (!currentSlot && !nextSlot) {
                            const firstSlot = resHours[0];
                            lines.push(`# ${firstSlot}:00 -> ${evData.reservations[firstSlot].userName}`);
                        }
                        if (resHours.length > 1) lines.push(`📌 ${resHours.length} slot(s) reserved`);
                    }
                }
            } else if (isRoomOpen(evData.schedules, minuteOffset)) {
                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                const endMinute = Math.ceil((nowMinutes - minuteOffset + 1) / 60) * 60 + minuteOffset;
                const endOfEvent = new Date(now.getTime());
                endOfEvent.setHours(Math.floor(endMinute / 60) % 24, endMinute % 60, 0, 0);
                if (endOfEvent <= now) endOfEvent.setHours(endOfEvent.getHours() + 1);
                const closeMins = Math.floor((endOfEvent.getTime() - now.getTime()) / 6e4);
                lines.push(`🟢 Open`);
                timerLine = closeMins <= 0 ? "⏱️ Expiring..." : `⏱️ Closes in ${closeMins}m`;
            } else {
                const nextOpenDate = calculateNextOpening(evData.schedules, minuteOffset);
                const diffMs = nextOpenDate.getTime() - now.getTime();
                const diffMins = Math.floor(diffMs / 6e4);
                lines.push(`🔴 Closed`);
                timerLine = diffMins < 60 ? `⏱️ Next in ${diffMins}m` : `⏱️ Next in ${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
            }
            block = timerLine
                ? `\`\`\`md\n${lines.join("\n")}\n\`\`\`\n\`\`\`yaml\n${timerLine}\n\`\`\``
                : `\`\`\`md\n${lines.join("\n")}\n\`\`\``;
        } else {
            block = `\`\`\`yaml\n${evData.status || STATUS_AVAILABLE}\n\`\`\``;
        }
        embed.addFields({ name: evData.name, value: block, inline: true });
    }
}

function renderSummonPanel(embed, current, key, now) {
    const summonProps = getSummonRoomKeys(key);
    const isSingle = summonProps.length === 1;
    embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
    for (const loc of summonProps) {
        const rData = current[loc];
        let block;

        if (STATUS_CLAIMED === rData.status && rData.ownerName) {
            let timerStr = "";
            if (rData.timeWindow) {
                const endTimeStr = rData.timeWindow.split(" ~ ")[1];
                const endTime = parseStringToDate(endTimeStr);
                if (endTime) {
                    const remainingSecs = Math.floor((endTime.getTime() - now.getTime()) / 1e3);
                    if (remainingSecs > 0) {
                        const mins = Math.floor(remainingSecs / 60);
                        const secs = remainingSecs % 60;
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
}

function renderAntidemonPanel(embed, current, key, now) {
    const antiRoomKeys = getAntidemonRoomKeys(key);
    embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
    for (const room of antiRoomKeys) {
        const rData = current[room];
        let remainingClaimStr = "";
        if (STATUS_CLAIMED === rData.status && rData.timeWindow) {
            const endTimeStr = rData.timeWindow.split(" ~ ")[1];
            const endTime = parseStringToDate(endTimeStr);
            if (endTime) {
                const remainingSecs = Math.floor((endTime.getTime() - now.getTime()) / 1e3);
                if (remainingSecs > 0) {
                    const mins = Math.floor(remainingSecs / 60);
                    const secs = remainingSecs % 60;
                    remainingClaimStr = `⏱️ ${mins}m ${secs}s (${getMsg("render.countdownUntil")} ${endTimeStr})`;
                } else {
                    remainingClaimStr = "⏱️ Expiring...";
                }
            }
        }
        let block = STATUS_CLAIMED === rData.status && rData.ownerName
            ? `\`\`\`md\n# 👑 ${rData.ownerName}\n${remainingClaimStr || rData.time}\n${rData.password ? getMsg("rooms.antidemonPasswordLabel", { password: rData.password }) : ""}\n\`\`\``
            : rData.endLimit && rData.nextName
                ? `\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\`\n${getEndLimitCountdown(rData.endLimit)}`
                : `\`\`\`yaml\n${STATUS_AVAILABLE}\n\`\`\``;
        if (STATUS_CLAIMED === rData.status && rData.nextName) {
            block += `\n\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
        } else if (rData.nextName && !rData.endLimit) {
            block += `\n\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
        }
        embed.addFields({ name: rData.name, value: block, inline: true });
    }
}

function renderDefaultPanel(embed, current, now) {
    let desc = "";

    if (current.ownerId) {
        desc += `\`\`\`md\n# ${current.ownerName || getMsg("render.unknownUser")}\n\`\`\`\n`;
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
        const minuteOffset = current.scheduleMinutes || 0;
        if (isRoomOpen(current.schedules, minuteOffset)) {
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const endMinute = Math.ceil((nowMinutes - minuteOffset + 1) / 60) * 60 + minuteOffset;
            const endOfEvent = new Date(now.getTime());
            endOfEvent.setHours(Math.floor(endMinute / 60) % 24, endMinute % 60, 0, 0);
            if (endOfEvent <= now) endOfEvent.setHours(endOfEvent.getHours() + 1);
            const closeMins = Math.floor((endOfEvent.getTime() - now.getTime()) / 6e4);
            embed.addFields({
                name: `⏰ ${getMsg("rooms.nextOpeningTitle")}`,
                value: `\`\`\`yaml\n${closeMins <= 0 ? "🟢 Open now" : `🟢 Closes in ${closeMins}m`}\n\`\`\``,
                inline: false
            });
        } else {
            const nextOpenDate = calculateNextOpening(current.schedules, minuteOffset);
            const diffMs = nextOpenDate.getTime() - now.getTime();
            const diffMins = Math.floor(diffMs / 6e4);
            embed.addFields({
                name: `⏰ ${getMsg("rooms.nextOpeningTitle")}`,
                value: `\`\`\`yaml\n${diffMins < 60 ? `Next in ${diffMins}m` : `Next in ${Math.floor(diffMins / 60)}h ${diffMins % 60}m`}\n\`\`\``,
                inline: false
            });
        }
    } else {
        for (const prop in current) {
            if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp", "scheduleMinutes"].includes(prop)) {
                let displayStatus = current[prop].status;

                if (displayStatus.startsWith(STATUS_KILLED) && current[prop].cooldown) {
                    let killedTime;
                    if (current[prop]._lastKilledAt) {
                        killedTime = new Date(current[prop]._lastKilledAt);
                    } else {
                        const killedTimeStr = displayStatus.replace(STATUS_KILLED_PREFIX, "").trim();
                        killedTime = parseStringToDate(killedTimeStr);
                    }
                    if (killedTime) {
                        if (usesScheduleRespawn(current, prop)) {
                            const schedules = getBossSchedules(current, prop);
                            const nextSpawn = getNextScheduleAfter(killedTime, schedules);
                            if (nextSpawn) {
                                const remainingMs = nextSpawn.getTime() - now.getTime();
                                if (remainingMs > 0) {
                                    const totalMins = Math.ceil(remainingMs / 6e4);
                                    const hrs = Math.floor(totalMins / 60);
                                    const mins = totalMins % 60;
                                    displayStatus = hrs > 0 ? `🔴 Respawn in ${hrs}h ${mins}m` : `🔴 Respawn in ${mins}m`;
                                } else {
                                    displayStatus = STATUS_ANY_MOMENT;
                                }
                            }
                        } else {
                            const totalCooldownSeconds = 60 * current[prop].cooldown;
                            const secondsPassed = Math.floor((now.getTime() - killedTime.getTime()) / 1e3);
                            const remainingSeconds = totalCooldownSeconds - secondsPassed;
                            if (remainingSeconds > 0) {
                                const mins = Math.floor(remainingSeconds / 60);
                                const secs = remainingSeconds % 60;
                                displayStatus = `🔴 Respawn in ${mins}m ${secs}s`;
                            } else {
                                displayStatus = STATUS_ANY_MOMENT;
                            }
                        }
                    }
                }

                if (displayStatus === STATUS_AVAILABLE && current[prop]._freeSince > 0) {
                    const freeDate = new Date(current[prop]._freeSince);
                    const diffMs = now.getTime() - freeDate.getTime();
                    if (diffMs >= 0) {
                        const diffMins = Math.floor(diffMs / 6e4);
                        const diffHours = Math.floor(diffMs / 36e5);
                        if (diffMins < 1) displayStatus = `🟢 Now`;
                        else if (diffHours < 1) displayStatus = `🟢 ${diffMins}m ago`;
                        else {
                            const remainingMins = diffMins % 60;
                            displayStatus = remainingMins > 0 ? `🟢 ${diffHours}h ${remainingMins}m ago` : `🟢 ${diffHours}h ago`;
                        }
                    }
                } else if (displayStatus === STATUS_AVAILABLE && !current[prop]._freeSince && (current[prop]._lastKilledAt || current[prop]._lastKilledTimeStr)) {
                    let killedDate;
                    if (current[prop]._lastKilledAt) {
                        killedDate = new Date(current[prop]._lastKilledAt);
                    } else {
                        killedDate = parseStringToDate(current[prop]._lastKilledTimeStr);
                    }
                    if (killedDate && !isNaN(killedDate.getTime())) {
                        const diffMs = now.getTime() - killedDate.getTime();
                        if (diffMs >= 0) {
                            const diffMins = Math.floor(diffMs / 6e4);
                            const diffHours = Math.floor(diffMs / 36e5);
                            if (diffMins < 1) displayStatus = `🟢 Now`;
                            else if (diffHours < 1) displayStatus = `🟢 ${diffMins}m ago`;
                            else {
                                const remainingMins = diffMins % 60;
                                displayStatus = remainingMins > 0 ? `🟢 ${diffHours}h ${remainingMins}m ago` : `🟢 ${diffHours}h ago`;
                            }
                        }
                    }
                }

                embed.addFields({
                    name: current[prop].name,
                    value: `\`\`\`yaml\n${displayStatus}\n\`\`\``,
                    inline: true
                });
            }
        }
    }
}
