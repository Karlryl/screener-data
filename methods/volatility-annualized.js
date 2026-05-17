'use strict';
const H = require('./_helpers.js');
const fs = require('fs');
const path = require('path');

const ID = 'volatility-annualized';
const LABEL = 'Annualized Volatility';
const THRESHOLD = 0.50;  // ≤ 50% annualized vol
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
  const series = (_loadPrices()[ticker]) || [];
  if (series.length < 60) {
    return H.buildResult({
      computable: false, reason: `need ≥ 60 daily prices (got ${series.length})`,
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
  if (returns.length < 30) {
    return H.buildResult({
      computable: false, reason: `usable returns < 30 (got ${returns.length})`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
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
