// ==========================================
// 🎨 EMBED — Panel Renderer (dispatcher + event_group)
// Extracted from render-embed.js
// Summon / antidemon / default room renderers live in render-embed-rooms.js
// ==========================================

import {
    EmbedBuilder as e
} from "discord.js";
import { getLocalTime, isRoomOpen, calculateNextOpening, getNextScheduleAfter, parseStringToDate, getFormattedTime12h } from "../core/time-utils.js";
import { getMsg } from "../core/lang.js";
import { db } from "../core/state.js";
import { STATUS_AVAILABLE, STATUS_KILLED, STATUS_KILLED_PREFIX } from "../core/constants.js";
import { getEventGroupKeys } from "./claim-core.js";
import { getEmbedColor } from "./render-embed-core.js";
import { renderSummonPanel, renderAntidemonPanel, renderDefaultPanel } from "./render-embed-rooms.js";

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
                        // Current schedule slot honoring the minute offset (e.g. Fury runs h:30-(h+1):30)
                        const nowMinutes = nowHour * 60 + now.getMinutes();
                        let activeHour = null;
                        for (const h of evData.schedules || []) {
                            const startMin = h * 60 + minuteOffset;
                            const endMin = startMin + 60;
                            if (nowMinutes >= startMin && nowMinutes < endMin) { activeHour = h; break; }
                        }
                        const currentSlot = activeHour !== null ? evData.reservations[String(activeHour)] : undefined;
                        if (currentSlot) lines.push(`🟢 Now: ${currentSlot.userName}`);
                        const lookupHour = activeHour !== null ? activeHour : nowHour;
                        const nextSlot = resHours.find(h => parseInt(h) > lookupHour);
                        if (nextSlot) {
                            const slotUser = evData.reservations[nextSlot].userName;
                            lines.push(`⏭️ Next: ${nextSlot}:${String(minuteOffset).padStart(2, "0")} -> ${slotUser}`);
                        }
                        if (!currentSlot && !nextSlot) {
                            const firstSlot = resHours[0];
                            lines.push(`# ${firstSlot}:${String(minuteOffset).padStart(2, "0")} -> ${evData.reservations[firstSlot].userName}`);
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
                const fiveMinBefore = new Date(nextOpenDate.getTime() - 5 * 60 * 1000);
                const inEarlyWindow = now >= fiveMinBefore;
                lines.push(inEarlyWindow
                    ? `🟡 ${getMsg("rooms.eventEarlyClaimActive", { time: getFormattedTime12h(nextOpenDate) })}`
                    : `🔴 Closed`);
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
