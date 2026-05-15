'use strict';
/**
 * Tag 197: Revenue-Quality (CoV of YoY Growth Rates)
 * ====================================================
 * Measures how consistent annual revenue growth has been over the past
 * 4 years. Computes 3 YoY growth rates from 4 annual data points and
 * returns the coefficient of variation (std / mean).
 *
 *   value = CoV(YoY growth) = stdev / mean
 *   pass  = CoV <= 0.30   (growth varies by ≤ 30% of its own mean)
 *
 * Why CoV rather than absolute stdev:
 *   - normalizes across growth tiers — a 5%-grower with ±2pp swings is
 *     just as "noisy" as a 20%-grower with ±8pp swings.
 *   - directly comparable across sectors and market caps.
 *
 * Why a separate method from revenue-volatility-guard / revenue-shock-guard:
 *   - those are DATAGUARDs that detect single-year outliers or shocks
 *     (HARD FAIL on hits). This one is a DIAGNOSTIC that scores
 *     consistency across the whole window — used as a quality signal
 *     for compounders, not as a disqualifier.
 *
 * Gates:
 *   - need ≥ 4 annual revenue points
 *   - all 4 must be positive (CoV undefined on negative/zero base)
 *   - mean growth must be ≥ 5% (low-mean denominators inflate CoV
 *     misleadingly; near-zero growth isn't "quality consistency")
 *
 * Quarterly fallback not implemented: Yahoo provides only ~5 quarters
 * per snapshot — not enough quarters for a CoV-grade signal. Annual
 * is the only source with adequate depth.
 */
const H = require('./_helpers.js');

const ID = 'revenue-quality';
const LABEL = 'Rev-Quality (CoV YoY)';
const THRESHOLD = 0.30;
const THRESHOLD_OP = 'lte';
const MIN_MEAN_GROWTH = 0.05;  // 5%

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _stdev(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  // sample stdev (n-1) to match gross-margin-stability convention
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function evaluate(stock) {
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  if (revArr.length < 4) {
    return H.buildResult({
      computable: false,
      reason: 'need ≥ 4 annual revenue points (got ' + revArr.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const revs = [];
  for (let i = 0; i < 4; i++) {
    const v = _unwrap(revArr[i]);
    if (v == null || v <= 0) {
      return H.buildResult({
        computable: false,
        reason: 'rev[' + i + ']=' + v + ' (need positive across 4y)',
        threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
      });
    }
    revs.push(v);
  }

  // YoY growth rates: 3 values from 4 annual points (newest first).
  // growths[0] = (rev[0] - rev[1]) / rev[1]  — most recent year
  // growths[1] = (rev[1] - rev[2]) / rev[2]
  // growths[2] = (rev[2] - rev[3]) / rev[3]  — oldest year
  const growths = [
    (revs[0] - revs[1]) / revs[1],
    (revs[1] - revs[2]) / revs[2],
    (revs[2] - revs[3]) / revs[3]
  ];

  const { mean, std } = _stdev(growths);

  if (mean < MIN_MEAN_GROWTH) {
    return H.buildResult({
      computable: false,
      reason: 'mean YoY growth ' + (mean*100).toFixed(1) + '% < ' + (MIN_MEAN_GROWTH*100) + '% gate',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // CoV uses |mean| to handle theoretical negative-mean cases, though the
  // MIN_MEAN_GROWTH gate above already ensures mean > 0 in practice.
  const cov = std / Math.abs(mean);

  return H.buildResult({
    value: cov,
    pass: cov <= THRESHOLD,
    computable: true,
    components: {
      growths: growths.map(g => Math.round(g * 10000) / 10000),
      meanGrowth: mean,
      stdGrowth: std
    },
    reason: 'YoY=[' + growths.map(g => (g*100).toFixed(0) + '%').join(', ') + '] ' +
            'mean=' + (mean*100).toFixed(1) + '% std=' + (std*100).toFixed(1) + 'pp CoV=' + cov.toFixed(2),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Coefficient-of-Variation der YoY-Wachstumsraten über 4 Jahre ≤ 0.30 (Wachstums-Konsistenz)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
