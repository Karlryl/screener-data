'use strict';
const H = require('./_helpers.js');

const ID = 'volatility-annualized';
const LABEL = 'Annualized Volatility';
const THRESHOLD = 0.50;  // ≤ 50% annualized vol
const THRESHOLD_OP = 'lte';

// audit SCORE-HIGH-1: use the shared price-history loader (single ~70MB parse
// across all five DIAGNOSTIC price methods) instead of a private per-method cache.

function evaluate(stock) {
  const ticker = stock && stock.meta && stock.meta.ticker;
  if (!ticker) return H.buildResult({ computable: false, reason: 'no ticker', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  const series = (H.loadPriceHistory()[ticker]) || [];
  const MIN_RETURNS = 30;
  // audit F-A-2026-06-22: prevents the daily-sized 60-bar floor rejecting valid weekly series with >=30 returns.
  // Cheap "is there any usable data" guard only; the real statistical floor (MIN_RETURNS) is applied
  // AFTER frequency detection so weekly series with 52-59 bars (>=30 weekly returns) are not pre-rejected
  // by a gate sized for daily data. A series can never yield >=30 returns with fewer than MIN_RETURNS+1 bars.
  if (series.length < MIN_RETURNS + 1) {
    return H.buildResult({
      computable: false, reason: `need ≥ ${MIN_RETURNS + 1} prices (got ${series.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // F-ME-016 / F-217c-04: detect data frequency from timestamps and scale lookback + annualization accordingly.
  // Use median of last N gaps (not just the trailing pair) so a single holiday-week
  // gap of 7 days doesn't misclassify daily data as weekly.
  let lookback52w = 252;   // default: daily
  let annualFactor = 252;  // sqrt(252) for daily data
  {
    const GAP_SAMPLES = 10;
    const gaps = [];
    const start = Math.max(1, series.length - GAP_SAMPLES);
    for (let i = start; i < series.length; i++) {
      if (!series[i] || !series[i - 1] || !series[i].date || !series[i - 1].date) continue;
      const d0 = Date.parse(series[i - 1].date);
      const d1 = Date.parse(series[i].date);
      if (Number.isFinite(d0) && Number.isFinite(d1) && d1 > d0) {
        gaps.push((d1 - d0) / (1000 * 60 * 60 * 24));
      }
    }
    if (gaps.length >= 3) {
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      if (median >= 4) { lookback52w = 52; annualFactor = 52; } // weekly data
    }
  }
  const window = series.slice(-lookback52w);
  const returns = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i].close > 0 && window[i-1].close > 0) {
      returns.push(Math.log(window[i].close / window[i-1].close));
    }
  }
  if (returns.length < MIN_RETURNS) {
    return H.buildResult({
      computable: false, reason: `usable returns < ${MIN_RETURNS} (got ${returns.length})`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const periodVol = Math.sqrt(variance);
  const annualVol = periodVol * Math.sqrt(annualFactor);
  return H.buildResult({
    value: annualVol,
    pass: annualVol <= THRESHOLD,
    computable: true,
    components: { periodVol, annualVol, annualFactor, n: returns.length },
    reason: `${(annualVol*100).toFixed(1)}% annualized vol (n=${returns.length} periods, annualFactor=${annualFactor})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Annualized Volatility ≤ 50% (Risk-Indikator)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
