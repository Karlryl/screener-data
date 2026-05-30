'use strict';
/**
 * Workstream B: Rule-of-40 (SBC-adjusted) — DIAGNOSTIC.
 *
 * Vanilla Rule-of-40 (revenueGrowthYoY + fcfMarginTTM) is gameable: stock-based
 * compensation (SBC) is a real economic cost but is added back in operating
 * cash flow, so FCF margin systematically OVERSTATES owner economics for
 * heavy-SBC software names (Okta, Snowflake, etc.). This method subtracts SBC
 * as a % of revenue from the FCF-margin term:
 *
 *   value = revenueGrowthYoY + (fcfMarginTTM - sbcPctOfRevenue)
 *   sbcPctOfRevenue = abs(annualSBC[0]) / annualRev[0] * 100
 *
 * pass = value >= rule_of_40 threshold (40 by default; config-overridable).
 *
 * SBC-INFLATION FLAG: independent of the pass/fail, we flag the optical-FCF
 * tell — a large gap between FCF margin and EBITDA margin. When FCF margin
 * materially exceeds EBITDA margin, reported FCF is being inflated by non-cash
 * add-backs (SBC) and/or working-capital / capitalization effects rather than
 * by genuine operating profitability. components.sbcInflationFlag = true when
 *   (fcfMarginTTM - ebitdaMargin) > 15 percentage points.
 *
 * EBITDA margin source (verified): pull-yahoo.js persists metrics.ebitdaMargins
 * (Yahoo financialData.ebitdaMargins * 100, i.e. already in percentage points)
 * and metrics.ebitda (absolute). We prefer metrics.ebitdaMargins; fall back to
 * metrics.ebitda / metrics.revenueTTM * 100; if neither is available we set
 * sbcInflationFlag=false and note 'ebitda-unavailable' in components.
 *
 * DIAGNOSTIC: NOT in any SCORE_WEIGHTS → fixture-hash safe by construction.
 */
const H = require('./_helpers.js');

const ID = 'rule-of-40-sbc-adjusted';
const LABEL = 'Rule of 40 (SBC-adjusted)';
const THRESHOLD_OP = 'gte';

// Mirror rule-of-40.js's config-load-with-fallback so this stays fixture-safe
// when filter-config.json is absent (CI default state) and tracks the same
// threshold as vanilla R40 when present.
let THRESHOLD = 40;
try {
  const cfg = require('../filter-config.json');
  if (cfg && cfg.rule_of_40 && typeof cfg.rule_of_40.threshold === 'number') {
    THRESHOLD = cfg.rule_of_40.threshold;
  }
} catch (_) { /* config absent — use hardcoded default */ }

// SBC-inflation tell: FCF margin exceeding EBITDA margin by more than this many
// percentage points indicates optical FCF (SBC add-back / capitalization).
const SBC_INFLATION_GAP_PP = 15;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  const growth = H.metricValue(stock, 'revenueGrowthYoY');
  const fcfMargin = H.metricValue(stock, 'fcfMarginTTM');

  // SBC[0] / Rev[0] — mirror sbc-revenue.js unwrap + Math.abs (Yahoo sometimes
  // stores SBC negative, counter to expense convention).
  const sbcArr = (stock && stock.annual && stock.annual.annualSBC) || [];
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  const sbcRaw = _unwrap(sbcArr[0]);
  const sbc = sbcRaw != null ? Math.abs(sbcRaw) : null;
  const rev = _unwrap(revArr[0]);

  if (growth == null || fcfMargin == null || sbc == null || rev == null || rev <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'missing inputs: growth=' + growth + ', fcfMargin=' + fcfMargin +
              ', sbc=' + sbcRaw + ', rev=' + rev,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const sbcPctOfRevenue = (sbc / rev) * 100;
  const adjustedFcfMargin = fcfMargin - sbcPctOfRevenue;
  const value = growth + adjustedFcfMargin;
  const pass = value >= THRESHOLD;

  // --- SBC-inflation flag (independent of pass/fail) ---
  // Prefer the persisted ebitdaMargins metric (already in pp); fall back to
  // ebitda / revenueTTM * 100. Unavailable → flag=false, documented reason.
  let ebitdaMargin = H.metricValue(stock, 'ebitdaMargins');
  let ebitdaSource = 'metrics.ebitdaMargins';
  if (ebitdaMargin == null) {
    const ebitdaAbs = H.metricValue(stock, 'ebitda');
    const revTTM = H.metricValue(stock, 'revenueTTM');
    if (ebitdaAbs != null && revTTM != null && revTTM > 0) {
      ebitdaMargin = (ebitdaAbs / revTTM) * 100;
      ebitdaSource = 'metrics.ebitda/revenueTTM';
    }
  }

  let sbcInflationFlag = false;
  let fcfVsEbitdaGapPp = null;
  const flags = [];
  if (ebitdaMargin == null) {
    ebitdaSource = 'ebitda-unavailable';
  } else {
    fcfVsEbitdaGapPp = fcfMargin - ebitdaMargin;
    if (fcfVsEbitdaGapPp > SBC_INFLATION_GAP_PP) {
      sbcInflationFlag = true;
      flags.push('SBC_INFLATED_FCF');
    }
  }

  const components = {
    growth,
    fcfMargin,
    sbcPctOfRevenue,
    adjustedFcfMargin,
    ebitdaMargin,
    ebitdaSource,
    fcfVsEbitdaGapPp,
    sbcInflationFlag
  };

  const result = H.buildResult({
    value, pass, computable: true, components,
    reason: growth.toFixed(1) + ' + (' + fcfMargin.toFixed(1) + ' − ' +
            sbcPctOfRevenue.toFixed(1) + ' SBC%) = ' + value.toFixed(1) +
            (sbcInflationFlag ? ' [SBC-inflated FCF: FCF−EBITDA gap ' +
              fcfVsEbitdaGapPp.toFixed(1) + 'pp]' : ''),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
  if (flags.length) result.flags = flags;
  return result;
}

module.exports = {
  id: ID, label: LABEL,
  description: 'SBC-adjusted Rule of 40: revenueGrowthYoY + (fcfMarginTTM − SBC%/rev) ≥ 40; ' +
               'flags optical-FCF when FCF margin exceeds EBITDA margin by >15pp (DIAGNOSTIC)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
