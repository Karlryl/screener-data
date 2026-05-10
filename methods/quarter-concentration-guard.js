'use strict';
/**
 * Tag 118: Quarter-Concentration-Guard (Hypergrowth-spezifisch)
 * Battle-Konsens: > 50% Single-Q-Konzentration in TTM-Revenue = FAIL.
 * Faengt Q-Spike-Pattern bevor Hypergrowth-Filter es uebersieht.
 */
var H = require('./_helpers.js');
var ID = 'quarter-concentration-guard';
var LABEL = 'Q-Concentration';
var SPIKE_THRESHOLD = 0.50;

function _arrVals(stock, path) {
  var arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(function(v){ return v == null ? null : (typeof v === 'number' ? v : v.value); }).filter(function(v){ return Number.isFinite(v); });
}

function evaluate(stock) {
  if (!stock) return H.buildResult({ computable: false, pass: false, reason: 'no stock' });
  var qRev = _arrVals(stock, 'timeseries.revenueQ');
  if (qRev.length < 4) {
    return H.buildResult({ computable: false, reason: 'need >=4 Q-revs, got ' + qRev.length });
  }
  var last4 = qRev.slice(0, 4);
  var sum = last4.reduce(function(a,b){ return a+b; }, 0);
  if (sum <= 0) return H.buildResult({ computable: false, reason: 'sum <= 0' });
  var maxQ = Math.max.apply(null, last4);
  var concentration = maxQ / sum;
  var pass = concentration <= SPIKE_THRESHOLD;
  return H.buildResult({
    computable: true, pass: pass, value: concentration,
    components: { last4: last4, maxQ: maxQ, sum: sum, concentration: concentration },
    reason: 'Single-Q max=' + Math.round(concentration*100) + '% of TTM' + (pass ? ' OK' : ' SPIKE'),
    threshold: SPIKE_THRESHOLD, thresholdOp: 'lte'
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Single-Quarter <= 50% von TTM-Revenue (Q-Spike-Detection)',
  threshold: SPIKE_THRESHOLD, thresholdOp: 'lte', unit: 'ratio',
  evaluate: evaluate
};
