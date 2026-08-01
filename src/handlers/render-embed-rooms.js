// ==========================================
// 🎨 EMBED — Room Panel Renderers (summon, antidemon, default/normal)
// Extracted from render-embed.js
// ==========================================

import { getMsg } from "../core/lang.js";
import {
    isRoomOpen,
    getDynamicQueueETA,
    getEndLimitCountdown,
    calculateNextOpening,
    getNextScheduleAfter,
    usesScheduleRespawn,
    getBossSchedules,
    parseStringToDate,
    getFormattedTime12h
} from "../core/time-utils.js";
import { STATUS_AVAILABLE, STATUS_CLAIMED, STATUS_KILLED, STATUS_KILLED_PREFIX, STATUS_ANY_MOMENT } from "../core/constants.js";
import { getAntidemonRoomKeys, getSummonRoomKeys } from "./claim-core.js";

/** Render a summon panel. @param {import('discord.js').EmbedBuilder} embed @param {object} current @param {string} key @param {Date} now */
export function renderSummonPanel(embed, current, key, now) {
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

/** Render an antidemon panel. @param {import('discord.js').EmbedBuilder} embed @param {object} current @param {string} key @param {Date} now */
export function renderAntidemonPanel(embed, current, key, now) {
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

/** Render a default (normal/peak/fixed standalone) panel. @param {import('discord.js').EmbedBuilder} embed @param {object} current @param {Date} now */
export function renderDefaultPanel(embed, current, now) {
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
        const fixedMinuteOffset = current.scheduleMinutes || 0;
        if (isRoomOpen(current.schedules, fixedMinuteOffset)) {
            desc += `\`\`\`fix\n🟢 ${getMsg("rooms.roomIsOpen")}\n\`\`\`\n`;
        } else {
            const nextOpenDate = calculateNextOpening(current.schedules, fixedMinuteOffset);
            const fiveMinBefore = new Date(nextOpenDate.getTime() - 5 * 60 * 1000);
            const inEarlyWindow = now >= fiveMinBefore;
            desc += inEarlyWindow
                ? `\`\`\`fix\n🟡 ${getMsg("rooms.eventEarlyClaimActive", { time: getFormattedTime12h(nextOpenDate) })}\n\`\`\`\n`
                : `\`\`\`yaml\n🔴 ${getMsg("rooms.eventEnded")}\n\`\`\`\n`;
        }
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
