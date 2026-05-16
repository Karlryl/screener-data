'use strict';
/**
 * Tag 209c: Capital-Allocation-Quality (Mauboussin Composite)
 * ===========================================================
 * Composite DIAGNOSTIC method that scores the *consistency* of a
 * company's capital-allocation decisions across four dimensions:
 *   1. Buybacks      — is the float shrinking?
 *   2. Leverage      — is debt prudent vs. earnings power?
 *   3. Reinvestment  — is capex stable/growing (real reinvestment)?
 *   4. Dilution      — is SBC bounded as a % of revenue?
 *
 * MAUBOUSSIN FRAMEWORK
 * --------------------
 * Michael Mauboussin (Morgan Stanley Counterpoint Global; "ROIC and
 * Intangible Assets", 2024; "Capital Allocation", 2014/2015) treats
 * CFO deployment as ONE decision, not four:
 *     CFO → { capex, M&A, debt-repayment, buybacks, dividends, SBC }
 * A quality compounder allocates in a sensible pecking order:
 *   reinvest first (at high ROIC) → pay down debt → opportunistic
 *   buybacks at low multiples → dividends. SBC should be a real
 *   compensation cost, not a dilution lever.
 *
 * Our pipeline already measures each dimension in isolation, but
 * the silos miss INTERNAL INCONSISTENCY — e.g. a stock that looks
 * like a "buyback champion" (high buyback-yield) while
 * simultaneously levering up (high net-debt-ebitda) is funding
 * returns with debt, which Mauboussin flags as value-destructive
 * when ROIC < WACC.
 *
 * COMPOSITE — 4 BINARY SUB-CHECKS (25 points each, max 100)
 * ---------------------------------------------------------
 *   +25  buyback-yield      >= 1%       (positive net buybacks)
 *   +25  net-debt-ebitda    <= 2.0      (prudent leverage)
 *   +25  capex-trend        passes      (real reinvestment — stable or
 *                                        growing; trend multiplier <= 1.5
 *                                        means capex/rev not exploding)
 *   +25  sbc-revenue        <= 5%       (dilution discipline; tighter
 *                                        than the 15% method threshold —
 *                                        we want elite-tier composers)
 *
 * PASS:  score >= 75  (3 of 4 dimensions clear at minimum)
 *
 * INCOMPUTABLE HANDLING
 * ---------------------
 * Each sub-check is INDEPENDENTLY computable. If a sub-method returns
 * computable:false, we SKIP that dimension and SCALE the score:
 *     score = sum(earned) * (4 / numComputable)
 * This keeps the 0..100 range intact when only 2 or 3 dimensions are
 * observable (e.g. ALAB has no buyback history yet). If ZERO dimensions
 * are computable, the composite itself returns computable:false.
 *
 * COMPONENTS RETURNED
 * -------------------
 *   { score, buybackContribution, debtContribution, capexContribution,
 *     sbcContribution, computableDimensions, reason }
 *
 * Each contribution is 25 (passed), 0 (failed), or null (incomputable).
 *
 * REGISTRY
 * --------
 * - methodType: DIAGNOSTIC
 * - defaultActive: true
 * - NOT in SCORE_WEIGHTS (composite layer, no aggregator weight)
 * - Per the fixture-hash invariant (memory/fixture_hash_invariant.md),
 *   DIAGNOSTIC additions that are NOT in SCORE_WEIGHTS are hash-safe by
 *   construction.
 *
 * SOURCES
 * -------
 * - Mauboussin, "Capital Allocation" (Morgan Stanley Counterpoint, 2014):
 *   https://www.morganstanley.com/im/publication/insights/articles/article_capitalallocation.pdf
 * - Mauboussin, "Capital Allocation Updated" (Cove Street, 2015):
 *   https://covestreetcapital.com/wp-content/uploads/2015/07/Mauboussin-June-2015.pdf
 * - Mauboussin, "ROIC and Intangible Assets" (Morgan Stanley Counterpoint, 2024):
 *   capital-allocation treated as one portfolio-level decision; ROIC
 *   relative to cost of capital governs whether buybacks/M&A create value.
 */
const H = require('./_helpers.js');

// Underlying methods — required directly so this method composes their
// outputs at evaluate-time without depending on a runner-level allResults
// plumbing change. Each dependency is its own module already loaded by the
// runner, so re-requiring is cheap (Node module cache).
const buybackYield = require('./buyback-yield.js');
const netDebtEbitda = require('./net-debt-ebitda.js');
const capexTrend = require('./capex-trend.js');
const sbcRevenue = require('./sbc-revenue.js');

const ID = 'capital-allocation-quality';
const LABEL = 'Capital-Allocation Quality (Mauboussin)';
const THRESHOLD = 75;
const THRESHOLD_OP = 'gte';

