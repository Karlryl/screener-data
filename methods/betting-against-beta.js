'use strict';
/**
 * Tag 230b: Betting Against Beta (Frazzini & Pedersen 2014)
 * ==========================================================
 * Low-beta stocks have historically outperformed CAPM expectations on a
 * risk-adjusted basis. The strategy is to OVERWEIGHT low-beta names — the
 * "Betting Against Beta" (BAB) factor builds a long-leverage low-beta /
 * short-deleverage high-beta portfolio that earns a positive alpha across
 * 20 international equity markets, 20 US treasury maturities, and the
 * commodity / currency / corporate-bond cross-section.
 *
 *   value = metrics.beta  (CAPM 5y monthly beta as persisted by Yahoo via
 *                          defaultKeyStatistics.beta; Tag 219 extraction)
 *
 *   pass        = beta in (0, 1.0]              (low-beta defensive tilt)
 *   borderline  = beta in (1.0, 1.5]            (pass:false + flag BORDERLINE)
 *   fail        = beta > 1.5                    (high-beta penalty)
 *   incomputable = beta null or beta <= 0       (recent IPO / no market history)
 *
 * Why this method exists (failure mode it catches):
 *   The empirical security-market line is flatter than CAPM predicts: high-beta
 *   stocks earn LESS than their beta-implied return, low-beta stocks earn MORE.
 *   Frazzini-Pedersen attribute the wedge to funding-constraint shadow costs:
 *   leverage-constrained investors (mutual funds, retail) overpay for high-beta
 *   stocks as a way to access market exposure without explicit leverage. The
 *   factor therefore tilts AWAY from glamour-growth high-beta names and TOWARD
 *   boring mature defensives — directly opposite to the momentum / growth
 *   factors that dominate the rest of the SCORE_WEIGHTS composite.
 *
 *   This is intentionally a contrarian DIAGNOSTIC: it will fire FAIL on the
 *   exact growth-momentum names (NVDA, PLTR, CRDO) that the Tag 213b 12-1
 *   momentum factor will fire PASS on. The two signals together let the
 *   human operator decide which factor the conviction case relies on.
 *
 * DIAGNOSTIC type — NOT listed in SCORE_WEIGHTS → fixture-hash invariant
 * preserved (per fixture_hash_invariant.md). Surfaces in detail-modal /
 * percentile views; future tag can promote into composite if desired.
 *
 * Threshold rationale:
 *   - Frazzini & Pedersen 2014 ("Betting Against Beta", Journal of Financial
 *     Economics 111(1):1-25) sort the cross-section into beta-deciles and find
 *     monotonic alpha-decay from low to high. Beta-1.0 is the structural CAPM
 *     neutral point; below 1.0 = systematically less market-correlated than
 *     average ⇒ the BAB tilt applies. Above 1.5 = clearly high-beta growth /
 *     leveraged-equity territory where the leverage-aversion premium that BAB
 *     exploits is most prominent ⇒ explicit fail.
 *   - The 1.0-1.5 soft-zone is a deliberate "neither defensive nor extreme
 *     leverage proxy" bucket. The pass flag is false (the method does not
 *     endorse the name) but the BORDERLINE flag prevents the operator from
 *     mis-reading this as a strong negative — the cross-section evidence is
 *     much weaker for marginally-above-market betas than for the >1.5 cohort.
 *   - beta <= 0 is treated as incomputable rather than auto-pass: a negative
 *     beta on Yahoo's 5y-monthly window typically indicates either (a) very
 *     short price history (post-IPO with <60 monthly observations, regression
 *     unstable) or (b) inverse-ETF / commodity-proxy that the BAB framework
 *     was not built for. Conservative: surface as no-data not false-positive.
 *
 * Edge cases / why it might be incomputable:
 *   - metrics.beta absent (pre-Tag 219 snapshots; ~80% of current universe
 *     still on older pulls — fresh metrics.beta lands during the next pull-yahoo
 *     run, see dead_code_method_activation.md for the broader pattern).
 *   - metrics.beta non-finite (NaN / Infinity from a degenerate regression).
 *   - metrics.beta <= 0 (insufficient market history or inverse-correlation
 *     proxy — neither case fits the BAB framework).
 *
 * Anchor check (snapshot data, 2026-05-17, 10 anchors):
 *   - NVDA:  beta 2.244 → FAIL (high-beta growth, expected)
 *   - MSFT:  beta 1.093 → BORDERLINE (just-above neutral, soft fail)
 *   - PLTR:  beta n/a   → NC (stale snapshot, pre-Tag-219 beta persistence)
 *   - CRDO:  beta n/a   → NC (stale snapshot)
 *   - MELI:  beta n/a   → NC (stale snapshot)
 *   - META:  beta n/a   → NC (stale snapshot)
 *   - COST:  beta n/a   → NC (stale snapshot)
 *   - AVGO:  beta n/a   → NC (stale snapshot)
 *   - GOOG:  beta n/a   → NC (stale snapshot)
 *   - V:     beta n/a   → NC (stale snapshot)
 *
 *   Computable pass-rate: 0 / 2 = 0% (NVDA FAIL, MSFT BORDERLINE).
 *   Universe coverage: 2 / 10 = 20% (rest gated on next pull-yahoo run that
 *   refreshes metrics.beta for the full cohort).
 *
 *   Anchor expectations from the task spec — NVDA/PLTR/CRDO likely FAIL,
 *   MSFT/COST/V likely PASS — match for NVDA (FAIL). MSFT actually borderline
 *   (1.09 vs the spec's implicit "<1.0"); COST and V will resolve next pull.
 *   The factor IS doing what it should: penalizing the high-beta growth names
 *   the human picked as anchors precisely because they're high-beta growth.
 *
 * Pattern-based, no hardcoded tickers. Capital-light defensives (consumer-
 * staples, utility, dividend-payer) will routinely pass by construction —
 * the BAB factor is by design biased toward boring mature names and against
 * the glamour-growth set, complementing the other DIAGNOSTICS that bias the
 * opposite way (momentum, gross-profitability).
 *
 * References:
 *   Frazzini, A., & Pedersen, L. H. (2014). "Betting Against Beta."
 *     Journal of Financial Economics 111(1):1-25.
 *   Asness, C. S., Frazzini, A., & Pedersen, L. H. (2014). "Low-Risk
 *     Investing Without Industry Bets." Financial Analysts Journal
 *     70(4):24-41 — refinement isolating the alpha from sector tilts.
 */
