'use strict';
// Hand table of 07.11.2026 (lane sd-hand-5): the vendor stores Kioxia's (285A.T) quarter to 31.12.2025 as the nine-month
// cumulative (revenue 1,334,776, gross profit 369,957, operating profit 273,574 JPY millions) and derives the quarter to
// 31.03.2026 from it (211,707 / 449,630 / 465,975), so the March quarter shows margins above 200 %. Kioxia's releases print
// 543,631 / 176,640 / 142,754 for October to December and the fiscal year minus nine months gives 1,002,852 / 642,947 /
// 596,795 for January to March. The other stored quarters match the releases to the million and are confirmed; the quarter to
// 30.09.2026 (release of 30.10.2026) is not in the vendor packet yet and fills the leading gap.
// Real packet: tests/fixtures/hand-table-kioxia-20261107.json (daily run 42356903064). Every probe changes an in-memory copy
// and the live files are hashed before and after. Break-once on test data: `node tests/hand-table-kioxia-20261107.test.js
// --prove-red` runs the same assertions on the table without these rows and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const { quarterOpMargins } = require('../src/scoring/axes.js');
const F = require('./fixtures/hand-table-kioxia-20261107.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'tests/fixtures/hand-table-kioxia-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-07-sdhand5b', T = '285A.T', M = 1e6;
const FIELDS = ['revenueQ', 'grossProfitQ', 'opIncQ'];
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
pre.coverage = pre.coverage.filter(v => v.ticker !== T);
H.validateTable(pre);
const active = process.argv.includes('--prove-red') ? pre : H.table;
const apply = s => H.applyFinancialCases(s, { table: active });
const leg = () => structuredClone(F[T]);
const fx = F[T].meta.fxRateApplied;
const native = (s, f) => s.timeseries[f].map(r => value(r) === null ? null : Math.round(value(r) / fx / M));
// Filed quarters, newest first, JPY millions (30.09.2026 back to 30.06.2025).
const FILED = {
  revenueQ: [2480035, 1767117, 1002852, 543631, 448346, 342799],
  grossProfitQ: [2053163, 1380066, 642947, 176640, 122138, 71179],
  opIncQ: [1994710, 1270017, 596795, 142754, 85921, 44899],
};
const ENDS = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];

test('precondition: the vendor December quarter is the nine-month total, March is derived from it, and the March margins exceed 100 %', () => {
  const s = leg();
  for (const f of FIELDS) assert.deepEqual(s.timeseries[f + 'Ends'], ENDS.slice(1), f);
  assert.deepEqual(native(s, 'revenueQ'), [1767117, 211707, 1334776, 448346, 342799]);
  assert.equal(342799 + 448346 + 543631, 1334776, 'nine months = three filed quarters');
  assert.equal(native(s, 'revenueQ').slice(1, 5).reduce((a, b) => a + b, 0), 2337628, 'the vendor quarters still sum to the filed year');
  const out = H.applyFinancialCases(leg(), { table: pre }).snapshot;
  assert.ok(out.timeseries.opIncQ[1].value / out.timeseries.revenueQ[1].value > 2, 'March operating margin above 200 % without the rows');
});

test('with the rows: six filed quarters, the September 2026 quarter filled, margins of the filed statements', () => {
  const r = apply(leg()), s = r.snapshot;
  for (const f of FIELDS) {
    assert.deepEqual(s.timeseries[f + 'Ends'], ENDS, f);
    assert.deepEqual(native(s, f), FILED[f], f);
  }
  assert.equal(FILED.revenueQ.slice(2, 6).reduce((a, b) => a + b, 0), 2337628, 'filed quarters sum to the fiscal year');
  assert.equal(r.events.filter(e => e.reasonCode === 'vendor-gap-filled').length, 3);
  assert.ok(quarterOpMargins(s).every(m => m > 0 && m < 1), 'every quarter margin between 0 and 100 %');
  const v = g31Shadow(s).v1;
  assert.deepEqual([v.basis, v.periodEnd, v.priorPeriodEnd], ['quarter', '2026-09-30', '2025-09-30']);
  assert.ok(Math.abs(v.pct - (2480035 / 448346 - 1) * 100) < 1e-9, String(v.pct));
  assert.deepEqual(apply(structuredClone(s)).snapshot, s, 'idempotent');
  assert.deepEqual(leg(), F[T], 'input unchanged');
});

test('a later vendor packet: the September quarter at the filed value is confirmed, a changed cell or a newer quarter is withheld', () => {
  const later = () => {
    const s = leg();
    for (const f of FIELDS) { s.timeseries[f] = [{ value: FILED[f][0] * M * fx }, ...s.timeseries[f]]; s.timeseries[f + 'Ends'] = [ENDS[0], ...s.timeseries[f + 'Ends']]; }
    return s;
  };
  const ok = apply(later()).snapshot;
  for (const f of FIELDS) assert.deepEqual(native(ok, f), FILED[f], f + ': no double quarter');
  const changed = later(); changed.timeseries.revenueQ[3] = { value: 1300000 * M * fx };
  const c = apply(changed).snapshot.timeseries.revenueQ[3];
  assert.equal(value(c), null);
  assert.equal(c.financialMissing.reasonCode, 'vendor-value-changed');
  const newer = later();
  for (const f of FIELDS) { newer.timeseries[f] = [{ value: 3e12 * fx }, ...newer.timeseries[f]]; newer.timeseries[f + 'Ends'] = ['2026-12-31', ...newer.timeseries[f + 'Ends']]; }
  const n = apply(newer).snapshot.timeseries.revenueQ[0];
  assert.equal(value(n), null);
  assert.equal(n.financialMissing.reasonCode, 'period-after-coverage', 'the next quarter waits until it is checked against the release');
});

test('rows: eighteen, appended last, coverage through 30.09.2026, exact sources, reasons naming the period, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 18);
  assert.deepEqual(H.table.cases.slice(-18), own, 'appended last');
  assert.equal(own.filter(c => c.expectedBadValue !== c.replacementValue).length, 6, 'six corrected, twelve confirmed');
  for (const f of FIELDS) assert.equal(H.table.coverage.find(v => v.ticker === T && v.field === f).coversThrough, '2026-09-30');
  for (const c of own) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId);
    assert.match(c.reason, /Geprüft am 07\.11\.2026\.$/);
    assert.doesNotMatch(c.reason, /[–—]| - /, c.caseId);
    assert.ok(c.sources.every(s => s.url.startsWith('https://ssl4.eir-parts.net/doc/285A/tdnet/') && s.page && s.quote && s.filed), c.caseId);
    if (c.period === '2026-03-31') assert.equal(c.sources[0].value - c.sources[1].value, c.replacementValue, c.caseId + ': year minus nine months');
    else assert.equal(c.sources[0].value, c.replacementValue, c.caseId);
  }
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
