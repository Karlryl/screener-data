'use strict';
const H = require('./_helpers.js');

const ID = 'high-proximity-52w';
const LABEL = '52w-High Proximity';
const THRESHOLD = 0.05;  // current price within 5% of 52w high = pass
const THRESHOLD_OP = 'lte';

// audit SCORE-HIGH-1: use the shared price-history loader (single ~70MB parse
// across all five DIAGNOSTIC price methods) instead of a private per-method cache.

function evaluate(stock) {
  const ticker = stock && stock.meta && stock.meta.ticker;
  if (!ticker) return H.buildResult({ computable: false, reason: 'no ticker', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  const prices = H.loadPriceHistory();
  const series = prices[ticker];
  if (!series || series.length < 30) {
    return H.buildResult({
      computable: false, reason: `need ≥30 days price history`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // bug-fix (audit 2026-06-21): robust median-of-last-10-gaps frequency detector (see drawdown-52w).
  // The old trailing-pair test misclassified daily data as weekly after a post-holiday gap (~229 tickers).
  const lookback52w = H.seriesLookback(series, 252, 52);
  const window = series.slice(-lookback52w);
  const high52w = Math.max(...window.map(e => e.close));
  const current = window[window.length - 1].close;
  // F-217b-02: guard zero/negative high52w to avoid Infinity/NaN distFromHigh
  if (!Number.isFinite(high52w) || high52w <= 0) {
    return H.buildResult({
      computable: false, reason: `high52w denominator <= 0 (got ${high52w})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const distFromHigh = (high52w - current) / high52w;
  return H.buildResult({
    value: distFromHigh,
    pass: distFromHigh <= THRESHOLD,
    computable: true,
    components: { current, high52w, distFromHigh },
    reason: `Current ${(current/high52w*100).toFixed(1)}% von 52w-High → ${(distFromHigh*100).toFixed(1)}% darunter`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Current Price ≤ 5% von 52w-High (Momentum-near-Top)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
