'use strict';
const H = require('./_helpers.js');

const ID = 'margin-decay';
const LABEL = 'Gross-Margin Decay';
const THRESHOLD = 1.10;  // GM[t-1] / GM[t] ≤ 1.10 = pass (kein dramatischer Decay)
const THRESHOLD_OP = 'lte';

// Beneish GMI: wenn Gross-Margin sich um >10% verschlechtert → Pricing-Power-Verlust oder Kostenexplosion
function evaluate(stock) {
  const revs = (stock && stock.annual && stock.annual.annualRev) || [];
  const gps = (stock && stock.annual && stock.annual.annualGP) || [];
  if (revs.length < 2 || gps.length < 2) {
    return H.buildResult({
      computable: false,
      reason: `need 2y rev+gp (rev=${revs.length} gp=${gps.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const revT = revs[0] && revs[0].value;
  const revT1 = revs[1] && revs[1].value;
  const gpT = gps[0] && gps[0].value;
  const gpT1 = gps[1] && gps[1].value;
  if (revT == null || revT1 == null || gpT == null || gpT1 == null || revT <= 0 || revT1 <= 0) {
    return H.buildResult({
      computable: false,
      reason: `missing/zero values`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const gmT = gpT / revT;
  const gmT1 = gpT1 / revT1;
  if (gmT <= 0) {
    return H.buildResult({
      computable: false, reason: `gmT <= 0`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = gmT1 / gmT;  // GMI: >1 = decay, <1 = improvement
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { gmT, gmT1, revT, revT1, gpT, gpT1 },
    reason: `GM ${(gmT1*100).toFixed(1)}% → ${(gmT*100).toFixed(1)}% (GMI=${value.toFixed(2)})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Gross-Margin-Decay-Index ≤ 1.10 (kein dramatischer GM-Verfall yoy)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
