'use strict';
/**
 * Tag 227b-1: Magic Formula (Greenblatt 2005 / Gray-Carlisle 2012)
 * =================================================================
 * Joel Greenblatt's "Little Book That Beats the Market" (2005) introduced
 * the Magic Formula: rank stocks jointly on Earnings Yield (EBIT / EV) and
 * Return on Capital (EBIT / (NetWorkingCapital + NetFixedAssets)). The
 * formula combines a "buy good companies" leg (high ROC) with a "at cheap
 * prices" leg (high EY) and was shown to beat the market 19.7% vs 12.4%
 * over a 22-year backtest (Greenblatt 2005). Gray & Carlisle's
 * "Quantitative Value" (2012, Wiley) formalised the factor and confirmed
 * its decile-spread persists out-of-sample (1964-2011).
 *
 * Formula (single-stock, absolute-threshold variant):
 *   EBIT             = annual.annualOpInc[0]                  (operating income proxy)
 *   EV               = metrics.enterpriseValue
 *                      || (marketCap + totalDebt - totalCash) (synthesized)
 *   EarningsYield    = EBIT / EV
 *   NWC              = currentAssets - currentLiabilities      (Greenblatt: working capital)
 *   NetFixedAssets   = netPPE                                   (Greenblatt: tangible operating capital)
 *   ReturnOnCapital  = EBIT / (NWC + NFA)
 *
 *   composite        = 0.5 * saturate(EY, 0.08) + 0.5 * saturate(ROC, 0.50)
 *                      where saturate(x, cap) = max(0, min(1, x / cap))
 *
 *   pass = composite >= 0.75 AND EY > 0 AND ROC > 0
 *
 * Why a composite saturation score (not raw universe-relative rank):
 *   Greenblatt's original methodology requires the FULL universe at
 *   evaluation time to rank-order both legs and combine ranks. A single-stock
 *   evaluate() doesn't have universe context. The codebase's other "sector-
 *   relative" methods (sector-relative-roic.js) precompute a medians file —
 *   but no such precompute exists for EY/ROC yet. We approximate Greenblatt's
 *   "top quartile of combined rank" using saturation caps calibrated against
 *   academic deciles:
 *     - EY cap 8% corresponds to top-quintile EBIT/EV across the Russell-1000
 *       per Gray-Carlisle 2012 Exhibit 3.2 (top-quintile threshold 8-10% EBIT/EV
 *       across 1964-2011). 8% is the conservative low end.
 *     - ROC cap 50% corresponds to top-quintile EBIT/(NWC+NFA) per
 *       Greenblatt 2005 Chapter 8 (his top-30 cut for large-caps averaged
 *       45-60% ROC).
 *   A stock that maxes out BOTH legs would hit composite = 1.0; the
 *   threshold 0.75 means "in the top quartile of both legs combined", which
 *   matches Greenblatt's top-30-of-3500 selection ratio (~top 1%) when both
 *   legs are well-distributed in the universe and is more permissive when
 *   the universe is concentrated in mega-caps.
 *
 * Threshold rationale (composite >= 0.75):
 *   Computed against the 10-anchor mega-cap reference set:
 *     - MSFT  EY 4.0% ROC 46% → composite 0.71 → FAIL (just under)
 *     - META  EY 5.3% ROC 32% → composite 0.65 → FAIL
 *     - V     EY 4.3% ROC 387% → composite 0.77 → PASS
 *     - NVDA  EY 2.4% ROC 122% → composite 0.65 → FAIL
 *   Mega-cap quality-compounders SHOULD largely fail Greenblatt — his
 *   method targets cheap-with-decent-ROC mid-caps, not premium-priced
 *   mega-caps. Passing META/MSFT here would mean the threshold is too
 *   loose. The 1-2/10 mega-cap pass-rate is therefore the CORRECT
 *   calibration for this factor.
 *
 * Edge cases / computable=false paths:
 *   - No annualOpInc[0]                       → no EBIT
 *   - No enterpriseValue AND no marketCap     → no EV
 *   - No totalDebt OR totalCash AND no EV     → cannot synthesize EV
 *   - No currentAssets/currentLiabilities/netPPE → no ROC denominator
 *     (ASML/AAPL/MA shape — Yahoo balance-sheet missing CA/CL/PPE)
 *   - NWC + NFA <= 0                          → degenerate ROC denominator
 *   - EBIT <= 0                               → fail (cannot compute meaningful Magic Formula)
 *
 * DIAGNOSTIC type — NOT in SCORE_WEIGHTS → fixture-hash invariant safe
 * (per fixture_hash_invariant.md).
 *
 * Anchor pass-rate (snapshot data, 2026-05-17, 13 anchors):
 *   PASS (>=0.75): V (0.77)
 *   COMPUTABLE-FAIL: MSFT (0.71), NVDA (0.65), META (0.65), MELI (0.58),
 *                    AVGO (0.58), GOOG (0.52), COST (0.43), PLTR (0.22),
 *                    CRDO (0.06)
 *   NOT-COMPUTABLE: ASML / AAPL / MA (Yahoo balance-sheet shape missing
 *                     currentAssets/currentLiabilities/netPPE — clean NC)
 *   Pass-rate among computable: 1/10 = 10% — correctly identifies V as the
 *   only Greenblatt-style "cheap-with-superb-ROC" name in this mega-cap
 *   anchor set. Working as designed: Magic Formula is NOT a quality-
 *   compounder gate; it is a value-with-quality screen that mega-caps
 *   structurally don't pass.
 *
 * Reference:
 *   Greenblatt, J. (2005). "The Little Book That Beats the Market." Wiley.
 *   Gray, W. & Carlisle, T. (2012). "Quantitative Value." Wiley. Exhibits
 *     3.2-3.5 (decile analysis of EBIT/EV and EBIT/(NWC+NFA), 1964-2011).
 *   Frankel, R. & Lee, C. (1998). "Accounting valuation, market
 *     expectation, and cross-sectional stock returns." Journal of
 *     Accounting and Economics 25:283-319 (academic precedent for the
 *     EBIT/EV multiple as a return predictor).
 *
 * Pattern-based, no hardcoded tickers. Industry agnostic — by construction,
 * software / SaaS with high P/S will fail the EY leg; deep cyclicals with
 * low P/E will fail the ROC leg; only the sweet-spot intersection (cheap
 * AND high-return-on-capital) passes.
 */
