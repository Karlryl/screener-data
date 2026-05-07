'use strict';
const H = require('./_helpers.js');
const fs = require('fs');
const path = require('path');

const ID = 'aktienfinder-quality';
const LABEL = 'Aktienfinder Quality';
const THRESHOLD = 7;  // Score ≥ 7/10 = pass
const THRESHOLD_OP = 'gte';
const DATA_PATH = path.join(__dirname, '..', 'external-data', 'aktienfinder.json');

let _cache = null;
function _loadData() {
  if (_cache !== null) return _cache;
  if (!fs.existsSync(DATA_PATH)) { _cache = {}; return _cache; }
  try { _cache = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch (e) { _cache = {}; }
  return _cache;
}

function evaluate(stock) {
  const ticker = stock && stock.meta && stock.meta.ticker;
  if (!ticker) {
    return H.buildResult({
      computable: false, reason: 'no ticker', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const data = _loadData();
  const entry = data[ticker];
  if (!entry || entry.score == null) {
    return H.buildResult({
      computable: false,
      reason: `no aktienfinder score for ${ticker} (run aktienfinder-import.js)`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  return H.buildResult({
    value: entry.score,
    pass: entry.score >= THRESHOLD,
    computable: true,
    components: { score: entry.score, importedAt: entry.importedAt },
    reason: `Aktienfinder ${entry.score}/10 (imported ${entry.importedAt})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Aktienfinder Quality-Score ≥ 7/10 (manual via aktienfinder-import.js)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'percent',
  evaluate
};
