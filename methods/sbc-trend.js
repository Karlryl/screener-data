'use strict';
/**
 * Tag 201: SBC-Trend (3y SBC/Revenue Ratio Direction)
 * ====================================================
 * Quality-Compounder signal: is stock-based-compensation as a share
 * of revenue IMPROVING (i.e. falling) over the last 3 fiscal years?
 *
 *   ratioNow   = abs(annualSBC[0]) / annualRev[0]
 *   ratioPrior = abs(annualSBC[2]) / annualRev[2]
 *   delta      = ratioNow - ratioPrior
 *
 *   pass = delta <= 0    (ratio improved or stayed flat)
 *
 * FAILURE MODE THIS DETECTS:
 *   sbc-revenue.js measures the LEVEL of SBC/Revenue today.
 *   sbc-growth-ratio.js measures the SPEED of SBC growth vs revenue
 *   growth across the most recent year.
 *   Neither catches the slow-burn case where SBC/Revenue starts at a
 *   tolerable 12% but creeps up year-over-year to 14% → 16% → 18%.
 *   That trajectory is a compounding-killer (dilution faster than
 *   per-share value creation) even though each single-year reading
 *   passes existing gates. This method surfaces the 3y DIRECTION as
 *   an independent diagnostic so an unfavourable drift is visible.
 *
 * Why abs() on SBC:
 *   Yahoo occasionally reports SBC with a negative sign (counter to
 *   expense convention). sbc-revenue.js fixed this same trap in
 *   F-ME-002 (Tag 179) and fcf-yield.js in Tag 174 #16. Without
 *   Math.abs a -$10B SBC becomes a "negative ratio" that trivially
 *   improves — hiding the real signal.
 *
 * Edge cases:
 *   - <3y of SBC or revenue data → computable:false.
 *   - rev[0] <= 0 or rev[2] <= 0 → computable:false (denominator).
 *   - SBC null in either year → computable:false (incomplete series).
 *   - SBC[2] = 0 and SBC[0] > 0 → ratioPrior=0 → delta>0 → pass=false
 *     (correctly: dilution emerging from nothing is still dilution).
 *
 * Pattern-based: no hardcoded tickers.
 */
const H = require('./_helpers.js');

const ID = 'sbc-trend';
const LABEL = 'SBC-Trend (3y Δ)';
const THRESHOLD = 0;
const THRESHOLD_OP = 'lte';

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  const sbcArr = (stock && stock.annual && stock.annual.annualSBC) || [];
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];

  if (sbcArr.length < 3 || revArr.length < 3) {
    return H.buildResult({
      computable: false,
      reason: 'need >= 3y of SBC + Rev (sbc=' + sbcArr.length + ', rev=' + revArr.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const sbc0Raw = _unwrap(sbcArr[0]);
  const sbc2Raw = _unwrap(sbcArr[2]);
  const rev0 = _unwrap(revArr[0]);
  const rev2 = _unwrap(revArr[2]);

  if (sbc0Raw == null || sbc2Raw == null || rev0 == null || rev2 == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing values: sbc0=' + sbc0Raw + ', sbc2=' + sbc2Raw +
              ', rev0=' + rev0 + ', rev2=' + rev2,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (rev0 <= 0 || rev2 <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'revenue <= 0 (rev0=' + rev0 + ', rev2=' + rev2 + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Normalize SBC sign — see header comment / sbc-revenue.js F-ME-002.
  const sbc0 = Math.abs(sbc0Raw);
  const sbc2 = Math.abs(sbc2Raw);
  const ratioNow = sbc0 / rev0;
  const ratioPrior = sbc2 / rev2;
  const delta = ratioNow - ratioPrior;

  return H.buildResult({
    value: delta,
    pass: delta <= THRESHOLD,
    computable: true,
    components: {
      ratioNow: Math.round(ratioNow * 10000) / 10000,
      ratioPrior: Math.round(ratioPrior * 10000) / 10000,
      delta: Math.round(delta * 10000) / 10000,
      sbc0, sbc2, rev0, rev2
    },
    reason: 'SBC/Rev ' + (ratioPrior * 100).toFixed(1) + '% (Y-2) → ' +
            (ratioNow * 100).toFixed(1) + '% (Y0) Δ=' +
            (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + 'pp',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'SBC/Revenue-Verhältnis verbessert sich über 3 Jahre — Dilutions-Trajektorie',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio-Δ',
  evaluate
};
