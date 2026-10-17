'use strict';
// Fixture for tests/clock-shift-gate.test.js. NOT a gate test (tests/fixtures/ is not discovered).
// Mechanism of the 19.09.2026 incident: an absolute fixture date against a 30-day age gate. The
// absolute date is taken from the process start (performance.timeOrigin is the real wall clock and
// is not shifted), 5 days back, so the fixture stays valid forever at the real clock.
const test = require('node:test');
const assert = require('node:assert/strict');

const DAY_MS = 864e5;
const AGE_GATE_DAYS = 30;
// Full timestamp, not the calendar day: a day cut would add the UTC time of day to the age and flip
// the asserted "45.x days" to "46.0" after 22:48 UTC (review of #8).
const FIXTURE_DATE = new Date(performance.timeOrigin - 5 * DAY_MS).toISOString(); // "absolute" once written down

test('fixture bar passes the 30-day age gate', () => {
  const ageDays = (new Date() - Date.parse(FIXTURE_DATE)) / DAY_MS;
  assert.ok(ageDays <= AGE_GATE_DAYS, `fixture bar ${FIXTURE_DATE} is ${ageDays.toFixed(1)} days old, gate is ${AGE_GATE_DAYS}`);
});
