'use strict';
/**
 * Owner Earnings (Warren Buffett, 1986 Berkshire Hathaway Annual Letter)
 * ======================================================================
 * "What should be reported [is] owner earnings. These represent
 *  (a) reported earnings plus (b) depreciation, depletion, amortization,
 *  and certain other non-cash charges... less (c) the average annual amount
 *  of capitalized expenditures for plant and equipment, etc. that the business
 *  requires to fully maintain its long-term competitive position and its unit
 *  volume." — Warren Buffett, 1986 BRK Annual Letter (the passage Berkshire
 *  shareholders "should care about").
 *
 * Formula (per letter + Hagstrom "The Warren Buffett Way" Tenet 5 — Financial):
 *   Owner Earnings = Net Income
 *                  + D&A  (non-cash amortisation adds back)
 *                  + SBC  (stock-based comp — non-cash dilution proxy)
 *                  − Maintenance Capex
 *                  − ΔWorking Capital  (cash absorbed by WC growth)
 *
 * Maintenance Capex proxy per Damodaran "Investment Valuation" ch. 11:
 *   Three configurable modes via OWNER_EARNINGS_MAINT_CAPEX_METHOD env var.
 *   See _computeMaintCapex() for full explanation of each mode.
 *
 * References:
 *   1. Buffett, W.E. (1986). Berkshire Hathaway Annual Report.
 *      Section: "Owner Earnings and the Cash Flow Fallacy".
 *   2. Hagstrom, R.G. (2013). The Warren Buffett Way, 3rd ed. Tenet 5:
 *      Financial Tenets — "Determine Owner Earnings".
 *   3. Damodaran, A. (2012). Investment Valuation, 3rd ed. Ch. 11:
 *      "Estimating Cash Flows — Maintenance Capex Proxies".
 */
const H = require('./_helpers.js');

const ID = 'owner-earnings';
const LABEL = 'Owner Earnings (Buffett 1986)';
const THRESHOLD_DEFAULT = 0.05;   // OE/Revenue margin >= 5% to pass
const THRESHOLD_OP = 'gte';
const MIN_YEARS = 5;              // require >= 5 computable years (Buffett criterion)

// Valid modes for maintenance capex proxy (Damodaran ch. 11)
const MAINT_CAPEX_METHODS = ['capex-5y-median', 'dna', 'capex-min-dna'];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function _rawEnvelopeVals(stock, path) {
  // Extracts array of raw values from paths like annual.annualNetIncome
  // where each element may be {value: N} envelope OR plain number OR null.
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && 'value' in v) return v.value;
    return null;
  });
}

