'use strict';
// Princes Group (PRN.L), PR #72 fix round of 01.11.2026: the vendor pairs the statutory year 2025 with the pro forma year 2024
// on revenue, gross profit and operating income, so every year-on-year axis is mixed (-8.86 % against a comparable -6.54 %).
// The hold is a quarantine: no score, the reason is shown, and no axis can profit from an empty revenue cell.
// Run: node tests/hand-table-prn-20261101.test.js
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyFinancialCases, table, validateTable } = require('../lib/financial-known-cases.js');

const CASE = 'prn.l-statutory-against-pro-forma-20261101';
// The stored packet of the run of 31.10.2026, in USD at the stored factor 1.3261017.
const FX = 1.3261017;
const packet = () => ({
  meta: { ticker: 'PRN.L', name: 'Princes Group plc', reportingCurrency: 'USD', reportingCurrencyOriginal: 'GBP', tradingCurrency: 'GBp', ccyAmbiguous: true, fxConverted: true, fxRateApplied: FX },
  timeseries: {},
  annual: { annualRev: [{ value: 2481840440.7026997 }, { value: 2723202885.0179996 }], annualRevEnds: ['2025-12-31', '2024-12-31'],
    annualGP: [{ value: 504718285.3251 }, { value: 448728945.4494 }], annualOpInc: [{ value: 100819533.9459 }, { value: 23088756.6987 }] },
});

test('the stored cells are the two bases of the report: statutory 2025 next to pro forma 2024', () => {
  const a = packet().annual;
  // Within two thousand GBP: the vendor rounds to ten thousand before the stored conversion.
  const near = (c, filed, what) => assert.ok(Math.abs(c.value / FX / 1000 - filed) < 2, `${what}: ${c.value / FX / 1000} against ${filed}`);
  near(a.annualRev[0], 1871531, 'statutory revenue 2025');
  near(a.annualRev[1], 2053539, 'pro forma revenue 2024');
  near(a.annualGP[0], 380603, 'statutory gross profit 2025');
  near(a.annualGP[1], 338382, 'pro forma gross profit 2024');
  near(a.annualOpInc[0], 76027, 'statutory operating profit 2025');
  near(a.annualOpInc[1], 17411, 'pro forma operating profit 2024');
  const mixed = (a.annualRev[0].value / a.annualRev[1].value - 1) * 100;
  assert.ok(Math.abs(mixed - -8.8632) < 0.001, String(mixed));
  assert.ok(Math.abs((1919319 / 2053539 - 1) * 100 - -6.536) < 0.001, 'the comparable pro forma pair, named in the reason');
});

test('the packet is quarantined with a dated German reason and two sources', () => {
  const { snapshot, events } = applyFinancialCases(packet());
  assert.equal(snapshot.meta.financialDataIssue?.caseId, CASE);
  assert.match(snapshot.meta.financialDataIssue.reason, /^Score fehlt: .*31\.12\.2025.*Geprüft am 01\.11\.2026\.$/);
  assert.ok(events.some(e => e.caseId === CASE && e.status === 'quarantined'));
  assert.ok(!events.some(e => e.caseId === CASE && e.status === 'stale'), 'the fingerprint matches');
  const q = table.quarantines.find(x => x.caseId === CASE);
  assert.equal(q.sources.length, 2);
  for (const s of q.sources) assert.match(s.url, /^https:\/\/princesgroupinvestors\.com\//);
});

test('the filter feed shows no growth from the held packet; the same packet without the row shows the mixed figure', () => {
  const { buildUniverse } = require('../scripts/write-filter-universe.js');
  const rowOf = s => buildUniverse({ snapshots: [s], excluded: new Map([['PRN.L', ['data-suspect']]]), generatedAt: '2026-11-01T00:00:00.000Z' }).rows[0];
  const held = rowOf(applyFinancialCases(packet()).snapshot);
  assert.equal(held.t, 'PRN.L');
  assert.equal(Object.hasOwn(held, 'g'), false);
  assert.equal(Object.hasOwn(held, 'g3'), false);
  assert.equal(rowOf(packet()).g, -8.86);
});

test('another firm with this ticker prefix or name is untouched; a drifted name stays held and says so', () => {
  const other = applyFinancialCases({ ...packet(), meta: { ...packet().meta, ticker: 'PRN.AX', name: 'Perenti Limited', reportingCurrencyOriginal: 'AUD' } });
  assert.equal(other.snapshot.meta.financialDataIssue, undefined);
  const drift = applyFinancialCases({ ...packet(), meta: { ...packet().meta, name: 'Princes Group' } });
  assert.equal(drift.snapshot.meta.financialDataIssue?.caseId, CASE, 'never released silently');
  assert.ok(drift.events.some(e => e.caseId === CASE && e.status === 'stale'));
});

test('break-once on test data: without the row the packet keeps its mixed year', () => {
  const copy = structuredClone(table);
  copy.quarantines = copy.quarantines.filter(q => q.caseId !== CASE);
  const { snapshot } = applyFinancialCases(packet(), { table: validateTable(copy) });
  assert.equal(snapshot.meta.financialDataIssue, undefined);
  assert.equal(snapshot.annual.annualRev[1].value, 2723202885.0179996);
});
