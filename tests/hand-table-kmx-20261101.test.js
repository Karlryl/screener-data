'use strict';
// Holds of 01.11.2026, each from a printed filing, on rows a home-listing rule would show.
// CarMax (council of 01.11.2026 on the operating income of the quality score): the firm prints no operating income line,
// and the vendor's figure stands in no report and cannot be rebuilt from printed lines, so a firm with net earnings in every
// year sat on the unprofitable list with the lamp "unprofit", rank 25 on 31.10.2026. Pretax income is another figure.
// China Shenhua: the vendor's June 2026 quarter is the half year on the new consolidation scope minus the first quarter on the
// old one, so it is no quarter: +73.6 % against a filed +7.9 % for the half year.
// Delivery Hero: three vendor quarters differ from the ones the firm reports on all four listings.
// Real packets of the daily run of 31.10.2026 (tests/fixtures/hand-table-kmx.json). Every probe changes an in-memory copy;
// the live table is hashed before and after.
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

test('the row leaves the unprofitable list and loses the lamp; net income decides the list', () => {
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

test('every reason names its period', () => {
  const own = table.cases.filter((c) => c.revision === '2026-11-01-sdheimat');
  assert.equal(own.length, 10);
  for (const c of own) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId);
    assert.equal(c.replacementValue, null, 'a hold, never a substitute: ' + c.caseId);
  }
});

test('Shenhua: the mixed cell is gone from the listing that showed it; the A share keeps its exchange check', () => {
  const before = g31Shadow(structuredClone(fixture['1088.HK'])).v1;
  assert.equal(before.periodEnd, '2026-06-30', 'precondition: the vendor pair exists');
  assert.ok(Math.abs(before.pct - 73.6) < 0.1);
  const s = applyFinancialCases(structuredClone(fixture['1088.HK'])).snapshot;
  const leg = g31Shadow(s).v1;
  assert.equal(leg.basis, 'year');
  assert.equal(leg.periodEnd, '2025-12-31');
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) {
    assert.equal(value(s.timeseries[f][s.timeseries[f + 'Ends'].indexOf('2026-06-30')]), null, f);
  }
  const a = structuredClone(fixture['601088.SS']);
  assert.deepEqual(applyFinancialCases(a).snapshot.timeseries, a.timeseries, 'no row on 601088.SS');
});

test('Delivery Hero: all four listings lose the wrong quarters and show the right fiscal year', () => {
  assert.ok(Math.abs(g31Shadow(structuredClone(fixture['DHER.SW'])).v1.pct - 16.4) < 0.2, 'precondition');
  assert.ok(Math.abs(g31Shadow(structuredClone(fixture['DHER.DE'])).v1.pct - 20.8) < 0.2, 'precondition');
  for (const [t, ticker] of [['DHER.DE', 'DHER.DE'], ['DHER.SW', 'DHER.SW'], ['DHER.SW', 'DHER.VI'], ['DHER.SW', '1DHER.MI']]) {
    const raw = structuredClone(fixture[t]); raw.meta.ticker = ticker;
    const leg = g31Shadow(applyFinancialCases(raw).snapshot).v1;
    assert.equal(leg.periodEnd, '2025-12-31', ticker);
    assert.ok(Math.abs(leg.pct - 14.35) < 0.1, ticker + ' ' + leg.pct);
  }
});

// Pinned on purpose: a dated annual series keeps a new year in front. CarMax's next report (about April 2027) needs its own row;
// until then the expectations pr90-KMX-* turn red, because the firm would fall back on the unprofitable list.
test('a new fiscal year in front is not held by these rows', () => {
  const next = structuredClone(fixture.KMX);
  next.annual.annualOpInc.unshift({ value: -380000000 });
  next.annual.annualOpIncEnds.unshift('2027-02-28');
  next.annual.annualRev.unshift({ value: 26000000000 });
  next.annual.annualRevEnds.unshift('2027-02-28');
  const s = applyFinancialCases(next).snapshot;
  assert.equal(value(s.annual.annualOpInc[0]), -380000000);
  assert.equal(value(s.annual.annualOpInc[1]), null);
});

test('the live table is unchanged by this test', () => {
  assert.equal(hash(), before);
});
