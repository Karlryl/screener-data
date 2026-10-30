'use strict';
// tests/annual-gap-fill.test.js: fill rule of P288 on real cells (tests/fixtures/annual-gap-fill.json, "about").
// Standalone: node tests/annual-gap-fill.test.js (exit 0/1). Reads the fixture only; writes nothing.
const assert = require('node:assert/strict');
const { annualGapFill, applyAnnualGapFill } = require('../lib/annual-gap-fill.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const F = require('./fixtures/annual-gap-fill.json');

const ctx = { stores: { cn: F.store } };
const fangbang = () => structuredClone(F.snapshots['688020.SS']);
const winshare = () => structuredClone(F.snapshots['601811.SS']);
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('must fill: Fangbang FY2025 from the annual report row, in the unit of its neighbours, with source and date', () => {
  const r = annualGapFill(fangbang(), ctx);
  assert.equal(r.refuse, undefined);
  assert.equal(r.fill.period, '2025-12-31');
  assert.equal(r.fill.nativeValue, 357636948.88);
  assert.equal(r.fill.nativeCurrency, 'CNY');
  assert.equal(r.fill.value, 357636948.88 * fangbang().meta.fxRateApplied);
  assert.equal(r.fill.source, 'Eastmoney RPT_F10_FINANCE_GINCOME');
  assert.equal(r.fill.noticeDate, '2026-04-20');
  assert.equal(r.fill.priorExchangeNative, 344570817.57);
  assert.ok(r.fill.priorDeviation < 1e-9, 'the vendor prior equals the exchange prior');
});

test('must refuse: a prior year 1.46 % off (the real gap of 601811.SS) gives no fill and names the evidence', () => {
  const s = fangbang();
  s.annual.annualRev[1].value *= 1 - 0.0146;
  const r = annualGapFill(s, ctx);
  assert.equal(r.fill, undefined);
  assert.equal(r.refuse, 'prior-mismatch');
  assert.ok(r.detail.priorDeviation > 0.014 && r.detail.priorDeviation < 0.015, String(r.detail.priorDeviation));
  assert.equal(r.detail.priorExchangeNative, 344570817.57);
});

test('must refuse: 601811.SS has no vendor quarters, so the exchange check cannot vouch for the line', () => {
  const r = annualGapFill(winshare(), ctx);
  assert.equal(r.fill, undefined);
  assert.equal(r.refuse, 'vendor-series');
});

test('the tolerance decides on both sides: prior off by 0.05 % fills, off by 0.2 % refuses', () => {
  const scaled = k => { const s = fangbang(); s.annual.annualRev[1].value *= k; return annualGapFill(s, ctx); };
  assert.ok(scaled(1.0005).fill);
  assert.equal(scaled(1.002).refuse, 'prior-mismatch');
});

test('no gap: a delivered cell and a missing prior year are not touched', () => {
  const delivered = fangbang();
  delivered.annual.annualRev[0] = { value: 1 };
  assert.equal(annualGapFill(delivered, ctx).refuse, 'no-gap');
  const noPrior = fangbang();
  noPrior.annual.annualRev[1] = null;
  assert.equal(annualGapFill(noPrior, ctx).refuse, 'no-gap');
});

test('base-mixing risks refuse: other markets, foreign currency, hand-table marker, restatement, wrong report, dates', () => {
  const terna = fangbang();
  terna.meta.ticker = 'TRN.MI';
  assert.equal(annualGapFill(terna, ctx).refuse, 'not-china');
  const hkd = fangbang();
  hkd.meta.reportingCurrencyOriginal = 'HKD';
  assert.equal(annualGapFill(hkd, ctx).refuse, 'currency');
  const hand = fangbang();
  hand.annual.annualRev[1].financialCorrection = { caseId: 'x' };
  assert.equal(annualGapFill(hand, ctx).refuse, 'hand-table');
  const restated = structuredClone(ctx);
  const list = restated.stores.cn.companies['688020.SS'].ytd['2025-12-31'];
  list.push({ ...list[0], total: 1 });
  assert.equal(annualGapFill(fangbang(), restated).refuse, 'exchange-restated');
  const interim = structuredClone(ctx);
  interim.stores.cn.companies['688020.SS'].ytd['2024-12-31'][0].reportType = '三季报';
  assert.equal(annualGapFill(fangbang(), interim).refuse, 'fiscal-year-chain');
  const shifted = fangbang();
  shifted.annual.annualRevEnds[1] = '2023-12-31';
  assert.equal(annualGapFill(shifted, ctx).refuse, 'period-ends');
  const quarterEnd = fangbang();
  quarterEnd.meta.statementPeriods.annualRev[0].duration = '3M';
  assert.equal(annualGapFill(quarterEnd, ctx).refuse, 'period-unproven');
  const newer = fangbang();
  newer.meta.annualRevNewerYear = { end: '2026-12-31' };
  assert.equal(annualGapFill(newer, ctx).refuse, 'newer-year-record');
});

test('apply changes only the empty cell and leaves its input alone', () => {
  const s = fangbang(), before = structuredClone(s);
  const after = applyAnnualGapFill(s, annualGapFill(s, ctx).fill);
  assert.deepEqual(s, before);
  assert.deepEqual(after.annual.annualRev.slice(1), before.annual.annualRev.slice(1));
  assert.equal(after.annual.annualRev[0].value, 357636948.88 * s.meta.fxRateApplied);
  assert.equal(after.annual.annualRev[0].annualGapFill.noticeDate, '2026-04-20');
});

test('not wired: prepareSnapshot leaves the cell empty, so no reader sees a fill', () => {
  const prepared = prepareSnapshot(fangbang());
  assert.equal(prepared.annual.annualRev[0], null);
});

console.log(`\nannual-gap-fill.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
