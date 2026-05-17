'use strict';
const H = require('./_helpers.js');
const fs = require('fs');
const path = require('path');

const ID = 'drawdown-52w';
const LABEL = 'Drawdown vs 52w-High';
const THRESHOLD = 0.30;  // ≤ 30% drawdown = pass (not too crashed)
const THRESHOLD_OP = 'lte';
const PRICES_HISTORY = path.join(__dirname, '..', 'prices', 'history.json');

let _cache = null;
function _loadPrices() {
  if (_cache !== null) return _cache;
  if (!fs.existsSync(PRICES_HISTORY)) { _cache = {}; return _cache; }
  try { _cache = JSON.parse(fs.readFileSync(PRICES_HISTORY, 'utf8')); }
  catch (e) { _cache = {}; }
  return _cache;
}

function evaluate(stock) {
  const ticker = stock && stock.meta && stock.meta.ticker;
  if (!ticker) return H.buildResult({ computable: false, reason: 'no ticker', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  const prices = _loadPrices();
  const series = prices[ticker];
  if (!series || series.length < 30) {
    return H.buildResult({
      computable: false, reason: `need ≥30 days price history (got ${series ? series.length : 0})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // F-ME-016: detect data frequency from timestamps and scale lookback accordingly
  // daily: avg ~1 calendar day between entries; weekly: avg ~5-8 days
  let lookback52w = 252; // default: daily
  if (series.length >= 2 && series[0].date && series[1].date) {
    const d0 = Date.parse(series[series.length - 2].date);
    const d1 = Date.parse(series[series.length - 1].date);
    if (Number.isFinite(d0) && Number.isFinite(d1)) {
      const avgDaysBetween = (d1 - d0) / (1000 * 60 * 60 * 24);
      if (avgDaysBetween >= 4) lookback52w = 52; // weekly data
    }
  }
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
