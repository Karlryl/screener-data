'use strict';
const H = require('./_helpers.js');
const fs = require('fs');
const path = require('path');

const ID = 'above-200d-ma';
const LABEL = 'Above 200-Day MA';
const THRESHOLD = 1.0;  // current >= MA
const THRESHOLD_OP = 'gte';
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
  const series = (_loadPrices()[ticker]) || [];
  // F-ME-016: detect data frequency from timestamps and scale lookback accordingly
  let lookback200d = 200; // default: daily
  if (series.length >= 2 && series[0].date && series[1].date) {
    const d0 = Date.parse(series[series.length - 2].date);
    const d1 = Date.parse(series[series.length - 1].date);
    if (Number.isFinite(d0) && Number.isFinite(d1)) {
      const avgDaysBetween = (d1 - d0) / (1000 * 60 * 60 * 24);
      if (avgDaysBetween >= 4) lookback200d = 40; // weekly: ~40 weeks ≈ 200 calendar days
    }
  }
  if (series.length < lookback200d) {
    return H.buildResult({
      computable: false, reason: `need ≥${lookback200d} prices (got ${series.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const last200 = series.slice(-lookback200d);
  const ma200 = last200.reduce((s, e) => s + e.close, 0) / lookback200d;
  const current = series[series.length - 1].close;
  // F-217b-02: guard zero/negative ma200 to avoid Infinity/NaN ratio
  if (!Number.isFinite(ma200) || ma200 <= 0) {
    return H.buildResult({
      computable: false, reason: `ma200 denominator <= 0 (got ${ma200})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ratio = current / ma200;
  return H.buildResult({
    value: ratio,
    pass: ratio >= THRESHOLD,
    computable: true,
    components: { current, ma200, ratio },
    reason: `Current ${current.toFixed(2)} vs MA200 ${ma200.toFixed(2)} → ratio ${ratio.toFixed(2)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Current Price > 200-Day Moving Average (Uptrend)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
