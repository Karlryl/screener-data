'use strict';
const H = require('./_helpers.js');

const ID = 'opinc-margin-spike';
const LABEL = 'OpInc-Margin Spike';
const THRESHOLD = 1.5;  // (OI/Rev)[t] / (OI/Rev)[t-1] ≤ 1.5
const THRESHOLD_OP = 'lte';

// Wenn OpInc-Margin yoy plötzlich >50% steigt → möglicher One-Off / Manipulation.
// Pass = stable. Fail = verdächtiger Spike.
function evaluate(stock) {
  const revs = (stock && stock.annual && stock.annual.annualRev) || [];
  const ois = (stock && stock.annual && stock.annual.annualOpInc) || [];
  if (revs.length < 2 || ois.length < 2) {
    return H.buildResult({
      computable: false, reason: `need 2y rev+oi (rev=${revs.length} oi=${ois.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const revT = revs[0] && revs[0].value;
  const revT1 = revs[1] && revs[1].value;
  const oiT = ois[0] && ois[0].value;
  const oiT1 = ois[1] && ois[1].value;
  if (revT == null || revT1 == null || oiT == null || oiT1 == null || revT <= 0 || revT1 <= 0) {
    return H.buildResult({
      computable: false, reason: 'missing/zero values', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const omT = oiT / revT;
  const omT1 = oiT1 / revT1;
  if (omT1 <= 0) {
    return H.buildResult({
      computable: false, reason: 'omT1 ≤ 0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = omT / omT1;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { omT, omT1 },
    reason: `OpInc-Margin ${(omT1*100).toFixed(1)}% → ${(omT*100).toFixed(1)}% (×${value.toFixed(2)})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'OpInc-Margin yoy-Multiplier ≤ 1.5 (kein verdächtiger Margin-Spike)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
