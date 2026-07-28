import { getMsg } from "./lang.js";

// ==========================================
// ⏰ SCHEDULE CONSTANTS
// ==========================================

export const redBossSchedules = [1, 4, 7, 10, 13, 16, 19, 22];
export const leader3Schedules = [0, 3, 6, 9, 12, 15, 18, 21];

// ==========================================
// ⏰ DATE/TIME UTILITIES
// ==========================================

export function getLocalTime() {
    const timeStr = (new Date).toLocaleString("en-US", {
        timeZone: "Europe/Berlin"
    });
    return new Date(timeStr);
}

export function isRoomOpen(schedules, minuteOffset = 0) {
    const now = getLocalTime();
    const hr = now.getHours();
    const min = now.getMinutes();
    if (minuteOffset > 0) {
        // Event lasts from X:minuteOffset to X+1:minuteOffset
        const currentMinutes = hr * 60 + min;
        for (const h of schedules) {
            const eventStart = h * 60 + minuteOffset;
            const eventEnd = eventStart + 60;
            if (currentMinutes >= eventStart && currentMinutes < eventEnd) return true;
        }
        return false;
    }
    return schedules.includes(hr);
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
        const endOfClaim = parseStringToDate(floorObj.timeWindow.split(" ~ ")[1]);
        if (endOfClaim) return getFormattedTime12h(endOfClaim);
    }
    return floorObj && floorObj.next ? floorObj.next.formattedTime : "--:--";
}

export function getEndLimitCountdown(endLimitStr) {
    if (!endLimitStr) return "";
    const limitTime = parseStringToDate(endLimitStr);
    if (!limitTime) return getMsg("rooms.claimBefore", { endLimit: endLimitStr });
    const remainingSecs = Math.floor((limitTime.getTime() - getLocalTime().getTime()) / 1e3);
    if (remainingSecs <= 0) return `⏳ Expired (${getMsg("render.countdownUntil")} ${endLimitStr})`;
    const mins = Math.floor(remainingSecs / 60);
    const secs = remainingSecs % 60;
    return `⏳ Claim within ${mins}m ${secs}s (${getMsg("render.countdownUntil")} ${endLimitStr})`;
}

export function calculateNextOpening(schedules, minuteOffset = 0) {
    const base = getLocalTime(),
        datesList = [];
    schedules.forEach(hr => {
        const checkDate = new Date(base.getTime());
        checkDate.setHours(hr, minuteOffset, 0, 0);
        if (checkDate <= base) checkDate.setDate(checkDate.getDate() + 1);
        datesList.push(checkDate);
    });
    datesList.sort((x, y) => x - y);
    return datesList[0];
}

export function getNextScheduleAfter(baseDate, schedules, minuteOffset = 0) {
    const datesList = [];
    schedules.forEach(hr => {
        const checkDate = new Date(baseDate.getTime());
        checkDate.setHours(hr, minuteOffset, 0, 0);
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
    if (current[prop] && current[prop].schedules) return current[prop].schedules;
    if ("peak" === current.type && "red" === prop) return redBossSchedules;
    if ("normal" === current.type && "boss3" === prop) return leader3Schedules;
    return null;
}

export function parseStringToDate(str) {
    if (!str) return null;
    const base = getLocalTime();
        const isPm = str.toLowerCase().includes("pm");
        const isAm = str.toLowerCase().includes("am");
        const parts = str.toLowerCase().replace("am", "").replace("pm", "").replace("killed at ", "").replace("active", "").trim().split(":");
        let hr = Number(parts[0]);
        const min = Number(parts[1]);
        const sec = parts[2] ? Number(parts[2]) : 0;

    if (isPm && hr < 12) hr += 12;
    if (isAm && 12 === hr) hr = 0;
    const res = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hr, min, sec);
    // If result is >12h ahead of base, the killed time was yesterday (e.g. killed 14:00, now 01:30 next day)
    if (res.getTime() - base.getTime() > 432e5) {
        res.setDate(res.getDate() - 1);
    }
    // If result is >12h behind base, the killed time was tomorrow (e.g. killed 23:00, now 02:00 next day)
    if (res.getTime() - base.getTime() < -432e5) {
        res.setDate(res.getDate() + 1);
    }
    return res;
}
