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
  // Use raw (positionally aligned) arrays so nis[i], cfos[i], assetsArr[i] refer to the same year
  const rawNis = _rawVals(stock, 'annual.annualNetIncome');
  // audit F-A-2026-06-22: canonical Sloan accrual is (NI - CFO), NOT (NI - FCF).
  // FCF = CFO - capex, so NI - FCF = (NI - CFO) + capex, which wrongly counts
  // capital expenditure as an accrual and inflates |Sloan| for reinvesting /
  // capex-heavy firms. Prefer reported operating cash flow (annualOCF, ~86%
  // coverage) and fall back to annualFCF per-year only when OCF is absent —
  // same idiom as piotroski-f-score.js (cfo0 = ocf0 != null ? ocf0 : fcf0) and
  // reinvestment-rate.js's per-year OCF build.
  // prevents failure mode: capex miscounted as accrual inflates |Sloan| for reinvesting firms.
  const rawOcfs = _rawVals(stock, 'annual.annualOCF');
  const rawFcfs = _rawVals(stock, 'annual.annualFCF');
  const cfoLen = Math.max(rawOcfs.length, rawFcfs.length);
  const rawCfos = [];
  for (let i = 0; i < cfoLen; i++) {
    const o = (i < rawOcfs.length) ? rawOcfs[i] : null;
    const f = (i < rawFcfs.length) ? rawFcfs[i] : null;
    rawCfos.push(Number.isFinite(o) ? o : (Number.isFinite(f) ? f : null));
  }
  const assetsArr = H.val(stock, 'annual.annualBalance');

  const validNis = rawNis.filter(v => Number.isFinite(v));
  const validCfos = rawCfos.filter(v => Number.isFinite(v));

  if (!validNis.length || !validCfos.length || !Array.isArray(assetsArr) || !assetsArr.length) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs (nis=${validNis.length} cfos=${validCfos.length} balance=${assetsArr ? assetsArr.length : 0})`,
      threshold: WARN_THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // audit F-A-2026-06-22: the per-year zip below keys {year: i} on the raw ARRAY
  // INDEX, not a fiscal year — the snapshot exposes no per-row fiscalYear/endDate
  // to key on (annual rows are bare {value}/{totalAssets,...} objects, see
  // pull-yahoo.js mapFTSToAnnual/mapFTSToBalance). mapFTSToAnnual `continue`s past
  // empty NI/FCF rows (no trailing trim on those arrays) while mapFTSToBalance
  // pushes null placeholders AND trims trailing nulls — so the three arrays can
  // legitimately differ in length and null-pattern, in which case index i no
  // longer denotes the SAME fiscal year across NI / CFO / assets. When the source
  // arrays are NOT positionally aligned (unequal lengths = divergent origin), the
  // consecutive-year hard-fail rule cannot trust index deltas, so we restrict to
  // single-latest-year evaluation (drop the 2y CHRONIC_FAIL rule) instead of
  // mixing non-aligned years into the accrual + consecutive-fail logic.
  // prevents failure mode: cross-array positional zip mixes non-aligned fiscal years in accrual + consecutive-fail logic.
  const aligned = (rawNis.length === rawCfos.length) && (rawNis.length === assetsArr.length);

  // Compute Sloan per year — zip all three arrays positionally
  const sloans = [];
  const yearsAvailable = Math.min(rawNis.length, rawCfos.length, assetsArr.length);
  for (let i = 0; i < yearsAvailable; i++) {
    const ni = rawNis[i];
    const cfo = rawCfos[i];
    const ta = assetsArr[i] && assetsArr[i].totalAssets;
    if (!Number.isFinite(ni) || !Number.isFinite(cfo) || !ta || ta <= 0) continue;
    sloans.push({ year: i, value: (ni - cfo) / ta });
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
  // audit F-A-2026-06-22: only run the consecutive-year rule when the source
  // arrays are positionally aligned (equal length / shared origin). If they are
  // not, sloans[k].year (= raw array index) may straddle non-aligned fiscal
  // years across NI / CFO / assets, so a `year[k] === year[k-1]+1` delta does NOT
  // prove two truly consecutive fiscal years — counting it could fabricate a
  // CHRONIC_FAIL from mismatched years. Stay conservative: skip the 2y rule.
  // prevents failure mode: cross-array positional zip mixes non-aligned fiscal years in consecutive-fail logic.
  let consecutiveHigh = 0;
  if (aligned) {
    for (let k = 0; k < sloans.length; k++) {
      if (k > 0 && sloans[k].year !== sloans[k - 1].year + 1) break; // gap — not truly consecutive
      if (sloans[k].value > FAIL_THRESHOLD) consecutiveHigh++;
      else break;
    }
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
    components: { latest: v, allYears: sloans, consecutiveHigh, flag, aligned }, // audit F-A-2026-06-22: surface array-alignment so a skipped 2y rule is observable
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
