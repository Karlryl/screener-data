'use strict';
/**
 * Tag 214b: Capex-vs-SBC Quality (real-reinvestment-to-dilution ratio)
 * =====================================================================
 * Compares CASH reinvestment (capex = real productive assets) with PAPER
 * compensation (SBC = stock-based comp = dilution). A healthy compounder
 * reinvests significantly MORE than it dilutes; a "cash flow optical"
 * company (looks profitable on FCF basis but dilutes aggressively to
 * pay employees) shows the inverse ratio.
 *
 * Mauboussin (Counterpoint, 2024) flags this as a hidden quality
 * indicator: many "SaaS compounders" have |Capex| < SBC, meaning the
 * business prints stock to pay payroll while plowing very little into
 * physical-asset reinvestment. That's a legitimate business model BUT
 * the GAAP FCF measure systematically overstates economic earnings
 * unless you subtract SBC (FCF − SBC, or "true FCF").
 *
 * This method gives a single 3y-averaged signal: ratio = |Capex| / SBC.
 *
 * Formula (latest-first arrays, last 3 years):
 *   For each year i (need annualCapex[i], annualSBC[i], both > 0 abs):
 *     ratio_i = |annualCapex[i]| / |annualSBC[i]|
 *   score = arithmetic mean of valid ratio_i over 3 years
 *
 * Pass: score >= 1.0 (capex equals or exceeds SBC = healthy real-asset
 *       reinvestment dominance). Threshold deliberately at the equality
 *       boundary — below 1.0 means SBC > Capex which is the optical
 *       FCF pattern Mauboussin flags.
 *
 * Failure modes this catches:
 *   - SaaS compounders that dilute >0.5% / year and dress it as FCF
 *   - Mature firms cutting capex while inflating SBC (boost reported
 *     FCF, paper over deteriorating capital intensity)
 *   - Pre-IPO firms where SBC is the dominant cost (legit but flagged
 *     as data signal)
 *
 * Not computable:
 *   - <2 valid years (both fields populated and positive abs)
 *   - All SBC = 0 (no-stock-comp firms — ratio undefined, but this is
 *     PASS-equivalent territory in spirit; we emit incomputable rather
 *     than fake a pass)
 *
 * DIAGNOSTIC + defaultActive:true + NOT in SCORE_WEIGHTS — fixture-hash
 * safe by construction.
 *
 * Citations:
 *   - Mauboussin & Callahan (Morgan Stanley Counterpoint, 2024) "ROIC
 *     and Intangible Assets" notes that SBC-heavy firms understate true
 *     dilution in FCF.
 *   - "Free Cash Flow ex-SBC" practitioners (Saber, Permanent Equity,
 *     Acquirer's Multiple) all consistently subtract SBC when
 *     evaluating real economic earnings.
 */
const H = require('./_helpers.js');

const ID = 'capex-vs-sbc-quality';
const LABEL = 'Capex / SBC (3y avg ratio)';
const THRESHOLD = 1.0;
const THRESHOLD_OP = 'gte';
const MIN_YEARS = 2;
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
  const capexArr = (stock.annual && stock.annual.annualCapex) || [];
  const sbcArr   = (stock.annual && stock.annual.annualSBC)   || [];
  if (!Array.isArray(capexArr) || !Array.isArray(sbcArr)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'annualCapex or annualSBC not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const maxYears = Math.min(WINDOW, capexArr.length, sbcArr.length);
  const ratios = [];
  for (let i = 0; i < maxYears; i++) {
    const cx  = _unwrap(capexArr[i]);
    const sbc = _unwrap(sbcArr[i]);
    if (cx == null || sbc == null) continue;
    const acx  = Math.abs(cx);
    const asbc = Math.abs(sbc);
    if (acx === 0 || asbc === 0) continue;     // ratio undefined
    ratios.push(acx / asbc);
  }

  if (ratios.length < MIN_YEARS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + ratios.length + ' valid (Capex>0, SBC>0) years (need >= ' + MIN_YEARS + ')',
      components: { yearsUsed: ratios.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Average across observed years (arithmetic mean — geometric would
  // over-penalize 1y dips; this signal is about "general profile" not
  // "any year fails").
  const score = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const pass = score >= THRESHOLD;
  const reason = 'capex/SBC=' + score.toFixed(2) +
                 ' (' + ratios.length + 'y avg' +
                 ', latest=' + ratios[0].toFixed(2) + ')' +
                 (pass ? ' [real reinvestment dominant]'
                       : ' [SBC dilution > capex — true FCF understated]');

  return H.buildResult({
    value: score,
    pass,
    computable: true,
    components: {
      score,
      ratios,
      yearsUsed: ratios.length,
      latestRatio: ratios[0]
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Capex / SBC (3y avg) >= 1.0 — real asset reinvestment dominates paper compensation (Mauboussin)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
