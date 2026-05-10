'use strict';
/**
 * Sloan-Ratio (Tag 117 v2 â eskalierte Logik nach Battle-Konsens):
 *   Single-Year:
 *     |Sloan| <= 10% â pass
 *     |Sloan| 10-15% â WARNING (pass=true mit warning-flag)
 *     |Sloan| 15-20% â REVIEW (pass=true mit review-flag)
 *     |Sloan| > 20% â check 2-year-rule
 *   Hard-Fail nur:
 *     |Sloan| > 20% in 2 aufeinanderfolgenden Jahren
 *
 * Damit wird Earnings-Manipulation hart abgefangen, aber ein einzelnes verzerrtes Jahr
 * killt nicht automatisch (z.B. NVDA 11.3% durch hohes NI/FCF-Delta in Spike-Quartal).
 */
const H = require('./_helpers.js');

const ID = 'sloan-ratio';
const LABEL = 'Sloan-Ratio';
const WARN_THRESHOLD = 0.10;
const REVIEW_THRESHOLD = 0.15;
const FAIL_THRESHOLD = 0.20;
const THRESHOLD_OP = 'lte_abs';

function _arrVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  const nis = _arrVals(stock, 'annual.annualNetIncome');
  const fcfs = _arrVals(stock, 'annual.annualFCF');
  const assetsArr = H.val(stock, 'annual.annualBalance');

  if (!nis.length || !fcfs.length || !Array.isArray(assetsArr) || !assetsArr.length) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs (nis=${nis.length} fcfs=${fcfs.length} balance=${assetsArr ? assetsArr.length : 0})`,
      threshold: WARN_THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Compute Sloan per year
  const sloans = [];
  const yearsAvailable = Math.min(nis.length, fcfs.length, assetsArr.length);
  for (let i = 0; i < yearsAvailable; i++) {
    const ni = nis[i];
    const fcf = fcfs[i];
    const ta = assetsArr[i] && assetsArr[i].totalAssets;
    if (ni == null || fcf == null || !ta || ta <= 0) continue;
    sloans.push({ year: i, value: (ni - fcf) / ta });
  }

  if (!sloans.length) {
    return H.buildResult({
      computable: false,
      reason: 'no valid year-pairs',
      threshold: WARN_THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const latest = sloans[0];
  const v = latest.value;
  const absV = Math.abs(v);

  // Check 2-year-rule for hard-fail
  let consecutiveHigh = 0;
  for (const s of sloans) {
    if (Math.abs(s.value) > FAIL_THRESHOLD) consecutiveHigh++;
    else break;
  }

  let pass = true;
  let flag = 'OK';
  if (consecutiveHigh >= 2) {
    pass = false;
    flag = 'CHRONIC_FAIL';
  } else if (absV > FAIL_THRESHOLD) {
    flag = 'EXTREME_SINGLE_YEAR';
  } else if (absV > REVIEW_THRESHOLD) {
    flag = 'REVIEW';
  } else if (absV > WARN_THRESHOLD) {
    flag = 'WARNING';
  }

  return H.buildResult({
    computable: true,
    pass,
    value: v,
    components: { latest: v, allYears: sloans, consecutiveHigh, flag },
    reason: `Sloan = ${(v*100).toFixed(1)}% [${flag}${consecutiveHigh >= 2 ? ', '+consecutiveHigh+'y >20%' : ''}]`,
    threshold: WARN_THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Sloan-Accruals eskaliert: >10% WARN, >15% REVIEW, >20% in 2y FAIL',
  threshold: WARN_THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
