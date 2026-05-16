'use strict';
/**
 * Tag 199j: SBC-Growth-Ratio
 * ============================
 * Dilution-risk signal. Healthy compounders keep stock-based compensation
 * growth in line with (or slower than) revenue growth. Companies whose
 * SBC outpaces revenue are diluting shareholders to finance growth, which
 * inflates GAAP profitability and masks real per-share economics.
 *
 *   sbcGrowth = (annualSBC[0] - annualSBC[1]) / annualSBC[1]
 *   revGrowth = (annualRev[0] - annualRev[1]) / annualRev[1]
 *
 *   value = sbcGrowth / revGrowth     (ratio)
 *   pass  = value <= 1.5              (SBC ≤ 1.5x rev growth rate)
 *
 * Edge cases:
 *   - revGrowth ≤ 0 → incomputable (declining revenue invalidates ratio)
 *   - annualSBC[1] ≤ 0 → incomputable (denominator)
 *   - sbcGrowth negative + revGrowth positive → value < 0 → PASS
 *     (SBC shrank while rev grew — exceptionally healthy)
 *
 * Distinct from existing sbc-revenue.js which measures SBC/Revenue LEVEL.
 * This one measures DIRECTION over time — the dynamic dilution signal.
 *
 * Audit-trace examples:
 *   NVDA SBC=$6.4B→$4.7B (34.8%), Rev=$216B→$130B (65.5%): ratio=0.53 PASS
 *   PLTR (typical SaaS): SBC grows faster than rev → ratio > 1, often > 1.5
 *
 * Pattern-based: no hardcoded tickers.
 */
const H = require('./_helpers.js');

const ID = 'sbc-growth-ratio';
const LABEL = 'SBC-vs-Rev-Growth';
const THRESHOLD = 1.5;
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

  if (sbcArr.length < 2 || revArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'need ≥ 2 annual SBC+Rev points (sbc=' + sbcArr.length + ' rev=' + revArr.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const sbc0 = _unwrap(sbcArr[0]);
  const sbc1 = _unwrap(sbcArr[1]);
  const rev0 = _unwrap(revArr[0]);
  const rev1 = _unwrap(revArr[1]);

  if (sbc0 == null || sbc1 == null || rev0 == null || rev1 == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing values',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (sbc1 <= 0 || rev1 <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'denominator <= 0 (sbc1=' + sbc1 + ', rev1=' + rev1 + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const sbcGrowth = (sbc0 - sbc1) / sbc1;
  const revGrowth = (rev0 - rev1) / rev1;

  if (revGrowth <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'revGrowth=' + (revGrowth*100).toFixed(1) + '% (no positive rev growth)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const ratio = sbcGrowth / revGrowth;
  // sbcGrowth can be negative (SBC shrank) — that's a great sign, treat as pass.
  const pass = ratio <= THRESHOLD;

  return H.buildResult({
    value: ratio,
    pass,
    computable: true,
    components: {
      sbcGrowth: Math.round(sbcGrowth * 10000) / 10000,
      revGrowth: Math.round(revGrowth * 10000) / 10000,
      sbc0, sbc1, rev0, rev1
    },
    reason: 'SBC growth ' + (sbcGrowth*100).toFixed(0) + '% / Rev growth ' +
            (revGrowth*100).toFixed(0) + '% = ' + ratio.toFixed(2) + ' (gate ≤ ' + THRESHOLD + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'SBC-Wachstum darf Revenue-Wachstum maximal 1.5x übersteigen — Dilutions-Disziplin',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
