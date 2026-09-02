'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectStatsDrift } = require('../scripts/check-pull-stats.js');

function row(asOf, yahooOk) {
  return {
    asOf,
    yahooOk,
    yahooFailed: 0,
    yahooTotal: yahooOk,
    yahooSuccessRate: 1,
    fxRatesCount: null,
    fxFailed: null,
    earningsWithDate: null,
    priceTickerCount: null,
    universeSize: null,
    snapshotsCount: null,
  };
}

const TODAY = row('2026-08-05', 80);
const RECENT = [
  row('2026-08-01', 80),
  row('2026-08-02', 100),
  row('2026-08-03', 120),
  row('2026-08-04', 140),
];

function alertMetrics(history) {
  return detectStatsDrift(TODAY, history, 0.25)
    .map((alert) => alert.metric);
}

test('flags a loss against the minimum recent comparison window', () => {
  assert.deepEqual(alertMetrics(RECENT), ['yahooOk']);
});

test('excludes stale older runs from the comparison baseline', () => {
  assert.deepEqual(
    alertMetrics([row('2026-07-31', 50), ...RECENT]),
    ['yahooOk'],
  );
});
