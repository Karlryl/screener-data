'use strict';
/**
 * Tag 196: Operating-Leverage (3Y Incremental Margin)
 * ====================================================
 * Measures how many cents of new operating income each new dollar of revenue
 * produced over the trailing 3 years. Practitioner blogs and SaaS analysts
 * prefer this to the academic DOL (= %ΔOI / %ΔRev) because:
 *
 *   - Handles loss-to-profit transitions naturally (DOL blows up when the
 *     base OI is small or negative, producing meaningless percentages).
 *   - Directly interpretable: 0.40 → 40 cents of OI per $1 of new revenue.
 *   - Smooths year-to-year lumpiness through a 3-year window.
 *
 *   value = (annualOpInc[0] - annualOpInc[3]) / (annualRev[0] - annualRev[3])
 *   pass  = value >= 0.25  (25%+ of incremental revenue flows to OI)
 *
 * Gates:
 *   - need ≥ 4 annual OI + 4 annual Rev points
 *   - ΔRev must be > 0 and the 3-year revenue growth ≥ 10%
 *     (small ΔRev makes the ratio numerically unstable and the signal noise)
 *   - clamp display reason to ±9.99 for sanity, but value itself is unclamped
 *
 * Why not also DOL: a separate diagnostic might add it later. Keep this
 * method single-purpose; mixing metrics inside one method hides edge cases.
 */
const H = require('./_helpers.js');

const ID = 'operating-leverage';
const LABEL = 'OpLeverage (3Y Incr. Margin)';
const THRESHOLD = 0.25;
const THRESHOLD_OP = 'gte';
const MIN_REV_GROWTH_3Y = 0.10;  // require ≥ 10% rev growth over 3y for ratio stability

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  const oiArr = (stock && stock.annual && stock.annual.annualOpInc) || [];
  if (revArr.length < 4 || oiArr.length < 4) {
    return H.buildResult({
      computable: false,
      reason: 'need ≥ 4 annual rev+OpInc points; got rev=' + revArr.length + ' oi=' + oiArr.length,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const rev0 = _unwrap(revArr[0]);
  const rev3 = _unwrap(revArr[3]);
  const oi0 = _unwrap(oiArr[0]);
  const oi3 = _unwrap(oiArr[3]);

  if (rev0 == null || rev3 == null || oi0 == null || oi3 == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing values: rev0=' + rev0 + ' rev3=' + rev3 + ' oi0=' + oi0 + ' oi3=' + oi3,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // ΔRev must be positive and ≥ 10% of base. Negative or near-zero growth
  // makes the ratio either meaningless (division near zero) or invertedly
  // signed (which doesn't reflect operating leverage).
  const dRev = rev0 - rev3;
  if (rev3 <= 0 || dRev <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'rev3=' + (rev3/1e9).toFixed(2) + 'B → rev0=' + (rev0/1e9).toFixed(2) + 'B (no positive growth)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const revGrowth3y = dRev / rev3;
  if (revGrowth3y < MIN_REV_GROWTH_3Y) {
    return H.buildResult({
      computable: false,
      reason: '3y rev growth ' + (revGrowth3y*100).toFixed(1) + '% < ' + (MIN_REV_GROWTH_3Y*100) + '% gate',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const dOI = oi0 - oi3;
  const value = dOI / dRev;
  const displayValue = Math.max(-9.99, Math.min(9.99, value));

  return H.buildResult({
    value,
    pass: value >= THRESHOLD,
    computable: true,
    components: {
      revStart: rev3, revEnd: rev0,
      oiStart: oi3, oiEnd: oi0,
      deltaRev: dRev, deltaOI: dOI,
      revGrowth3y
    },
    reason: 'ΔOI=' + (dOI/1e9).toFixed(2) + 'B / ΔRev=' + (dRev/1e9).toFixed(2) + 'B = ' + displayValue.toFixed(2) +
            ' (3y rev growth ' + (revGrowth3y*100).toFixed(0) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: '3-Jahres Incremental-Margin (ΔOpInc/ΔRev) ≥ 0.25 — Operating-Leverage Quality-Signal',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