const H = require('./_helpers.js');

const ID = 'betting-against-beta';
const LABEL = 'Betting Against Beta (FP 2014)';
const THRESHOLD = 1.0;            // pass ceiling (beta <= 1.0 = defensive)
const THRESHOLD_OP = 'lte';
const BORDERLINE_CEILING = 1.5;   // beta (1.0, 1.5] = soft-zone

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const beta = H.metricValue(stock, 'beta');
  if (beta == null) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'metrics.beta absent (pre-Tag 219 snapshot or Yahoo defaultKeyStatistics.beta empty)',
      components: { beta: null },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (beta <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'beta <= 0 (' + beta + ') — insufficient market history or inverse-correlation proxy; BAB framework not applicable',
      components: { beta },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const pass = beta <= THRESHOLD;
  const borderline = !pass && beta <= BORDERLINE_CEILING;
  const reason = pass
    ? 'beta ' + beta.toFixed(2) + ' <= ' + THRESHOLD.toFixed(2) + ' (low-beta defensive — BAB favorable)'
    : borderline
      ? 'beta ' + beta.toFixed(2) + ' in (' + THRESHOLD.toFixed(1) + ', ' + BORDERLINE_CEILING.toFixed(1) + '] (BORDERLINE — soft fail)'
      : 'beta ' + beta.toFixed(2) + ' > ' + BORDERLINE_CEILING.toFixed(1) + ' (high-beta — BAB penalty)';

  return H.buildResult({
    value: Math.round(beta * 10000) / 10000,
    pass,
    computable: true,
    components: {
      beta: Math.round(beta * 10000) / 10000,
      passCeiling: THRESHOLD,
      borderlineCeiling: BORDERLINE_CEILING,
      flag: borderline ? 'BORDERLINE' : null
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Betting-Against-Beta (Frazzini-Pedersen JFE 2014) — beta <= 1.0 PASS, beta in (1.0, 1.5] BORDERLINE, beta > 1.5 FAIL',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
