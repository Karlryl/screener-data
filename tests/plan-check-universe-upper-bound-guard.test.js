'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStatus } = require('../scripts/plan-check.js');

function statusForUniverseSize(nTotal) {
  return buildStatus(
    [],
    { missing: [], hard: false },
    { n_total: nTotal },
    6088,
    '2026-09-02T00:00:00.000Z',
    '2026-09',
  );
}

function universeFlags(status) {
  return status.drift_flags.filter((flag) => flag.includes('Universe-Groesse'));
}

test('accepts the upper universe boundary without a drift flag', () => {
  const status = statusForUniverseSize(60000);

  assert.equal(universeFlags(status).length, 0);
  assert.equal(status.blocked, false);
});

test('flags a universe above the upper boundary without blocking', () => {
  const status = statusForUniverseSize(60001);

  assert.equal(universeFlags(status).length, 1);
  assert.equal(status.blocked, false);
});
