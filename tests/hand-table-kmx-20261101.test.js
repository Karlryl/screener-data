'use strict';
// Holds of 01.11.2026, each from a printed filing, on rows a home-listing rule would show.
// CarMax (council of 01.11.2026 on the operating income of the quality score): the firm prints no operating income line,
// and the vendor's figure stands in none of its income statements, so a firm with net earnings in every
// year sat on the unprofitable list with the lamp "unprofit", rank 25 on 31.10.2026. Pretax income is another figure.
// China Shenhua: the vendor's June 2026 quarter is the half year on the new consolidation scope minus the first quarter on the
// old one, so it is no quarter: +73.6 % against a filed +7.9 % for the half year.
// Delivery Hero: three vendor quarters differ from the ones the firm reports on all four listings; since 04.11.2026 they carry the filed values.
// CarMax (04.11.2026): the five quarterly cells of operating income are held as well; the filings print no operating line.
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

test('a changed vendor value keeps the cell empty and reports it', () => {
  const moved = structuredClone(fixture.KMX);
  moved.annual.annualOpInc[0] = { value: 123000000 };
  const { snapshot: s, events } = applyFinancialCases(moved);
  assert.equal(value(s.annual.annualOpInc[0]), null);
  assert.ok(events.some((e) => e.reasonCode === 'annual-value-changed'), 'the change is reported');
});

test('every reason names its period; holds stay holds, Delivery Hero carries the filed value', () => {
  const own = table.cases.filter((c) => c.revision === '2026-11-01-sdheimat' || c.revision === '2026-11-04-sdheimat2');
  assert.equal(own.length, 17);
  for (const c of own) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId);
    if (c.ticker === 'DHER.DE') {
      assert.equal(c.replacementValue, c.sources[0].value, 'filed value: ' + c.caseId);
      assert.equal(c.sources[0].end, c.period, c.caseId);
    } else assert.equal(c.replacementValue, null, 'a hold, never a substitute: ' + c.caseId);
  }
});

test('Shenhua: gross profit and operating income say the mechanism is unexplained, revenue shows its bridge', () => {
  const rows = table.cases.filter((c) => c.ticker === '1088.HK');
  assert.deepEqual(rows.map((c) => c.field).sort(), ['grossProfitQ', 'opIncQ', 'revenueQ']);
  for (const c of rows) {
    if (c.field === 'revenueQ') assert.ok(!/ungeklärt/.test(c.reason));
    else {
      assert.match(c.reason, /ungeklärt/);
      assert.ok(c.sources.some((s) => s.quote === 'Gross profit 56,692 53,750'), c.caseId);
    }
  }
});

test('CarMax: the five vendor quarters of operating income are held, and a later quarter waits for its own row', () => {
  const raw = structuredClone(fixture.KMX);
  assert.deepEqual(raw.timeseries.opIncQ.map(value), [-35741000, 31701000, -249727000, -133695000, -117819000], 'precondition: the vendor cells');
  const s = applyFinancialCases(structuredClone(raw)).snapshot;
  assert.deepEqual(s.timeseries.opIncQ.map(value), [null, null, null, null, null]);
  assert.deepEqual(s.timeseries.revenueQ.map(value), raw.timeseries.revenueQ.map(value), 'revenue stays');
  const next = structuredClone(raw);
  next.timeseries.opIncQ.unshift({ value: -20000000 });
  next.timeseries.opIncQEnds.unshift('2026-11-30');
  const { snapshot: n, events } = applyFinancialCases(next);
  assert.equal(value(n.timeseries.opIncQ[0]), null);
  assert.ok(events.some((e) => e.period === '2026-11-30' && e.reasonCode === 'period-after-coverage'));
});

test('Shenhua: the mixed cell is gone from both listings; the A share shows what it showed', () => {
  const before = g31Shadow(structuredClone(fixture['1088.HK'])).v1;
  assert.equal(before.periodEnd, '2026-06-30', 'precondition: the vendor pair exists');
  assert.ok(Math.abs(before.pct - 73.6) < 0.1);
  assert.equal(g31Shadow(structuredClone(fixture['601088.SS'])).v1.periodEnd, '2025-12-31', 'precondition: the A share showed the year before these rows');
  for (const t of ['1088.HK', '601088.SS']) {
    const s = applyFinancialCases(structuredClone(fixture[t])).snapshot;
    const leg = g31Shadow(s).v1;
    assert.equal(leg.basis, 'year', t);
    assert.equal(leg.periodEnd, '2025-12-31', t);
    assert.ok(Math.abs(leg.pct + 13.2) < 0.1, t + ' ' + leg.pct);
    for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) {
      assert.equal(value(s.timeseries[f][s.timeseries[f + 'Ends'].indexOf('2026-06-30')]), null, t + ' ' + f);
    }
  }
});

test('Delivery Hero: the filed quarters on all four real packets; the newest quarter shows where the packet holds it', () => {
  assert.ok(Math.abs(g31Shadow(structuredClone(fixture['DHER.SW'])).v1.pct - 16.4) < 0.2, 'precondition: the vendor pair');
  assert.ok(Math.abs(g31Shadow(structuredClone(fixture['DHER.DE'])).v1.pct - 20.8) < 0.2, 'precondition: the vendor pair');
  for (const [ticker, end, pct] of [['DHER.DE', '2026-06-30', 15.34], ['DHER.SW', '2026-09-30', 23.17], ['DHER.VI', '2026-09-30', 23.17], ['1DHER.MI', '2026-09-30', 23.17]]) {
    const leg = g31Shadow(applyFinancialCases(structuredClone(fixture[ticker])).snapshot).v1;
    assert.equal(leg.basis, 'quarter', ticker);
    assert.equal(leg.periodEnd, end, ticker);
    assert.ok(Math.abs(leg.pct - pct) < 0.01, ticker + ' ' + leg.pct);
  }
  // DHER.DE holds no September quarter, so it shows June; a stored quarter after 30.09.2026 waits for its own row.
  const next = structuredClone(fixture['DHER.SW']);
  next.timeseries.revenueQ.unshift({ value: 5.0e9 });
  next.timeseries.revenueQEnds.unshift('2026-12-31');
  assert.equal(value(applyFinancialCases(next).snapshot.timeseries.revenueQ[0]), null);
});

// Pinned on purpose: a dated annual series keeps a new year in front. CarMax's next report (about April 2027) needs its own row.
// The expectations pr90-KMX-* turn red only if that year shows a loss, because the firm then falls back on the unprofitable list;
// a small vendor profit would stand unnoticed, which four loss years make unlikely.
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
