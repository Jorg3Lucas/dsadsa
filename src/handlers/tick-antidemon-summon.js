import { parseStringToDate } from "../core/time-utils.js";
import { getMsg } from "../core/lang.js";
import { notifyUserDM } from "./panel-utils.js";
import { pushToDailyLogs } from "../core/daily-logs.js";
import { getAntidemonRoomKeys, getSummonRoomKeys, freeAntidemonRoom } from "./claim-core.js";
import { STATUS_CLAIMED } from "../core/constants.js";
import { noop } from "../core/config.js";

// ==========================================
// ⏱️ ANTIDEMON / SUMMON — Timeout + Absence
// ==========================================

/** Handle timeout and absence expiry for antidemon and summon panels. @param {object} current @param {string} key @param {Date} now @returns {Promise<boolean>} Whether state was updated */
export async function handleAntidemonSummon(current, key, now) {
    let updateNeeded = false;

    if ("antidemon" !== current.type && "summon" !== current.type) return updateNeeded;

    const roomList = "summon" === current.type ? getSummonRoomKeys(key) : getAntidemonRoomKeys(key);
    for (const room of roomList) {
        const rData = current[room];
        if (!rData) continue;

        // ── Time limit ──
        if (STATUS_CLAIMED === rData.status && rData.timeWindow) {
            const limitTime = parseStringToDate(rData.timeWindow.split(" ~ ")[1]);
            if (limitTime && now >= limitTime) {
                if (rData.ownerName) pushToDailyLogs("CLAIM_END", rData.ownerName, `${current.title} - Room ${room.toUpperCase()}`, getMsg("logs.timeout"));
                await notifyUserDM(rData.ownerId, getMsg("rooms.dmRemovedNotice", {
                    title: `${current.title} - Room ${room.toUpperCase()}`,
                    reason: getMsg("logs.timeout")
                })).catch(noop);
                freeAntidemonRoom(current, room);
                updateNeeded = true;
            }
        }

        // ── Queue absence endLimit ──
        if (rData.endLimit && rData.nextId) {
            const absenceLimit = parseStringToDate(rData.endLimit);
            if (absenceLimit && now >= absenceLimit) {
                const displayName = rData.name || room.toUpperCase();
                const absenceTemplate = current.type === "summon"
                    ? "rooms.summonAbsenceDM"
                    : "rooms.antidemonAbsenceDM";
                await notifyUserDM(rData.nextId, getMsg(absenceTemplate, {
                    roomKey: displayName,
                    title: current.title
                })).catch(noop);
                if (rData.nextName) pushToDailyLogs("CLAIM_END", rData.nextName, `${current.title} - ${displayName}`, getMsg("logs.absenceQueue"));
                rData.nextId = null;
                rData.nextName = null;
                rData.endLimit = null;
                rData.formattedTimeNext = "";
                freeAntidemonRoom(current, room);
                updateNeeded = true;
            }
        }
    }

    return updateNeeded;
}
