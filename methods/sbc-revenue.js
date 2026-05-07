'use strict';
const H = require('./_helpers.js');

const ID = 'sbc-revenue';
const LABEL = 'SBC / Revenue';
const THRESHOLD = 0.15;
const THRESHOLD_OP = 'lte';

// Stock-Based-Compensation als % von Revenue. Hypergrowth-Stocks sind oft >25%, was real Earnings verwässert.
function evaluate(stock) {
  const sbcArr = (stock && stock.annual && stock.annual.annualSBC) || [];
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  if (sbcArr.length === 0 || revArr.length === 0) {
    return H.buildResult({
      computable: false,
      reason: `missing SBC or rev (sbc=${sbcArr.length}, rev=${revArr.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // SBC[0] / Rev[0]
  const sbc = sbcArr[0];
  const rev = revArr[0] && revArr[0].value;
  if (sbc == null || rev == null || rev <= 0) {
    return H.buildResult({
      computable: false,
      reason: `missing/zero values: sbc=${sbc}, rev=${rev}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = sbc / rev;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { sbc, revenue: rev },
    reason: `${(sbc/1e9).toFixed(2)}B / ${(rev/1e9).toFixed(1)}B = ${(value*100).toFixed(1)}%`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'SBC / Revenue ≤ 15% (Stock-Based-Compensation-Verwässerungs-Detektor)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
