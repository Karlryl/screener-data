'use strict';
/**
 * Bug 10 regression: non-finite scores must be dropped+counted, not fed into
 * spearman() where they get an arbitrary rank and fabricate a plausible IC.
 * Run standalone: node --test lib/metrics.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { rankIC, cohortSpread, hitRate, quintileMonotonicity, _median } = require('./metrics.js');
const { spearman, averageRank } = require('./spearman.js');

test('rankIC drops NaN score (was ic:0.8 dropped:0)', () => {
  const entries = [
    { ticker: 'A', score: 1 },
    { ticker: 'B', score: 2 },
    { ticker: 'C', score: 3 },
    { ticker: 'D', score: NaN },
  ];
  const rets = { A: 0.1, B: 0.2, C: 0.3, D: 0.4 };
  const r = rankIC(entries, rets);
  assert.equal(r.n, 3);
  assert.equal(r.dropped, 1);
});

test('rankIC drops null score', () => {
  const entries = [
    { ticker: 'A', score: 1 },
    { ticker: 'B', score: 2 },
    { ticker: 'C', score: 3 },
    { ticker: 'D', score: null },
  ];
  const rets = { A: 0.1, B: 0.2, C: 0.3, D: 0.4 };
  const r = rankIC(entries, rets);
  assert.equal(r.n, 3);
  assert.equal(r.dropped, 1);
});

test('spearman returns null on non-finite input', () => {
  assert.equal(spearman([1, 2, NaN], [1, 2, 3]), null);
  assert.equal(spearman([1, 2, 3], [1, null, 3]), null);
});

test('cohortSpread ignores NaN-score entry (no non-deterministic pin)', () => {
  const entries = [
    { ticker: 'A', score: NaN },
    { ticker: 'B', score: 5 },
    { ticker: 'C', score: 4 },
  ];
  const rets = { A: 0.9, B: 0.2, C: 0.1 };
  const r = cohortSpread(entries, rets, { cohortN: 1 });
  // top finite-score name is B (0.2), not the NaN-score A (0.9)
  assert.equal(r.cohortMean, 0.2);
});

test('quintileMonotonicity drops NaN-score entries', () => {
  const entries = [];
  for (let i = 0; i < 5; i++) entries.push({ ticker: 'T' + i, score: i });
  entries.push({ ticker: 'NAN', score: NaN });
  const rets = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4, NAN: 99 };
  const r = quintileMonotonicity(entries, rets);
  // 5 usable entries -> quintileMeans defined; NaN entry excluded
  assert.ok(Array.isArray(r.quintileMeans));
  assert.equal(r.quintileMeans.length, 5);
});

test('hitRate counts two returns above the median out of four', () => {
  const entries = [
    { ticker: 'A', score: 4 }, { ticker: 'B', score: 3 },
    { ticker: 'C', score: 2 }, { ticker: 'D', score: 1 },
  ];
  assert.deepEqual(hitRate(entries, { A: 0.4, B: 0.3, C: 0.2, D: 0.1 }, 4),
    { hitRate: 0.5, n: 4 });
});

test('hitRate excludes NaN and null scores from the measured cohort count', () => {
  const entries = [
    { ticker: 'NAN', score: NaN }, { ticker: 'NULL', score: null },
    { ticker: 'A', score: 4 }, { ticker: 'B', score: 3 },
    { ticker: 'C', score: 2 }, { ticker: 'D', score: 1 },
  ];
  // hitRate exposes the usable count n, not a separate dropped counter.
  assert.deepEqual(hitRate(entries, { A: 0.4, B: 0.3, C: 0.2, D: 0.1, NAN: 100, NULL: -100 }, 8),
    { hitRate: 0.5, n: 4 });
  assert.deepEqual(hitRate([{ ticker: 'NAN', score: NaN }, { ticker: 'NULL', score: null }],
    { NAN: 100, NULL: -100 }, 8), { hitRate: null, n: 0 });
  assert.deepEqual(hitRate([], {}, 4), { hitRate: null, n: 0 });
});

test('_median pins odd, even and empty samples without sorting the input in place', () => {
  const odd = [8, 2, 5];
  const even = [8, 2, 4, 6];
  assert.equal(_median(odd), 5);
  assert.equal(_median(even), 5);
  assert.equal(_median([]), null);
  assert.deepEqual(odd, [8, 2, 5]);
  assert.deepEqual(even, [8, 2, 4, 6]);
});

test('spearman pins both perfect positive and negative correlation', () => {
  assert.equal(spearman([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
});

test('averageRank averages tied positions and preserves original order', () => {
  assert.deepEqual(averageRank([10, 20, 20]), [1, 2.5, 2.5]);
  assert.deepEqual(averageRank([20, 10, 20]), [2.5, 1, 2.5]);
  assert.deepEqual(averageRank([]), []);
});
