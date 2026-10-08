'use strict';
// Real 06.10.2026 packets; independent expected cells and memory-only missing-row faults.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, validateTable, table } = require('../lib/financial-known-cases.js');
const { revQuartalsYoY } = require('../src/scoring/axes.js');
const fixtures = require('./fixtures/financial-known-cases.json').snapshots;
const root = path.resolve(__dirname, '..'), value = row => typeof row === 'number' ? row : row?.value;
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const live = ['configs/financial-known-cases.json', 'configs/statement-currency-hand-table.json',
  'configs/share-count-hand-table.json', 'tests/fixtures/financial-known-cases.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const cells = [
  ['000688.SZ', '2026-06-30', 1666778278.46, 1666778278.46],
  ['000688.SZ', '2026-03-31', 1696217709.13, 1696217709.13],
  ['000688.SZ', '2025-12-31', 3087702614.19, 1428454750.76],
  ['000688.SZ', '2025-06-30', 555470993.66, 1073278451.44],
  ['000688.SZ', '2025-03-31', 1086391910.94, 1086391910.94],
  ['GRANULES.NS', '2026-06-30', 14649730000, 14767740000],
  ['GRANULES.NS', '2026-03-31', 14574310000, 14706080000],
  ['GRANULES.NS', '2025-12-31', 13780200000, 13879400000],
  ['GRANULES.NS', '2025-09-30', 12946740000, 12969880000],
  ['GRANULES.NS', '2025-06-30', 12087920000, 12101060000],
];
const idFor = ([ticker, period]) => `${ticker.toLowerCase()}-${period}-revenueQ-p138`;
function without(id) {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.caseId !== id);
  copy.coverage = copy.coverage.map(c => ({ ...c, coversThrough: copy.cases
    .filter(r => r.ticker === c.ticker && r.field === c.field).map(r => r.period).sort().at(-1) })).filter(c => c.coversThrough);
  return validateTable(copy);
}
function guard(cell, config) {
  const [ticker, period, old, replacement] = cell, raw = fixtures[ticker];
  const i = raw.timeseries.revenueQEnds.indexOf(period);
  assert.ok(i >= 0);
  const result = applyFinancialCases(raw, { table: config }).snapshot.timeseries.revenueQ[i];
  assert.equal(value(result), replacement * raw.meta.fxRateApplied, idFor(cell) + ': corrected cell');
  if (old !== replacement) assert.equal(result.financialCorrection?.caseId, idFor(cell), 'own evidence marker');
  else assert.deepEqual(result, raw.timeseries.revenueQ[i], 'confirmed cell remains byte-identical');
}

// Real nonzero CLI proof, with an in-memory table and SHA-256 checks even on failure.
if (process.env.P138_RED_CASE) {
  const cell = cells.find(c => idFor(c) === process.env.P138_RED_CASE);
  assert.ok(cell, 'known red-once target');
  try { guard(cell, without(idFor(cell))); } finally { assert.deepEqual(liveHashes(), beforeHashes); }
}

test('P138 appends exactly ten cells, two coverage entries and two genuine trimmed packets', () => {
  assert.deepEqual(table.cases.slice(233, 243).map(c => c.caseId), cells.map(idFor)); // P138: +10 after the nine P129 and eight P47 cases (216 + 9 + 8); P140 appends its four cases after index 243
  assert.deepEqual(table.coverage.slice(34), ['000688.SZ', 'GRANULES.NS'].map(ticker =>
    ({ ticker, field: 'revenueQ', coversThrough: '2026-06-30' }))); // P138: +2
  for (const [key, count, digest] of [
    ['cases', 216, '495cee60cd67f8ae1813a39f26d66887a38ecf9af5886c2846fb7ce867327707'],
    ['coverage', 34, '5aec87031a1f8531b556329f38852ea6fa01c33370cde601c9267595610cf490'],
    ['quarantines', 11, '04d5d37834c47fb1d95e468102a07c3b4a42b3fcf91a0f892754685443ef5b89'],
    ['periodLabels', 16, '57bb38710653f7db4cfb98a1e1820372f2c628ef22ff4fb5da0637fe44667445'],
  ]) assert.equal(hash(table[key].slice(0, count)), digest, key + ' untouched');
  assert.equal(hash(Object.fromEntries(Object.entries(fixtures).slice(0, 45))),
    '1f6b5fff99c92ceed65ae735e785e65f0bf82f41be04a3dfea20e832c3cdf1e8');
  assert.equal(Object.keys(fixtures).length, 62); // P138: +2 after the 15 P129 fixtures
  assert.equal(hash(fixtures['000688.SZ']), '74c1bfc25c4fe547fb5a3ab14e730095ad46671a8212f92846bd838ff266f408');
  assert.equal(hash(fixtures['GRANULES.NS']), '2205dd5cbaf8ab29e2766e78298b2535404b4364a0de0b0d9b935a5121622483');
});

