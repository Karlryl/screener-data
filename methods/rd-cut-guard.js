'use strict';
/**
 * Tag 210c: R&D-Cut Guard (real-earnings-management red flag)
 * ===========================================================
 * Detects "real earnings management" via the classic pattern: latest annual
 * R&D drops materially (>20% YoY) WHILE operating margin simultaneously
 * improves (>2pp YoY). The conjunction is the smoking gun — either alone is
 * normal business variation, but together they indicate management is
 * boosting reported earnings by slashing future-investment.
 *
 * Triggers (BOTH must hold to flag):
 *   1. R&D YoY change < -20%  (R&D_t / R&D_{t-1} - 1 < -0.20)
 *      OR R&D/Revenue ratio drop > 20% relative
 *   2. Operating margin (OI/Rev) improves by > 2 percentage points YoY
 *
 * Pass = NO flag (no real-EM pattern detected).
 *
 * Why DIAGNOSTIC (not DATAGUARD):
 *   - Real R&D cuts can be legitimate (M&A integration absorbing redundant
 *     teams, completed major project, strategic shift). A hard gate would
 *     false-positive on healthy reorganizations.
 *   - Margin improvement is a goal, not a problem; gating on it would
 *     penalize operating-leverage breakthroughs.
 *   - The conjunction is the signal — but it deserves human review, not
 *     auto-disqualification. Surface as a diagnostic for the Deep-Dive modal.
 *   - Not in SCORE_WEIGHTS → fixture-hash safe by construction.
 *
 * Data requirements:
 *   - annualRnD[0], annualRnD[1] (Tag 202 backfill — may be missing for some)
 *   - annualOpInc[0], annualOpInc[1]
 *   - annualRev[0], annualRev[1]
 *   Missing any → computable=false (NOT a fail; we cannot detect what we
 *   cannot measure).
 *
 * Anchor safety (per audit-reports/2026-05-16-tag208-academic-research.md):
 *   - NVDA/MSFT/PLTR/CRDO are all *growing* R&D ratio → never triggers.
 *   - Method only flags companies that quietly cut R&D to manufacture
 *     margin expansion. This is the documented Roychowdhury 2006 pattern.
 *
 * References:
 *   - Roychowdhury, S. (2006). "Earnings Management through Real Activities
 *     Manipulation." Journal of Accounting and Economics, 42(3), 335-370.
 *   - Lepetit, F. et al. (2024). "Revisiting Quality Investing." SSRN 3877161.
 *   - Gibbs, K. (2025). "Does earnings management matter for strategy
 *     research?" Strategic Management Journal — documents the post-2020 shift
 *     from accrual-EM (Sloan-detectable) to real-EM (R&D/CapEx cuts).
 *   - ICPAS Insight (Summer 2025); MDPI JRFM 18/7/404 — same conclusion.
 */
const H = require('./_helpers.js');

const ID = 'rd-cut-guard';
const LABEL = 'R&D-Cut Guard';
// Threshold reads as "value <= 0" — value is the flag (0 = no flag, 1 = flag);
// pass = value == 0.
const THRESHOLD = 0;
const THRESHOLD_OP = 'lte';

// Pattern parameters
const RD_DROP_REL = -0.20;     // R&D YoY relative change < -20%
const OPMARGIN_IMPROVE_PP = 0.02; // operating margin improves >= +2pp YoY

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

