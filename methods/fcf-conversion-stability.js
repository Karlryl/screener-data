'use strict';
/**
 * Tag 211e: FCF-Conversion-Stability (5y geometric mean of FCF/NetIncome)
 * ========================================================================
 * RESEARCH BASIS:
 *   Damodaran on cash quality and Mauboussin on persistence of cash returns.
 *   The FCF/NetIncome conversion ratio measures how much of reported earnings
 *   actually shows up as distributable cash. A 5y GEOMETRIC mean (not
 *   arithmetic — geometric penalizes outliers symmetrically and resists
 *   one-blow-out-year overstatement) is the canonical "persistence" measure
 *   for cash conversion.
 *
 * Distinct from existing methods:
 *   - sloan-ratio:       single-year accruals snapshot (asset-normalized).
 *   - operating-cashflow-coverage: 3y arithmetic mean of OCF/NI (cleaner-
 *     coverage version of Sloan). Catches *chronic drift* in NI vs OCF.
 *   - fcf-conversion-stability: 5y GEOMETRIC mean of FCF/NI — the persistence
 *     view. Catches companies whose accounting earnings systematically run
 *     ahead of cash AND whose conversion is non-recurring. Where OCF/NI asks
 *     "are operating earnings turning into cash?", FCF/NI asks the stricter
 *     "are operating earnings turning into FREE cash after capex?" — the
 *     distributable bottom line.
 *
 * Formula (latest-first arrays, like every other annual.* field):
 *   For each of the last 5 fiscal years where annualNetIncome[i] > 0:
 *     ratio[i] = annualFCF[i] / annualNetIncome[i]
 *     (Negative-ratio years — i.e. negative FCF against positive NI — are
 *      floored at 0.01 before entering the geometric mean. This treats them
 *      as a very strong fail signal but keeps the geometric mean defined.)
 *   Skip years where NI <= 0 (the ratio inverts sign and becomes meaningless
 *   for the "earnings converting to cash" interpretation).
 *   Require at least 3 valid ratios across the 5y window. A company
 *   unprofitable for 3+ of 5 years is *incomputable* under this method
 *   (correctly — there is no NI baseline to convert against), not failing.
 *
 *   Geometric mean = (prod(ratio_i))^(1/n)
 *
 * Pass: value >= 0.85 (5y geometric-mean conversion >= 85%). High-quality
 *       cash generators (Visa/MasterCard/MSFT/ADP) routinely exceed 1.0 here;
 *       0.85 is a generous-but-discriminating floor.
 *
 * FAILURE MODE THIS DETECTS:
 *   1. Companies whose earnings persistently run ahead of cash (accrual drift
 *      across multiple years). Single-year sloan-ratio misses this if the
 *      gap stays under the asset-normalized threshold each year — the
 *      multi-year geometric mean compounds the gap.
 *   2. Companies with one blowout FCF year masking sustained weak conversion.
 *      Arithmetic mean is fooled by such years; geometric mean is not.
 *
 * Edge cases / why it might be incomputable:
 *   - Fewer than 3 positive-NI years in the last 5 → incomputable. A company
 *     unprofitable that often is not a "low-quality" candidate for this lens;
 *     it's outside the lens's domain (use loss-magnitude-guard / profitability-
 *     state instead).
 *   - Missing annualFCF or annualNetIncome arrays → incomputable with
 *     structured reason.
 *   - Both FCF and NI in envelope-{value:N} or raw-number form supported.
 *
 * Anchor headcheck (pattern-based, no ticker hardcodes):
 *   - MSFT FCF/NI typically 0.95-1.10 → PASS.
 *   - GOOG ~0.85-1.05 → PASS (borderline some years).
 *   - Capex-heavy growth (TSLA, AMZN circa 2020): FCF/NI < 0.5 → FAIL.
 *   - Pre-profit (PLTR early years, IONQ): NI <= 0 most years → NOT COMPUTABLE.
 *
 * NOT in SCORE_WEIGHTS → DIAGNOSTIC-only → fixture-hash safe by construction.
 */
const H = require('./_helpers.js');

