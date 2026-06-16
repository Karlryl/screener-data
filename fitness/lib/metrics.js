'use strict';
/**
 * fitness/lib/metrics.js
 * Pure ranking-quality metrics.
 * No I/O, no Date.now(), no Math.random().
 */

const { spearman } = require('./spearman.js');

/**
 * rankIC(rankingEntries, returnByTicker)
 * Spearman of baseline score vs forward return.
 * Sign convention: POSITIVE IC = higher score → higher forward return (good).
 *
 * @param {Array<{ticker:string, score:number}>} rankingEntries
 * @param {Object<string,number>} returnByTicker  { ticker: fractionReturn }
 * @returns {{ ic:number|null, n:number, dropped:number }}
 */
function rankIC(rankingEntries, returnByTicker) {
  const scores = [];
  const returns = [];
  let dropped = 0;

  for (const { ticker, score } of rankingEntries) {
    const ret = returnByTicker[ticker];
    if (ret === undefined || ret === null || !Number.isFinite(ret)) {
      dropped++;
      continue;
    }
    scores.push(score);
    returns.push(ret);
  }

  const n = scores.length;
  const ic = n >= 3 ? spearman(scores, returns) : null;
  return { ic, n, dropped };
}

/**
 * Compute the median of a numeric array. Returns null if empty.
 * @param {number[]} arr
 */
function _median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * cohortSpread(rankingEntries, returnByTicker, opts)
 * Cohort = top cohortN tickers by score (highest first); tie-break by ticker.localeCompare.
 * Restricted to those with a finite return.
 * Universe return = MEDIAN of ALL returnByTicker values passed in.
 *
 * @param {Array<{ticker:string, score:number}>} rankingEntries
 * @param {Object<string,number>} returnByTicker
 * @param {{ cohortN?:number, label?:string }} opts
 * @returns {{ spread:number|null, cohortMean:number|null, universeMedian:number|null, cohortN_used:number, universeN:number }}
 */
function cohortSpread(rankingEntries, returnByTicker, opts) {
  const cohortN = (opts && opts.cohortN != null) ? opts.cohortN : 8;

  // Sort by score descending, tie-break by ticker ascending
  const sorted = rankingEntries.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.ticker.localeCompare(b.ticker);
  });

  // Top cohortN with finite returns
  const cohortReturns = [];
  for (const entry of sorted) {
    if (cohortReturns.length >= cohortN) break;
    const ret = returnByTicker[entry.ticker];
    if (ret !== undefined && ret !== null && Number.isFinite(ret)) {
      cohortReturns.push(ret);
    }
  }

  // Universe = all finite returns in returnByTicker
  const universeReturns = Object.values(returnByTicker).filter(r => Number.isFinite(r));

  const cohortN_used = cohortReturns.length;
  const universeN = universeReturns.length;

  if (cohortN_used < 1 || universeN < 1) {
    return { spread: null, cohortMean: null, universeMedian: null, cohortN_used, universeN };
  }

  const cohortMean = cohortReturns.reduce((s, r) => s + r, 0) / cohortReturns.length;
  const universeMedian = _median(universeReturns);
  const spread = cohortMean - universeMedian;

  return { spread, cohortMean, universeMedian, cohortN_used, universeN };
}

/**
 * hitRate(rankingEntries, returnByTicker, cohortN)
 * Fraction of the top-cohortN names whose return > universe median.
 * @param {Array<{ticker:string, score:number}>} rankingEntries
 * @param {Object<string,number>} returnByTicker
 * @param {number} cohortN
 * @returns {{ hitRate:number|null, n:number }}
 */
function hitRate(rankingEntries, returnByTicker, cohortN) {
  const n = cohortN || 8;
  const universeReturns = Object.values(returnByTicker).filter(r => Number.isFinite(r));
  const uMedian = _median(universeReturns);
  if (uMedian === null) return { hitRate: null, n: 0 };

  const sorted = rankingEntries.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.ticker.localeCompare(b.ticker);
  });

  let hits = 0, count = 0;
  for (const entry of sorted) {
    if (count >= n) break;
    const ret = returnByTicker[entry.ticker];
    if (ret !== undefined && ret !== null && Number.isFinite(ret)) {
      if (ret > uMedian) hits++;
      count++;
    }
  }

  return { hitRate: count > 0 ? hits / count : null, n: count };
}

/**
 * quintileMonotonicity(rankingEntries, returnByTicker)
 * Split into 5 quintiles by score (Q1=top), compute each quintile's mean return.
 * monotoneScore = fraction of adjacent pairs where higher quintile mean >= lower quintile mean.
 * @param {Array<{ticker:string, score:number}>} rankingEntries
 * @param {Object<string,number>} returnByTicker
 * @returns {{ quintileMeans:number[]|null, monotoneScore:number|null }}
 */
function quintileMonotonicity(rankingEntries, returnByTicker) {
  // Filter to entries with finite returns
  const usable = rankingEntries
    .filter(e => {
      const r = returnByTicker[e.ticker];
      return r !== undefined && r !== null && Number.isFinite(r);
    })
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.ticker.localeCompare(b.ticker);
    });

  if (usable.length < 5) {
    return { quintileMeans: null, monotoneScore: null };
  }

  const n = usable.length;
  const quintileMeans = [];
  for (let q = 0; q < 5; q++) {
    const start = Math.floor(q * n / 5);
    const end = Math.floor((q + 1) * n / 5);
    const slice = usable.slice(start, end);
    const mean = slice.reduce((s, e) => s + returnByTicker[e.ticker], 0) / slice.length;
    quintileMeans.push(mean);
  }

  // monotoneScore: # of adjacent pairs (q, q+1) where quintileMeans[q] >= quintileMeans[q+1]
  // Q1 (index 0) is top quintile (should have highest return for a good model)
  let monotone = 0;
  for (let i = 0; i < 4; i++) {
    if (quintileMeans[i] >= quintileMeans[i + 1]) monotone++;
  }
  const monotoneScore = monotone / 4;

  return { quintileMeans, monotoneScore };
}

module.exports = { rankIC, cohortSpread, hitRate, quintileMonotonicity, _median };
