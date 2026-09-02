'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seedEntry } = require('../scripts/backfill-prices-max.js');

const SEEDED_AT = '2026-09-02';

test('two valid bars are sufficient to seed max-price state', () => {
  const entry = seedEntry([
    { date: '2026-08-31', close: 80 },
    { date: '2026-09-01', close: 120 },
  ], SEEDED_AT);

  assert.notEqual(entry, null);
  assert.equal(entry.ath, 120);
  assert.equal(entry.lastClose, 120);
});

test('a single valid bar cannot complete max-price seeding', () => {
  assert.equal(seedEntry([
    { date: '2026-09-01', close: 120 },
  ], SEEDED_AT), null);
});
