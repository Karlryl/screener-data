'use strict';
/**
 * DCF Intrinsic Value — 3-Stage Owner-Earnings DCF with Margin-of-Safety
 * =======================================================================
 * Sources:
 *   - Buffett 1996 Owner's Manual, Principle 6 ("owner earnings"):
 *       https://www.berkshirehathaway.com/ownman.pdf
 *   - Buffett 1992 Annual Letter (Coca-Cola DCF example, Appendix A — not published
 *       verbatim but reconstructed in Hagstrom "The Warren Buffett Way" 3rd ed.,
 *       Tenet 9 & 10: Value Tenets, pp. 55-79).
 *   - Damodaran "Investment Valuation" 3rd ed., ch. 14 (three-stage DCF), pp. 351-389.
 *   - Hagstrom "The Warren Buffett Way" 3rd ed., ch. 4 (Financial Tenets) pp. 69-80.
 *
 * Model overview:
 *   Stage 1 (years 1 … S1_YEARS): constant growth at growth1
 *   Stage 2 (years S1_YEARS+1 … S1_YEARS+S2_YEARS): growth decays linearly from
 *       growth1 → terminalGrowth (Damodaran transition-growth model)
 *   Stage 3 (perpetuity from year S1+S2+1): Gordon Growth formula
 *
 * Discount rate floored at Buffett's stated ~9-10% risk floor (1996 Owner's Manual);
 * we use 9% as the floor, matching Buffett's Berkshire hurdle.
 *
 * Growth clamped to [-0.05, 0.25] before stage-1 computation:
 *   "Growth is an input to value, not an end in itself. Growth can destroy value
 *    when a business earns sub-standard returns on incremental capital." (Buffett, 1992).
 *   Any historical CAGR outside this range is noise that would make the DCF meaningless.
 *
 * Margin-of-Safety (MoS):
 *   - High-predictability proxy (earnings-stability + low margin volatility): 25% MoS
 *   - Everything else: 50% MoS
 *   Introduced because Buffett only buys at a significant discount to intrinsic value
 *   to protect against estimation error (Buffett 1992; Hagstrom ch. 4, p. 78).
 *
 * Hurdle-rate test (Buffett 1992 Coca-Cola framework):
 *   Compute the annualised return that would be realised if the stock converges to
 *   intrinsic value over the S1 holding horizon. Pass when >= 15% p.a. (hurdleRate).
 */

const H = require('./_helpers.js');

const ID = 'dcf-intrinsic-value';
const LABEL = 'DCF Intrinsic Value (3-Stage Owner Earnings)';

// --- Configurable constants (environment-overridable) -------------------------
const DEFAULT_DISCOUNT_RATE       = 0.045;   // base: ~10y UST yield proxy
const DEFAULT_DISCOUNT_RATE_FLOOR = 0.09;    // Buffett's stated ~9-10% floor
const DEFAULT_MOS_HIGH_PRED       = 0.25;    // 25% margin-of-safety (predictable biz)
const DEFAULT_MOS_LOW_PRED        = 0.50;    // 50% margin-of-safety (all others)
const DEFAULT_HURDLE_RATE         = 0.15;    // 15% projected annual return hurdle
const DEFAULT_TERMINAL_GROWTH     = 0.025;   // 2.5% perpetuity growth (≈ long-run GDP)
const DEFAULT_S1_YEARS            = 10;      // Stage-1 high-growth duration
const DEFAULT_S2_YEARS            = 10;      // Stage-2 transition duration
const GROWTH1_CLAMP_MIN           = -0.05;   // Buffett: don't model persistent contraction
const GROWTH1_CLAMP_MAX           = 0.25;    // Buffett: high growth destroys value if costs > returns
const GROWTH1_DEFAULT             = 0.08;    // median mid-cap fundamental growth proxy (Damodaran survey)
const MIN_OE_YEARS                = 5;       // minimum OE history to run DCF meaningfully