function evaluate(stock) {
  if (!stock || !stock.annual) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock/annual data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const A = stock.annual;

  const rd_t = _annualVal(A.annualRnD, 0);
  const rd_p = _annualVal(A.annualRnD, 1);
  const oi_t = _annualVal(A.annualOpInc, 0);
  const oi_p = _annualVal(A.annualOpInc, 1);
  const rev_t = _annualVal(A.annualRev, 0);
  const rev_p = _annualVal(A.annualRev, 1);

  const missing = [];
  if (!Number.isFinite(rd_t) || rd_t <= 0)   missing.push('annualRnD[0]');
  if (!Number.isFinite(rd_p) || rd_p <= 0)   missing.push('annualRnD[1]');
  if (!Number.isFinite(oi_t))                missing.push('annualOpInc[0]');
  if (!Number.isFinite(oi_p))                missing.push('annualOpInc[1]');
  if (!Number.isFinite(rev_t) || rev_t <= 0) missing.push('annualRev[0]');
  if (!Number.isFinite(rev_p) || rev_p <= 0) missing.push('annualRev[1]');

  if (missing.length > 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'rd-cut-guard requires 2y R&D + OpInc + Rev: missing ' + missing.join(','),
      components: { missingFields: missing },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // R&D YoY change (relative)
  const rdYoY = (rd_t - rd_p) / rd_p;
  // R&D/Rev ratio change (catches the case where R&D grows nominally but
  // < revenue growth — silent under-investment)
  const rdRevRatio_t = rd_t / rev_t;
  const rdRevRatio_p = rd_p / rev_p;
  const rdRevYoY = (rdRevRatio_t - rdRevRatio_p) / rdRevRatio_p;

  // Operating margin
  const opM_t = oi_t / rev_t;
  const opM_p = oi_p / rev_p;
  const opMarginYoY = opM_t - opM_p; // in absolute percentage points (e.g. 0.025 = +2.5pp)

  // Flag triggers if EITHER absolute R&D cut OR R&D/Rev ratio cut > 20%
  // AND operating margin expanded >= +2pp.
  const rdAbsCut = rdYoY <= RD_DROP_REL;
  const rdRatioCut = rdRevYoY <= RD_DROP_REL;
  const marginExpanded = opMarginYoY >= OPMARGIN_IMPROVE_PP;

  const flag = (rdAbsCut || rdRatioCut) && marginExpanded;
  const pass = !flag;

  let reason;
  if (flag) {
    const cutDescr = rdAbsCut
      ? 'R&D ' + (rdYoY * 100).toFixed(1) + '% YoY (abs cut)'
      : 'R&D/Rev ' + (rdRevYoY * 100).toFixed(1) + '% YoY (ratio cut)';
    reason = 'REAL-EM FLAG: ' + cutDescr + ' AND opMargin +' + (opMarginYoY * 100).toFixed(1) + 'pp YoY (' + (opM_p * 100).toFixed(1) + '%→' + (opM_t * 100).toFixed(1) + '%)';
  } else if (!rdAbsCut && !rdRatioCut) {
    reason = 'No R&D cut: ' + (rdYoY * 100).toFixed(1) + '% YoY abs, ' + (rdRevYoY * 100).toFixed(1) + '% YoY ratio';
  } else if (!marginExpanded) {
    reason = 'R&D cut without margin expansion (' + (opMarginYoY * 100).toFixed(1) + 'pp) — normal cost discipline';
  } else {
    reason = 'No flag';
  }

  return H.buildResult({
    value: flag ? 1 : 0,
    pass,
    computable: true,
    components: {
      flag,
      rdYoY: Math.round(rdYoY * 10000) / 10000,
      rdRevRatio_t: Math.round(rdRevRatio_t * 10000) / 10000,
      rdRevRatio_p: Math.round(rdRevRatio_p * 10000) / 10000,
      rdRevYoY: Math.round(rdRevYoY * 10000) / 10000,
      opMargin_t: Math.round(opM_t * 10000) / 10000,
      opMargin_p: Math.round(opM_p * 10000) / 10000,
      opMarginYoY: Math.round(opMarginYoY * 10000) / 10000,
      rdAbsCut, rdRatioCut, marginExpanded,
      thresholds: { rdDropRel: RD_DROP_REL, opMarginImprovePP: OPMARGIN_IMPROVE_PP }
    },
    reason,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'R&D-Cut Guard: flag if R&D drops >20% YoY AND op-margin expands >2pp YoY (real-EM red flag, Roychowdhury 2006)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'flag',
  evaluate
};