for (const cell of cells) test(idFor(cell) + ': exact fingerprint, source-backed value and red-once proof', () => {
  const [ticker, period, old, replacement] = cell, raw = fixtures[ticker];
  const c = table.cases.find(c => c.caseId === idFor(cell)), i = raw.timeseries.revenueQEnds.indexOf(period);
  assert.ok(c);
  assert.deepEqual([c.ticker, c.field, c.period, c.periodType, c.currency, c.expectedBadValue, c.replacementValue],
    [ticker, 'revenueQ', period, '3M', raw.meta.reportingCurrencyOriginal, old, replacement]);
  assert.equal(old * raw.meta.fxRateApplied, value(raw.timeseries.revenueQ[i]), 'exact stored USD fingerprint');
  assert.match(c.reason, old === replacement ? /^Umsatz bestätigt: / : /^Umsatz korrigiert: /);
  assert.ok(!/[–—]/.test(c.reason));
  assert.ok(c.sources.every(s => s.url.startsWith('https://') && s.page && s.published && s.quote && s.unit && s.start && s.end && Number.isFinite(s.value)));
  const bytes = JSON.stringify(raw);
  guard(cell, table);
  assert.throws(() => guard(cell, without(idFor(cell))), assert.AssertionError, 'deleting this row must fail');
  assert.equal(JSON.stringify(raw), bytes);
});

test('all stored revenue quarters remain present, both growth targets hold, and future quarters are withheld', () => {
  for (const [ticker, target] of [['000688.SZ', 0.5529784244], ['GRANULES.NS', 0.2203674719]]) {
    const raw = fixtures[ticker], bytes = JSON.stringify(raw), result = applyFinancialCases(raw);
    assert.deepEqual(result.snapshot.timeseries.revenueQEnds, raw.timeseries.revenueQEnds);
    assert.equal(result.snapshot.timeseries.revenueQ.length, 5);
    assert.ok(result.snapshot.timeseries.revenueQ.every(r => Number.isFinite(value(r))));
    assert.equal(result.events.filter(e => ['period-not-verified', 'period-after-coverage'].includes(e.reasonCode)).length, 0);
    assert.equal(result.events.filter(e => e.status === 'stale').length, 0);
    assert.equal(revQuartalsYoY(result.snapshot).toFixed(9), target.toFixed(9));
    assert.deepEqual(result.snapshot.annual, raw.annual);
    for (const field of Object.keys(raw.timeseries).filter(f => f !== 'revenueQ')) assert.deepEqual(result.snapshot.timeseries[field], raw.timeseries[field]);
    const next = structuredClone(raw);
    next.timeseries.revenueQ.unshift({ value: 1 }); next.timeseries.revenueQEnds.unshift('2026-09-30');
    const future = applyFinancialCases(next);
    assert.equal(value(future.snapshot.timeseries.revenueQ[0]), null);
    assert.equal(future.snapshot.timeseries.revenueQ[0].financialMissing?.reasonCode, 'period-after-coverage');
    assert.deepEqual(future.snapshot.timeseries.revenueQ.slice(1), result.snapshot.timeseries.revenueQ);
    assert.equal(JSON.stringify(raw), bytes);
  }
  assert.deepEqual(liveHashes(), beforeHashes);
});