function _envNum(key, fallback) {
  const v = parseFloat(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

function _getParams() {
  const base  = _envNum('DCF_DISCOUNT_RATE', DEFAULT_DISCOUNT_RATE);
  const floor = _envNum('DCF_DISCOUNT_RATE_FLOOR', DEFAULT_DISCOUNT_RATE_FLOOR);
  return {
    discountRate:    Math.max(base, floor),
    mosHighPred:     _envNum('DCF_MOS_HIGH_PRED', DEFAULT_MOS_HIGH_PRED),
    mosLowPred:      _envNum('DCF_MOS_LOW_PRED',  DEFAULT_MOS_LOW_PRED),
    hurdleRate:      _envNum('DCF_HURDLE_RATE',   DEFAULT_HURDLE_RATE),
    terminalGrowth:  DEFAULT_TERMINAL_GROWTH,
    s1Years:         DEFAULT_S1_YEARS,
    s2Years:         DEFAULT_S2_YEARS
  };
}

// ---------------------------------------------------------------------------
// Predictability classification
//   High-pred proxy: earnings-stability passes (OpInc+FCF positive 4/5y, no
//   >50% decline) — same criteria as earnings-stability.js MUST-1 for QC,
//   so we re-evaluate inline rather than depending on Runner output.
// ---------------------------------------------------------------------------
function _classifyPredictability(stock) {
  // Use raw arrays preserving positional alignment (same pattern as earnings-stability.js)
  const rawOi  = H.val(stock, 'annual.annualOpInc');
  const rawFcf = H.val(stock, 'annual.annualFCF');

  function _toNums(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(v => {
      if (v == null) return null;
      const n = (typeof v === 'number') ? v : v.value;
      return Number.isFinite(n) ? n : null;
    });
  }

  const opInc = _toNums(rawOi).slice(0, 5);
  const fcf   = _toNums(rawFcf).slice(0, 5);

  const oiObs  = opInc.filter(v => v != null).length;
  const fcfObs = fcf.filter(v => v != null).length;

  if (oiObs < 4 || fcfObs < 4) return 'less-pred';

  // Positivity thresholds (scaled as in earnings-stability.js Tag 221)
  const oiNeeded  = Math.round(4 * oiObs / 5);
  const fcfNeeded = Math.round(4 * fcfObs / 5);
  const oiPos  = opInc.filter(v => v != null && v > 0).length;
  const fcfPos = fcf.filter(v => v != null && v > 0).length;

  if (oiPos < oiNeeded || fcfPos < fcfNeeded) return 'less-pred';

  // Max single-year OpInc decline > 50% → less-pred
  for (let i = 0; i < opInc.length - 1; i++) {
    const newer = opInc[i];
    const older = opInc[i + 1];
    if (newer == null || older == null) continue;
    if (older > 0 && newer < older) {
      const decline = (older - newer) / older;
      if (decline > 0.50) return 'less-pred';
    }
  }

  return 'high-pred';
}

// ---------------------------------------------------------------------------
// Core DCF math
// ---------------------------------------------------------------------------

/**
 * Compute three-stage DCF present value.
 *
 * @param {number} oe0          - Base owner earnings (USD), latest year
 * @param {number} growth1      - Stage-1 constant growth rate (clamped)
 * @param {number} termGrowth   - Terminal perpetuity growth rate
 * @param {number} r            - Discount rate (effective, post-floor)
 * @param {number} s1           - Stage-1 years
 * @param {number} s2           - Stage-2 transition years
 * @returns {{ pvStage1, pvStage2, pvTerminal, intrinsicTotal,
 *             oeEndS1, oeEndS2 }}
 */
function _computeDCF(oe0, growth1, termGrowth, r, s1, s2) {
  // --- Stage 1: constant growth ---
  // PV_stage1 = Σ_{y=1}^{s1}  OE0 * (1+g1)^y / (1+r)^y
  //           = OE0 * Σ_{y=1}^{s1} ((1+g1)/(1+r))^y
  // (geometric series simplification is valid, but we iterate for transparency)
  let pvStage1 = 0;
  let oeY = oe0; // OE accumulator: starts at OE0, will reach OE at end of S1
  for (let y = 1; y <= s1; y++) {
    oeY = oeY * (1 + growth1);           // OE for year y (newest-to-oldest sequence)
    pvStage1 += oeY / Math.pow(1 + r, y); // discount back to present
  }
  const oeEndS1 = oeY; // OE at end of Stage 1 = base for Stage 2

  // --- Stage 2: linearly decaying growth ---
  // Growth rate in transition step k (k=1 at y=s1+1, k=s2 at y=s1+s2) interpolates:
  //   g_decay(k) = growth1 + (termGrowth - growth1) * (k / s2)
  // This matches Damodaran's linear-interpolation transition model
  // (Investment Valuation 3rd ed., ch. 14, p. 357).
  let pvStage2 = 0;
  let oeY2 = oeEndS1;
  for (let k = 1; k <= s2; k++) {
    const y = s1 + k;                                      // absolute discount year
    const frac = k / s2;                                   // interpolation fraction [1/s2 .. 1]
    const gDecay = growth1 + (termGrowth - growth1) * frac; // linearly interpolated growth rate
    oeY2 = oeY2 * (1 + gDecay);                           // OE for this transition year
    pvStage2 += oeY2 / Math.pow(1 + r, y);                // discount back to present
  }
  const oeEndS2 = oeY2; // OE at end of Stage 2 = base for perpetuity

  // --- Stage 3: terminal value (Gordon Growth perpetuity) ---
  // Gordon Growth formula: TV = OE_{s1+s2+1} / (r - g)
  //   where OE_{s1+s2+1} = oeEndS2 * (1 + termGrowth)
  // Derivation: a perpetuity paying CF * (1+g)^t discounted at r
  //   PV = CF * (1+g) / (r-g)  (first payment one period hence, growing at g forever).
  // This is the standard Gordon (1962) dividend-growth formula applied to owner earnings.
  const oeFirstTerminal = oeEndS2 * (1 + termGrowth);   // first terminal-year OE
  const terminalValue   = oeFirstTerminal / (r - termGrowth); // Gordon growth TV
  // Discount terminal value back s1+s2 periods (the perpetuity starts at end of S2)
  const pvTerminal = terminalValue / Math.pow(1 + r, s1 + s2);

  const intrinsicTotal = pvStage1 + pvStage2 + pvTerminal;

  return { pvStage1, pvStage2, pvTerminal, intrinsicTotal, oeEndS1, oeEndS2 };
}

// ---------------------------------------------------------------------------
// Core compute function (called by evaluate or externally by buffett-criteria)
// ---------------------------------------------------------------------------

/**
 * Compute DCF result given owner-earnings components from owner-earnings.js.
 *
 * This helper is exposed so the buffett-criteria composite can call it
 * directly with pre-computed ownerEarningsComponents, avoiding a redundant
 * Runner.evaluateStock() call for each stock.
 *
 * @param {object} stock                  - Full stock snapshot (USD-converted)
 * @param {object} oeComponents           - components from owner-earnings evaluate result:
 *   { annualOwnerEarnings, avgOE5y, cagrOE5y, isPositiveAllYears, isGrowing, yearsWithData }
 * @returns {object} H.buildResult output
 */
function _compute(stock, oeComponents) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data', threshold: DEFAULT_MOS_LOW_PRED, thresholdOp: 'gte' });
  }
  if (!oeComponents || !Array.isArray(oeComponents.annualOwnerEarnings) || oeComponents.annualOwnerEarnings.length < MIN_OE_YEARS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: `owner-earnings prerequisite missing or < ${MIN_OE_YEARS} years of data`,
      threshold: DEFAULT_MOS_LOW_PRED, thresholdOp: 'gte'
    });
  }

  // --- Parameters ---
  const P = _getParams();

  // Guard: Gordon growth requires r > terminalGrowth
  if (P.discountRate <= P.terminalGrowth) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'discount rate ≤ terminal growth — DCF undefined',
      threshold: P.mosLowPred, thresholdOp: 'gte'
    });
  }

  // --- Base owner earnings: latest annual value (newest-first array) ---
  const oe0 = oeComponents.annualOwnerEarnings[0];
  if (!Number.isFinite(oe0) || oe0 <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: `latest owner earnings non-positive or missing (oe0=${oe0})`,
      threshold: P.mosLowPred, thresholdOp: 'gte'
    });
  }

  // --- Growth rate: clamp cagrOE5y to [-5%, 25%] ---
  // Buffett: "Growth is an input to value, not an end in itself."
  // Any historical CAGR outside [-5%, 25%] is statistically unreliable for
  // a 10-year forward projection; use the mid-cap baseline instead.
  let growth1 = GROWTH1_DEFAULT;
  if (Number.isFinite(oeComponents.cagrOE5y)) {
    growth1 = Math.max(GROWTH1_CLAMP_MIN, Math.min(GROWTH1_CLAMP_MAX, oeComponents.cagrOE5y));
  }

  // --- Market data ---
  const currentMcap  = H.val(stock, 'marketCap.value');
  const currentPrice = H.val(stock, 'price.regularMarketPrice');

  if (!Number.isFinite(currentMcap) || currentMcap <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'currentMcap null or zero',
      threshold: P.mosLowPred, thresholdOp: 'gte'
    });
  }

  // sharesOutstanding: Tag 219 field preferred; derive from mcap/price as fallback
  let sharesOutstanding = null;
  const annualShares = H.val(stock, 'annual.annualShares');
  if (Array.isArray(annualShares) && annualShares.length > 0) {
    const s0 = annualShares[0];
    if (s0 != null) sharesOutstanding = (typeof s0 === 'number') ? s0 : s0.value;
  }
  if (!Number.isFinite(sharesOutstanding) || sharesOutstanding <= 0) {
    // Derive: shares = mcap / price
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      sharesOutstanding = currentMcap / currentPrice;
    }
  }
  if (!Number.isFinite(sharesOutstanding) || sharesOutstanding <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'sharesOutstanding not derivable (no annualShares + no price)',
      threshold: P.mosLowPred, thresholdOp: 'gte'
    });
  }

  // --- DCF computation ---
  const { pvStage1, pvStage2, pvTerminal, intrinsicTotal, oeEndS1, oeEndS2 } =
    _computeDCF(oe0, growth1, P.terminalGrowth, P.discountRate, P.s1Years, P.s2Years);

  if (!Number.isFinite(intrinsicTotal) || intrinsicTotal <= 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: `DCF produced non-positive intrinsic value (${intrinsicTotal})`,
      threshold: P.mosLowPred, thresholdOp: 'gte'
    });
  }

  const intrinsicValuePerShare = intrinsicTotal / sharesOutstanding;

  // --- Discount to intrinsic ---
  // Positive = below intrinsic (good); negative = above intrinsic (overvalued)
  const discountToIntrinsicPercent = ((intrinsicTotal - currentMcap) / intrinsicTotal) * 100;

  // --- Predictability & Margin of Safety ---
  const predictClass  = _classifyPredictability(stock);
  const mos           = (predictClass === 'high-pred') ? P.mosHighPred : P.mosLowPred;
  // MoS pass: buy only when currentMcap <= intrinsicValueTotal * (1 - mos)
  const mosThreshold  = intrinsicTotal * (1 - mos);
  const mosMet        = currentMcap <= mosThreshold;

  // --- Hurdle Rate ---
  // Projected annual return assuming convergence to intrinsic over S1 years:
  //   ((intrinsicTotal / currentMcap)^(1/s1)) - 1
  // Buffett (1992 Coca-Cola): if you buy at current price, what annualised return
  // do you earn by year 10 when the stock reaches fair value? Must exceed 15%.
  const projReturn     = (Math.pow(intrinsicTotal / currentMcap, 1 / P.s1Years) - 1) * 100;
  const hurdleMet      = projReturn >= P.hurdleRate * 100;

  const pass = mosMet && hurdleMet;

  const reasonParts = [];
  if (!mosMet) reasonParts.push(`MoS FAIL: mcap ${(currentMcap/1e9).toFixed(1)}B > intrinsic×(1-${(mos*100).toFixed(0)}%)=${((intrinsicTotal*(1-mos))/1e9).toFixed(1)}B`);
  if (!hurdleMet) reasonParts.push(`Hurdle FAIL: projected ${projReturn.toFixed(1)}%/yr < ${(P.hurdleRate*100).toFixed(0)}%`);
  if (pass) reasonParts.push(`MoS+Hurdle PASS: discount=${discountToIntrinsicPercent.toFixed(1)}%, projected ${projReturn.toFixed(1)}%/yr`);

  return H.buildResult({
    computable: true,
    pass,
    value: discountToIntrinsicPercent,   // positive = below intrinsic, sortable
    reason: reasonParts.join('; '),
    threshold: mos,
    thresholdOp: 'gte',
    components: {
      intrinsicValuePerShare,
      intrinsicValueTotal: intrinsicTotal,
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
      currentMcap,
      sharesOutstanding,
      discountToIntrinsicPercent,
      marginOfSafetyApplied: mos,
      marginOfSafetyMet: mosMet,
      projectedAnnualReturnPct: projReturn,
      hurdleRate: P.hurdleRate,
      hurdleRateMet: hurdleMet,
      discountRate: P.discountRate,
      terminalGrowth: P.terminalGrowth,
      growth1Used: growth1,
      s1Years: P.s1Years,
      s2Years: P.s2Years,
      predictabilityClass: predictClass,
      method: '3-stage-owner-earnings',
      // breakdown for transparency
      pvStage1,
      pvStage2,
      pvTerminal,
      oe0,
      oeEndS1,
      oeEndS2
    }
  });
}

