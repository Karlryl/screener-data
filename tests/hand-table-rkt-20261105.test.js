'use strict';
// Hand table of 05.11.2026 (lane sd-hand-3): Rocket Companies reported the quarter to 30.09.2026 on 30.10.2026. The table covered
// the series only through 30.06.2026, so the new quarter was held back and the board fell back to fiscal 2025 (+39.9 % instead of
// the filed +93.7 %). Two rows from the 10-Q (Total revenue, net 3,284 against 1,695 in USD millions; the vendor shows 2,925 and
// 1,460 because it nets the interest expense of 359 and 235) bring the quarterly pair back, and a period hint binds the pro forma
// comparison (2,505) to the new pair. Real packet: tests/fixtures/hand-table-rkt-20261105.json (daily run 42002731590), once as
// stored (with the held cell) and once rebuilt as the vendor delivers it at pull time. Every probe changes an in-memory copy and the
// live files are hashed before and after. Break-once on test data: `node tests/hand-table-rkt-20261105.test.js --prove-red` runs the
// same assertions on the table without these rows and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const hints = require('../configs/g31-hinweise.json');
const erwartungen = require('../data-health/erwartungen.json');
const F = require('./fixtures/hand-table-rkt-20261105.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/g31-hinweise.json', 'data-health/erwartungen.json', 'tests/fixtures/hand-table-rkt-20261105.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-05-sdhand3';
const RED = process.argv.includes('--prove-red');
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
// The table as it stood before these rows: their cases out, coverage back to the June quarter of 02.11.2026.
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
pre.coverage = pre.coverage.map(v => v.ticker === 'RKT' ? { ...v, coversThrough: '2026-06-30' } : v);
H.validateTable(pre);
const active = RED ? pre : H.table;
const apply = s => H.applyFinancialCases(s, { table: active });
const stored = () => structuredClone(F.RKT);
// The packet as the vendor delivers it: every held or corrected cell back to its original vendor row.
const raw = () => {
  const s = stored();
  s.timeseries.revenueQ = s.timeseries.revenueQ.map(r => r?.financialMissing?.originalVendorRow || r?.financialCorrection?.originalVendorRow || r);
  return s;
};
const cur = 3284000000, prior = 1695000000, filed = (cur / prior - 1) * 100;

test('the vendor figures are the filed ones minus the interest expense, so the table replaces a netted line, not a different quarter', () => {
  assert.deepEqual(raw().timeseries.revenueQ.map(value), [2925000000, 2410000000, 2592000000, 2487401000, 1460000000]);
  assert.equal(cur - 359e6, 2925000000);
  assert.equal(prior - 235e6, 1460000000);
});

test('stored packet: the held September quarter returns, the shown pair is the filed quarter pair', () => {
  const v0 = g31Shadow(H.applyFinancialCases(stored(), { table: pre }).snapshot).v1;
  assert.deepEqual([v0.basis, v0.periodEnd], ['year', '2025-12-31'], 'precondition: the fiscal year fallback of 04.11.2026');
  assert.ok(Math.abs(v0.pct - 39.9225) < 0.001, 'precondition: ' + v0.pct);
  const r = apply(stored()), v1 = g31Shadow(r.snapshot).v1;
  assert.deepEqual([v1.basis, v1.periodEnd, v1.priorPeriodEnd], ['quarter', '2026-09-30', '2025-09-30']);
  assert.ok(Math.abs(v1.pct - filed) < 1e-9, String(v1.pct));
  assert.ok(Math.abs(filed - 93.7463) < 0.0001);
  const ts = r.snapshot.timeseries;
  assert.deepEqual(ts.revenueQEnds, ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30']);
  assert.deepEqual(ts.revenueQ.map(value), [cur, 2784000000, null, null, prior]);
  assert.equal(ts.revenueQ[0].financialCorrection.caseId, 'rkt-2026-09-30-revenueQ-20261105');
  assert.equal(ts.revenueQ[4].financialCorrection.caseId, 'rkt-2025-09-30-revenueQ-20261105');
  assert.deepEqual([2, 3].map(i => ts.revenueQ[i].financialMissing.reasonCode), ['period-not-verified', 'period-not-verified'], 'unverified quarters stay withheld');
  assert.deepEqual(apply(structuredClone(r.snapshot)).snapshot, r.snapshot, 'idempotent');
  assert.deepEqual(stored(), F.RKT, 'input unchanged');
});

test('pull-time packet: the same result from the vendor figures', () => {
  const r = apply(raw()), ts = r.snapshot.timeseries;
  assert.deepEqual(ts.revenueQ.map(value), [cur, 2784000000, null, null, prior]);
  assert.ok(Math.abs(g31Shadow(r.snapshot).v1.pct - filed) < 1e-9);
  assert.deepEqual(r.events.filter(e => e.status === 'stale').map(e => [e.reasonCode, e.period]),
    [['period-not-verified', '2026-03-31'], ['period-not-verified', '2025-12-31']]);
});

test('a changed vendor figure never reaches the board: the cell is withheld, not shown', () => {
  for (const [i, v] of [[0, 2900000000], [4, 1500000000]]) {
    const s = raw();
    s.timeseries.revenueQ[i] = { value: v };
    const q = apply(s).snapshot.timeseries.revenueQ[i];
    assert.equal(value(q), null, 'index ' + i);
    assert.equal(q.financialMissing.reasonCode, 'vendor-value-changed', 'index ' + i);
  }
  const s = raw();
  s.timeseries.revenueQ.unshift({ value: 3000000000 });
  s.timeseries.revenueQEnds.unshift('2026-12-31');
  const q = apply(s).snapshot.timeseries.revenueQ[0];
  assert.equal(q.financialMissing.reasonCode, 'period-after-coverage', 'a newer quarter is held until it is checked against the filing');
});

test('rows: count, revision, exact sources, a reason naming its period, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 2);
  assert.deepEqual(own.map(c => [c.ticker, c.field, c.period, c.periodType, c.currency, c.expectedBadValue, c.replacementValue]), [
    ['RKT', 'revenueQ', '2026-09-30', '3M', 'USD', 2925000000, cur],
    ['RKT', 'revenueQ', '2025-09-30', '3M', 'USD', 1460000000, prior]]);
  const at = H.table.cases.findIndex(c => c.revision === REV);
  assert.deepEqual(H.table.cases.slice(at, at + 2), own, 'one block, appended after every earlier case');
  assert.deepEqual(H.table.coverage.find(v => v.ticker === 'RKT'), { ticker: 'RKT', field: 'revenueQ', coversThrough: '2026-09-30' });
  for (const c of own) {
    assert.ok(c.sources.every(s => s.url.startsWith('https://www.sec.gov/Archives/edgar/data/1805284/') && s.page && s.quote && s.filed && s.verifiedAt));
    assert.ok(c.sources[0].url.endsWith('/000162828026068434/rkt-20260930.htm'), 'the 10-Q filed 30.10.2026');
    assert.match(c.sources[0].quote, /^Total revenue, net 3,284 1,695 9,009 4,248$/);
    assert.equal(c.sources[0].value, c.replacementValue);
    assert.match(c.reason, new RegExp(c.period.slice(8) + '\\.' + c.period.slice(5, 7) + '\\.' + c.period.slice(0, 4)), 'names its period');
    assert.doesNotMatch(c.reason, /[–—]| - |kauf|verkauf/i);
  }
  assert.equal(own[1].sources[1].value, 1605284000, 'the original Q3 2025 report, in thousands, before the 2026 reclassification');
  const nine = own[0].sources[1];
  assert.deepEqual([nine.value, nine.start, nine.end], [9009000000, '2026-01-01', '2026-09-30']);
  assert.equal(9009e6 - 5725e6, cur, 'nine months minus the six months of the Q2 report is the quarter');
});

test('hint: the pro forma comparison is bound to the new pair and lapses with it', () => {
  const { g31Hinweis } = require('../lib/g31-recency.js');
  const h = g31Hinweis(apply(stored()).snapshot);
  if (RED) { assert.equal(h, null); return; }
  assert.equal(h.code, 'uebernahme');
  assert.match(h.reason, /30\.09\.2026/);
  assert.match(h.reason, /2\.505 Mio\. USD/);
  assert.match(h.reason, /plus 31,1 % statt plus 93,7 %/);
  assert.ok(Math.abs((cur / 2505e6 - 1) * 100 - 31.1) < 0.05, 'the pro forma ratio in the text');
  const e = hints.entries.find(x => x.ticker === 'RKT' && x.periodEnd === '2026-09-30');
  assert.deepEqual([e.priorPeriodEnd, e.sources.length], ['2025-09-30', 2]);
  assert.ok(e.sources.every(s => s.url.startsWith('https://www.sec.gov/') && s.form && s.page && s.quote && s.published === '2026-10-30'));
  assert.equal(hints.entries.filter(x => x.ticker === 'RKT').length, 2, 'the June hint stays and lapses by itself');
});

test('expectations: growth, basis, period and hint of Rocket on the financials board, bound to the issuer name', () => {
  const own = erwartungen.filter(e => e.id.startsWith('pr-rkt-q3-'));
  assert.deepEqual(own.map(e => e.feld).sort(), ['g31Hinweis.code', 'revGrowthBasis', 'revGrowthPeriodEnd', 'revGrowthYoYPct']);
  for (const e of own) {
    assert.equal(e.name, F.RKT.meta.name, e.id);
    assert.equal(e.board, 'full/financials', e.id);
    assert.equal(e.gueltigAb, '2026-11-06', e.id);
    assert.ok(e.grund.includes('05.11.2026') || e.grund.includes('30.10.2026'), e.id + ' dates its number');
  }
  const g = own.find(e => e.feld === 'revGrowthYoYPct');
  assert.ok(g.min < filed && filed < g.max && g.max - g.min < 0.61, 'the band holds the filed ratio and excludes the June figure 91.87 and the fiscal-year fallback 39.92');
  const old = erwartungen.find(e => e.id === 'pr99-RKT-wachstum');
  assert.ok(old.gueltigBis < own[0].gueltigAb, 'the June expectation ends before the new one starts');
});

test('red without the rows: the fiscal-year fallback is back', () => {
  const v = g31Shadow(H.applyFinancialCases(stored(), { table: pre }).snapshot).v1;
  assert.deepEqual([v.basis, v.periodEnd], ['year', '2025-12-31']);
  assert.equal(H.applyFinancialCases(raw(), { table: pre }).snapshot.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage');
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});
