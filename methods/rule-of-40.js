'use strict';
/**
 * Tag 201c: TTM-fcfMargin fallback to 3y annual median (anchor-repair, Agent 4).
 * MELI's TTM fcfMargin is -12.9% (driven by working-capital build for credit
 * operations) but annualFCF runs +10.8B / +7.1B / +4.6B / +2.5B — a 3y
 * median margin of ~33%. Without fallback, MELI fails R40 at 36.1 despite
 * a "real" R40 of ~82. Pattern-based: only triggers when TTM is negative AND
 * annual median is positive AND >=3y of clean annualFCF/annualRev exist.
 * Fixture has fcfMarginTTM=22 (positive) → fallback never triggers → fixture-hash-safe.
 */
const H = require('./_helpers.js');

const ID = 'rule-of-40';
const LABEL = 'Rule of 40';
const THRESHOLD_OP = 'gte';

// Load threshold from filter-config.json if present; fall back to hardcoded 40.
// This preserves fixture-hash stability when config is absent (CI default state).
let THRESHOLD = 40;
try {
  const cfg = require('../filter-config.json');
  if (cfg && cfg.rule_of_40 && typeof cfg.rule_of_40.threshold === 'number') {
    THRESHOLD = cfg.rule_of_40.threshold;
  }
} catch (_) { /* config absent — use hardcoded default */ }

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _annualFcfMarginMedian(stock) {
  const fcfArr = (stock && stock.annual && stock.annual.annualFCF) || [];
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  const n = Math.min(fcfArr.length, revArr.length, 4);
  if (n < 3) return null;
  const margins = [];
  for (let i = 0; i < n; i++) {
    const f = _unwrap(fcfArr[i]);
    const r = _unwrap(revArr[i]);
    if (f == null || r == null || r <= 0) continue;
    margins.push((f / r) * 100);
  }
  if (margins.length < 3) return null;
  margins.sort((a, b) => a - b);
  const mid = Math.floor(margins.length / 2);
  return (margins.length % 2 === 0)
    ? (margins[mid - 1] + margins[mid]) / 2
    : margins[mid];
}

function evaluate(stock) {
  const growth = H.metricValue(stock, 'revenueGrowthYoY');
  let fcfMargin = H.metricValue(stock, 'fcfMarginTTM');
  let fcfMarginSource = 'TTM';

  // Tag 201c: TTM fcfMargin is sometimes a one-quarter WC-noise artifact
  // (MELI). When TTM is negative AND a 3y annual median exists and is
  // materially positive, prefer the annual median — it represents the
  // company's structural FCF generation, not a transient WC swing.
  // F-ME-003: also require that the most recent annual FCF is positive,
  // so we don't inflate R40 for stocks with structurally declining FCF.
  // F-06 (audit 2026-06-08): the fallback must not fire for STRUCTURALLY negative FCF.
  // F-ME-003 already requires the latest annual FCF to be positive; additionally cap
  // the TTM deficit at -20pp — beyond that the negative TTM is no longer plausible
  // working-capital noise (MELI's repair case is -12.9pp) and substituting the annual
  // median would inflate R40 enough to flip FAIL→PASS for structurally FCF-negative
  // stocks. Treat such a TTM as real and let R40 fail.
  if (growth != null && fcfMargin != null && fcfMargin < 0 && fcfMargin > -20) {
    const annualMedian = _annualFcfMarginMedian(stock);
    const annualFcfArr = (stock.annual && stock.annual.annualFCF) || [];
    const latestAnnualFcf = _unwrap(annualFcfArr[0]);
    if (annualMedian != null && annualMedian > 5 && latestAnnualFcf != null && latestAnnualFcf > 0) {
      fcfMargin = annualMedian;
      fcfMarginSource = '3y-annual-median';
    }
  }

  if (growth == null || fcfMargin == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing inputs: growth=' + growth + ', fcfMargin=' + fcfMargin,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // Bug #3: guard against decimal-vs-percent unit mismatch.
  // audit F-A-2026-06-22: prevents false unit-error rejection of genuinely near-flat
  // percent inputs. Upstream guarantees percent units (pull-yahoo.js:615 revGrowthYoY =
  // revGrowth*100, :728 fcfMarginTTM = (fcfTTM/revTTM)*100), so a real low-growth value/
  // utility name (e.g. growth=+0.8%, fcfMargin=+0.5%) legitimately has BOTH terms in
  // [-1,1] yet is NOT corrupt — the old `|growth|<=1 && |fcfMargin|<=1` heuristic wrongly
  // declared it a unit error and marked it non-computable. Tighten to the actual
  // decimal-corruption signature: a divided-by-100 pair (e.g. 0.38 + 0.22) sums to a
  // combined R40 well under 2, whereas a near-flat-but-real percent pair we want to keep
  // computable (and let it simply FAIL R40). Only flag when the combined value is below
  // that floor AND at least one input is non-zero. Fixture cases (50+10, 15+10, 25+25,
  // 38+22) are all far outside this window → fixture-hash-safe.
  if (Math.abs(growth) < 1 && Math.abs(fcfMargin) < 1
      && Math.abs(growth) + Math.abs(fcfMargin) < 1
      && (growth !== 0 || fcfMargin !== 0)) {
    return H.buildResult({
      computable: false,
      reason: `unit error: growth=${growth} and fcfMargin=${fcfMargin} appear to be decimals, not percent`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = growth + fcfMargin;
  return H.buildResult({
    value, pass: value >= THRESHOLD, computable: true,
    components: { growth, fcfMargin, fcfMarginSource },
    reason: growth.toFixed(1) + ' + ' + fcfMargin.toFixed(1) +
            (fcfMarginSource !== 'TTM' ? ' [' + fcfMarginSource + ']' : '') +
            ' = ' + value.toFixed(1),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Revenue Growth YoY + FCF Margin TTM ≥ 40 (Q-Spike-Filter via hypergrowth-quality-class)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