function _median(arr) {
  // Simple median over a filtered finite array.
  const finite = arr.filter(v => Number.isFinite(v));
  if (!finite.length) return null;
  const s = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --------------------------------------------------------------------------
/**
 * _computeMaintCapex — Damodaran ch. 11 maintenance capex proxy.
 *
 * Three modes (controlled by OWNER_EARNINGS_MAINT_CAPEX_METHOD env var):
 *
 * 1. 'capex-5y-median'  (DEFAULT — Damodaran's preferred approach for mature
 *    steady-state businesses)
 *    Uses the 5-year median of |annualCapex| as the maintenance proxy.
 *    Rationale: for companies in a steady competitive position, total capex
 *    is mostly maintenance (growth capex is relatively small). The 5-year
 *    median smooths lumpy large years (e.g. a one-off data-center buildout).
 *    Per Damodaran 2012, ch. 11: "For stable firms, maintenance capex can
 *    be proxied by the average or median capital expenditure over time."
 *
 * 2. 'dna'  (steady-state assumption — popular for pure-software companies)
 *    Uses annualDepreciation as the maintenance proxy.
 *    Rationale: in steady state, depreciation approximates the investment
 *    needed to replace worn-out productive assets. For software companies
 *    with very low physical capex but high D&A from acquired intangibles,
 *    D&A better captures the ongoing cost of maintaining the asset base.
 *    Damodaran 2012, ch. 11: "Firms that have maintained their assets will
 *    have depreciation approximately equal to maintenance capex."
 *
 * 3. 'capex-min-dna'  (conservative — caps maintenance at the smaller)
 *    per-year value: min(|annualCapex|, annualDepreciation).
 *    Rationale: conservative lower-bound — if actual capex is below D&A
 *    the firm is under-investing (use actual capex as the proxy); if capex
 *    is above D&A the firm may be growing (use D&A as the maintenance floor).
 *    Appropriate when you want to avoid overstating Owner Earnings.
 *
 * @param {number[]} rawAbsCapex  - per-year |annualCapex|, newest-first
 * @param {number[]} rawDna       - per-year annualDepreciation, newest-first
 * @param {number}   i            - year index
 * @param {string}   mode         - one of MAINT_CAPEX_METHODS
 * @param {number}   capex5yMedian - precomputed 5y median of |capex| (for mode 1)
 * @returns {number|null}
 */
function _computeMaintCapex(rawAbsCapex, rawDna, i, mode, capex5yMedian) {
  const capexI = (i < rawAbsCapex.length && Number.isFinite(rawAbsCapex[i])) ? rawAbsCapex[i] : null;
  const dnaI   = (i < rawDna.length    && Number.isFinite(rawDna[i]))       ? rawDna[i]      : null;

  if (mode === 'dna') {
    // Mode 2: use D&A as maintenance proxy (Damodaran steady-state)
    return dnaI;
  }
  if (mode === 'capex-min-dna') {
    // Mode 3: conservative floor — min(|capex|, D&A)
    if (capexI != null && dnaI != null) return Math.min(capexI, dnaI);
    return capexI != null ? capexI : dnaI;
  }
  // Mode 1 (default): 5y median of |capex| — same value applied to each year
  return capex5yMedian;
}

// --------------------------------------------------------------------------
/**
 * evaluate — Buffett Owner Earnings analysis.
 *
 * Returns H.buildResult with full components shape:
 *   annualOwnerEarnings, maintCapexMethod, maintCapexValues,
 *   avgOE5y, cagrOE5y, isPositiveAllYears, isGrowing, yearsWithData
 *
 * Pass = (OE_latest/Rev_latest >= threshold) AND (yearsWithData >= 5)
 *        AND (isPositiveAllYears) AND (isGrowing)
 *
 * @param {object} stock - snapshot object (Runner convention)
 * @returns {object} H.buildResult output
 */
function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD_DEFAULT, thresholdOp: THRESHOLD_OP });
  }

  // --- Read maintenance-capex mode from env ---
  const rawMode = (process.env.OWNER_EARNINGS_MAINT_CAPEX_METHOD || 'capex-5y-median').trim().toLowerCase();
  const maintCapexMethod = MAINT_CAPEX_METHODS.includes(rawMode) ? rawMode : 'capex-5y-median';

  // --- Extract raw series (newest first, envelope-aware) ---
  const rawNI     = _rawEnvelopeVals(stock, 'annual.annualNetIncome');  // Net Income (a)
  const rawDna    = _rawEnvelopeVals(stock, 'annual.annualDepreciation'); // D&A (b1), plain numbers
  const rawSBC    = _rawEnvelopeVals(stock, 'annual.annualSBC');          // SBC non-cash (b2), plain numbers
  const rawCapex  = _rawEnvelopeVals(stock, 'annual.annualCapex');        // raw capex (Yahoo: negative)
  const rawRev    = _rawEnvelopeVals(stock, 'annual.annualRev');          // Revenue (for OE margin)
  const rawBal    = H.val(stock, 'annual.annualBalance');                 // [{currentAssets, currentLiabilities}, ...]

  // Abs-capex: Yahoo returns outflows as negative — normalise to positive for subtraction
  // Damodaran ch. 11: "capital expenditures are always positive (a use of cash)"
  const rawAbsCapex = rawCapex.map(v => (v != null && Number.isFinite(v)) ? Math.abs(v) : null);

  // Latest Revenue — required for OE margin (value field for sorting)
  const latestRev = (rawRev.length > 0 && Number.isFinite(rawRev[0])) ? rawRev[0] : null;
  if (latestRev == null || latestRev === 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'revenue missing or zero at latest year — cannot compute OE margin',
      threshold: THRESHOLD_DEFAULT, thresholdOp: THRESHOLD_OP
    });
  }

  // --- Precompute 5y median of |capex| (used in 'capex-5y-median' mode) ---
  const absCapex5y = rawAbsCapex.slice(0, 5).filter(v => v != null && Number.isFinite(v));
  const capex5yMedian = _median(absCapex5y);

  // --- Working Capital per year ---
  // WC[i] = currentAssets[i] − currentLiabilities[i]  (per-row plain numbers, Tag 211l)
  // ΔWC[i] = WC[i] − WC[i+1]  (latest minus prior; positive ΔWC = cash absorbed by WC growth)
  function _wc(i) {
    if (!Array.isArray(rawBal) || i >= rawBal.length || rawBal[i] == null) return null;
    const row = rawBal[i];
    const ca = row.currentAssets;
    const cl = row.currentLiabilities;
    if (!Number.isFinite(ca) || !Number.isFinite(cl)) return null;
    return ca - cl;  // Working Capital[i]
  }

  // --- Compute Owner Earnings for each year ---
  // Determine loop bound: align across all series, up to 10 years
  const maxLen = Math.min(10,
    rawNI.length,
    Math.max(rawDna.length, 1),   // D&A optional; don't cut series at zero
  );

  const annualOwnerEarnings = [];
  const maintCapexValues    = [];

  for (let i = 0; i < maxLen; i++) {
    // Net Income (a) — Buffett letter item (a)
    const ni = (Number.isFinite(rawNI[i])) ? rawNI[i] : null;
    if (ni == null) {
      annualOwnerEarnings.push(null);
      maintCapexValues.push(null);
      continue;
    }

    // D&A (b1) — add back non-cash charge; treat missing as 0 (conservative)
    const dna = (i < rawDna.length && Number.isFinite(rawDna[i])) ? rawDna[i] : 0;

    // SBC (b2) — add back non-cash dilution proxy; treat missing as 0
    const sbc = (i < rawSBC.length && Number.isFinite(rawSBC[i])) ? rawSBC[i] : 0;

    // Maintenance Capex (c) — per Damodaran ch. 11 proxy
    const mCap = _computeMaintCapex(rawAbsCapex, rawDna, i, maintCapexMethod, capex5yMedian);
    if (mCap == null) {
      // Cannot compute Owner Earnings without maintenance capex
      annualOwnerEarnings.push(null);
      maintCapexValues.push(null);
      continue;
    }

    // ΔWorking Capital: WC[i] − WC[i+1]
    // Positive ΔWC = WC grew = cash absorbed → subtract (Buffett letter item c extension)
    // For the oldest available year there is no prior year → ΔWC = 0 (conservative)
    const wcCur  = _wc(i);
    const wcPrev = _wc(i + 1);
    let deltaWC = 0;
    if (wcCur != null && wcPrev != null) {
      deltaWC = wcCur - wcPrev;  // positive = WC increased = cash absorbed
    }

    // Owner Earnings = NI + D&A + SBC − MaintenanceCapex − ΔWC
    const oe = ni + dna + sbc - mCap - deltaWC;

    annualOwnerEarnings.push(oe);
    maintCapexValues.push(mCap);
  }

  // --- Count computable years ---
  const validOE = annualOwnerEarnings.filter(v => v != null && Number.isFinite(v));
  const yearsWithData = validOE.length;

  if (yearsWithData < MIN_YEARS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: `<${MIN_YEARS} years of OE-computable data — buffett-criteria expects ≥${MIN_YEARS}y (have ${yearsWithData})`,
      threshold: THRESHOLD_DEFAULT, thresholdOp: THRESHOLD_OP,
      components: {
        annualOwnerEarnings,
        maintCapexMethod,
        maintCapexValues,
        avgOE5y: null,
        cagrOE5y: null,
        isPositiveAllYears: false,
        isGrowing: false,
        yearsWithData
      }
    });
  }

  // --- isPositiveAllYears: every computable year has OE > 0 ---
  // Buffett: a business that generates negative Owner Earnings is consuming capital
  const isPositiveAllYears = validOE.every(v => v > 0);

  // --- avgOE5y: simple average of latest 5 computable years ---
  // Index-aligned: take newest-first OE array and keep up to 5 valid entries
  const oe5y = [];
  for (let i = 0; i < annualOwnerEarnings.length && oe5y.length < 5; i++) {
    if (annualOwnerEarnings[i] != null && Number.isFinite(annualOwnerEarnings[i])) {
      oe5y.push(annualOwnerEarnings[i]);
    }
  }
  const avgOE5y = oe5y.length > 0
    ? oe5y.reduce((s, v) => s + v, 0) / oe5y.length
    : null;

  // --- cagrOE5y: CAGR using oldest and newest of valid 5y window ---
  // Per Damodaran: use endpoints of the window, not regression, for comparability.
  // null if either endpoint is <= 0 (negative/zero OE breaks fractional power).
  let cagrOE5y = null;
  if (oe5y.length >= 2) {
    const oeLatest = oe5y[0];
    const oeOldest = oe5y[oe5y.length - 1];
    const years = oe5y.length - 1;  // periods = datapoints - 1
    if (oeLatest != null && oeOldest != null && oeOldest > 0 && oeLatest > 0) {
      cagrOE5y = Math.pow(oeLatest / oeOldest, 1 / years) - 1;
    }
    // null when early years are negative/zero — documented in spec
  }

  // --- isGrowing: monotonic upward trend OR cagrOE5y > 0 ---
  // Monotonic: each consecutive valid year OE >= previous valid year OE
  let isMonotonic = true;
  let prevValid = null;
  for (let i = oe5y.length - 1; i >= 0; i--) {  // oldest to newest
    const v = oe5y[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (prevValid !== null && v < prevValid) { isMonotonic = false; break; }
    prevValid = v;
  }
  const isGrowing = isMonotonic || (cagrOE5y != null && cagrOE5y > 0);

  // --- OE Margin (latest year) — used as value for sortability ---
  // Buffett-aligned: OE_latest / Revenue_latest
  const oeLatestValue = annualOwnerEarnings[0];
  const oeMargin = (oeLatestValue != null && Number.isFinite(oeLatestValue))
    ? oeLatestValue / latestRev
    : null;

  // --- Pass conditions (all three must hold) ---
  const c1_margin  = oeMargin != null && oeMargin >= THRESHOLD_DEFAULT;
  const c2_years   = yearsWithData >= MIN_YEARS;  // always true here (caught above)
  const c3_quality = isPositiveAllYears && isGrowing;
  const pass = c1_margin && c2_years && c3_quality;

  let reason;
  if (!c1_margin) {
    reason = `OE margin ${oeMargin != null ? (oeMargin * 100).toFixed(1) + '%' : 'n/a'} < ${(THRESHOLD_DEFAULT * 100).toFixed(0)}% threshold`;
  } else if (!c3_quality) {
    const parts = [];
    if (!isPositiveAllYears) parts.push('OE negative in ≥1 year');
    if (!isGrowing) parts.push('OE not growing (CAGR ≤0, non-monotonic)');
    reason = parts.join('; ');
  } else {
    reason = `OE margin ${(oeMargin * 100).toFixed(1)}% ≥ ${(THRESHOLD_DEFAULT * 100).toFixed(0)}%, ${yearsWithData}y data, positive+growing`;
  }

  return H.buildResult({
    computable: true,
    pass,
    value: oeMargin,
    threshold: THRESHOLD_DEFAULT,
    thresholdOp: THRESHOLD_OP,
    reason,
    components: {
      annualOwnerEarnings,
      maintCapexMethod,
      maintCapexValues,
      avgOE5y,
      cagrOE5y,
      isPositiveAllYears,
      isGrowing,
      yearsWithData
    }
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Buffett (1986) Owner Earnings = NI + D&A + SBC − MaintCapex − ΔWC; OE/Rev >= 5%, ≥5y, positive+growing',
  threshold: THRESHOLD_DEFAULT, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};

// --------------------------------------------------------------------------
// Smoke test (node methods/owner-earnings.js)
// --------------------------------------------------------------------------
if (require.main === module) {
  /**
   * Synthetic stock — hand-computable Owner Earnings.
   *
   * 5 years of data (newest = index 0):
   *   Year 0 (latest): NI=100, D&A=10, SBC=5, |Capex|=20, CA=80, CL=30 → WC=50
   *   Year 1:          NI=90,  D&A=9,  SBC=4, |Capex|=18, CA=70, CL=25 → WC=45
   *   Year 2:          NI=80,  D&A=8,  SBC=4, |Capex|=16, CA=60, CL=20 → WC=40
   *   Year 3:          NI=70,  D&A=7,  SBC=3, |Capex|=15, CA=55, CL=20 → WC=35
   *   Year 4:          NI=60,  D&A=6,  SBC=3, |Capex|=14, CA=50, CL=20 → WC=30
   *
   * 5y median |capex| = median(20,18,16,15,14) = 16
   *
   * Hand-computed OE (default 'capex-5y-median' mode):
   *   ΔWC[0] = WC[0] − WC[1] = 50 − 45 = 5
   *   OE[0] = 100 + 10 + 5 − 16 − 5 = 94
   *
   *   ΔWC[1] = WC[1] − WC[2] = 45 − 40 = 5
   *   OE[1] = 90 + 9 + 4 − 16 − 5 = 82
   *
   *   etc.
   *
   * Revenue year 0 = 500 → OE margin = 94/500 = 0.188 (18.8%) ≥ 5% → c1 PASS
   */

  // Build synthetic stock in the exact snapshot shape evaluate() reads
  const mk = (v) => ({ value: v });  // envelope helper
  const synth = {
    annual: {
      annualNetIncome:   [mk(100), mk(90), mk(80), mk(70), mk(60)],
      annualDepreciation:[10, 9, 8, 7, 6],
      annualSBC:         [5, 4, 4, 3, 3],
      annualCapex:       [-20, -18, -16, -15, -14],  // Yahoo: negative outflows
      annualRev:         [mk(500), mk(450), mk(400), mk(350), mk(300)],
      annualBalance: [
        { currentAssets: 80, currentLiabilities: 30 },  // WC=50
        { currentAssets: 70, currentLiabilities: 25 },  // WC=45
        { currentAssets: 60, currentLiabilities: 20 },  // WC=40
        { currentAssets: 55, currentLiabilities: 20 },  // WC=35
        { currentAssets: 50, currentLiabilities: 20 },  // WC=30
      ]
    }
  };

  // Hand-calculated expected OE at year 0:
  //   5y median |capex| = median([20,18,16,15,14]) sorted=[14,15,16,18,20] → 16
  //   ΔWC[0] = (80-30) − (70-25) = 50 − 45 = 5
  //   OE[0] = 100 + 10 + 5 − 16 − 5 = 94
  const EXPECTED_OE_LATEST = 94;
  const EXPECTED_OE_MARGIN = 94 / 500;  // 0.188

  const result = evaluate(synth);

  const oeLatest = result.components && result.components.annualOwnerEarnings &&
                   result.components.annualOwnerEarnings[0];
  const margin   = result.value;

  let pass = true;
  const failures = [];

  if (!result.computable) {
    pass = false; failures.push('computable=false: ' + result.reason);
  }
  if (Math.abs(oeLatest - EXPECTED_OE_LATEST) > 0.001) {
    pass = false; failures.push(`OE[0]=${oeLatest} expected=${EXPECTED_OE_LATEST}`);
  }
  if (Math.abs(margin - EXPECTED_OE_MARGIN) > 0.0001) {
    pass = false; failures.push(`margin=${margin} expected=${EXPECTED_OE_MARGIN}`);
  }
  if (result.components.yearsWithData < 5) {
    pass = false; failures.push(`yearsWithData=${result.components.yearsWithData} < 5`);
  }
  if (!result.components.isPositiveAllYears) {
    pass = false; failures.push('isPositiveAllYears=false');
  }
  if (!result.pass) {
    pass = false; failures.push('evaluate pass=false: ' + result.reason);
  }

  if (pass) {
    console.log('PASS — OE[0]=' + oeLatest + ', margin=' + (margin * 100).toFixed(2) + '%, yearsWithData=' + result.components.yearsWithData);
  } else {
    console.log('FAIL:', failures.join('; '));
    process.exit(1);
  }
}
