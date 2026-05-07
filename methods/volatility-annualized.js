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
  // Daily log returns
  const window = series.slice(-252);
  const returns = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i].close > 0 && window[i-1].close > 0) {
      returns.push(Math.log(window[i].close / window[i-1].close));
    }
  }
  if (returns.length < 50) {
    return H.buildResult({
      computable: false, reason: `usable returns < 50`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);
  const annualVol = dailyVol * Math.sqrt(252);
  return H.buildResult({
    value: annualVol,
    pass: annualVol <= THRESHOLD,
    computable: true,
    components: { dailyVol, annualVol, n: returns.length },
    reason: `${(annualVol*100).toFixed(1)}% annualized vol (n=${returns.length} days)`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Annualized Volatility ≤ 50% (Risk-Indikator)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
