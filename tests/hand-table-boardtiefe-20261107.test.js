'use strict';
// Board check of 07.11.2026 (utilities and real estate, ranks 11 to 25), lane sd-hand-7. Fixed where the filed report proves it.
//   Gujarat Energy: the June quarter 2026 against June 2025 on the consolidated Revenue from operations, 9,771.38 against 6,045.88 crore INR
//   (+61.62 %) instead of the vendor's 9,544.98 against 5,851.36 (+63.12 %): the vendor subtracts the excise duty (226.40 and 194.52), a net
//   figure the firm does not print; both quarters are on the merged basis (GSPC and GSPL, appointed date 01.04.2024). The March quarter 2026 of the same report is set too;
//   the September and December quarters 2025 are not printed there and stay withheld (coverage through 30.06.2026).
//   Keppel DC REIT is not changed: the vendor's 2,745.2 M units include the 297,620,000 units of the placement of 10.09.2026 (blind review).
// Real packets: tests/fixtures/hand-table-boardtiefe-20261107.json (daily run 42356903064). Probes change in-memory copies; live files are
// hashed before and after. Break-once on test data: `node tests/hand-table-boardtiefe-20261107.test.js --prove-red` runs without these rows
// and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const F = require('./fixtures/hand-table-boardtiefe-20261107.json');

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'tests/fixtures/hand-table-boardtiefe-20261107.json'];
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
  // The vendor quarters are the filed revenue less the excise duty (PDF 9, "(d) Excise duty expense 226.40 210.55 194.52 810.29").
  const raw = gje(), crore0 = i => value(raw.timeseries.revenueQ[i]) / raw.meta.fxRateApplied / 1e7;
  for (const [i, filed, excise] of [[0, 9771.38, 226.40], [1, 6002.40, 210.55], [4, 6045.88, 194.52]]) assert.ok(Math.abs(crore0(i) - (filed - excise)) < 0.005, String(i));
  const s = H.applyFinancialCases(gje(), { table: active }).snapshot, v = g31Shadow(s).v1;
  assert.deepEqual([v.basis, v.periodEnd, v.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
  assert.ok(Math.abs(v.pct - (9771.38 / 6045.88 - 1) * 100) < 1e-9, String(v.pct));
  const crore = s.timeseries.revenueQ.map(r => value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied / 1e5) / 100);
  assert.deepEqual(crore, [9771.38, 6002.4, null, null, 6045.88], 'the two quarters the report does not print stay empty');
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
