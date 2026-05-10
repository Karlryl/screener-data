'use strict';
/**
 * Tag 118: Deceleration-Guard (Hypergrowth-spezifisch)
 * Battle-Konsens: latestQuarterYoY << TTM-Growth = Wachstum operativ tot, TTM laggt.
 *
 * Pass: Q[0]/Q[4] (YoY-Quartal) >= 0 UND latestQuarterYoY > revenueGrowthTTM - 30pp
 * Wenn TTM hoch (>=25%) aber Q-YoY < 10% UND letzter Q < avg(prev 3): FAIL_DECELERATION
 */
var H = require('./_helpers.js');
var ID = 'deceleration-guard';
var LABEL = 'Deceleration';

function _arrVals(stock, path) {
  var arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(function(v){ return v == null ? null : (typeof v === 'number' ? v : v.value); }).filter(function(v){ return Number.isFinite(v); });
}

function evaluate(stock) {
  if (!stock) return H.buildResult({ computable: false, pass: false, reason: 'no stock' });
  var qRev = _arrVals(stock, 'timeseries.revenueQ');
  if (qRev.length < 5) {
    return H.buildResult({ computable: false, reason: 'need >=5 Q for YoY-Q comparison, got ' + qRev.length });
  }
  var ttmGrowth = H.metricValue(stock, 'revenueGrowthYoY');
  // Latest Q YoY: qRev[0] / qRev[4]
  var qYoY = qRev[4] > 0 ? ((qRev[0] - qRev[4]) / qRev[4]) * 100 : null;
  if (qYoY == null) return H.buildResult({ computable: false, reason: 'qYoY n/a' });

  var prev3Avg = (qRev[1] + qRev[2] + qRev[3]) / 3;
  var qBelowAvg = qRev[0] < prev3Avg;

  var hardFail = ttmGrowth != null && ttmGrowth >= 25 && qYoY < 10 && qBelowAvg;
  // Soft warning condition (not hard fail)
  var softFail = ttmGrowth != null && qYoY < ttmGrowth - 30;

  var pass = !hardFail;
  var flag = hardFail ? 'HARD_DECEL' : (softFail ? 'SOFT_DECEL' : 'OK');

  return H.buildResult({
    computable: true, pass: pass,
    value: qYoY,
    components: { qYoY: qYoY, ttmGrowth: ttmGrowth, qBelowAvg: qBelowAvg, flag: flag },
    reason: 'Q-YoY=' + qYoY.toFixed(0) + '% vs TTM=' + (ttmGrowth || 0).toFixed(0) + '% [' + flag + ']',
    threshold: 10, thresholdOp: 'gte'
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Deceleration-Guard: kein TTM-Wachstum-Lag wenn Q-YoY << TTM',
  threshold: 10, thresholdOp: 'gte', unit: '%',
  evaluate: evaluate
};
