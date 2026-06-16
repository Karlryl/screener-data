'use strict';
/**
 * fitness/measure.test.js
 * Standalone test suite for the fitness measurement harness.
 * Run from screener-data/: node fitness/measure.test.js
 *
 * NO Date.now(), NO Math.random(), NO network, NO reading real history.json.
 * All price data is synthetic and built in-memory.
 */

const { averageRank, spearman }   = require('./lib/spearman.js');
const { classify, resolveWindow } = require('./lib/forward-returns.js');
const { rankIC, cohortSpread, hitRate, quintileMonotonicity, _median } = require('./lib/metrics.js');
const { isHorizonPending }        = require('./measure.js');
const { addDaysIso }              = require('../scripts/walk-forward-perf.js');

// ─── Test scaffold (mirrors tag28-tests.js pattern) ────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(` V ${name}`);
    passed++;
  } catch (e) {
    console.log(` X ${name}\n    ${e.message}`);
    failed++;
  }
}
function assertEq(a, b, msg) {
  const aS = JSON.stringify(a), bS = JSON.stringify(b);
  if (aS !== bS) throw new Error(`${msg || 'eq'}: expected ${bS}, got ${aS}`);
}
function approxEq(a, b, eps, msg) {
  eps = eps || 1e-9;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > eps) {
    throw new Error(`${msg || 'approxEq'}: expected ~${b}, got ${a} (eps=${eps})`);
  }
}

console.log('Fitness Harness Tests');
console.log('---------------------');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. averageRank — tie handling
// ═══════════════════════════════════════════════════════════════════════════════

test('averageRank: [10,20,20,40] → [1,2.5,2.5,4]', () => {
  // Hand derivation:
  //   sorted positions: 10→pos1, 20→pos2, 20→pos3, 40→pos4
  //   ties at value 20: positions 2 & 3, average = 2.5
  //   → ranks by original index: [1, 2.5, 2.5, 4]
  const r = averageRank([10, 20, 20, 40]);
  assertEq(r, [1, 2.5, 2.5, 4], 'averageRank ties');
});

test('averageRank: no ties [5,1,3] → [3,1,2]', () => {
  // sorted: 1(orig idx 1)→pos1, 3(orig idx 2)→pos2, 5(orig idx 0)→pos3
  // → result[0]=3, result[1]=1, result[2]=2
  const r = averageRank([5, 1, 3]);
  assertEq(r, [3, 1, 2], 'averageRank no ties');
});

