'use strict';
const H = require('./_helpers.js');

const ID = 'drawdown-52w';
const LABEL = 'Drawdown vs 52w-High';
const THRESHOLD = 0.30;  // ≤ 30% drawdown = pass (not too crashed)
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
      computable: false, reason: `need ≥30 days price history (got ${series ? series.length : 0})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // bug-fix (audit 2026-06-21): use the robust median-of-last-10-gaps frequency detector. The old
  // trailing-pair test (and its guard that checked series[0]/[1] but read [len-2]/[len-1])
  // misclassified daily data as weekly after a single post-holiday gap, shrinking the 52w window to
  // 52 bars (~2.5 months) and flipping the verdict for ~229 tickers (e.g. NOVO-B.CO 39% DD read as 5%).
  const lookback52w = H.seriesLookback(series, 252, 52);
  const window = series.slice(-lookback52w);
  const high52w = Math.max(...window.map(e => e.close));
  const current = window[window.length - 1].close;
  // F-217b-02: guard zero/negative high52w to avoid Infinity/NaN drawdown
  if (!Number.isFinite(high52w) || high52w <= 0) {
    return H.buildResult({
      computable: false, reason: `high52w denominator <= 0 (got ${high52w})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const drawdown = (high52w - current) / high52w;
  return H.buildResult({
    value: drawdown,
    pass: drawdown <= THRESHOLD,
    computable: true,
    components: { current, high52w, drawdown },
    reason: `Current ${current.toFixed(2)} vs 52w-High ${high52w.toFixed(2)} → DD ${(drawdown*100).toFixed(1)}%`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Drawdown vs 52w-High ≤ 30% (Stock nicht im Crash)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