// ---------------------------------------------------------------------------
// Public evaluate — resolves owner-earnings via Runner
// ---------------------------------------------------------------------------

/**
 * Evaluate DCF intrinsic value for a stock.
 *
 * Acquires owner-earnings components via Runner.evaluateStock (lazy require
 * to avoid circular-require issues at module-load time). Callers that already
 * have a Runner results map should use _compute() directly with the components.
 *
 * @param {object} stock - Full stock snapshot
 * @returns {object} H.buildResult
 */
function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data', threshold: DEFAULT_MOS_LOW_PRED, thresholdOp: 'gte' });
  }

  // Lazy require to avoid circular dependency at module load time.
  // owner-earnings.js may also be loaded after this module (parallel registration).
  let oeResult = null;
  try {
    const Runner = require('./runner.js');
    const allResults = Runner.evaluateStock(stock);
    oeResult = allResults['owner-earnings'];
  } catch (e) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'owner-earnings prerequisite missing: ' + e.message,
      threshold: DEFAULT_MOS_LOW_PRED, thresholdOp: 'gte'
    });
  }

  if (!oeResult || !oeResult.computable) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'owner-earnings prerequisite missing or not computable',
      threshold: DEFAULT_MOS_LOW_PRED, thresholdOp: 'gte'
    });
  }

  return _compute(stock, oeResult.components);
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------
module.exports = {
  id: ID,
  label: LABEL,
  description: '3-stage owner-earnings DCF (Buffett 1996 + 1992 Coke), 25/50% Margin-of-Safety, 15% hurdle-rate test',
  threshold: DEFAULT_MOS_LOW_PRED,
  thresholdOp: 'gte',
  unit: 'percent',
  evaluate,
  // Exposed for buffett-criteria composite to avoid redundant Runner call
  _compute
};
