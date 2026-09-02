'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { endenVon } = require('../scripts/probe-jahresreihen-alter.js');

test('canonical annual period-end shapes remain available to the age probe', () => {
  const snapshot = { annual: { annualRevEnds: ['2025-12-31'] } };

  assert.deepEqual(endenVon(snapshot, 'annualRev'), ['2025-12-31']);
});

test('malformed annual period-end shapes stay outside the age probe', () => {
  const snapshot = {
    annual: { annualRevEnds: [null, 20251231, '2025/12/31', 'not-a-date'] },
  };

  assert.deepEqual(endenVon(snapshot, 'annualRev'), []);
});