test('averageRank: all tied [7,7,7] → [2,2,2]', () => {
  // positions 1,2,3 → avg = 2
  const r = averageRank([7, 7, 7]);
  assertEq(r, [2, 2, 2], 'averageRank all tied');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. spearman — perfect positive, perfect negative, tied, null cases
// ═══════════════════════════════════════════════════════════════════════════════

test('spearman: perfect positive → 1', () => {
  // [1,2,3,4] vs [10,20,30,40]: ranks are identical → corr=1
  const r = spearman([1, 2, 3, 4], [10, 20, 30, 40]);
  approxEq(r, 1, 1e-10, 'spearman perfect positive');
});

test('spearman: perfect negative → -1', () => {
  // [1,2,3,4] vs [40,30,20,10]: ranks are perfectly inverted → corr=-1
  const r = spearman([1, 2, 3, 4], [40, 30, 20, 10]);
  approxEq(r, -1, 1e-10, 'spearman perfect negative');
});

test('spearman: with a tie in a, hand-computed', () => {
  // a=[1,1,3,4], b=[10,20,30,40]
  // ranks(a): 1 & 1 tie at positions 1,2 → avg=1.5; 3→pos3=3; 4→pos4=4
  //   ra = [1.5, 1.5, 3, 4]
  // ranks(b): no ties → rb = [1, 2, 3, 4]
  // mean_ra = (1.5+1.5+3+4)/4 = 10/4 = 2.5
  // mean_rb = (1+2+3+4)/4 = 2.5
  // da = [-1, -1, 0.5, 1.5];  db = [-1.5, -0.5, 0.5, 1.5]
  // num = (-1)(-1.5) + (-1)(-0.5) + (0.5)(0.5) + (1.5)(1.5)
  //     = 1.5 + 0.5 + 0.25 + 2.25 = 4.5
  // varA = 1 + 1 + 0.25 + 2.25 = 4.5
  // varB = 2.25 + 0.25 + 0.25 + 2.25 = 5.0
  // rho = 4.5 / sqrt(4.5 * 5.0) = 4.5 / sqrt(22.5) ≈ 0.94868
  const expected = 4.5 / Math.sqrt(4.5 * 5.0);
  const r = spearman([1, 1, 3, 4], [10, 20, 30, 40]);
  approxEq(r, expected, 1e-9, 'spearman with tie');
});

test('spearman: returns null for n<3', () => {
  assertEq(spearman([1, 2], [3, 4]), null, 'n<3 → null');
});

test('spearman: returns null for n=1', () => {
  assertEq(spearman([5], [5]), null, 'n=1 → null');
});

test('spearman: returns null for zero-variance a', () => {
  // All same value in a → rank vector has zero variance
  const r = spearman([5, 5, 5], [1, 2, 3]);
  assertEq(r, null, 'zero variance a → null');
});

test('spearman: returns null for zero-variance b', () => {
  const r = spearman([1, 2, 3], [7, 7, 7]);
  assertEq(r, null, 'zero variance b → null');
});

test('spearman: returns null for mismatched lengths', () => {
  const r = spearman([1, 2, 3], [1, 2]);
  assertEq(r, null, 'mismatched lengths → null');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. classify — synthetic in-memory priceIndex
// ═══════════════════════════════════════════════════════════════════════════════

function makeMap(entries) {
  // entries: [{date, close}]
  const m = new Map();
  for (const e of entries) m.set(e.date, e.close);
  return m;
}

function makePriceIndex(tickers) {
  // tickers: { tickerName: [{date, close}] }
  const idx = {};
  for (const [t, entries] of Object.entries(tickers)) {
    idx[t] = makeMap(entries);
  }
  return idx;
}

// Build a synthetic index where 2026-01-02 is entry, 2026-02-02 is exit (31 days)
const synthEntry = '2026-01-02';
const synthExit  = '2026-02-02';

const synthIndex = makePriceIndex({
  GOOD: [
    { date: '2026-01-02', close: 100 },
    { date: '2026-02-02', close: 110 },
  ],
  NOENTRY: [
    // Series starts AFTER entryDate + 7 days: can't look back to find entry
    { date: '2026-01-15', close: 50 },
    { date: '2026-02-02', close: 60 },
  ],
  DELISTED: [
    { date: '2026-01-02', close: 80 },
    // Last date is 2026-01-10, which is > 7 days before exitDate 2026-02-02
    // (2026-02-02 - 7 = 2026-01-26; 2026-01-10 < 2026-01-26 → no exit price)
    { date: '2026-01-10', close: 70 },
  ],
});

test('classify: ok — exact prices → ret=0.10', () => {
  // p0=100, p1=110 → (110/100)-1 = 0.10
  const { status, ret } = classify(synthIndex, 'GOOD', synthEntry, synthExit);
  assertEq(status, 'ok', 'classify ok status');
  approxEq(ret, 0.10, 1e-10, 'classify ok ret');
});

test('classify: no_series — ticker absent from index', () => {
  const { status, ret } = classify(synthIndex, 'MISSING', synthEntry, synthExit);
  assertEq(status, 'no_series', 'classify no_series status');
  assertEq(ret, null, 'classify no_series ret');
});

test('classify: no_entry_price — series starts too late', () => {
  // NOENTRY has no price at or within 7 days before 2026-01-02
  // The series first entry is 2026-01-15 (13 days after entry) → no entry price
  const { status, ret } = classify(synthIndex, 'NOENTRY', synthEntry, synthExit);
  assertEq(status, 'no_entry_price', 'classify no_entry_price status');
  assertEq(ret, null, 'classify no_entry_price ret');
});

test('classify: delisted — series ends too early for exit', () => {
  // DELISTED last price is 2026-01-10; exit target is 2026-02-02
  // _priceAtCanonical walks back 7 days from 2026-02-02 → earliest is 2026-01-26
  // 2026-01-10 is before 2026-01-26 → null → delisted
  const { status, ret } = classify(synthIndex, 'DELISTED', synthEntry, synthExit);
  assertEq(status, 'delisted', 'classify delisted status');
  assertEq(ret, null, 'classify delisted ret');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. rankIC — sign and exact values
// ═══════════════════════════════════════════════════════════════════════════════

test('rankIC: higher score → higher return → POSITIVE ic', () => {
  // 4 names, score perfectly predicts return
  // scores=[4,3,2,1], returns=[0.4,0.3,0.2,0.1]
  // spearman([4,3,2,1],[0.4,0.3,0.2,0.1])
  // ranks([4,3,2,1])=[4,3,2,1], ranks([0.4,0.3,0.2,0.1])=[4,3,2,1]
  // Perfectly correlated → ic=1
  const ranking = [
    { ticker: 'A', score: 4 },
    { ticker: 'B', score: 3 },
    { ticker: 'C', score: 2 },
    { ticker: 'D', score: 1 },
  ];
  const rets = { A: 0.4, B: 0.3, C: 0.2, D: 0.1 };
  const { ic, n, dropped } = rankIC(ranking, rets);
  assertEq(n, 4, 'rankIC n');
  assertEq(dropped, 0, 'rankIC dropped');
  approxEq(ic, 1, 1e-10, 'rankIC positive');
});

test('rankIC: higher score → lower return → NEGATIVE ic', () => {
  // scores=[4,3,2,1], returns=[0.1,0.2,0.3,0.4] → perfect negative
  const ranking = [
    { ticker: 'A', score: 4 },
    { ticker: 'B', score: 3 },
    { ticker: 'C', score: 2 },
    { ticker: 'D', score: 1 },
  ];
  const rets = { A: 0.1, B: 0.2, C: 0.3, D: 0.4 };
  const { ic } = rankIC(ranking, rets);
  approxEq(ic, -1, 1e-10, 'rankIC negative');
});

test('rankIC: missing return → dropped, ic still computed on remainder', () => {
  const ranking = [
    { ticker: 'A', score: 3 },
    { ticker: 'B', score: 2 },
    { ticker: 'C', score: 1 },
    { ticker: 'MISSING', score: 4 }, // no return
  ];
  const rets = { A: 0.3, B: 0.2, C: 0.1 };
  const { ic, n, dropped } = rankIC(ranking, rets);
  assertEq(n, 3, 'rankIC n with missing');
  assertEq(dropped, 1, 'rankIC dropped=1');
  approxEq(ic, 1, 1e-10, 'rankIC positive after drop');
});

test('rankIC: n<3 after drops → ic=null', () => {
  const ranking = [
    { ticker: 'A', score: 2 },
    { ticker: 'B', score: 1 },
  ];
  const rets = { A: 0.2, B: 0.1 };
  const { ic, n } = rankIC(ranking, rets);
  assertEq(n, 2, 'rankIC n=2');
  assertEq(ic, null, 'rankIC null for n<3');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. cohortSpread — 6-name fixture, hand-computed
// ═══════════════════════════════════════════════════════════════════════════════

test('cohortSpread: 6 names cohortN=2, hand-computed', () => {
  // ranking: A(score=6),B(score=5),C(score=4),D(score=3),E(score=2),F(score=1)
  // returns: A=0.30,B=0.20,C=0.10,D=0.05,E=-0.05,F=-0.10
  //
  // cohort top-2 (by score desc): A(0.30), B(0.20)
  //   cohortMean = (0.30 + 0.20) / 2 = 0.25
  //
  // universe all 6: [0.30, 0.20, 0.10, 0.05, -0.05, -0.10]
  //   sorted: [-0.10, -0.05, 0.05, 0.10, 0.20, 0.30]
  //   median of 6 = (0.05 + 0.10) / 2 = 0.075
  //
  // spread = 0.25 - 0.075 = 0.175
  const ranking = [
    { ticker: 'A', score: 6 },
    { ticker: 'B', score: 5 },
    { ticker: 'C', score: 4 },
    { ticker: 'D', score: 3 },
    { ticker: 'E', score: 2 },
    { ticker: 'F', score: 1 },
  ];
  const rets = { A: 0.30, B: 0.20, C: 0.10, D: 0.05, E: -0.05, F: -0.10 };
  const result = cohortSpread(ranking, rets, { cohortN: 2 });
  approxEq(result.cohortMean,    0.25,  1e-10, 'cohortMean');
  approxEq(result.universeMedian, 0.075, 1e-10, 'universeMedian');
  approxEq(result.spread,        0.175, 1e-10, 'spread');
  assertEq(result.cohortN_used, 2, 'cohortN_used');
  assertEq(result.universeN,    6, 'universeN');
});

test('cohortSpread: tie-break by ticker.localeCompare', () => {
  // Two names with equal score; lower lexicographic ticker goes first
  const ranking = [
    { ticker: 'Z', score: 5 },
    { ticker: 'A', score: 5 },
    { ticker: 'B', score: 1 },
  ];
  const rets = { Z: 0.10, A: 0.30, B: 0.05 };
  // sorted: A(5) before Z(5) by localeCompare; then B(1)
  // cohortN=1 → cohort = [A(0.30)]
  // cohortMean = 0.30
  // universe = [0.10, 0.30, 0.05] → sorted [0.05, 0.10, 0.30] → median = 0.10
  // spread = 0.30 - 0.10 = 0.20
  const result = cohortSpread(ranking, rets, { cohortN: 1 });
  approxEq(result.cohortMean,    0.30, 1e-10, 'cohortMean tie-break');
  approxEq(result.universeMedian, 0.10, 1e-10, 'universeMedian tie-break');
  approxEq(result.spread,        0.20, 1e-10, 'spread tie-break');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. PENDING path — isHorizonPending helper
// ═══════════════════════════════════════════════════════════════════════════════

test('isHorizonPending: prices too stale → true', () => {
  // newestPrice = 2026-05-17, t0 = 2026-06-16, horizon = 28d
  // exitTarget = 2026-07-14
  // 2026-05-17 < 2026-07-14 → PENDING
  const result = isHorizonPending('2026-05-17', '2026-06-16T00:00:00Z', 28, addDaysIso);
  assertEq(result, true, 'PENDING 28d');
});

test('isHorizonPending: prices too stale for 84d → true', () => {
  // exitTarget = 2026-09-08
  // 2026-05-17 < 2026-09-08 → PENDING
  const result = isHorizonPending('2026-05-17', '2026-06-16T00:00:00Z', 84, addDaysIso);
  assertEq(result, true, 'PENDING 84d');
});

test('isHorizonPending: prices fresh enough → false', () => {
  // newestPrice = 2026-08-01, t0 = 2026-06-16, horizon = 28d
  // exitTarget = 2026-07-14
  // 2026-08-01 >= 2026-07-14 → not pending
  const result = isHorizonPending('2026-08-01', '2026-06-16T00:00:00Z', 28, addDaysIso);
  assertEq(result, false, 'not PENDING when fresh');
});

test('isHorizonPending: exactly at exit date → false', () => {
  // newestPrice == exitTarget → not pending (prices have arrived)
  // t0=2026-01-01, horizon=28d → exitTarget=2026-01-29
  const result = isHorizonPending('2026-01-29', '2026-01-01T00:00:00Z', 28, addDaysIso);
  assertEq(result, false, 'exactly at exit → not pending');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Delisting conservative variant
// ═══════════════════════════════════════════════════════════════════════════════

test('cohortSpread: delisted at -1.0 vs dropped produce different spreads', () => {
  // Fixture: 4 names, top-2 cohort has one delisted name
  // A(score=4,ret=0.20), B(score=3,ret=delisted), C(score=2,ret=0.05), D(score=1,ret=0.02)
  //
  // NAIVE (drop B): returnByTicker = {A:0.20, C:0.05, D:0.02}
  //   cohort top-2 by score from ranking, with finite returns: A(0.20), C(0.05)
  //   cohortMean = (0.20+0.05)/2 = 0.125
  //   universe = [0.20, 0.05, 0.02] → sorted [0.02,0.05,0.20] → median=0.05
  //   spread_naive = 0.125 - 0.05 = 0.075
  //
  // CONSERVATIVE (B=-1.0): returnByTicker = {A:0.20, B:-1.0, C:0.05, D:0.02}
  //   cohort top-2 by score: A(0.20), B(-1.0)
  //   cohortMean = (0.20 + -1.0)/2 = -0.40
  //   universe = [0.20, -1.0, 0.05, 0.02] → sorted [-1.0,0.02,0.05,0.20] → median=(0.02+0.05)/2=0.035
  //   spread_conservative = -0.40 - 0.035 = -0.435
  //
  // The two spreads must be different.

  const ranking = [
    { ticker: 'A', score: 4 },
    { ticker: 'B', score: 3 },
    { ticker: 'C', score: 2 },
    { ticker: 'D', score: 1 },
  ];

  // Naive: B dropped
  const retsNaive = { A: 0.20, C: 0.05, D: 0.02 };
  const naiveResult = cohortSpread(ranking, retsNaive, { cohortN: 2 });
  approxEq(naiveResult.cohortMean,    0.125, 1e-10, 'naive cohortMean');
  approxEq(naiveResult.universeMedian, 0.05,  1e-10, 'naive universeMedian');
  approxEq(naiveResult.spread,        0.075, 1e-10, 'naive spread');

  // Conservative: B=-1.0
  const retsConservative = { A: 0.20, B: -1.0, C: 0.05, D: 0.02 };
  const conservResult = cohortSpread(ranking, retsConservative, { cohortN: 2 });
  approxEq(conservResult.cohortMean,    -0.40,  1e-10, 'conservative cohortMean');
  approxEq(conservResult.universeMedian, 0.035, 1e-10, 'conservative universeMedian');
  approxEq(conservResult.spread,       -0.435, 1e-10, 'conservative spread');

  // They must differ
  if (naiveResult.spread === conservResult.spread) {
    throw new Error('Expected naive and conservative spreads to differ');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. hitRate and quintileMonotonicity sanity checks
// ═══════════════════════════════════════════════════════════════════════════════

test('hitRate: 3 of top-4 beat universe median', () => {
  // ranking: A(4),B(3),C(2),D(1),E(0) — scores
  // rets: A=0.5, B=0.3, C=0.1, D=0.2, E=0.05
  // universe: [0.5,0.3,0.1,0.2,0.05] sorted [0.05,0.1,0.2,0.3,0.5] → median=0.2
  // top-4: A(0.5>0.2 hit), B(0.3>0.2 hit), C(0.1 not hit), D(0.2 not hit)
  // hitRate = 2/4 = 0.5
  const ranking = [
    { ticker: 'A', score: 4 },
    { ticker: 'B', score: 3 },
    { ticker: 'C', score: 2 },
    { ticker: 'D', score: 1 },
    { ticker: 'E', score: 0 },
  ];
  const rets = { A: 0.5, B: 0.3, C: 0.1, D: 0.2, E: 0.05 };
  const result = hitRate(ranking, rets, 4);
  approxEq(result.hitRate, 0.5, 1e-10, 'hitRate');
  assertEq(result.n, 4, 'hitRate n');
});

test('quintileMonotonicity: perfect ordering → monotoneScore=1', () => {
  // 10 names, scores 10..1, returns 10%..1% → perfect Q1>Q2>Q3>Q4>Q5
  const ranking = [];
  const rets = {};
  for (let i = 0; i < 10; i++) {
    const ticker = `T${i}`;
    ranking.push({ ticker, score: 10 - i });
    rets[ticker] = (10 - i) / 100;
  }
  // Q1 (top 2): T0(0.10),T1(0.09) mean=0.095
  // Q2 (next 2): T2(0.08),T3(0.07) mean=0.075
  // Q3 (next 2): T4(0.06),T5(0.05) mean=0.055
  // Q4 (next 2): T6(0.04),T7(0.03) mean=0.035
  // Q5 (last 2): T8(0.02),T9(0.01) mean=0.015
  // Each adjacent pair: Q1>Q2>Q3>Q4>Q5 → all 4 monotone → monotoneScore=1.0
  const result = quintileMonotonicity(ranking, rets);
  approxEq(result.monotoneScore, 1.0, 1e-10, 'quintile monotoneScore perfect');
});

test('quintileMonotonicity: too few names (<5) → nulls', () => {
  const ranking = [
    { ticker: 'A', score: 3 },
    { ticker: 'B', score: 2 },
    { ticker: 'C', score: 1 },
  ];
  const rets = { A: 0.1, B: 0.05, C: 0.02 };
  const result = quintileMonotonicity(ranking, rets);
  assertEq(result.quintileMeans, null, 'quintile null means');
  assertEq(result.monotoneScore, null, 'quintile null score');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════════════════
console.log('');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
