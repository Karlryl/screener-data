'use strict';
/**
 * Tag 209d: Beneish M-Score (earnings-manipulation detector)
 * ==========================================================
 * 8-variable probit-style composite for detecting earnings manipulation.
 * Sibling to Altman Z-Score (solvency) and Sloan-Ratio (accruals): Beneish
 * combines accrual, growth, asset-quality and leverage signals into a single
 * research-validated fraud-fingerprint number.
 *
 * Formula (Beneish, 1999, Financial Analysts Journal):
 *   M = -4.84 + 0.92*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI
 *           + 0.115*DEPI - 0.172*SGAI + 4.679*TATA - 0.327*LVGI
 *
 * Where (subscript t = current year, t-1 = prior year):
 *   DSRI = Days-Sales-in-Receivables Index = (AR/Sales)_t   / (AR/Sales)_{t-1}
 *   GMI  = Gross-Margin Index              =  GM_{t-1}      / GM_t
 *   AQI  = Asset-Quality Index             = (1-(CA+PPE)/TA)_t / (1-(CA+PPE)/TA)_{t-1}
 *   SGI  = Sales-Growth Index              =  Sales_t       / Sales_{t-1}
 *   DEPI = Depreciation Index              = (Dep/(Dep+PPE))_{t-1} / same_t
 *   SGAI = SG&A Index                      = (SGA/Sales)_t  / (SGA/Sales)_{t-1}
 *   TATA = Total-Accruals to Total-Assets  = (NI - CFO)_t   / TA_t
 *   LVGI = Leverage Index                  = ((LTD+CL)/TA)_t / same_{t-1}
 *
 * Pass threshold: M < -2.22 (conservative — Beneish 1999 originally used -1.78
 * as the manipulator threshold; -2.22 is the stricter "clearly non-manipulator"
 * cutoff used by recent quality-of-earnings research and gives a cleaner pass
 * gate against false-positives in high-growth firms).
 *
 * Why this method (failure mode it catches):
 *   Sloan-Ratio detects single-year accrual abuse but is silent about
 *   receivables-quality drift, asset-quality decay, leverage spikes and the
 *   combined sales/depreciation pattern that characterizes "channel-stuffing
 *   + capitalization-of-opex" manipulation. Beneish was empirically validated
 *   on the SEC's AAER fraud sample and famously flagged Enron in 1998.
 *
 * DIAGNOSTIC type (NOT a DATAGUARD hard-gate) because:
 *   1. DATA AVAILABILITY: Our current Yahoo snapshot exposes only
 *      {totalCash, totalDebt, totalAssets} on annualBalance — it does NOT
 *      persist accountsReceivable, propertyPlantEquipment, currentLiabilities,
 *      the LTD/STD split, SG&A, depreciation or operating cash flow. Until
 *      pull-yahoo is extended to surface these eight fields, this method
 *      returns computable=false for every stock. A hard-gate that is
 *      computable=false universally has no operational effect but creates
 *      future risk if it accidentally activates without anchor verification.
 *   2. ANCHOR SAFETY: With data unavailable, we cannot demonstrate that
 *      NVDA/MSFT/COST/CRDO/PLTR pass the M < -2.22 threshold. Per the
 *      project's anchor-safety rule (audit-reports/.../tag208 +
 *      fixture_hash_invariant.md), a method whose anchor-pass cannot be
 *      verified MUST stay DIAGNOSTIC.
 *   3. FIXTURE-HASH INVARIANT: DIAGNOSTIC + not in SCORE_WEIGHTS keeps the
 *      fixture hash stable (verified by tests/fixture-hash.txt golden test).
 *
 * Promotion path (future tag, e.g. 210+):
 *   a. Extend pull-yahoo.js mapFTSToBalance() + mapFTSToAnnual() to persist:
 *      annualBalance[].{accountsReceivable, propertyPlantEquipment,
 *                       currentLiabilities, longTermDebt}
 *      annual.annualSGA[], annual.annualDepreciation[], annual.annualOCF[]
 *   b. Backfill snapshots for the anchor universe.
 *   c. Compute M-Score for NVDA/MSFT/COST/CRDO/PLTR; confirm all pass
 *      M < -2.22 with margin >= 0.5 (away from threshold).
 *   d. Flip type to DATAGUARD, add `beneishFail` to row payload + hardGated
 *      chain in generate-screener.js, register beneishFail badge.
 *
 * Reference:
 *   Beneish, M. D. (1999). "The Detection of Earnings Manipulation."
 *   Financial Analysts Journal, 55(5), 24-36.
 *   https://doi.org/10.2469/faj.v55.n5.2296
 */
