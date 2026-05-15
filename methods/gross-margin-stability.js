'use strict';
const H = require('./_helpers.js');

const ID = 'gross-margin-stability';
const LABEL = 'GM-Stability (CoV)';
const THRESHOLD = 0.10;  // CoV <= 10%
const THRESHOLD_OP = 'lte';

function _stdev(arr) {
  // Bug #7: guard against length-1 input (variance denominator = 0)
  if (arr.length < 2) return { mean: arr[0] || 0, std: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);  // sample stdev
  return { mean, std: Math.sqrt(variance) };
}

function evaluate(stock) {
  const revs = (stock && stock.annual && stock.annual.annualRev) || [];
  const gps = (stock && stock.annual && stock.annual.annualGP) || [];
  if (revs.length < 4 || gps.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need ≥ 4 annual rev+gp, got rev=${revs.length} gp=${gps.length}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const margins = [];
  for (let i = 0; i < 4; i++) {
    const r = revs[i] && revs[i].value;
    const g = gps[i] && gps[i].value;
    if (r == null || g == null || r <= 0) continue;
    margins.push(g / r);
  }
  if (margins.length < 3) {
    return H.buildResult({
      computable: false,
      reason: `usable margin-points < 3 (got ${margins.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const { mean, std } = _stdev(margins);
  if (mean <= 0) {
    return H.buildResult({
      computable: false,
      reason: `mean GM <= 0`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const cov = std / mean;
  return H.buildResult({
    value: cov,
    pass: cov <= THRESHOLD,
    computable: true,
    components: { margins, mean, std },
    reason: `mean=${(mean*100).toFixed(1)}% std=${(std*100).toFixed(2)}% CoV=${(cov*100).toFixed(2)}%`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Gross-Margin Coefficient-of-Variation über 4 Jahre ≤ 10% (Pricing-Power-Stability)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
