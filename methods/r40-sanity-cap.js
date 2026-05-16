'use strict';
/**
 * Tag 205: R40-Sanity-Cap DataGuard
 * ===================================
 * The R40 Universe tab is the most permissive (every stock with computable R40 admits)
 * and therefore the most vulnerable to data artifacts. This guard caps the inputs
 * specifically to filter R40-poisoning patterns without affecting the other tabs:
 *   - 150% revGrowth: empirically no anchor exceeds 120% (CRDO 201% is exception, see below).
 *   - 80% FCFM: no anchor exceeds 50% (MSFT 30%, NVDA 27%, ASML 34%).
 *   - 50pp OpM-FCFM divergence: biotechs with R&D capitalization show this pattern.
 *
 * Failure conditions (any 1 fires → fail; carve-outs noted):
 *   F1. metrics.revenueGrowthYoY > 150 AND annualOpInc[0] < 0
 *       Carve-out rationale: CRDO has revGrowthYoY=201% but POSITIVE OpInc — a
 *       young hyper-growth chip-IP company with real commerciality. ONDS (629%)
 *       and BEAM (324%) have NEGATIVE OpInc — narrative spikes without operating
 *       leverage. Gating by OpInc<0 spares CRDO while catching the artifact class.
 *
 *   F2. metrics.fcfMarginTTM > 80
 *       No anchor exceeds 50% (MSFT 30%, NVDA 27%, ASML 34%). FCFM north of 80
 *       is almost always a one-time event tell: asset sale (GPT.AX 598%), tax
 *       refund, divestiture (ASX.AX 275%). No carve-out: the threshold is far
 *       above any sustainable operating business.
 *
 *   F3. |operatingMargin - fcfMarginTTM| > 50 (percentage points)
 *       Biotechs with R&D capitalization show this pattern: BEAM has OpM=-337%
 *       but FCFM positive ("phantom FCF" from R&D capex). Healthy compounders
 *       sit within ~25pp (PLTR 21/34 = 13pp, NVDA 60/27 = 33pp). Even NVDA's
 *       gap is well below 50pp; the cap is intentionally generous.
 *
 * ANCHOR SAFETY (verified pattern-only, no hardcoded tickers):
 *   NVDA  revGrowth=73,  fcfMargin=27, opM=60   → F1 miss (≤150), F2 miss (≤80), F3 miss (33pp<50) → PASS
 *   MSFT  revGrowth=12,  fcfMargin=30, opM=45   → all miss → PASS
 *   PLTR  revGrowth=85,  fcfMargin=34, opM=21   → all miss (div=13pp) → PASS
 *   CRDO  revGrowth=201, OpInc>0                → F1 gated by OpInc<0 → PASS
 *   ALAB  revGrowth=93,  fcfMargin=24, opM=17   → all miss (div=7pp) → PASS
 *   COST  revGrowth=7,   fcfMargin=3,  opM=4    → all miss → PASS
 *   ONDS  revGrowth=629, OpInc<0                → F1 fires → FAIL
 *   BEAM  OpM=-337, FCFM positive               → F3 fires (>>50pp) → FAIL
 *
 * Fixture stock (growth=38, fcfMargin=22, opM=25): all conditions miss → PASS.
 * DATAGUARD-only (no SCORE_WEIGHTS): fixture-hash preserved.
 *
 * Pattern-based: no hardcoded tickers, all inputs are first-class snapshot
 * fields (metrics.revenueGrowthYoY, metrics.fcfMarginTTM, metrics.operatingMargin,
 * annual.annualOpInc).
 */
const H = require('./_helpers.js');

const ID = 'r40-sanity-cap';
const LABEL = 'R40-Sanity-Cap';
const REV_GROWTH_CAP    = 150;  // %, gated by OpInc<0 carve-out
const FCF_MARGIN_CAP    = 80;   // %, no carve-out (above any real operating business)
const DIVERGENCE_CAP    = 50;   // pp, |OpM - FCFM|
const THRESHOLD         = REV_GROWTH_CAP;
const THRESHOLD_OP      = 'lte';

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _metric(stock, key) {
  const m = stock && stock.metrics && stock.metrics[key];
  return _unwrap(m);
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const revGrowth = _metric(stock, 'revenueGrowthYoY');
  const fcfMargin = _metric(stock, 'fcfMarginTTM');
  const opMargin  = _metric(stock, 'operatingMargin');
  const oiArr     = (stock.annual && stock.annual.annualOpInc) || [];
  const oi0       = _unwrap(oiArr[0]);

  // Need at least one of the three core inputs to evaluate anything.
  if (revGrowth == null && fcfMargin == null && opMargin == null) {
    return H.buildResult({
      computable: false,
      reason: 'no revGrowth/fcfMargin/opMargin metrics',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const divergence = (opMargin != null && fcfMargin != null)
    ? Math.abs(opMargin - fcfMargin) : null;

  // --- F1: revGrowth > 150 AND annualOpInc[0] < 0 (CRDO carve-out) ---
  // Only fires when BOTH (a) revGrowth excessive AND (b) OpInc negative — the
  // ONDS/BEAM pattern. CRDO with positive OpInc bypasses this gate even at 201%.
  const f1 = (revGrowth != null && oi0 != null && revGrowth > REV_GROWTH_CAP && oi0 < 0);

  // --- F2: fcfMargin > 80 (one-time-event tell, no carve-out) ---
  const f2 = (fcfMargin != null && fcfMargin > FCF_MARGIN_CAP);

  // --- F3: |OpM - FCFM| > 50pp (margin-divergence, biotech R&D-capex pattern) ---
  const f3 = (divergence != null && divergence > DIVERGENCE_CAP);

  const fired = [];
  if (f1) fired.push('revGrowth=' + revGrowth.toFixed(0) + '% > ' + REV_GROWTH_CAP + '% with OpInc<0');
  if (f2) fired.push('fcfMargin=' + fcfMargin.toFixed(0) + '% > ' + FCF_MARGIN_CAP + '%');
  if (f3) fired.push('|OpM-FCFM|=' + divergence.toFixed(0) + 'pp > ' + DIVERGENCE_CAP + 'pp');

  const pass = fired.length === 0;
  const failureReason = pass ? '' : fired.join('; ');

  return H.buildResult({
    value: revGrowth != null ? revGrowth : null,
    pass,
    computable: true,
    components: {
      revGrowth,
      fcfMargin,
      opMargin,
      divergence,
      oi0,
      failureReason
    },
    reason: pass
      ? 'R40 inputs within sanity caps (revGrowth=' +
        (revGrowth != null ? revGrowth.toFixed(0) + '%' : 'n/a') +
        ', fcfMargin=' + (fcfMargin != null ? fcfMargin.toFixed(0) + '%' : 'n/a') +
        ', div=' + (divergence != null ? divergence.toFixed(0) + 'pp' : 'n/a') + ')'
      : 'R40 sanity-cap fired: ' + failureReason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Hard-DataGuard: filters R40-poisoning input artifacts (Q-spike revGrowth, one-time FCFM, OpM-FCFM divergence)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'percent',
  evaluate
};
