'use strict';
/**
 * Tag 98h + 102d + 102e: Revenue-Shock-Guard v2 (DATAGUARD)
 * Tag 102d: timeseries.revenueQ statt quarterly.revenue
 * Tag 102e: Q-Schwelle 6→4 (Yahoo liefert oft nur 5Q, sonst Stage-2-Fallback)
 */
const H = require('./_helpers.js');

const ID = 'revenue-shock-guard';
const LABEL = 'Revenue Shock Guard';
const THRESHOLD = 4;
const THRESHOLD_OP = 'lte';

function _median(arr) {
  const s = arr.slice().sort((a,b)=>a-b);
  const n = s.length;
  return n===0?null:(n%2===0?(s[n/2-1]+s[n/2])/2:s[(n-1)/2]);
}
function _mad(arr, med) { return _median(arr.map(x => Math.abs(x - med))); }

function _arr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a) || a.length === 0) return null;
  return a.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)))
          .filter(v => Number.isFinite(v));
}

function _materialityFloor(stock) {
  const ttmRev = _arr(stock, 'annual.annualRev');
  const ttm = (ttmRev && ttmRev[0]) || 0;
  const mcapField = H.val(stock, 'marketCap');
  const mcap = (typeof mcapField === 'number') ? mcapField : (mcapField && mcapField.value) || 0;
  return Math.max(10000000, 0.08*ttm, 0.0025*mcap);
}

function evaluate(stock) {
  let qrev = _arr(stock, 'timeseries.revenueQ');
  if (!qrev) qrev = _arr(stock, 'quarterly.revenue') || _arr(stock, 'quarterly.totalRevenue');
  const floor = _materialityFloor(stock);

  if (qrev && qrev.length >= 4) {
    const window = qrev.slice(0, 8);
    const latest = window[0];
    const prior = window.slice(1);
    if (latest <= 0) return H.buildResult({ value: 0, pass: true, computable: true, reason: 'Q0<=0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
    const med = _median(prior);
    const mad = _mad(prior, med);
    const z = (mad > 0) ? (latest - med) / (1.4826 * mad) : 0;
    const absZ = Math.abs(z);
    const jump = latest - med;
    const shock = absZ > THRESHOLD && jump > floor;
    return H.buildResult({
      value: absZ, pass: !shock, computable: true,
      components: { source: 'quarterly', latest, priorMedian: med, mad, zscore: z, absoluteJump: jump, materialityFloor: floor, shock },
      reason: 'Q0=' + latest.toFixed(0) + ' vs Q-med=' + med.toFixed(0) + ', |z|=' + absZ.toFixed(2),
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, flags: shock ? ['REVENUE_SHOCK_QUARTERLY'] : []
    });
  }

  const arev = _arr(stock, 'annual.annualRev');
  if (arev && arev.length >= 3) {
    const y0 = arev[0];
    const prior = arev.slice(1, 4);
    if (y0 <= 0) return H.buildResult({ value: 0, pass: true, computable: true, reason: 'Y0<=0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
    const med = _median(prior);
    const mad = _mad(prior, med);
    const z = (mad > 0) ? (y0 - med) / (1.4826 * mad) : (med > 0 && y0 / med > 5 ? 99 : 0);
    const absZ = Math.abs(z);
    const jump = y0 - med;
    const shock = absZ > THRESHOLD && jump > floor;
    return H.buildResult({
      value: absZ, pass: !shock, computable: true,
      components: { source: 'annual', latest: y0, priorMedian: med, mad, zscore: z, absoluteJump: jump, materialityFloor: floor, shock },
      reason: 'Y0=' + y0.toFixed(0) + ' vs Y-med=' + med.toFixed(0) + ', |z|=' + absZ.toFixed(2),
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, flags: shock ? ['REVENUE_SHOCK_ANNUAL'] : []
    });
  }

  const yoyG = H.metricValue(stock, 'revenueGrowthYoY');
  if (yoyG != null && yoyG > 500) {
    return H.buildResult({
      value: 99, pass: false, computable: true,
      components: { source: 'metrics_yoy', revenueGrowthYoY: yoyG, materialityFloor: floor, shock: true },
      reason: 'YoY=' + yoyG.toFixed(0) + '% > 500%',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, flags: ['REVENUE_SHOCK_YOY']
    });
  }

  return H.buildResult({
    computable: false,
    reason: 'no quarterly/annual revenue data',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = { id: ID, label: LABEL, description: 'Robust outlier detection with skalenadaptive materiality', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'z-score', evaluate };
