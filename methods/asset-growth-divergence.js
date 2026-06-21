'use strict';
/**
 * Asset-Growth-Divergence (DATAGUARD)
 * ====================================
 * Detects M&A-driven growth: total assets growing significantly faster than revenue.
 * Computes 2-year CAGRs for both revenue and total assets, then checks whether
 * assetGrowthCAGR exceeds revGrowthCAGR by more than the threshold (15pp).
 *
 * pass = true  => NO divergence (assets growing inline with or slower than revenue) — CLEAN
 * pass = false => Divergence detected (M&A-compounder signal) — DATAGUARD fires
 *
 * Requires: >= 3 annualRev points, >= 3 annualBalance points (latest-first arrays).
 */
const H = require('./_helpers.js');

const ID = 'asset-growth-divergence';
const LABEL = 'Asset-Growth-Divergence';
const THRESHOLD = 0.15;   // 15 percentage-point spread (as decimal)
const THRESHOLD_OP = 'lte';

/**
 * Compute 2-year CAGR from a latest-first array.
 * Accepts both plain-number arrays and [{value: ...}] arrays.
 * Returns null if calculation is not possible.
 */
function _cagr2y(arr) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  const toNum = v => (v == null ? null : (typeof v === 'number' ? v : (v.value != null ? v.value : null)));
  const latest = toNum(arr[0]);
  const oldest = toNum(arr[2]);
  if (latest == null || oldest == null || oldest <= 0) return null;
  return Math.pow(latest / oldest, 1 / 2) - 1;  // as decimal, not %
}

function evaluate(stock) {
  const revArr  = (stock && stock.annual && stock.annual.annualRev)     || [];
  const balArr  = (stock && stock.annual && stock.annual.annualBalance) || [];

  if (revArr.length < 3) {
    return H.buildResult({
      computable: false,
      reason: `need >= 3 annual revenue points, got ${revArr.length}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (balArr.length < 3) {
    return H.buildResult({
      computable: false,
      reason: `need >= 3 annual balance points, got ${balArr.length}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // audit F-A-2026-06-21: prevents CAGR spread computed across mismatched fiscal
  // windows when one series has a gap year the other lacks. annualRev (income
  // statement) and annualBalance (balance sheet) are built from independent Yahoo
  // modules / QS->FTS overrides and carry NO per-entry fiscal-year label — index
  // is the only alignment. _cagr2y reads positional [0]/[2] from each array
  // independently, so if the two series have different year coverage the spread
  // subtracts CAGRs measured over different windows and fires/clears the 8-point
  // M&A red-flag on a miscomputed value. A length divergence is the only
  // structurally-detectable symptom of that desync; refuse to score it rather
  // than emit a silent false signal. Equal-length aligned series (the normal
  // mega-cap case) are unaffected — same indices, same result as before.
  if (revArr.length !== balArr.length) {
    return H.buildResult({
      computable: false,
      reason: `annualRev (${revArr.length}) and annualBalance (${balArr.length}) length mismatch — fiscal-year alignment cannot be verified (no period labels); spread would compare different windows`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Extract totalAssets from annualBalance entries
  const assetArr = balArr.map(b => (b && b.totalAssets != null ? b.totalAssets : null));
  const assetArrClean = assetArr.slice(0, 3);
  if (assetArrClean.some(v => v == null || v <= 0)) {
    return H.buildResult({
      computable: false,
      reason: 'one or more totalAssets values missing or <= 0 in first 3 balance entries',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const revCAGR   = _cagr2y(revArr);
  const assetCAGR = _cagr2y(assetArrClean);

  if (revCAGR == null) {
    return H.buildResult({
      computable: false,
      reason: 'revenue CAGR calculation failed (zero or negative oldest value)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (assetCAGR == null) {
    return H.buildResult({
      computable: false,
      reason: 'asset CAGR calculation failed (zero or negative oldest totalAssets)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // spread = assetGrowthCAGR - revGrowthCAGR (positive = assets outpacing revenue)
  const spread = assetCAGR - revCAGR;

  // pass = true when spread <= threshold (no problematic divergence)
  const pass = spread <= THRESHOLD;

  const toNum = v => (v == null ? null : (typeof v === 'number' ? v : (v.value != null ? v.value : null)));
  const latestRev    = toNum(revArr[0]);
  const oldestRev    = toNum(revArr[2]);
  const latestAssets = assetArrClean[0];
  const oldestAssets = assetArrClean[2];

  return H.buildResult({
    value: spread,
    pass,
    computable: true,
    components: {
      revCAGR,
      assetCAGR,
      spread,
      latestRev,
      oldestRev,
      latestAssets,
      oldestAssets
    },
    reason: `assetCAGR=${(assetCAGR*100).toFixed(1)}% revCAGR=${(revCAGR*100).toFixed(1)}% spread=${(spread*100).toFixed(1)}pp${!pass ? ' [M&A-SIGNAL]' : ''}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Asset-Growth-Divergence: flags M&A-driven growth when totalAssets 2y-CAGR exceeds revenue 2y-CAGR by > 15pp',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
