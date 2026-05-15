'use strict';
const H = require('./_helpers.js');

const ID = 'capex-trend';
const LABEL = 'Capex/Revenue Trend';
const THRESHOLD = 1.5;  // (Capex/Rev)[t] / (Capex/Rev)[t-3] ≤ 1.5
const THRESHOLD_OP = 'lte';

// Wenn Capex/Revenue über 3 Jahre stark steigt → Cash-Burn-Frühwarnsignal.
// Stable oder fallender Capex/Rev = Quality.
function evaluate(stock) {
  const capexArr = (stock && stock.annual && stock.annual.annualCapex) || [];
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  if (capexArr.length < 4 || revArr.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need 4y capex+rev (capex=${capexArr.length} rev=${revArr.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const capexT = Math.abs(typeof capexArr[0] === 'object' && capexArr[0] !== null ? capexArr[0].value : capexArr[0]);  // Yahoo gives capex as negative number
  const revT = revArr[0] && revArr[0].value;
  const capexT3 = Math.abs(typeof capexArr[3] === 'object' && capexArr[3] !== null ? capexArr[3].value : capexArr[3]);
  const revT3 = revArr[3] && revArr[3].value;
  if (capexT == null || revT == null || capexT3 == null || revT3 == null || revT <= 0 || revT3 <= 0) {
    return H.buildResult({
      computable: false, reason: `missing/zero values`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ratioT = capexT / revT;
  const ratioT3 = capexT3 / revT3;
  if (ratioT3 <= 0) {
    return H.buildResult({
      computable: false, reason: `capex/rev ratio T-3 <= 0`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = ratioT / ratioT3;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { capexT, revT, capexT3, revT3, ratioT, ratioT3 },
    reason: `Capex/Rev ${(ratioT3*100).toFixed(1)}% → ${(ratioT*100).toFixed(1)}% (×${value.toFixed(2)})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Capex/Revenue 3y-Wachstums-Multiplier ≤ 1.5 (Cash-Burn-Frühwarn)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
