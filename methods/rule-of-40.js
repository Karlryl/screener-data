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
const THRESHOLD = 40;
const THRESHOLD_OP = 'gte';

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
  if (growth != null && fcfMargin != null && fcfMargin < 0) {
    const annualMedian = _annualFcfMarginMedian(stock);
    if (annualMedian != null && annualMedian > 5) {
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
  // Bug #3: guard against decimal-vs-percent unit mismatch (both in [-1,1] → almost certainly decimals)
  if (Math.abs(growth) <= 1 && Math.abs(fcfMargin) <= 1) {
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
