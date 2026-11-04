'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const S = require('../../src/scoring/score.js');

const values = a => a.map(value => ({ value }));
const snapshot = (op, rev) => ({ annual: { annualOpInc: values(op), annualRev: values(rev) } });
const oscillation = [10, -10, 10, -10];
const atDrawdown = dd => snapshot(oscillation, [1 - dd, 1, 1, 1]);
// R12, fixed 2026-10-31 inputs. The displayed thresholds are 0.147007 and 0.147026.
const sihuan = snapshot([91151545.28088, -20738521.45722, 24276791.18076, -274859163.92274],
  [393058872.25295997, 285426079.51158, 279335036.83818, 327476344.04118]);
const previousThreshold = 0.14700697647017294;
const threshold = 0.14702589659492998;
const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected}`);

// Independent old-head oracle: preserve data/source guards and the old >= threshold gate.
function oldFactor(s, t) {
  const { op, rev } = S.cycleSeriesPair(s);
  const signal = op.length < 3 || S.oscExcess(op) < 1 || rev.some(v => v <= 0)
    || t === null || S.revMaxDrawdown(rev) < t ? 0 : S.oscExcess(op);
  return 1 / (1 + S.CYCLE_DAMPER_KD * signal);
}

test('0460.HK: learned threshold movement no longer flips factor 0.5 to 1', () => {
  assert.equal(oldFactor(sihuan, previousThreshold), 0.5);
  assert.equal(oldFactor(sihuan, threshold), 1);
  const before = S.cycleDamperFactor(sihuan, previousThreshold);
  const after = S.cycleDamperFactor(sihuan, threshold);
  close(before, 2 / 3);
  assert.ok(after > before && (after / before - 1) < 0.00022);
});

test('ramp boundaries and midpoint: half weight, not half factor', () => {
  const t = 0.25;
  close(S.cycleSignal(atDrawdown(0.8 * t), t), 0);
  close(S.cycleSignal(atDrawdown(t), t), 1);
  close(S.cycleDamperFactor(atDrawdown(t), t), 2 / 3);
  close(S.cycleSignal(atDrawdown(1.2 * t), t), 2);
  assert.equal(S.cycleDamperFactor(atDrawdown(0.1), t), 1);
  assert.equal(S.cycleDamperFactor(atDrawdown(0.4), t), 0.5);
});

test('continuous and monotone through the entire 80 to 120 percent band', () => {
  const t = 0.25;
  let prior = 1;
  for (let i = 0; i <= 1000; i++) {
    const dd = t * (0.8 + 0.4 * i / 1000);
    const factor = S.cycleDamperFactor(atDrawdown(dd), t);
    close(factor, 1 / (1 + i / 1000));
    assert.ok(factor <= prior + 1e-14 && prior - factor < 0.00101);
    prior = factor;
  }
  for (const dd of [0.8 * t, t, 1.2 * t]) {
    const left = S.cycleDamperFactor(atDrawdown(dd - 1e-10), t);
    const right = S.cycleDamperFactor(atDrawdown(dd + 1e-10), t);
    assert.ok(Math.abs(left - right) < 3e-9);
  }
});

test('outside the band factors remain bit identical to the old formula', () => {
  for (const t of [0.01, 0.14702589659492998, 0.25, 0.75]) {
    for (const ratio of [0, 0.2, 0.799, 1.201, 1.3]) {
      const s = atDrawdown(t * ratio);
      assert.ok(Object.is(S.cycleDamperFactor(s, t), oldFactor(s, t)));
    }
  }
});

test('data guards, neutral calibration and zero-width threshold keep old behavior', () => {
  for (const s of [snapshot([1, -1], [1, 2]), snapshot([1, 2, 3], [1, 2, 3]),
    snapshot(oscillation, [0, 2, 3, 4]), snapshot(oscillation, [-1, 2, 3, 4]),
    snapshot(oscillation, [null, 2, 3, 4]), { annual: {} }, sihuan]) {
    assert.equal(S.cycleDamperFactor(s, null), 1);
    assert.equal(S.cycleDamperFactor(s, 0), oldFactor(s, 0));
    if (s !== sihuan) assert.equal(S.cycleDamperFactor(s, threshold), oldFactor(s, threshold));
  }
  assert.equal(S.cycleDamperFactor(atDrawdown(0), 0), 0.5);
});

test('legacy factor is the exact old gate on both sides and within the band', () => {
  for (const t of [null, 0, threshold, 0.25]) {
    for (const s of [sihuan, ...[0, 0.1, 0.2, 0.25, 0.3, 0.4].map(atDrawdown)]) {
      assert.ok(Object.is(S.cycleDamperFactorLegacy(s, t), oldFactor(s, t)));
    }
  }
});

test('real scoring and export carry the legacy score without using it for sorting', () => {
  const fs = require('node:fs'), path = require('node:path');
  const W = require('../../scripts/write-findash-export.js');
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/MU.json'), 'utf8'));
  const universe = [0.05, 0.12, 0.14, 0.15, 0.16, 0.17, 0.18, 0.19, 0.20, 0.21, 0.24, 0.35]
    .map((dd, i) => ({ ...structuredClone(base), identifier: { primary: 'ISIN', value: 'CYCLE' + i },
      meta: { ...base.meta, ticker: 'CYCLE' + i, name: 'Cycle fixture ' + i },
      secAnnual: undefined, annual: { ...base.annual, ...atDrawdown(dd).annual } }));
  const results = S.scoreUniverse(universe, require('../../src/scoring/formulas'));
  const finite = results.filter(e => Number.isFinite(e.score));
  assert.equal(finite.length, universe.length);
  assert.ok(finite.some(e => e.score !== e.scoreCycleLegacy));
  for (const e of finite) {
    const s = universe.find(s => s.meta.ticker === e.ticker);
    assert.equal(e._factorCycleLegacy, oldFactor(s, results.calibration.cycleDDThreshold));
    assert.equal(e.scoreCycleLegacy, e._scorePreFactor * e._factorBurn * e._factorGrowth * e._factorCycleLegacy);
  }
  const ranking = S.produceRankings(results, { topN: 100 });
  const flat = Object.values(ranking.full).flatMap(b => [...b.profitable, ...b.unprofitable]);
  for (const row of flat) {
    const e = finite.find(e => e.ticker === row.ticker);
    assert.equal(row.scoreCycleLegacy, Math.round(e.scoreCycleLegacy * 10) / 10);
    assert.equal(row.factors.cycleLegacy, Math.round(e._factorCycleLegacy * 1000) / 1000);
    const mapped = W.mapBoardRow(row, 0);
    assert.equal(mapped.scoreCycleLegacy, Math.min(100, row.scoreCycleLegacy));
    assert.equal(mapped.factors.cycleLegacy, row.factors.cycleLegacy);
    const errors = [];
    W.validateBoardRow(mapped, row.ticker, errors);
    assert.deepEqual(errors.filter(e => /cycleLegacy|CycleLegacy/.test(e)), []);
    for (const mutate of [r => { delete r.scoreCycleLegacy; }, r => { delete r.factors.cycleLegacy; },
      r => { r.factors.cycleLegacy = 1.1; }, r => { r.scoreCycleLegacy = 999; },
      r => { r.scoreCycleLegacy = r.scoreCycleLegacy > 50 ? 0 : 100; }]) {
      const broken = structuredClone(mapped), bad = [];
      mutate(broken); W.validateBoardRow(broken, row.ticker, bad);
      assert.ok(bad.some(e => /cycleLegacy|CycleLegacy/.test(e)), 'broken comparison must fail');
    }
  }
  for (const row of ranking.overview) {
    assert.equal(W.mapOverviewRow(row, 0).scoreCycleLegacy, Math.min(100, row.scoreCycleLegacy));
  }
  const altered = results.map(e => ({ ...e, scoreCycleLegacy: 100000 - (e.scoreCycleLegacy || 0) }));
  const order = r => Object.values(S.produceRankings(r, { topN: 100 }).full)
    .flatMap(b => [...b.profitable, ...b.unprofitable]).map(row => [row.ticker, row.score]);
  assert.deepEqual(order(altered), order(results));
  const capped = { ...flat[0], score: 110, scoreCycleLegacy: 105 };
  assert.equal(W.mapBoardRow(capped, 0).scoreCycleLegacy, 100);
  const oldFeed = { ...capped }; delete oldFeed.scoreCycleLegacy;
  assert.equal(Object.hasOwn(W.mapBoardRow(oldFeed, 0), 'scoreCycleLegacy'), false);
});
