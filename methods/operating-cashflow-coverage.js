'use strict';
/**
 * Tag 204: Operating-Cashflow-Coverage (OCF/NI mean over 3y)
 * ===========================================================
 * RESEARCH BASIS:
 *   Aktien-Newsletter quality-investing literature (continuation of the
 *   Sloan, 1996 "Do stock prices fully reflect information in accruals?"
 *   tradition). The OCF/NetIncome ratio is a more robust earnings-quality
 *   signal than the raw Sloan-Ratio because:
 *     1. Sloan-Ratio (NI − FCF) / TotalAssets normalizes by assets, which
 *        understates the signal for asset-light businesses.
 *     2. OCF/NI is a direct cash-coverage ratio — for every dollar of
 *        reported earnings, how many dollars of cash actually flowed in.
 *     3. When NI persistently exceeds OCF over multiple years, earnings
 *        are increasingly non-cash (working-capital build, deferred-revenue
 *        recognition policy, capitalized R&D timing).
 *   A 3y mean of OCF/NI ≥ 0.80 is the conventional fundamentalist floor
 *   (companies meeting this are converting at least 80% of reported earnings
 *   into operating cash on average).
 *
 * Distinct from existing sloan-ratio (NI vs FCF, asset-normalized):
 *   - sloan-ratio: detects accrual *manipulation* (asset-normalized delta).
 *   - operating-cashflow-coverage: detects accrual *drift* (NI growing
 *     faster than OCF, even if total accruals stay modest as a share of
 *     assets — i.e. a chronic but slow earnings-quality erosion).
 *
 * Formula (latest-first arrays, like every other annual.* field):
 *   For each of the last 3 fiscal years where BOTH annualOCF[i] AND
 *   annualNetIncome[i] are positive (sign mismatch is non-informative —
 *   a loss year with positive OCF is a recovery signal, not a quality
 *   signal, and shouldn't be averaged into the coverage ratio):
 *     coverage[i] = annualOCF[i] / annualNetIncome[i]
 *   Then:
 *     value = mean(coverage[])
 *
 * Pass: value >= 0.80 (3y mean coverage at or above the conventional floor).
 *
 * FAILURE MODE THIS DETECTS:
 *   A company inflating reported earnings through revenue-recognition policy
 *   or working-capital accumulation without underlying cash collection. The
 *   sister of sloan-ratio but with cleaner inputs: instead of asking "what
 *   fraction of assets is accruals" (Sloan), it asks "what fraction of
 *   reported earnings is actually cash" — a directly interpretable ratio
 *   that doesn't require asset-base normalization.
 *
 * Edge cases:
 *   - Fewer than 2 same-sign positive pairs → incomputable (need at least 2
 *     of 3 valid years; one is statistically meaningless for "consistently").
 *   - annualOCF missing entirely → incomputable (pattern-based, the field
 *     IS in the canonical schema — see pull-yahoo.js line ~496 — but is
 *     allowed to be absent on partial snapshots).
 *   - annualNetIncome[i] == 0 → excluded from the year set (would divide by
 *     zero; sign mismatch is the same logic).
 *   - Either field as envelope {value:N} or raw number → both supported.
 *
 * Anchor headcheck (per design spec — pattern-based, no ticker hardcodes):
 *   MSFT OCF/NI ~ 1.10 (PASS), AMZN ~ 1.40 (PASS, capital-heavy depreciation
 *   adds back to OCF), TSLA ~ 0.95 (PASS, narrowly).
 *
 * NOT in SCORE_WEIGHTS → DIAGNOSTIC-only → fixture-hash safe.
 */
const H = require('./_helpers.js');

const ID = 'operating-cashflow-coverage';
const LABEL = 'OCF/NI-Coverage (3y mean)';
const THRESHOLD = 0.80;
const THRESHOLD_OP = 'gte';
const MIN_PAIRS = 2;
const WINDOW = 3;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ocfArr = (stock.annual && stock.annual.annualOCF) || [];
  const niArr  = (stock.annual && stock.annual.annualNetIncome) || [];
  if (!Array.isArray(ocfArr) || !Array.isArray(niArr)) {
    return H.buildResult({
      computable: false,
      reason: 'annualOCF or annualNetIncome not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (ocfArr.length === 0) {
    return H.buildResult({
      computable: false,
      reason: 'no annualOCF data in snapshot',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const maxYears = Math.min(WINDOW, ocfArr.length, niArr.length);
  const ratios = [];
  const skipped = [];
  for (let i = 0; i < maxYears; i++) {
    const ocf = _unwrap(ocfArr[i]);
    const ni  = _unwrap(niArr[i]);
    if (ocf == null || ni == null) { skipped.push({ i, why: 'null' }); continue; }
    if (ocf <= 0 || ni <= 0)        { skipped.push({ i, why: 'sign' }); continue; }
    ratios.push(ocf / ni);
  }
  if (ratios.length < MIN_PAIRS) {
    return H.buildResult({
      computable: false,
      reason: 'only ' + ratios.length + ' same-sign positive (OCF,NI) pairs (need >= ' + MIN_PAIRS + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const mean = ratios.reduce((s, x) => s + x, 0) / ratios.length;

  return H.buildResult({
    value: mean,
    pass: mean >= THRESHOLD,
    computable: true,
    components: {
      meanCoverage: Math.round(mean * 10000) / 10000,
      n: ratios.length,
      ratios: ratios.map(r => Math.round(r * 10000) / 10000),
      skippedYears: skipped.length
    },
    reason: 'OCF/NI mean=' + mean.toFixed(2) + 'x (n=' + ratios.length +
            ', skipped=' + skipped.length + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'OCF deckt im 3y-Schnitt ≥ 80% des NI — Earnings-Quality-Floor (Sloan-Sister)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