// Composite-internal sub-thresholds (tighter than the underlying methods'
// own pass thresholds — we want ELITE allocation, not just "not failing").
const BUYBACK_MIN_PCT   = 1.0;   // buyback-yield returns % units
const LEVERAGE_MAX      = 2.0;   // net-debt-ebitda returns ratio
const SBC_MAX_FRAC      = 0.05;  // sbc-revenue returns fraction (0.05 = 5%)
// capex-trend has no scalar threshold here — we accept its native pass=true
// (which means capex/rev growth multiplier <= 1.5 over 3y = stable or only
// modestly increasing reinvestment, not an out-of-control capex blow-out).

function _safeEvaluate(method, stock) {
  // Defensive: a thrown exception in a sub-method must not break the
  // composite — surface it as computable:false for that dimension.
  try { return method.evaluate(stock); }
  catch (e) {
    return H.buildResult({
      computable: false,
      reason: 'sub-method ' + method.id + ' threw: ' + (e && e.message || e),
      threshold: method.threshold, thresholdOp: method.thresholdOp
    });
  }
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Run each sub-method ---
  const buybackR  = _safeEvaluate(buybackYield, stock);
  const debtR     = _safeEvaluate(netDebtEbitda, stock);
  const capexR    = _safeEvaluate(capexTrend, stock);
  const sbcR      = _safeEvaluate(sbcRevenue, stock);

  // --- Score each dimension (null = incomputable, contributes 0 to sum
  //     but reduces the divisor so the final score scales correctly) ---
  let buybackContribution  = null;
  let debtContribution     = null;
  let capexContribution    = null;
  let sbcContribution      = null;

  if (buybackR.computable && Number.isFinite(buybackR.value)) {
    buybackContribution = (buybackR.value >= BUYBACK_MIN_PCT) ? 25 : 0;
  }
  if (debtR.computable && Number.isFinite(debtR.value)) {
    debtContribution = (debtR.value <= LEVERAGE_MAX) ? 25 : 0;
  }
  // capex-trend: native pass means trend multiplier <= 1.5 (stable/modest).
  // We treat its boolean pass as the dimension signal — its `value` is a
  // ratio, not directly interpretable as "stable vs. increasing".
  if (capexR.computable) {
    capexContribution = capexR.pass ? 25 : 0;
  }
  if (sbcR.computable && Number.isFinite(sbcR.value)) {
    sbcContribution = (sbcR.value <= SBC_MAX_FRAC) ? 25 : 0;
  }

  const contributions = [buybackContribution, debtContribution, capexContribution, sbcContribution];
  const computableDimensions = contributions.filter(c => c !== null).length;

  if (computableDimensions === 0) {
    return H.buildResult({
      computable: false,
      reason: 'no sub-method computable (buyback=' + buybackR.computable +
              ', debt=' + debtR.computable + ', capex=' + capexR.computable +
              ', sbc=' + sbcR.computable + ')',
      components: {
        buybackContribution, debtContribution, capexContribution, sbcContribution,
        computableDimensions
      },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Sum earned points, then scale to 0..100 based on dimensions observed.
  // E.g. 2/4 dimensions computable, both pass: 50 raw → 50 * (4/2) = 100.
  // E.g. 3/4 dimensions computable, 2 pass: 50 raw → 50 * (4/3) ≈ 66.67.
  const earned = contributions.reduce((s, c) => s + (c || 0), 0);
  const score = Math.round((earned * (4 / computableDimensions)) * 10) / 10;
  const pass = score >= THRESHOLD;

  // Human-readable reason. Show pass/fail per dimension; mark skipped.
  const flag = (c, label) => {
    if (c === null) return label + '=skip';
    return label + '=' + (c === 25 ? 'pass' : 'fail');
  };
  const reason = 'score=' + score + '/100 [' +
    flag(buybackContribution, 'buyback') + ', ' +
    flag(debtContribution,    'debt')    + ', ' +
    flag(capexContribution,   'capex')   + ', ' +
    flag(sbcContribution,     'sbc')     + ']' +
    (computableDimensions < 4 ? ' (' + computableDimensions + '/4 dims observed, scaled)' : '');

  return H.buildResult({
    value: score,
    pass,
    computable: true,
    components: {
      score,
      buybackContribution,
      debtContribution,
      capexContribution,
      sbcContribution,
      computableDimensions,
      // Surface the raw sub-method values for downstream diagnostics — keeps
      // this composite useful for drill-down without re-running sub-methods.
      buybackYieldPct: buybackR.computable ? buybackR.value : null,
      netDebtEbitdaRatio: debtR.computable ? debtR.value : null,
      capexTrendPass: capexR.computable ? capexR.pass : null,
      sbcRevenueFrac: sbcR.computable ? sbcR.value : null,
      reason
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Mauboussin Capital-Allocation-Quality Composite: buybacks + leverage + capex + SBC (0-100, pass ≥75)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'score',
  evaluate
};
