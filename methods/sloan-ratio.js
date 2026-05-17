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

function _rawVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value));
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  // Use raw (positionally aligned) arrays so nis[i], fcfs[i], assetsArr[i] refer to the same year
  const rawNis = _rawVals(stock, 'annual.annualNetIncome');
  const rawFcfs = _rawVals(stock, 'annual.annualFCF');
  const assetsArr = H.val(stock, 'annual.annualBalance');

  const validNis = rawNis.filter(v => Number.isFinite(v));
  const validFcfs = rawFcfs.filter(v => Number.isFinite(v));

  if (!validNis.length || !validFcfs.length || !Array.isArray(assetsArr) || !assetsArr.length) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs (nis=${validNis.length} fcfs=${validFcfs.length} balance=${assetsArr ? assetsArr.length : 0})`,
      threshold: WARN_THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Compute Sloan per year — zip all three arrays positionally
  const sloans = [];
  const yearsAvailable = Math.min(rawNis.length, rawFcfs.length, assetsArr.length);
  for (let i = 0; i < yearsAvailable; i++) {
    const ni = rawNis[i];
    const fcf = rawFcfs[i];
    const ta = assetsArr[i] && assetsArr[i].totalAssets;
    if (!Number.isFinite(ni) || !Number.isFinite(fcf) || !ta || ta <= 0) continue;
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
  // Tag 221 (audit F-221b-1 anchor-safety fix): Sloan is asymmetric.
  // POSITIVE Sloan = NI > FCF = accruals-heavy = real manipulation risk.
  // NEGATIVE Sloan = FCF > NI = conservative accounting = GOOD signal.
  // The previous Math.abs() logic treated both sides as bad and silently
  // disqualified MELI (Sloan ≈ -22% from FCF/NI = 2.0× — conservative
  // accounting, the OPPOSITE of fraud). Now: only positive direction
  // triggers WARN/REVIEW/EXTREME/CHRONIC_FAIL. Negative direction always
  // passes with NEGATIVE-OK flag.
  const posV = Math.max(0, v);  // 0 if v < 0; v if v >= 0

  // Check 2-year-rule for hard-fail (positive direction only).
  let consecutiveHigh = 0;
  for (let k = 0; k < sloans.length; k++) {
    if (k > 0 && sloans[k].year !== sloans[k - 1].year + 1) break; // gap — not truly consecutive
    if (sloans[k].value > FAIL_THRESHOLD) consecutiveHigh++;
    else break;
  }

  let pass = true;
  let flag = 'OK';
  if (consecutiveHigh >= 2) {
    pass = false;
    flag = 'CHRONIC_FAIL';
  } else if (posV > FAIL_THRESHOLD) {
    flag = 'EXTREME_SINGLE_YEAR';
  } else if (posV > REVIEW_THRESHOLD) {
    flag = 'REVIEW';
  } else if (posV > WARN_THRESHOLD) {
    flag = 'WARNING';
  } else if (v < -WARN_THRESHOLD) {
    flag = 'NEGATIVE_OK';  // conservative accounting — informational, not bad
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
