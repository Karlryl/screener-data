'use strict';
/**
 * Tag 98c: Profitability-State (CORE) - 4-Bucket-Variante
 * 4 Buckets: LOSS / TURNAROUND / RECENT / STABLE
 */
const H = require('./_helpers.js');

const ID = 'profitability-state';
const LABEL = 'Profitability State';
const THRESHOLD = 'TURNAROUND';
const THRESHOLD_OP = 'gte';

function _getNetIncomeArr(stock) {
  const arr = H.val(stock, 'annual.annualNetIncome');
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)));
}

function _classify(niArr) {
  if (!niArr || niArr.length === 0) return null;
  const y0 = niArr[0];
  if (y0 == null) return null;
  if (y0 <= 0) return 'LOSS';

  const y1 = niArr.length > 1 ? niArr[1] : null;
  if (y1 == null || y1 <= 0) return 'TURNAROUND';

  let consec = 0;
  for (const ni of niArr) {
    if (ni == null) break;
    if (ni > 0) consec++;
    else break;
  }
  if (consec >= 3) return 'STABLE';
  return 'RECENT';
}

function evaluate(stock) {
  const niArr = _getNetIncomeArr(stock);
  if (!niArr || niArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'insufficient netIncome history (need >=2 years)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const state = _classify(niArr);
  if (state == null) {
    return H.buildResult({
      computable: false,
      reason: 'cannot classify state - null netIncome',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const stateRank = { LOSS: 0, TURNAROUND: 1, RECENT: 2, STABLE: 3 }[state];
  const pass = stateRank >= 1;
  return H.buildResult({
    value: stateRank,
    pass,
    computable: true,
    components: { state, yearsAvailable: niArr.length, latestNetIncome: niArr[0] },
    reason: 'state=' + state + ' (' + niArr.length + 'y available, Y-0=' + niArr[0] + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'LOSS / TURNAROUND / RECENT / STABLE classification - 4 buckets',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'state',
  evaluate
};
