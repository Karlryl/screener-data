'use strict';
// Fixture for tests/clock-shift-gate.test.js. NOT a gate test (tests/fixtures/ is not discovered).
// Mechanism of the 16./17.10.2026 incident: the code under test stamps a file with `new Date()`,
// the test then expects the stamp to be the day of the data. The data day comes from a real-clock
// source (file mtime, which the clock shift never touches), so this file is green forever at the
// real clock and red as soon as `new Date()` runs ahead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('store stamp is the day of the stored data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-stamp-'));
  try {
    const dataFile = path.join(dir, 'data.json');
    fs.writeFileSync(dataFile, '{}');
    const metaFile = path.join(dir, '_meta.json');
    fs.writeFileSync(metaFile, JSON.stringify({ updatedAt: new Date().toISOString() })); // the unpinned stamp
    const dataDay = fs.statSync(dataFile).mtime.toISOString().slice(0, 10);
    const stampDay = JSON.parse(fs.readFileSync(metaFile, 'utf8')).updatedAt.slice(0, 10);
    // Day-granular compare with a one-day tolerance, so a run across midnight UTC stays green.
    const apartDays = Math.abs(Date.parse(stampDay) - Date.parse(dataDay)) / 864e5;
    assert.ok(apartDays <= 1, `stamp day ${stampDay} is ${apartDays} days away from data day ${dataDay}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
