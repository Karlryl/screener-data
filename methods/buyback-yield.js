'use strict';
/**
 * Tag 201: Buyback-Yield (Shares-Outstanding YoY Decline)
 * =======================================================
 * Quality-Compounder signal: a falling share count is one of the
 * cleanest evidences that a company is returning capital to
 * shareholders without diluting them. Many premium compounders
 * (AAPL, ORLY, AZO) compound EPS materially through buybacks even in
 * flat-revenue years. This method surfaces buyback yield as a
 * diagnostic so it can be weighed alongside ROIC trend and SBC
 * discipline.
 *
 * Formula (latest-first arrays, like every other annual.* field):
 *   yield = (sharesPrior - sharesNow) / sharesPrior        // positive = buyback
 *
 * Pass: yield > 0 (any net reduction in float).
 *
 * FAILURE MODE THIS DETECTS:
 *   A company whose share count is QUIETLY EXPANDING year after year
 *   (SBC overhang, secondary offerings, M&A-stock issuance) inflates
 *   GAAP earnings while diluting per-share economics. Existing methods
 *   (sbc-revenue, sbc-growth-ratio) catch the income-statement SBC
 *   signal but miss real dilution from M&A or secondaries — which only
 *   shows up in the share-count time series. This method is the
 *   independent cross-check.
 *
 * Data sources (in priority order — pattern-based, no hardcoded tickers):
 *   1. stock.annual.annualShares       (latest first, future-proofed for
 *                                       a planned pull-yahoo extension)
 *   2. stock.timeseries.sharesQ        (quarterly history, latest first;
 *                                       indices [0] vs [4] ≈ 1y)
 *   3. stock.meta.sharesOutstanding    (spot — only computable if BOTH
 *                                       a prior snapshot has been kept;
 *                                       falls back to incomputable when
 *                                       only a single spot value exists)
 *
 * Edge cases:
 *   - Only one data point (sharesNow but no sharesPrior) → computable:false.
 *   - sharesPrior <= 0 → computable:false (denominator).
 *   - sharesNow > sharesPrior → value is negative, pass=false (dilution).
 *   - Field is an envelope ({value: N}) or a raw number → both supported
 *     via the _unwrap helper (same pattern as roic-trend / sbc-growth-ratio).
 */
const H = require('./_helpers.js');

const ID = 'buyback-yield';
const LABEL = 'Buyback-Yield (YoY)';
const THRESHOLD = 0;
const THRESHOLD_OP = 'gt';

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _extractPair(stock) {
  // Source 1: annual share-count series (latest first).
  const annualArr = stock && stock.annual && stock.annual.annualShares;
  if (Array.isArray(annualArr) && annualArr.length >= 2) {
    const now = _unwrap(annualArr[0]);
    const prior = _unwrap(annualArr[1]);
    if (now != null && prior != null) return { now, prior, source: 'annual' };
  }
  // Source 2: quarterly share-count series. Use [0] vs [4] for a 1y diff.
  const qArr = stock && stock.timeseries && stock.timeseries.sharesQ;
  if (Array.isArray(qArr) && qArr.length >= 5) {
    const now = _unwrap(qArr[0]);
    const prior = _unwrap(qArr[4]);
    if (now != null && prior != null) return { now, prior, source: 'sharesQ' };
  } else if (Array.isArray(qArr) && qArr.length >= 2) {
    // Partial fallback — better than nothing; flag the shorter horizon.
    const now = _unwrap(qArr[0]);
    const prior = _unwrap(qArr[qArr.length - 1]);
    if (now != null && prior != null) return { now, prior, source: 'sharesQ-partial' };
  }
  // Source 3: a single spot value can't form a YoY pair on its own.
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const pair = _extractPair(stock);
  if (!pair) {
    return H.buildResult({
      computable: false,
      reason: 'no annual/quarterly share-count series available (need annual.annualShares or timeseries.sharesQ with >=2 points)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const { now: sharesNow, prior: sharesPrior, source } = pair;
  if (sharesPrior <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'sharesPrior <= 0 (' + sharesPrior + ') — invalid denominator',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const yieldFrac = (sharesPrior - sharesNow) / sharesPrior;
  const yieldPct = yieldFrac * 100;
  return H.buildResult({
    value: yieldPct,
    pass: yieldPct > THRESHOLD,
    computable: true,
    components: {
      sharesNow,
      sharesPrior,
      yieldPct: Math.round(yieldPct * 100) / 100,
      source
    },
    reason: 'shares ' + (sharesPrior / 1e6).toFixed(1) + 'M → ' +
            (sharesNow / 1e6).toFixed(1) + 'M = ' +
            (yieldPct >= 0 ? '+' : '') + yieldPct.toFixed(2) + '% (' + source + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Buyback-Yield: Aktienanzahl YoY rückläufig — Capital-Return-Disziplin',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: '%',
  evaluate
};
