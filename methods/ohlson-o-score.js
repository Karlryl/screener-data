'use strict';
/**
 * Tag 210a: Ohlson O-Score (logit bankruptcy probability)
 * =======================================================
 * 9-variable logit bankruptcy-probability model. Sibling to Altman Z-Score
 * (discriminant) and Beneish M-Score (manipulation): Ohlson uses a logistic
 * regression on accounting fundamentals to produce a true probability of
 * bankruptcy. Empirically catches a *different* failure profile than Altman
 * (services, low-leverage failures), so the pair reduces single-model
 * false-negatives.
 *
 * Formula (Ohlson, 1980, Journal of Accounting Research):
 *   O = -1.32 - 0.407*log(TA / GNP_price_index)
 *           + 6.03*(TL/TA) - 1.43*(WC/TA)
 *           + 0.0757*(CL/CA) - 1.72*X
 *           - 2.37*(NI/TA) - 1.83*(FFO/TL)
 *           + 0.285*Y - 0.521*((NI_t - NI_{t-1}) / (|NI_t| + |NI_{t-1}|))
 *
 * Where:
 *   X = 1 if TL > TA else 0  (insolvency indicator)
 *   Y = 1 if NI < 0 in BOTH t and t-1 else 0  (two-year-loss indicator)
 *   FFO = Funds From Operations ≈ Operating Cash Flow (annualOCF when present)
 *   GNP_price_index = constant 1.0 (2010 base) — see "GNP simplification" note.
 *
 * Bankruptcy probability:
 *   P(bankruptcy) = 1 / (1 + exp(-O))
 *
 * Pass threshold:  P < 0.5  (i.e. O < 0). The 0.5 cutoff is Ohlson's original
 * binary classification boundary; later literature has used 0.038 (Begley 1996)
 * as a more conservative gate, but 0.5 keeps the method anchor-safe and
 * symmetric with Beneish/Altman bands.
 *
 * GNP simplification:
 *   Ohlson's original SIZE term deflates total assets by a GNP price index
 *   (1968=1.00 base). For long-cross-section cap-comparability we'd need
 *   a yearly CPI/GNP-deflator timeseries that the snapshot does not carry.
 *   We use a constant GNP_price_index = 1.0 (2010 normalization). The
 *   resulting bias is:
 *     - For TA ~ $1B (typical mid-cap), log(1e9/1.0) ≈ 20.7
 *     - True deflator at 2010-base ≈ 1.0 today, ≈ 0.5 in 1968 → effect
 *       on the -0.407*log term is small (<0.3 in O), order-of-magnitude
 *       irrelevant for the 0.5-probability decision boundary.
 *   This simplification is documented in the components so a future refactor
 *   can promote to a real CPI series without changing the calling contract.
 *
 * Why DIAGNOSTIC (not DATAGUARD) — same reasoning as beneish-m-score:
 *   1. DATA AVAILABILITY: Snapshot's annualBalance only carries
 *      {totalCash, totalDebt, totalAssets} — missing currentAssets,
 *      currentLiabilities, totalLiabilities, working-capital line.
 *      annualOCF (FFO proxy) is absent. The full 9-variable computation
 *      therefore returns computable=false for ~all current snapshots.
 *   2. ANCHOR SAFETY: Without computable inputs, we cannot demonstrate
 *      NVDA/MSFT/COST/CRDO/PLTR all yield O < 0. Per fixture_hash_invariant.md,
 *      anchor-unverified models stay DIAGNOSTIC.
 *   3. FIXTURE-HASH INVARIANT: Not in SCORE_WEIGHTS → hash-safe.
 *
 * Promotion path (future tag, e.g. 220+):
 *   a. Extend pull-yahoo to persist annualBalance[].currentAssets,
 *      currentLiabilities, totalLiabilities + annual.annualOCF[].
 *   b. Optionally add a CPI/GNP-deflator timeseries to the snapshot meta.
 *   c. Backfill snapshots for the anchor universe.
 *   d. Verify all anchors achieve P(bankruptcy) < 0.1 (well under the
 *      0.5 hard gate) with the full 9-variable model.
 *   e. Flip to DATAGUARD; add an `ohlsonFail` badge in generate-screener.js.
 *
 * Reference:
 *   Ohlson, J. A. (1980). "Financial Ratios and the Probabilistic Prediction
 *   of Bankruptcy." Journal of Accounting Research, 18(1), 109-131.
 *   https://doi.org/10.2307/2490395
 */
const H = require('./_helpers.js');

const ID = 'ohlson-o-score';
const LABEL = 'Ohlson O-Score';
// pass = O < 0 ⇔ P(bankruptcy) < 0.5 (Ohlson's original binary boundary).
const THRESHOLD = 0;
const THRESHOLD_OP = 'lt';

// GNP price index — see header "GNP simplification" note. Constant 1.0 keeps
// the size term log(TA/GNP_pi) ≈ log(TA), with documented small bias.
const GNP_PRICE_INDEX = 1.0;

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

