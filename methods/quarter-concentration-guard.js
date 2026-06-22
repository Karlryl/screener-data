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
// F-ME-006 (Tag 180): raw arrays preserve calendar alignment.
function _rawArrVals(stock, path) {
  var arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(function(v){ return v == null ? null : (typeof v === 'number' ? v : v.value); });
}

// audit F-A-2026-06-22: prevents blunt 50% concentration cut from overriding
// q-spike seasonal/launch suppression. Ported from q-spike-dataguard.js
// (_isSeasonalQ4Spike / _inLaunchInflection) so this DATAGUARD does not
// hard-disqualify a retailer/e-commerce name with a structurally large Q4
// (or a launch step-change) that q-spike-dataguard would suppress. Suppression
// only ever converts a fail into a pass (it widens the gate), so it cannot
// disqualify a healthy stock that currently passes.
// Keep regex/logic in lockstep with q-spike-dataguard.js Tag 125/127.
var SEASONAL_SECTORS = /\b(internet retail|internet content|sports? betting|leisure|specialty retail|gambling|department stores|home improvement)\b/i;
function _isSeasonalQ4Spike(stock, qVals) {
  var sectorInfo = ((stock.meta && stock.meta.sector) || '') + ' ' + ((stock.meta && stock.meta.industry) || '');
  if (!SEASONAL_SECTORS.test(sectorInfo)) return false;
  if (qVals.length < 8) return false;
  var v = qVals.slice(0, 8);
  if (v.some(function(x){ return x == null || !Number.isFinite(x); })) return false;
  var currentQ4Share = v[0] / (v[0] + v[1] + v[2] + v[3]);
  var priorQ4Share = v[4] / (v[4] + v[5] + v[6] + v[7]);
  return Math.abs(currentQ4Share - priorQ4Share) < 0.03;  // within 3pp = seasonal pattern
}
function _inLaunchInflection(qVals) {
  if (qVals.length < 8) return false;
  var v = qVals.slice(0, 8);
  if (v.some(function(x){ return x == null || !Number.isFinite(x); })) return false;
  var recent4 = (v[0] + v[1] + v[2] + v[3]) / 4;
  var prior4 = (v[4] + v[5] + v[6] + v[7]) / 4;
  return prior4 > 0 && recent4 / prior4 > 1.5;
}

function evaluate(stock) {
  if (!stock) return H.buildResult({ computable: false, pass: false, reason: 'no stock' });
  // F-ME-006 (Tag 180): previously _arrVals filtered nulls, so qRev[0..3] was
  // "the last 4 non-null quarters" which mixes calendar periods when intermediate
  // quarters are missing. Use raw + null-check on positions 0..3.
  var qRev = _rawArrVals(stock, 'timeseries.revenueQ');
  if (qRev.length < 4 || ![0,1,2,3].every(function(i){ return Number.isFinite(qRev[i]); })) {
    return H.buildResult({ computable: false, reason: 'need >=4 calendar-contiguous Q-revs (got ' + qRev.length + ', any of pos 0..3 null)' });
  }
  var last4 = qRev.slice(0, 4);
  var sum = last4.reduce(function(a,b){ return a+b; }, 0);
  if (sum <= 0) return H.buildResult({ computable: false, reason: 'sum <= 0' });
  var maxQ = Math.max.apply(null, last4);
  var concentration = maxQ / sum;
  var pass = concentration <= SPIKE_THRESHOLD;
  // audit F-A-2026-06-22: prevents blunt 50% concentration cut from overriding
  // q-spike seasonal/launch suppression. When the concentration would otherwise
  // FAIL, suppress it for the same two cases q-spike-dataguard recognises:
  // a structurally seasonal Q4 (current Q4-share ~ prior-year Q4-share) or a
  // launch-inflection step-change (recent-4Q-avg > 1.5x prior-4Q-avg). Only
  // ever flips fail->pass, so a healthy stock that already passes is unaffected.
  var suppression = null;
  if (!pass) {
    if (_isSeasonalQ4Spike(stock, qRev)) {
      suppression = 'seasonal_q4_pattern';
      pass = true;
    } else if (_inLaunchInflection(qRev)) {
      suppression = 'launch_inflection_window';
      pass = true;
    }
  }
  return H.buildResult({
    computable: true, pass: pass, value: concentration,
    components: { last4: last4, maxQ: maxQ, sum: sum, concentration: concentration, suppression: suppression },
    reason: 'Single-Q max=' + Math.round(concentration*100) + '% of TTM' +
      (suppression ? ' SPIKE suppressed (' + suppression + ')' : (pass ? ' OK' : ' SPIKE')),
    threshold: SPIKE_THRESHOLD, thresholdOp: 'lte'
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Single-Quarter <= 50% von TTM-Revenue (Q-Spike-Detection)',
  threshold: SPIKE_THRESHOLD, thresholdOp: 'lte', unit: 'ratio',
  evaluate: evaluate
};
