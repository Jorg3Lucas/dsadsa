// ==========================================
// 🧪 UNIT TESTS — src/core/time-utils.js
// Run: npm test
// ==========================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { getLocalTime } from '../src/core/time-utils.js';

// Schedules the MS11/MS12 event panels use (see panel-utils.js). They are
// expressed in the game clock, so they must line up with it year round.
const FURY = { schedules: [0, 3, 6, 9, 12, 15, 18, 21], minutes: 30 };
const FRENZY = { schedules: [2, 5, 8, 11, 14, 17, 20, 23], minutes: 0 };

/** Game clock for an instant, as `YYYY-M-D HH:MM`. */
function gameWallClock(date) {
    const g = getLocalTime(date);
    const pad = n => String(n).padStart(2, '0');
    return `${g.getFullYear()}-${g.getMonth() + 1}-${g.getDate()} ${pad(g.getHours())}:${pad(g.getMinutes())}`;
}

/** Minutes since game midnight for an instant. */
function gameMinutes(date) {
    const g = getLocalTime(date);
    return g.getHours() * 60 + g.getMinutes();
}

/** Whether a scheduled event is inside its 1-hour window at an instant. */
function isOpen({ schedules, minutes }, date) {
    const now = gameMinutes(date);
    return schedules.some(h => {
        const start = h * 60 + minutes;
        return now >= start && now < start + 60;
    });
}

/** Minutes until the next opening of a scheduled event (24h wrap-around). */
function minutesUntilNext({ schedules, minutes }, date) {
    const now = gameMinutes(date);
    return Math.min(...schedules.map(h => {
        const diff = h * 60 + minutes - now;
        return diff <= 0 ? diff + 24 * 60 : diff;
    }));
}

test('game clock stays on UTC+2 during European winter time (no DST)', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    assert.equal(gameWallClock(winter), '2026-1-15 14:00');
});

test('game clock stays on UTC+2 during European summer time', () => {
    const summer = new Date('2026-07-15T12:00:00Z');
    assert.equal(gameWallClock(summer), '2026-7-15 14:00');
});

test('game clock does not jump when Europe switches to winter time', () => {
    assert.equal(gameWallClock(new Date('2026-10-25T00:30:00Z')), '2026-10-25 02:30'); // 02:30 CEST
    assert.equal(gameWallClock(new Date('2026-10-25T01:30:00Z')), '2026-10-25 03:30'); // 03:30 CEST
    assert.equal(gameWallClock(new Date('2026-10-25T02:30:00Z')), '2026-10-25 04:30'); // 03:30 CET
});

test('game clock rolls the date over with the game day, not the server day', () => {
    const lateUtc = new Date('2026-07-15T23:30:00Z'); // 01:30 game time on the 16th
    assert.equal(gameWallClock(lateUtc), '2026-7-16 01:30');
    assert.equal(getLocalTime(lateUtc).getDay(), 4); // Thursday
});

test('game clock matches UTC+2 for the current instant', () => {
    const now = new Date();
    const expected = new Date(now.getTime() + 2 * 3600000);
    assert.equal(gameMinutes(now), expected.getUTCHours() * 60 + expected.getUTCMinutes());
});

test('reported case: at 04:52 game time Fury is closed and Frenzy opens in 8 minutes', () => {
    const instant = new Date('2026-10-26T02:52:00Z'); // 2026-10-25 02:52 UTC → 04:52 game time
    assert.equal(gameWallClock(instant), '2026-10-26 04:52');
    assert.equal(isOpen(FURY, instant), false);
    assert.equal(isOpen(FRENZY, instant), false);
    assert.equal(minutesUntilNext(FRENZY, instant), 8);
    assert.equal(minutesUntilNext(FURY, instant), 98); // next Fury at 06:30
});
