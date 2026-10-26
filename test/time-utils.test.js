// ==========================================
// 🧪 UNIT TESTS — src/core/time-utils.js
// Run: npm test
// ==========================================
import test from 'node:test';
import assert from 'node:assert/strict';

import { getLocalTime } from '../src/core/time-utils.js';

/** Europe/Berlin wall clock for an instant, as `YYYY-M-D HH:MM`. */
function berlinWallClock(date) {
    const parts = {};
    for (const part of new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Berlin',
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).formatToParts(date)) {
        if (part.type !== 'literal') parts[part.type] = part.value;
    }
    return `${parts.year}-${Number(parts.month)}-${Number(parts.day)} ${parts.hour}:${parts.minute}`;
}

/** Game clock for an instant, as `YYYY-M-D HH:MM` (local getters = Berlin wall clock). */
function gameWallClock(date) {
    const g = getLocalTime(date);
    const pad = n => String(n).padStart(2, '0');
    return `${g.getFullYear()}-${g.getMonth() + 1}-${g.getDate()} ${pad(g.getHours())}:${pad(g.getMinutes())}`;
}

test('game clock uses CET (UTC+1) during European winter time', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    assert.equal(gameWallClock(winter), '2026-1-15 13:00');
    assert.equal(gameWallClock(winter), berlinWallClock(winter));
});

test('game clock uses CEST (UTC+2) during European summer time', () => {
    const summer = new Date('2026-07-15T12:00:00Z');
    assert.equal(gameWallClock(summer), '2026-7-15 14:00');
    assert.equal(gameWallClock(summer), berlinWallClock(summer));
});

test('game clock follows the DST switch on the last Sunday of October', () => {
    const beforeSwitch = new Date('2026-10-25T00:30:00Z'); // 02:30 CEST
    const afterSwitch = new Date('2026-10-25T02:30:00Z');  // 03:30 CET
    assert.equal(gameWallClock(beforeSwitch), '2026-10-25 02:30');
    assert.equal(gameWallClock(afterSwitch), '2026-10-25 03:30');
    assert.equal(gameWallClock(beforeSwitch), berlinWallClock(beforeSwitch));
    assert.equal(gameWallClock(afterSwitch), berlinWallClock(afterSwitch));
});

test('game clock rolls the date over with the Berlin day, not the server day', () => {
    const lateUtc = new Date('2026-07-15T23:30:00Z'); // 01:30 CEST on the 16th
    assert.equal(gameWallClock(lateUtc), '2026-7-16 01:30');
    assert.equal(getLocalTime(lateUtc).getDay(), 4); // Thursday
});

test('game clock matches Europe/Berlin for the current instant', () => {
    const now = new Date();
    assert.equal(gameWallClock(now), berlinWallClock(now));
});
