'use strict';
const H = require('./_helpers.js');

const ID = 'peg';
const LABEL = 'PEG (Lynch)';
const THRESHOLD = 1.5;
const THRESHOLD_OP = 'lte';

function evaluate(stock) {
  const pe_val = H.metricValue(stock, 'pe');
  const pe = (pe_val != null) ? pe_val : H.metricValue(stock, 'forwardPE');
  // Bug #4: Lynch PEG should use EPS/earnings growth, not revenue growth.
  // Prefer earningsGrowthYoY or epsGrowthYoY if available; fall back to revenueGrowthYoY.
  // F-ME-009 (Tag 179): `||` falls through when earningsGrowthYoY is 0 (zero growth
  // is valid data, not missing), defeating Bug #4. Use explicit null check.
  const eg1 = H.metricValue(stock, 'earningsGrowthYoY');
  const eg2 = H.metricValue(stock, 'epsGrowthYoY');
  const earningsGrowth = eg1 != null ? eg1 : eg2;
  const growth = earningsGrowth != null ? earningsGrowth : H.metricValue(stock, 'revenueGrowthYoY');
  const growthSource = earningsGrowth != null ? 'EPS' : 'Rev';
  if (pe == null || growth == null) {
    return H.buildResult({
      computable: false, reason: `missing pe=${pe} growth=${growth}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (pe <= 0 || growth <= 0) {
    return H.buildResult({
      computable: false, reason: `pe ≤ 0 or negative growth`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // PEG: PE / Growth-as-percent (so growth=20% → 20)
  const value = pe / growth;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { pe, growthYoY: growth, growthSource },
    reason: `PE=${pe.toFixed(1)} / ${growthSource}Growth=${growth.toFixed(1)}% → PEG=${value.toFixed(2)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'PEG (P/E ÷ Growth) ≤ 1.5 (Lynch)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