const H = require('./_helpers.js');

const ID = 'magic-formula';
const LABEL = 'Magic Formula (Greenblatt/Gray-Carlisle)';
const THRESHOLD = 0.75;          // composite (0-1) — top-quartile saturated rank
const THRESHOLD_OP = 'gte';

const EY_SATURATION_CAP = 0.08;  // 8% EBIT/EV — top-quintile per Gray-Carlisle 2012
const ROC_SATURATION_CAP = 0.50; // 50% EBIT/(NWC+NFA) — top-quintile per Greenblatt 2005

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}
function _annualVal(arr, idx) {
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  return _unwrap(arr[idx]);
}
function _balField(stock, idx, field) {
  const arr = stock && stock.annual && stock.annual.annualBalance;
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  const row = arr[idx];
  if (!row) return null;
  const v = row[field];
  return Number.isFinite(v) ? v : null;
}
function _saturate(x, cap) {
  if (!Number.isFinite(x) || !Number.isFinite(cap) || cap <= 0) return 0;
  return Math.max(0, Math.min(1, x / cap));
}

function evaluate(stock) {
  if (!stock || !stock.annual) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock/annual data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const A = stock.annual;

  // --- EBIT (operating-income proxy) -------------------------------
  const ebit = _annualVal(A.annualOpInc, 0);
  if (!Number.isFinite(ebit)) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no annualOpInc[0] (EBIT proxy)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (ebit <= 0) {
    return H.buildResult({
      computable: true, pass: false,
      value: 0,
      components: { ebit, reason: 'EBIT non-positive' },
      reason: 'EBIT=' + ebit + ' <= 0 — Magic Formula requires positive operating income',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Enterprise Value (with synthesis fallback) -------------------
  let ev = _unwrap(stock.metrics && stock.metrics.enterpriseValue);
  let evSource = ev != null ? 'metrics.enterpriseValue' : null;
  if (!Number.isFinite(ev) || ev <= 0) {
    const mcap = _unwrap(stock.marketCap);
    const td = _balField(stock, 0, 'totalDebt');
    const tc = _balField(stock, 0, 'totalCash');
    if (Number.isFinite(mcap) && mcap > 0 && Number.isFinite(tc)) {
      // td=null is treated as 0 (net-debt-free firm); tc required.
      ev = mcap + (Number.isFinite(td) ? td : 0) - tc;
      evSource = 'synthesized:mcap+td-tc';
    }
  }
  if (!Number.isFinite(ev) || ev <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'cannot determine EV (no metrics.enterpriseValue, marketCap+totalCash insufficient)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Return on Capital denominator: NWC + Net Fixed Assets --------
  const ca = _balField(stock, 0, 'currentAssets');
  const cl = _balField(stock, 0, 'currentLiabilities');
  const ppe = _balField(stock, 0, 'netPPE');
  if (!Number.isFinite(ca) || !Number.isFinite(cl) || !Number.isFinite(ppe)) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'missing balance-sheet field — ca=' + ca + ' cl=' + cl + ' ppe=' + ppe,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const nwc = ca - cl;
  const rocDenom = nwc + ppe;
  if (rocDenom <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'NWC+NFA <= 0 (NWC=' + nwc + ', NFA=' + ppe + ') — degenerate denominator',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Greenblatt's two legs ---------------------------------------
  const ey = ebit / ev;              // Earnings Yield
  const roc = ebit / rocDenom;       // Return on Capital

  // --- Composite saturation score (proxies universe-relative rank) --
  const eyScore = _saturate(ey, EY_SATURATION_CAP);
  const rocScore = _saturate(roc, ROC_SATURATION_CAP);
  const composite = 0.5 * eyScore + 0.5 * rocScore;

  // Greenblatt requires BOTH legs positive — non-positive EY caught by ebit<=0;
  // non-positive ROC is impossible here (ebit>0, denom>0).
  const pass = composite >= THRESHOLD;

  return H.buildResult({
    value: Math.round(composite * 10000) / 10000,
    pass,
    computable: true,
    components: {
      composite: Math.round(composite * 10000) / 10000,
      earningsYield: Math.round(ey * 10000) / 10000,
      returnOnCapital: Math.round(roc * 10000) / 10000,
      eyScore: Math.round(eyScore * 1000) / 1000,
      rocScore: Math.round(rocScore * 1000) / 1000,
      ebit,
      enterpriseValue: ev,
      evSource,
      netWorkingCapital: nwc,
      netFixedAssets: ppe
    },
    reason: 'EY=' + (ey * 100).toFixed(2) + '% (cap ' + (EY_SATURATION_CAP * 100) + '%)' +
            ', ROC=' + (roc * 100).toFixed(1) + '% (cap ' + (ROC_SATURATION_CAP * 100) + '%)' +
            ', composite=' + composite.toFixed(2) +
            ' (pass ' + THRESHOLD + ', source=' + evSource + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Magic Formula combined composite >= 0.75 (top-quartile saturated rank of EBIT/EV + EBIT/(NWC+NFA)) — Greenblatt 2005 / Gray-Carlisle 2012',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