const H = require('./_helpers.js');

const ID = 'beneish-m-score';
const LABEL = 'Beneish M-Score';
// Beneish's original 1999 paper used -1.78 as the "likely manipulator" line.
// The stricter -2.22 cutoff is the conservative "clearly clean" threshold
// recommended by later quality-of-earnings literature; values above suggest
// manipulation risk warrants investigation. pass = M < -2.22.
const THRESHOLD = -2.22;
const THRESHOLD_OP = 'lt';

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

function _missing(reason) {
  return H.buildResult({
    computable: false, pass: false, reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

function evaluate(stock) {
  if (!stock || !stock.annual) {
    return _missing('no stock/annual data');
  }
  const A = stock.annual;

  // --- Required arrays, both years (idx 0 = latest, idx 1 = prior) ---------
  // Sales (Rev), GP, NI are present in our snapshot.
  const sales_t  = _annualVal(A.annualRev, 0);
  const sales_p  = _annualVal(A.annualRev, 1);
  const gp_t     = _annualVal(A.annualGP, 0);
  const gp_p     = _annualVal(A.annualGP, 1);
  const ni_t     = _annualVal(A.annualNetIncome, 0);

  // OCF: snapshot may carry annualOCF (added by FTS path) or fall back to
  // FCF + |Capex|. We require true OCF for TATA; do not silently substitute.
  const ocf_t    = _annualVal(A.annualOCF, 0);

  // Balance-sheet fields. Most are NOT in current snapshot — see header.
  const ta_t  = _balField(stock, 0, 'totalAssets');
  const ta_p  = _balField(stock, 1, 'totalAssets');
  const ar_t  = _balField(stock, 0, 'accountsReceivable');
  const ar_p  = _balField(stock, 1, 'accountsReceivable');
  const ppe_t = _balField(stock, 0, 'propertyPlantEquipment');
  const ppe_p = _balField(stock, 1, 'propertyPlantEquipment');
  const ca_t  = _balField(stock, 0, 'currentAssets');
  const ca_p  = _balField(stock, 1, 'currentAssets');
  const cl_t  = _balField(stock, 0, 'currentLiabilities');
  const cl_p  = _balField(stock, 1, 'currentLiabilities');
  const ltd_t = _balField(stock, 0, 'longTermDebt');
  const ltd_p = _balField(stock, 1, 'longTermDebt');

  // Income-statement extras NOT in current snapshot.
  const sga_t = _annualVal(A.annualSGA, 0);
  const sga_p = _annualVal(A.annualSGA, 1);
  const dep_t = _annualVal(A.annualDepreciation, 0);
  const dep_p = _annualVal(A.annualDepreciation, 1);

  // --- Hard requirements: 2y of fundamentals ------------------------------
  if (!Number.isFinite(sales_t) || !Number.isFinite(sales_p)) {
    return _missing('require >=2y annualRev');
  }
  if (sales_t <= 0 || sales_p <= 0) {
    return _missing('non-positive sales (t=' + sales_t + ', t-1=' + sales_p + ')');
  }
  if (!Number.isFinite(ta_t) || !Number.isFinite(ta_p) || ta_t <= 0 || ta_p <= 0) {
    return _missing('require >=2y totalAssets');
  }

  // --- Identify which Beneish inputs are missing (transparent reason) -----
  const missingFields = [];
  if (!Number.isFinite(ar_t) || !Number.isFinite(ar_p))   missingFields.push('accountsReceivable');
  if (!Number.isFinite(ppe_t) || !Number.isFinite(ppe_p)) missingFields.push('propertyPlantEquipment');
  if (!Number.isFinite(ca_t) || !Number.isFinite(ca_p))   missingFields.push('currentAssets');
  if (!Number.isFinite(cl_t) || !Number.isFinite(cl_p))   missingFields.push('currentLiabilities');
  if (!Number.isFinite(ltd_t) || !Number.isFinite(ltd_p)) missingFields.push('longTermDebt');
  if (!Number.isFinite(sga_t) || !Number.isFinite(sga_p)) missingFields.push('annualSGA');
  if (!Number.isFinite(dep_t) || !Number.isFinite(dep_p)) missingFields.push('annualDepreciation');
  if (!Number.isFinite(ocf_t))                            missingFields.push('annualOCF');
  if (!Number.isFinite(gp_t) || !Number.isFinite(gp_p))   missingFields.push('annualGP');
  if (!Number.isFinite(ni_t))                             missingFields.push('annualNetIncome');

  if (missingFields.length > 0) {
    // Per spec: "If some fields missing: report computable:false with clear
    // reason. Don't fake." With current pull-yahoo coverage, accountsReceivable
    // / PPE / CL / LTD-split / SGA / Depreciation / OCF are not persisted, so
    // this branch fires for ~all stocks. Promotion plan in header.
    return H.buildResult({
      computable: false, pass: false,
      reason: 'Beneish requires fields not in snapshot: ' + missingFields.join(','),
      components: { missingFields },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Compute the 8 sub-indices ------------------------------------------
  // DSRI (Days-Sales-in-Receivables Index)
  const dsri = (ar_t / sales_t) / (ar_p / sales_p);

  // GMI (Gross-Margin Index): GM_{t-1} / GM_t (rising COGS → GMI > 1)
  const gm_t = gp_t / sales_t;
  const gm_p = gp_p / sales_p;
  if (gm_t === 0) {
    return _missing('GM_t = 0 (division by zero in GMI)');
  }
  const gmi = gm_p / gm_t;

  // AQI (Asset-Quality Index): non-current, non-PPE asset share trending up
  // is suspect (capitalization of expenses).
  const nonProductive_t = 1 - (ca_t + ppe_t) / ta_t;
  const nonProductive_p = 1 - (ca_p + ppe_p) / ta_p;
  if (nonProductive_p === 0) {
    return _missing('non-productive-asset share = 0 in prior year (division by zero in AQI)');
  }
  const aqi = nonProductive_t / nonProductive_p;

  // SGI (Sales-Growth Index)
  const sgi = sales_t / sales_p;

  // DEPI (Depreciation Index): rate of depreciation slowing → DEPI > 1
  const depRate_t = dep_t / (dep_t + ppe_t);
  const depRate_p = dep_p / (dep_p + ppe_p);
  if (depRate_t === 0) {
    return _missing('depreciation rate = 0 in current year (division by zero in DEPI)');
  }
  const depi = depRate_p / depRate_t;

  // SGAI (SG&A Index): SG&A growing faster than sales → SGAI > 1
  const sgai = (sga_t / sales_t) / (sga_p / sales_p);

  // TATA (Total Accruals to Total Assets): (NI - OCF) / TA
  const tata = (ni_t - ocf_t) / ta_t;

  // LVGI (Leverage Index): leverage rising → LVGI > 1
  const lev_t = (ltd_t + cl_t) / ta_t;
  const lev_p = (ltd_p + cl_p) / ta_p;
  if (lev_p === 0) {
    return _missing('prior-year leverage = 0 (division by zero in LVGI)');
  }
  const lvgi = lev_t / lev_p;

  // --- Composite M-Score --------------------------------------------------
  const mScore = -4.84
    + 0.92  * dsri
    + 0.528 * gmi
    + 0.404 * aqi
    + 0.892 * sgi
    + 0.115 * depi
    - 0.172 * sgai
    + 4.679 * tata
    - 0.327 * lvgi;

  if (!Number.isFinite(mScore)) {
    return _missing('M-Score not finite (NaN/Inf in sub-index)');
  }

  const pass = mScore < THRESHOLD;
  // Risk zones (descriptive only — pass gate is M < -2.22)
  //   M < -2.22 : clean
  //   -2.22 .. -1.78 : caution
  //   M > -1.78 : likely manipulator (Beneish 1999 original cutoff)
  const zone = mScore < -2.22 ? 'CLEAN'
             : mScore < -1.78 ? 'CAUTION'
             : 'LIKELY_MANIPULATOR';

  return H.buildResult({
    value: Math.round(mScore * 1000) / 1000,
    pass,
    computable: true,
    components: {
      mScore: Math.round(mScore * 1000) / 1000,
      zone,
      DSRI: Math.round(dsri * 1000) / 1000,
      GMI:  Math.round(gmi  * 1000) / 1000,
      AQI:  Math.round(aqi  * 1000) / 1000,
      SGI:  Math.round(sgi  * 1000) / 1000,
      DEPI: Math.round(depi * 1000) / 1000,
      SGAI: Math.round(sgai * 1000) / 1000,
      TATA: Math.round(tata * 1000) / 1000,
      LVGI: Math.round(lvgi * 1000) / 1000
    },
    reason: 'M=' + mScore.toFixed(2) + ' (' + zone + ', floor ' + THRESHOLD + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Beneish M-Score < -2.22: earnings-manipulation fingerprint (8-variable composite, Beneish 1999)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'score',
  evaluate
};
