'use strict';
const H = require('./_helpers.js');
const fs = require('fs');
const path = require('path');

const ID = 'high-proximity-52w';
const LABEL = '52w-High Proximity';
const THRESHOLD = 0.05;  // current price within 5% of 52w high = pass
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
      computable: false, reason: `need ≥30 days price history`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const window = series.slice(-252);
  const high52w = Math.max(...window.map(e => e.close));
  const current = window[window.length - 1].close;
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
