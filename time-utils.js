import { getMsg } from "./lang.js";
import { getContinentOffset, getContinentLabel } from "./setup-config.js";

// ==========================================
// ⏰ SCHEDULE CONSTANTS (Berlin time)
// ==========================================

export const redBossSchedules = [1, 4, 7, 10, 13, 16, 19, 22];
export const leader3Schedules = [0, 3, 6, 9, 12, 15, 18, 21];

// ==========================================
// ⏰ DATE/TIME UTILITIES
// ==========================================

/** Returns current time in Berlin (Europe/Berlin) — used for internal logic */
export function getLocalTime() {
    let timeStr = (new Date).toLocaleString("en-US", {
        timeZone: "Europe/Berlin"
    });
    return new Date(timeStr);
}

/** Returns current time adjusted to the configured continent */
export function getContinentTime() {
    const berlinDate = getLocalTime();
    const offset = getContinentOffset();
    return new Date(berlinDate.getTime() + offset * 3600000);
}

/** Converts a Berlin-time Date to the configured continent time */
export function berlinToContinentTime(berlinDate) {
    const offset = getContinentOffset();
    return new Date(berlinDate.getTime() + offset * 3600000);
}

/**
 * Converts a time string from Berlin time to the configured continent time.
 * Handles formats: "HH:MM", "killed at HH:MM", "HH:MM ~ HH:MM", "HH:MM:SS"
 */
export function convertTimeStrToContinent(timeStr) {
    if (!timeStr) return timeStr;
    const offset = getContinentOffset();
    if (offset === 0) return timeStr;

    // Handle "HH:MM ~ HH:MM" format
    if (timeStr.includes(' ~ ')) {
        const parts = timeStr.split(' ~ ');
        return parts.map(p => convertSingleTime(p, offset)).join(' ~ ');
    }
    
    return convertSingleTime(timeStr, offset);
}

function convertSingleTime(str, offset) {
    // Handle "killed at HH:MM" format
    let prefix = '';
    let timePart = str;
    if (str.toLowerCase().startsWith('killed at ')) {
        prefix = str.slice(0, 10); // "killed at "
        timePart = str.slice(10);
    }
    
    const trimmed = timePart.trim();
    const isPM = trimmed.toLowerCase().includes('pm');
    const isAM = trimmed.toLowerCase().includes('am');
    
    let cleanTime = trimmed.replace(/am/i, '').replace(/pm/i, '').trim();
    const parts = cleanTime.split(':');
    if (parts.length < 2) return str;
    
    let hour = parseInt(parts[0], 10);
    const min = parseInt(parts[1], 10);
    const sec = parts[2] ? parseInt(parts[2], 10) : 0;
    
    // Convert to 24h for calculation
    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
    
    // Apply offset
    let newHour = hour + offset;
    if (newHour < 0) newHour += 24;
    if (newHour >= 24) newHour -= 24;
    
    // Format back
    const formattedMin = String(min).padStart(2, '0');
    const formattedSec = parts[2] ? ':' + String(sec).padStart(2, '0') : '';
    const result = `${String(newHour).padStart(2, '0')}:${formattedMin}${formattedSec}`;
    
    return prefix ? prefix + result : result;
}



export function isRoomOpen(schedules) {
    let hr = getLocalTime().toLocaleTimeString("en-GB", {
            hour: "2-digit",
            hour12: !1
        }),
        n = parseInt(hr, 10);
    return schedules.includes(n);
}

// ==========================================
// 🧠 TIME FORMATTING & PARSING
// ==========================================

export function getFormattedTime12h(d) {
    return d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function getDynamicQueueETA(floorObj) {
    if (floorObj && floorObj.timeWindow) {
        let endOfClaim = parseStringToDate(floorObj.timeWindow.split(" ~ ")[1]);
        if (endOfClaim) return getFormattedTime12h(endOfClaim);
    }
    return floorObj && floorObj.next ? floorObj.next.formattedTime : "--:--";
}

export function getEndLimitCountdown(endLimitStr) {
    if (!endLimitStr) return "";
    let limitTime = parseStringToDate(endLimitStr);
    if (!limitTime) return getMsg("rooms.claimBefore", { endLimit: endLimitStr });
    let remainingSecs = Math.floor((limitTime.getTime() - getLocalTime().getTime()) / 1e3);
    let displayTime = convertTimeStrToContinent(endLimitStr);
    if (remainingSecs <= 0) return `⏳ Expired (${getMsg("render.countdownUntil")} ${displayTime})`;
    let mins = Math.floor(remainingSecs / 60);
    let secs = remainingSecs % 60;
    return `⏳ Claim within ${mins}m ${secs}s (${getMsg("render.countdownUntil")} ${displayTime})`;
}

export function calculateNextOpening(schedules) {
    let base = getLocalTime(),
        datesList = [];
    schedules.forEach(hr => {
        let checkDate = new Date(base.getTime());
        checkDate.setHours(hr, 0, 0, 0);
        checkDate <= base && checkDate.setDate(checkDate.getDate() + 1);
        datesList.push(checkDate);
    });
    return datesList.sort((x, y) => x - y), datesList[0];
}

export function getNextScheduleAfter(baseDate, schedules) {
    let datesList = [];
    schedules.forEach(hr => {
        let checkDate = new Date(baseDate.getTime());
        checkDate.setHours(hr, 0, 0, 0);
        if (checkDate <= baseDate) {
            checkDate.setDate(checkDate.getDate() + 1);
        }
        datesList.push(checkDate);
    });
    return datesList.sort((x, y) => x - y)[0];
}

export function usesScheduleRespawn(current, prop) {
    return ("peak" === current.type && "red" === prop) || ("normal" === current.type && "boss3" === prop);
}

export function getBossSchedules(current, prop) {
    if ("peak" === current.type && "red" === prop) return redBossSchedules;
    if ("normal" === current.type && "boss3" === prop) return leader3Schedules;
    return null;
}

export function parseStringToDate(str) {
    if (!str) return null;
    let base = getLocalTime(),
        isPm = str.toLowerCase().includes("pm"),
        isAm = str.toLowerCase().includes("am"),
        parts = str.toLowerCase().replace("am", "").replace("pm", "").replace("killed at ", "").replace("active", "").trim().split(":"),
        hr = Number(parts[0]),
        min = Number(parts[1]),
        sec = parts[2] ? Number(parts[2]) : 0;

    isPm && hr < 12 && (hr += 12);
    isAm && 12 === hr && (hr = 0);
    let res = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hr, min, sec);
    return res.getTime() - base.getTime() < -432e5 && res.setDate(res.getDate() + 1), res;
}
