'use strict';
// CarMax (council of 01.11.2026 on the operating income of the quality score). The firm prints no operating income line.
// The vendor's annual figure (-409.8 M USD for fiscal 2026) stands in no report and leaves out CarMax Auto Finance income,
// so a firm with net earnings in every year sat on the unprofitable list with the lamp "unprofit", rank 25 on 31.10.2026.
// The cells are withheld; the list then follows net income, the rule for an empty newest year. Pretax income is another
// figure and does not fill them. Real packet of the daily run of 31.10.2026 (tests/fixtures/hand-table-kmx.json).
// Every probe changes an in-memory copy; the live table is hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
const { evaluateLamps } = require('../src/scoring/lamps.js');
const { trackOf } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { route } = require('../src/scoring/router.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const fixture = require('./fixtures/hand-table-kmx.json').snapshots;

const root = path.resolve(__dirname, '..');
const liveFile = path.join(root, 'configs/financial-known-cases.json');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(liveFile)).digest('hex');
const before = hash();
const value = (row) => (typeof row === 'number' ? row : row?.value ?? null);
const rows = table.cases.filter((c) => c.ticker === 'KMX' && c.field === 'annualOpInc');
const track = (s) => trackOf(s, formulas[route(s).formulaId]);

test('the four years are withheld, each with a printed source, and none is filled with pretax income', () => {
  assert.deepEqual(rows.map((c) => c.period), ['2026-02-28', '2025-02-28', '2024-02-29', '2023-02-28']);
  for (const c of rows) {
    assert.equal(c.replacementValue, null);
    assert.match(c.sources[0].url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1170010\//);
    assert.match(c.reason, /keinen Betriebsgewinn/);
  }
  const s = applyFinancialCases(structuredClone(fixture.KMX)).snapshot;
  assert.deepEqual(s.annual.annualOpInc.map(value), [null, null, null, null]);
});

test('the row leaves the unprofitable list and loses the lamp; net income decides', () => {
  const raw = structuredClone(fixture.KMX);
  assert.equal(track(raw), 'unprofitable', 'precondition: the vendor series puts a profitable firm on the unprofitable list');
  assert.ok(evaluateLamps(raw).active.includes('unprofit'));
  const s = applyFinancialCases(structuredClone(fixture.KMX)).snapshot;
  assert.equal(track(s), 'profitable');
  assert.ok(!evaluateLamps(s).active.includes('unprofit'));
  assert.deepEqual(s.annual.annualNetIncome.map(value), [247290000, 500556000, 479204000, 484762000], 'the net earnings stay');
  assert.deepEqual(s.annual.annualRev.map(value), [25881131000, 26353420000, 26536040000, 29684873000], 'the revenue stays');
});

test('red without the rows: a table without them leaves the firm where it was', () => {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter((c) => !(c.ticker === 'KMX' && c.field === 'annualOpInc'));
  const s = applyFinancialCases(structuredClone(fixture.KMX), { table: copy }).snapshot;
  assert.equal(track(s), 'unprofitable');
});

test('a changed vendor value releases nothing into the cell silently', () => {
  const moved = structuredClone(fixture.KMX);
  moved.annual.annualOpInc[0] = { value: 123000000 };
  const s = applyFinancialCases(moved).snapshot;
  assert.equal(value(s.annual.annualOpInc[0]), null);
});

// China Shenhua: the prior-year quarter stands on the old consolidation scope, so the pair showed +73.6 % against a filed +7.9 %.
test('Shenhua: the mixed pair is gone on both listings, growth falls back to the fiscal year', () => {
  for (const t of ['1088.HK', '601088.SS']) {
    assert.ok(g31Shadow(applyFinancialCases(structuredClone(fixture[t]), { table: { ...structuredClone(table), cases: table.cases.filter((c) => c.caseId !== '1088.hk-2025-06-30-revenueQ-20261101') } }).snapshot).v1.periodEnd >= '2025-12-31');
    const leg = g31Shadow(applyFinancialCases(structuredClone(fixture[t])).snapshot).v1;
    assert.equal(leg.basis, 'year', t);
    assert.equal(leg.periodEnd, '2025-12-31', t);
  }
  const before = g31Shadow(structuredClone(fixture['1088.HK'])).v1;
  assert.equal(before.periodEnd, '2026-06-30', 'precondition: the vendor pair exists');
  assert.ok(Math.abs(before.pct - 73.6) < 0.1);
});

// Delivery Hero: the prior-year quarter differs from the one the firm compares with (3,530.1 against the vendor's 3,736).
test('Delivery Hero: the wrong +16.4 % is gone; a single correct quarter needs a coverage row, so the cell stays empty', () => {
  const before = g31Shadow(structuredClone(fixture['DHER.SW'])).v1;
  assert.equal(before.periodEnd, '2026-09-30');
  assert.ok(Math.abs(before.pct - 16.4) < 0.2, 'precondition: ' + before.pct);
  const leg = g31Shadow(applyFinancialCases(structuredClone(fixture['DHER.SW'])).snapshot).v1;
  assert.notEqual(leg.periodEnd, '2026-09-30');
  assert.notEqual(Math.round(leg.pct), 16);
});

test('the live table is unchanged by this test', () => {
  assert.equal(hash(), before);
});
