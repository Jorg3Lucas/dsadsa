// ==========================================
// 🎯 FLOOR — Event Group Slide Handler
// Routes schedule/fixed/summon selection
// Extracted from floor-eventgroup.js
// ==========================================

import { ActionRowBuilder as t, StringSelectMenuBuilder as i } from "discord.js";
import { getMsg, getArray } from "../core/lang.js";
import { db, saveLocalStorage } from "../core/state.js";
import { refreshVisualPanel, notifyUserDM } from "../handlers/panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import {
    checkPunishment,
    hasActiveClaim,
    buildActiveClaimMessage
} from "../handlers/claim-core.js";
import {
    getFormattedTime12h,
    getLocalTime,
    calculateNextOpening,
    isRoomOpen
} from "../core/time-utils.js";
import { noop } from "../core/config.js";
import { egSummonCache } from "./floor-eventgroup-cache.js";

/** Handle event selection from slide menu. Routes to schedule/fixed/summon claim logic. @param {import('discord.js').StringSelectMenuInteraction} interaction @param {string} uid @param {string} uName @returns {Promise<void>} */
export async function handleEGSlide(interaction, uid, uName) {
    const pStr = checkPunishment(uid);
    if (pStr) {return await interaction.update({ content: pStr, components: [], flags: 64 }).catch(noop);}

    if (hasActiveClaim(uid)) {
        const claimMsg = buildActiveClaimMessage(uid);
        return await interaction.update({ content: claimMsg, components: [], flags: 64 }).catch(noop);
    }

    const pKey = interaction.customId.replace("egslide-", ""),
        targetFloor = db[pKey],
        selectedEvent = interaction.values[0];

    if (!targetFloor || !targetFloor[selectedEvent]) {return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);}

    const evData = targetFloor[selectedEvent];

    if (evData.ownerId) {
        return await interaction.update({
            content: getMsg("rooms.slotAlreadyClaimed", { room: evData.name, ownerName: evData.ownerName || getMsg("render.unknownUser") }),
            components: [], flags: 64
        }).catch(noop);
    }

    if (evData.type === "schedule") {
        const now = getLocalTime();
        evData.ownerId = uid;
        evData.ownerName = uName;
        evData._claimTimestamp = now.getTime();
        pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${evData.name}`, "Claimed Red Boss");
        notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} - ${evData.name}`, window: "Until boss is killed" }));
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({ content: `🏆 ${evData.name} claimed!`, components: [], flags: 64 }).catch(noop);
    } else if (evData.type === "fixed") {
        const now = getLocalTime();
        const minuteOffset = evData.scheduleMinutes || 0;
        let eventStart, claimedHour;

        if (isRoomOpen(evData.schedules, minuteOffset)) {
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            let foundHour = null;
            for (const h of evData.schedules) {
                const startMin = h * 60 + minuteOffset;
                const endMin = startMin + 60;
                if (nowMinutes >= startMin && nowMinutes < endMin) { foundHour = h; break; }
            }
            if (foundHour !== null) {
                eventStart = new Date(now.getTime());
                eventStart.setHours(foundHour, minuteOffset, 0, 0);
                claimedHour = foundHour;
            } else {
                eventStart = calculateNextOpening(evData.schedules, minuteOffset);
                claimedHour = eventStart.getHours();
            }
        } else {
            eventStart = calculateNextOpening(evData.schedules, minuteOffset);
            claimedHour = eventStart.getHours();
        }

        const hourKey = String(claimedHour);
        if (typeof evData.reservedFor === "string" && evData.reservedFor !== uid) {
            return await interaction.update({ content: getMsg("reserve.blockedOther", { event: evData.name, userName: evData.reservedByName || evData.reservedFor }), components: [], flags: 64 }).catch(noop);
        }
        if (evData.reservations) {
            if (evData.reservations._all && evData.reservations._all.userId !== uid) {
                return await interaction.update({ content: getMsg("reserve.blockedOther", { event: evData.name, userName: evData.reservations._all.userName }), components: [], flags: 64 }).catch(noop);
            }
            const slotRes = evData.reservations[hourKey];
            if (slotRes && slotRes.userId !== uid) {
                return await interaction.update({ content: getMsg("reserve.blockedSlot", { event: evData.name, userName: slotRes.userName }), components: [], flags: 64 }).catch(noop);
            }
        }

        const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
        const windowStr = `${getFormattedTime12h(eventStart)} ~ ${getFormattedTime12h(eventEnd)}`;
        evData.ownerId = uid;
        evData.ownerName = uName;
        evData.timeWindow = windowStr;
        evData._claimTimestamp = now.getTime();
        pushToDailyLogs("CLAIM_START", uName, `${targetFloor.title} - ${evData.name}`, `${getMsg("render.windowPrefix")}: ${windowStr}`);
        notifyUserDM(uid, getMsg("rooms.dmClaimStartedNotice", { title: `${targetFloor.title} - ${evData.name}`, window: windowStr }));
        saveLocalStorage();
        await refreshVisualPanel(pKey);
        return await interaction.update({ content: `🏆 ${evData.name} secured!`, components: [], flags: 64 }).catch(noop);
    } else if (evData.type === "summon") {
        egSummonCache.set(uid, { panelId: pKey, event: selectedEvent });
        return await interaction.update({
            content: `🎫 **${getMsg("rooms.antidemonPromptSelection")}**`,
            components: [new t().addComponents(
                new i().setCustomId(`egticket-${pKey}`)
                    .setPlaceholder(getMsg("rooms.antidemonTicketPlaceholder"))
                    .addOptions(getArray("tickets").map(e => ({ label: e.label, value: e.value, emoji: "🎫" })))
            )],
            flags: 64
        }).catch(noop);
    }

    return await interaction.update({ content: getMsg("rooms.antidemonTimeoutCache"), components: [], flags: 64 }).catch(noop);
}
