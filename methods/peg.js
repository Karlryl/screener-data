'use strict';
const H = require('./_helpers.js');

const ID = 'peg';
// audit F-A-2026-06-22: prevents mislabeling a revenue-growth ratio as earnings-PEG,
// which under-prices margin-dilutive growth. The pipeline (pull-yahoo.js) produces ONLY
// revenueGrowthYoY — there are zero producer sites for earningsGrowthYoY/epsGrowthYoY —
// so the old earnings-growth preference chain was dead code and this metric was always
// P/E ÷ revenue-growth despite the 'Lynch PEG' label. Relabeled to reflect actual semantics.
// (Numeric value, threshold and pass/fail are unchanged: still pe / revenueGrowthYoY.)
const LABEL = 'P/Rev-Growth';
const THRESHOLD = 1.5;
const THRESHOLD_OP = 'lte';

function evaluate(stock) {
  const pe_val = H.metricValue(stock, 'pe');
  const pe = (pe_val != null) ? pe_val : H.metricValue(stock, 'forwardPE');
  // audit F-A-2026-06-22: earningsGrowthYoY/epsGrowthYoY are never produced by the
  // pipeline, so the former preference chain (eg1/eg2 -> earningsGrowth) was inert and
  // growthSource was always 'Rev'. Removed the dead branch and read revenueGrowthYoY
  // directly so the code no longer pretends to use earnings growth it can never see.
  const growth = H.metricValue(stock, 'revenueGrowthYoY');
  const growthSource = 'Rev';
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
  // audit F-A-2026-06-22: description no longer claims Lynch-PEG / earnings semantics;
  // the ratio is P/E ÷ revenue growth (the only growth the pipeline produces).
  id: ID, label: LABEL,
  description: 'P/E ÷ Revenue-Growth ≤ 1.5',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
