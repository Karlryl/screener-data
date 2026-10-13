'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapYahooToCanonical } = require('../pull-yahoo.js');

const asOf = '2026-10-10T12:00:00Z';
const entry = { ticker: 'W6-FIXTURE', name: 'W6 Fixture' };
for (const [file, expected] of [['payer', 'zahlt'], ['non-payer', 'keine'], ['missing-module', 'unbekannt']]) {
  test('summaryDetail dividend status: ' + file, () => {
    const snapshot = mapYahooToCanonical(require('./fixtures/w6/' + file + '.json'), entry, asOf);
    assert.equal(snapshot.metrics.dividendStatus?.value, expected);
    if (expected === 'zahlt') {
      assert.ok(Math.abs(snapshot.metrics.dividendYield.value - 3.5) < 1e-12);
      assert.equal(snapshot.metrics.payoutRatio.value, 42);
      assert.equal(snapshot.metrics.fiftyTwoWeekHigh.value, 125);
    } else {
      assert.equal(snapshot.metrics.dividendYield, null);
      assert.equal(snapshot.metrics.payoutRatio, null);
      assert.equal(snapshot.metrics.fiftyTwoWeekHigh, null);
    }
  });
}

test('malformed modules and present but unusable dividend fields stay unknown', () => {
  for (const summaryDetail of ['upstream error', true, [], { dividendYield: null }, { dividendYield: { raw: null } }, { dividendYield: 0 }]) {
    const snapshot = mapYahooToCanonical({ summaryDetail }, entry, asOf);
    assert.equal(snapshot.metrics.dividendStatus?.value, 'unbekannt', JSON.stringify(summaryDetail));
  }
});

test('numeric metric extraction never coerces booleans or strings into values', () => {
  for (const value of [true, false, '0.035', { raw: true }, { raw: '0.035' }]) {
    const snapshot = mapYahooToCanonical({ summaryDetail: { dividendYield: value, payoutRatio: value, fiftyTwoWeekHigh: value } }, entry, asOf);
    assert.equal(snapshot.metrics.dividendStatus.value, 'unbekannt');
    for (const key of ['dividendYield', 'payoutRatio', 'fiftyTwoWeekHigh']) assert.equal(snapshot.metrics[key], null, key);
  }
});
