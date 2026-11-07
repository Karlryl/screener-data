'use strict';
// Hand table of 07.11.2026 (lane sd-hand-5, Codex S13): Talen Energy (TLN) prints "Operating Revenues" as the total of energy
// and other revenues, capacity revenues and the unrealized gain or loss on derivative instruments. The vendor quarters add only
// the first two lines (June 2026: 722 + 237 = 959 against the printed 747 Mio. USD), so the board showed +111.2 % instead of the
// printed +18.6 % for the June quarter. Rule of the master (07.11.2026): the line the company itself labels as total revenue.
// Real packet: tests/fixtures/hand-table-tln-20261107.json (daily run 42356903064). Break-once on test data:
// `node tests/hand-table-tln-20261107.test.js --prove-red` runs the same assertions without these rows and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const F = require('./fixtures/hand-table-tln-20261107.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'tests/fixtures/hand-table-tln-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-07-sdhand5d', M = 1e6;
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
pre.coverage = pre.coverage.filter(v => v.ticker !== 'TLN');
H.validateTable(pre);
const active = process.argv.includes('--prove-red') ? pre : H.table;
const leg = () => structuredClone(F.TLN);

test('precondition: the vendor quarters are energy plus capacity revenues, the board showed +111.2 %', () => {
  assert.deepEqual(F.TLN.timeseries.revenueQ.map(r => value(r) / M), [959, 1241, 771, 770, 454]);
  assert.equal(722 + 237, 959); assert.equal(366 + 88, 454);
  const v = g31Shadow(H.applyFinancialCases(leg(), { table: pre }).snapshot).v1;
  assert.ok(Math.abs(v.pct - 111.2335) < 0.001, String(v.pct));
});

test('with the rows: Operating Revenues as printed, the unread December quarter withheld, +18.6 % on the June pair', () => {
  const s = H.applyFinancialCases(leg(), { table: active }).snapshot;
  assert.deepEqual(s.timeseries.revenueQ.map(r => value(r) === null ? null : value(r) / M), [747, 1129, null, 812, 630]);
  assert.equal(s.timeseries.revenueQ[2].financialMissing.reasonCode, 'period-not-verified');
  const v = g31Shadow(s).v1;
  assert.deepEqual([v.basis, v.periodEnd, v.priorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
  assert.ok(Math.abs(v.pct - (747 / 630 - 1) * 100) < 1e-9, String(v.pct));
  assert.deepEqual(leg(), F.TLN, 'input unchanged');
});

test('rows: four, appended last, sources quote the printed total, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 4);
  assert.deepEqual(H.table.cases.slice(-4), own, 'appended last');
  assert.equal(H.table.coverage.find(v => v.ticker === 'TLN' && v.field === 'revenueQ').coversThrough, '2026-06-30');
  for (const c of own) {
    assert.ok(c.sources.every(s => /^Operating Revenues /.test(s.quote) && s.filed && s.page), c.caseId);
    assert.match(c.reason, /Geprüft am 07\.11\.2026\.$/);
    assert.doesNotMatch(c.reason, /[–—]| - /, c.caseId);
  }
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
