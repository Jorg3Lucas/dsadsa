// ==========================================
// 📅 UPCOMING EVENTS — next spawns/openings
// Merges claim-derived events (live state from
// the claim db) with the bot's scheduler lists
// (world bosses + scheduled + weekly events),
// using the same time-utils the panels use.
// ==========================================

import { db } from "../core/state.js";
import {
    getLocalTime,
    getNextScheduleAfter,
    calculateNextOpening,
    parseStringToDate,
    getFormattedTime12h,
    usesScheduleRespawn,
    getBossSchedules
} from "../core/time-utils.js";
import { STATUS_KILLED, STATUS_KILLED_PREFIX } from "../core/constants.js";
import { getEventGroupKeys } from "../handlers/claim-core-rooms.js";
import {
    bossSpawns,
    scheduledEvents,
    weeklyScheduledEvents
} from "./scheduler-data.js";

/** Time until a date, in whole minutes (min 1). @param {Date} date @param {Date} now @returns {number} */
function minutesUntil(date, now) {
    return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 6e4));
}

/** Best-effort killed time of a boss/event. @param {object} data @param {string} status @returns {Date|null} */
function killedTimeOf(data, status) {
    if (!status || !status.startsWith(STATUS_KILLED)) return null;
    if (data._lastKilledAt) return new Date(data._lastKilledAt);
    const str = status.replace(STATUS_KILLED_PREFIX, "").trim();
    return parseStringToDate(str);
}

/** Next occurrence of {h, m} after base (same convention as the bot's calculateNextOpening). @returns {Date} */
function nextTimeAfter(base, h, m = 0) {
    const d = new Date(base.getTime());
    d.setHours(h, m, 0, 0);
    if (d <= base) d.setDate(d.getDate() + 1);
    return d;
}

