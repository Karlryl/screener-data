'use strict';
// Board check of 07.11.2026 (utilities and real estate, ranks 11 to 25), lane sd-hand-7. Fixed where the filed report proves it:
//   Gujarat Energy: the June quarter 2026 against June 2025 on the consolidated Revenue from operations, 9,771.38 against the merger-restated
//   6,045.88 crore INR (+61.62 %) instead of the vendor's 9,544.98 against 5,851.36 (+63.12 %). The March quarter 2026 of the same report is set too;
//   the September and December quarters 2025 are not printed there and stay withheld (coverage through 30.06.2026).
//   Keppel DC REIT: market cap on its 2,446,173,860 units of 30.06.2026 instead of the vendor's 2,745.2 M (about 12 % too high).
// Real packets: tests/fixtures/hand-table-boardtiefe-20261107.json (daily run 42356903064). Probes change in-memory copies; live files are
// hashed before and after. Break-once on test data: `node tests/hand-table-boardtiefe-20261107.test.js --prove-red` runs without these rows
// and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const guard = require('../lib/market-cap-guard.js');
const F = require('./fixtures/hand-table-boardtiefe-20261107.json');

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/share-count-hand-table.json', 'tests/fixtures/hand-table-boardtiefe-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const RED = process.argv.includes('--prove-red');
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== '2026-11-07-sdhand7b');
pre.coverage = pre.coverage.filter(v => v.ticker !== 'GUJENERGY.NS');
H.validateTable(pre);
const active = RED ? pre : H.table;
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const gje = () => structuredClone(F.snapshots['GUJENERGY.NS']);

test('Gujarat Energy shows the filed growth of the June quarter 2026, on the restated prior year', () => {
  const v0 = g31Shadow(H.applyFinancialCases(gje(), { table: pre }).snapshot).v1;
  assert.deepEqual([v0.basis, v0.periodEnd, +v0.pct.toFixed(2)], ['quarter', '2026-06-30', 63.12], 'precondition: the vendor growth');
  const s = H.applyFinancialCases(gje(), { table: active }).snapshot, v = g31Shadow(s).v1;
  assert.deepEqual([v.basis, v.periodEnd, v.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
  assert.ok(Math.abs(v.pct - (9771.38 / 6045.88 - 1) * 100) < 1e-9, String(v.pct));
  const crore = s.timeseries.revenueQ.map(r => value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied / 1e5) / 100);
  assert.deepEqual(crore, [9771.38, 6002.4, null, null, 6045.88], 'the two quarters the report does not print stay empty');
});

test('Keppel DC REIT: market cap is price times the 2,446,173,860 units of 30.06.2026', () => {
  const s = structuredClone(F.marketCapSnapshots['AJBU.SI']);
  const out = guard.prepareMarketCap(s);
  if (RED) { assert.equal(out.marketCap.value, s.marketCap.value, 'without the row'); assert.fail('prove-red'); }
  assert.equal(out.marketCap.source, 'hand-table:shares');
  assert.ok(Math.abs(out.marketCap.value - 2446173860 * s.price.regularMarketPrice) < 1, String(out.marketCap.value));
  assert.ok(Math.abs(out.marketCap.value / s.price.regularMarketPrice * s.price.regularMarketPrice / 0.7797271 / 2446173860 - 2.17) < 0.001, 'about 5,308 M SGD at 2.17 SGD');
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
