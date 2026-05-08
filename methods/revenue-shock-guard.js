'use strict';
/**
 * Tag 98b: Revenue-Shock-Guard (DATAGUARD)
 * =========================================
 * Ersetzt das stable-quarterly-growth-Pflaster (ARWR-Fix) durch echten
 * outlier-detector basiert auf robuster Statistik:
 *
 * Methodik:
 *   1. Trailing 8 Quartale Revenue holen (latest first).
 *   2. Median + MAD (Median Absolute Deviation) der prior 7Q (ohne latest) berechnen.
 *   3. Robust-z-score des LATEST quarter: (Q0 - median) / (1.4826 * MAD)
 *   4. |z| > 4 -> Shock detected -> fail (DATAGUARD disqualifiziert Stock)
 *
 * Edge-Cases:
 *   - <6 Quartale Daten -> uncomputable
 *   - MAD = 0 -> Fallback auf relative deviation
 *   - Latest <= 0 -> direkter Pass
 */
const H = require('./_helpers.js');

const ID = 'revenue-shock-guard';
const LABEL = 'Revenue Shock Guard';
const THRESHOLD = 4;
const THRESHOLD_OP = 'lte';

function _median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const n = sorted.length;
  return n === 0 ? null : (n % 2 === 0 ? (sorted[n/2-1] + sorted[n/2])/2 : sorted[(n-1)/2]);
}

function _mad(arr, med) {
  return _median(arr.map(x => Math.abs(x - med)));
}

function _getQuarterlyRevenue(stock) {
  const candidates = [
    H.val(stock, 'quarterly.revenue'),
    H.val(stock, 'quarterly.quarterlyRevenue'),
    H.val(stock, 'quarterly.totalRevenue'),
    H.val(stock, 'annual.quarterlyRevenue')
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)))
              .filter(v => Number.isFinite(v));
    }
  }
  return null;
}

function evaluate(stock) {
  const qrev = _getQuarterlyRevenue(stock);
  if (!qrev || qrev.length < 6) {
    return H.buildResult({
      computable: false,
      reason: 'insufficient quarterly history (have ' + (qrev ? qrev.length : 0) + ', need >=6)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const window = qrev.slice(0, 8);
  const latest = window[0];
  const prior = window.slice(1);

  if (latest <= 0) {
    return H.buildResult({
      value: 0, pass: true, computable: true,
      components: { latest, priorMedian: _median(prior), reason: 'non-positive latest' },
      reason: 'latest revenue <= 0, no shock signal',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const med = _median(prior);
  const mad = _mad(prior, med);

  let zscore;
  if (mad === 0 || mad == null) {
    if (med === 0) zscore = 0;
    else zscore = Math.abs((latest - med) / med) > 1.0 ? 99 : 0;
  } else {
    zscore = (latest - med) / (1.4826 * mad);
  }

  const absZ = Math.abs(zscore);
  const pass = absZ <= THRESHOLD;
  return H.buildResult({
    value: absZ,
    pass,
    computable: true,
    components: {
      latest, priorMedian: med, mad, zscore,
      direction: zscore > 0 ? 'positive_spike' : zscore < 0 ? 'negative_drop' : 'flat',
      windowSize: window.length
    },
    reason: 'Q0=' + latest.toFixed(0) + ' vs prior-median=' + med.toFixed(0) + ', |z|=' + absZ.toFixed(2),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Robust outlier detection on latest quarterly revenue (catches ARWR-style royalty spikes)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'z-score',
  evaluate
};