/** Next occurrence of a weekly event (day = getDay(): Sun=0..Sat=6) after base. @returns {Date} */
function nextWeeklyAfter(base, day, hour) {
    const d = new Date(base.getTime());
    let diff = (day - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    d.setHours(hour, 0, 0, 0);
    if (d <= base) d.setDate(d.getDate() + 7);
    return d;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Scheduler events already represented (per-floor, with live state) by claim panels.
 * Each entry lists the scheduler name and the family regex matched against
 * claim-derived event names. If the claim side produced a member of the family,
 * the scheduler copy is skipped (avoids duplicates like "Red Boss (Secret Peak)"
 * vs the per-floor "🟥 Red" respawns).
 */
const CLAIM_COVERED_SCHEDULER = [
    { name: "Red Boss (Secret Peak)", family: "red" },
    { name: "Red Boss (SP11 + SP12)", family: "red" },
    { name: "Leader 3 (Magic Square)", family: "leader3" },
    { name: "Random Event (SP12)", family: "randomevent" }
];

/**
 * List the next spawn/open events across all panels and scheduler lists,
 * sorted by time.
 * @param {number} [limit=24]
 * @returns {Array<{name: string, panel: string, source: string, minutesUntil: number, timeLabel: string}>}
 */
export function computeUpcomingEvents(limit = 24) {
    const now = getLocalTime();
    const events = [];
    // Family flags: set when a claim-derived event matches a covered scheduler name
    const claimFamilies = { red: false, leader3: false, randomevent: false };

    for (const key in db) {
        const panel = db[key];
        if (!panel || key.startsWith("_") || typeof panel !== "object") continue;

        // ── Event groups: schedule events (Red Boss) + fixed events (Fury/Frenzy) ──
        if (panel.type === "event_group") {
            for (const evKey of getEventGroupKeys(panel)) {
                const ev = panel[evKey];
                if (!ev || typeof ev !== "object" || !ev.name) continue;

                if (ev.type === "schedule") {
                    const killed = killedTimeOf(ev, ev.status);
                    const base = killed || now;
                    const next = getNextScheduleAfter(base, ev.schedules || []);
                    if (next && next > now) {
                        events.push({
                            name: ev.name,
                            panel: panel.title,
                            source: killed ? "respawn" : "spawn",
                            date: next
                        });
                    }
                } else if (ev.type === "fixed") {
                    const next = calculateNextOpening(ev.schedules || [], ev.scheduleMinutes || 0);
                    if (next && next > now) {
                        events.push({ name: ev.name, panel: panel.title, source: "open", date: next });
                    }
                }
            }
        }
        // ── Standalone fixed event (Random Event) ──
        else if (panel.type === "fixed") {
            const next = calculateNextOpening(panel.schedules || [], panel.scheduleMinutes || 0);
            if (next && next > now) {
                events.push({ name: panel.title, panel: panel.title, source: "open", date: next });
            }
        }
        // ── Boss respawns (Leaders + peak Red) ──
        else if (panel.type === "normal" || panel.type === "peak") {
            const props = panel.type === "peak"
                ? ["red", "left", "right"]
                : ["boss1", "boss2", "boss3"];
            for (const prop of props) {
                const boss = panel[prop];
                if (!boss || typeof boss !== "object" || !boss.name) continue;
                const killed = killedTimeOf(boss, boss.status);
                if (!killed) continue; // only killed bosses have a respawn

                let respawn = null;
                if (usesScheduleRespawn(panel, prop)) {
                    const schedules = getBossSchedules(panel, prop);
                    if (schedules) respawn = getNextScheduleAfter(killed, schedules);
                } else if (boss.cooldown) {
                    respawn = new Date(killed.getTime() + boss.cooldown * 60_000);
                }
                if (respawn && respawn > now) {
                    events.push({ name: boss.name, panel: panel.title, source: "respawn", date: respawn });
                }
            }
        }
    }

    // Mark which covered families the claim side actually produced
    for (const e of events) {
        if (/red/i.test(e.name)) claimFamilies.red = true;
        if (/leader\s*3/i.test(e.name)) claimFamilies.leader3 = true;
        if (/random\s*event/i.test(e.name)) claimFamilies.randomevent = true;
    }

    // ── Scheduler: world boss spawns (5-min reminders, #reminders) ──
    for (const entry of bossSpawns) {
        let next = null;
        for (const t of entry.times) {
            const d = nextTimeAfter(now, t.h, t.m);
            if (!next || d < next) next = d;
        }
        if (next) {
            events.push({
                name: entry.boss,
                panel: `${entry.map} (${entry.world} Layer ${entry.layer})`,
                source: "world",
                date: next
            });
        }
    }

    // ── Scheduler: scheduled events (10-min alerts, #events) ──
    for (const event of scheduledEvents) {
        const covered = CLAIM_COVERED_SCHEDULER.find(c => c.name === event.name);
        if (covered && claimFamilies[covered.family]) continue;
        const next = getNextScheduleAfter(now, event.hours || []);
        if (next && next > now) {
            events.push({ name: event.name, panel: "Scheduled", source: "spawn", date: next });
        }
    }

    // ── Scheduler: weekly events (day-specific, #events) ──
    for (const event of weeklyScheduledEvents) {
        const next = nextWeeklyAfter(now, event.day, event.hour);
        if (next) {
            events.push({
                name: event.name,
                panel: `Weekly · ${WEEKDAY_NAMES[next.getDay()]}`,
                source: "weekly",
                date: next
            });
        }
    }

    // Convert bot-convention dates (Berlin wall clock parsed as local) to real
    // epoch so the frontend can run accurate ticking countdowns against Date.now().
    const realOffset = Date.now() - now.getTime();
    return events
        .sort((a, b) => a.date - b.date)
        .slice(0, limit)
        .map(e => ({
            name: e.name,
            panel: e.panel,
            source: e.source,
            minutesUntil: minutesUntil(e.date, now),
            timeLabel: getFormattedTime12h(e.date),
            date: e.date.getTime() + realOffset
        }));
}