function _missing(reason, components) {
  return H.buildResult({
    computable: false, pass: false, reason,
    components: components || {},
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

function evaluate(stock) {
  if (!stock || !stock.annual) {
    return _missing('no stock/annual data');
  }
  const A = stock.annual;

  // --- Required arrays: 2y of NI, current-year balance ---
  const ni_t = _annualVal(A.annualNetIncome, 0);
  const ni_p = _annualVal(A.annualNetIncome, 1);

  // Balance: t (current year)
  const ta_t  = _balField(stock, 0, 'totalAssets');
  const tl_t  = _balField(stock, 0, 'totalLiab');     // missing in snapshot
  const ca_t  = _balField(stock, 0, 'currentAssets'); // missing in snapshot
  const cl_t  = _balField(stock, 0, 'currentLiabilities'); // missing
  // Working capital line — usually CA - CL. We accept either direct WC field
  // or derive from CA/CL.
  const wcDirect = _balField(stock, 0, 'workingCapital');

  // FFO (Funds From Operations) ≈ Operating Cash Flow.
  const ffo_t = _annualVal(A.annualOCF, 0);

  // --- Hard requirements: 2y NI + current TA ----------------------
  if (!Number.isFinite(ni_t) || !Number.isFinite(ni_p)) {
    return _missing('require >=2y annualNetIncome');
  }
  if (!Number.isFinite(ta_t) || ta_t <= 0) {
    return _missing('require positive totalAssets (t)');
  }

  // --- Identify missing fields (transparent reason) ----------------
  const missingFields = [];
  if (!Number.isFinite(tl_t))   missingFields.push('totalLiab');
  if (!Number.isFinite(ca_t) && !Number.isFinite(wcDirect)) missingFields.push('currentAssets');
  if (!Number.isFinite(cl_t) && !Number.isFinite(wcDirect)) missingFields.push('currentLiabilities');
  if (!Number.isFinite(ffo_t)) missingFields.push('annualOCF');

  if (missingFields.length > 0) {
    // Per spec: with current pull-yahoo coverage this fires for ~all stocks.
    // Promotion plan in header — ship the brick + clear future path.
    return H.buildResult({
      computable: false, pass: false,
      reason: 'Ohlson requires fields not in snapshot: ' + missingFields.join(','),
      components: { missingFields, gnpPriceIndex: GNP_PRICE_INDEX },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Derived inputs ---------------------------------------------
  const wc_t = Number.isFinite(wcDirect) ? wcDirect : (ca_t - cl_t);

  if (ca_t === 0) return _missing('currentAssets = 0 (division by zero in CL/CA)');
  if (tl_t === 0) return _missing('totalLiab = 0 (division by zero in FFO/TL)');

  // --- 9 sub-terms -------------------------------------------------
  // Size term
  const sizeRatio = ta_t / GNP_PRICE_INDEX;
  if (sizeRatio <= 0) return _missing('log(TA/GNP) undefined for non-positive TA');
  const size = -0.407 * Math.log(sizeRatio);

  // Leverage / liquidity
  const TL_TA = 6.03   * (tl_t / ta_t);
  const WC_TA = -1.43  * (wc_t / ta_t);
  const CL_CA = 0.0757 * (cl_t / ca_t);

  // Insolvency indicator X
  const X = (tl_t > ta_t) ? 1 : 0;
  const X_TERM = -1.72 * X;

  // Profitability
  const NI_TA = -2.37 * (ni_t / ta_t);

  // Cash-flow coverage
  const FFO_TL = -1.83 * (ffo_t / tl_t);

  // Two-year-loss indicator Y
  const Y = (ni_t < 0 && ni_p < 0) ? 1 : 0;
  const Y_TERM = 0.285 * Y;

  // NI-change term (denominator = |NI_t| + |NI_p|; both zero → 0/0 → use 0)
  const niChangeDen = Math.abs(ni_t) + Math.abs(ni_p);
  const niChangeRatio = niChangeDen === 0 ? 0 : (ni_t - ni_p) / niChangeDen;
  const NI_CHANGE = -0.521 * niChangeRatio;

  // --- Composite O-Score -------------------------------------------
  const O = -1.32 + size + TL_TA + WC_TA + CL_CA + X_TERM
            + NI_TA + FFO_TL + Y_TERM + NI_CHANGE;

  if (!Number.isFinite(O)) {
    return _missing('O-Score not finite (NaN/Inf in sub-term)');
  }

  // Bankruptcy probability via logistic transform.
  // Guard against overflow for extreme O: clamp to ±50 (P ≈ 0 or 1 already).
  const Oclamped = Math.max(-50, Math.min(50, O));
  const probability = 1 / (1 + Math.exp(-Oclamped));

  const pass = O < THRESHOLD;
  // Risk zones for diagnostic reporting (pass gate is O < 0).
  //   O <  -2 : LOW   (P < 0.12)
  //   O ∈ [-2, 0) : MODERATE
  //   O ∈ [0, 2)  : ELEVATED
  //   O >= 2  : HIGH  (P > 0.88)
  const zone = O < -2 ? 'LOW'
             : O < 0  ? 'MODERATE'
             : O < 2  ? 'ELEVATED'
             : 'HIGH';

  return H.buildResult({
    value: Math.round(O * 1000) / 1000,
    pass,
    computable: true,
    components: {
      oScore: Math.round(O * 1000) / 1000,
      probability: Math.round(probability * 10000) / 10000,
      zone,
      size: Math.round(size * 1000) / 1000,
      TL_TA: Math.round(TL_TA * 1000) / 1000,
      WC_TA: Math.round(WC_TA * 1000) / 1000,
      CL_CA: Math.round(CL_CA * 1000) / 1000,
      X_TERM,
      NI_TA: Math.round(NI_TA * 1000) / 1000,
      FFO_TL: Math.round(FFO_TL * 1000) / 1000,
      Y_TERM,
      NI_CHANGE: Math.round(NI_CHANGE * 1000) / 1000,
      gnpPriceIndex: GNP_PRICE_INDEX
    },
    reason: 'O=' + O.toFixed(2) + ' P(bk)=' + (probability * 100).toFixed(1) + '% (' + zone + ', floor O<' + THRESHOLD + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Ohlson O-Score < 0 (P(bankruptcy) < 50%): 9-variable logit bankruptcy probability (Ohlson 1980)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'score',
  evaluate
};