const ID = 'fcf-conversion-stability';
const LABEL = 'FCF-Conversion-Stability (5y geo-mean FCF/NI)';
// Tag 215b (audit HIGH-2 fix): MSFT (0.81) and GOOG (0.79) were FAILING
// even though docs and intent say they should PASS as quality compounders.
// Two fixes:
//   1. Lower threshold from 0.85 → 0.75. 0.85 was too tight for normal
//      capex-deduction (FCF = OCF − Capex; even MSFT's Azure capex pulls FCF
//      ~15% below NI). The textbook "FCF should equal NI long-term" is true
//      ONLY at steady state with zero growth-capex; growing compounders
//      undershoot legitimately.
//   2. Cap individual ratios at 2.0 before the geomean. MELI's 4.69 (one-year
//      blowout from working-capital seasonality) was pulling its 5y geomean
//      above the threshold artificially. The cap normalizes upper-tail
//      outliers WITHOUT discarding the signal that some years over-convert.
const THRESHOLD = 0.75;
const THRESHOLD_OP = 'gte';
const MIN_RATIOS = 3;
const WINDOW = 5;
const NEG_RATIO_FLOOR = 0.01; // floor for negative-ratio years entering geomean
const POS_RATIO_CAP = 2.0;    // cap upper-tail outliers (Tag 215b)

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
  const fcfArr = (stock.annual && stock.annual.annualFCF) || [];
  const niArr  = (stock.annual && stock.annual.annualNetIncome) || [];
  if (!Array.isArray(fcfArr) || !Array.isArray(niArr)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'annualFCF or annualNetIncome not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (fcfArr.length === 0 || niArr.length === 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'missing annualFCF or annualNetIncome',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const maxYears = Math.min(WINDOW, fcfArr.length, niArr.length);
  const ratios = [];
  const rawRatios = []; // un-floored, for component reporting
  let lossYears = 0;
  for (let i = 0; i < maxYears; i++) {
    const fcf = _unwrap(fcfArr[i]);
    const ni  = _unwrap(niArr[i]);
    if (fcf == null || ni == null) continue;
    if (ni <= 0) { lossYears++; continue; }
    const r = fcf / ni;
    rawRatios.push(r);
    // Tag 215b: clamp to [NEG_RATIO_FLOOR, POS_RATIO_CAP]. Negative-ratio floor
    // keeps the geometric mean well-defined; positive cap suppresses one-year
    // outliers (working-capital releases, one-time tax refunds) that would
    // otherwise pull the geomean up artificially.
    const clamped = r <= 0 ? NEG_RATIO_FLOOR
                  : r > POS_RATIO_CAP ? POS_RATIO_CAP
                  : r;
    ratios.push(clamped);
  }

  if (ratios.length < MIN_RATIOS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + ratios.length + ' valid (FCF, NI>0) ratios in last ' + maxYears
            + 'y (need >= ' + MIN_RATIOS + '; lossYears=' + lossYears + ')',
      components: { validYears: ratios.length, lossYears },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Geometric mean = (prod(ratios))^(1/n). All entries floored > 0 so log-form
  // is safe; we use the log-form to avoid overflow on large product chains.
  const sumLog = ratios.reduce((s, r) => s + Math.log(r), 0);
  const geomean = Math.exp(sumLog / ratios.length);

  if (!Number.isFinite(geomean)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'geometric mean not finite (' + geomean + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  return H.buildResult({
    value: geomean,
    pass: geomean >= THRESHOLD,
    computable: true,
    components: {
      geometricMean: Math.round(geomean * 10000) / 10000,
      validYears: ratios.length,
      lossYears,
      ratios: rawRatios.map(r => Math.round(r * 10000) / 10000),
      // Tag 225e-2d (audit LOW-2): parallel-array comparison relies on
      // rawRatios.push and ratios.push being lockstep within the same loop
      // body above (lines 130-139). DO NOT decouple the two pushes without
      // switching to an explicit `floored:true` flag carried inside each entry.
      negativeRatioFloorUsed: ratios.some((r, i) => rawRatios[i] !== r),
      thresholds: { geomeanFloor: THRESHOLD, negRatioFloor: NEG_RATIO_FLOOR }
    },
    reason: 'FCF/NI geo-mean=' + geomean.toFixed(2) + 'x over n=' + ratios.length
          + 'y (floor >=' + THRESHOLD + ', lossYears=' + lossYears + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'FCF/NetIncome 5y geometric mean >= 0.85 — cash-conversion persistence (Damodaran/Mauboussin)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
