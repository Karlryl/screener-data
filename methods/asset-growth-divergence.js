'use strict';
const H = require('./_helpers.js');

const ID = 'asset-growth-divergence';
const LABEL = 'Asset/Sales-Growth Divergence';
const THRESHOLD = 1.5;
const THRESHOLD_OP = 'lte';

// Wenn Total-Assets schneller wachsen als Revenue → Bilanz-Aufblasung möglich.
// Beneish M-Score-derivat: AGI / SGI ≤ 1.5 (Asset-Growth nicht > 1.5x Sales-Growth).
function evaluate(stock) {
  const revs = (stock && stock.annual && stock.annual.annualRev) || [];
  const balances = (stock && stock.annual && stock.annual.annualBalance) || [];
  if (revs.length < 2 || balances.length < 2) {
    return H.buildResult({
      computable: false,
      reason: `need 2y rev+balance (rev=${revs.length} bal=${balances.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const revT = revs[0] && revs[0].value;
  const revT1 = revs[1] && revs[1].value;
  const assetT = balances[0] && balances[0].totalAssets;
  const assetT1 = balances[1] && balances[1].totalAssets;
  if (revT == null || revT1 == null || assetT == null || assetT1 == null || revT1 <= 0 || assetT1 <= 0) {
    return H.buildResult({
      computable: false,
      reason: `missing/zero values: rev[t-1]=${revT1}, assets[t-1]=${assetT1}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const sgi = revT / revT1;        // Sales-Growth-Index
  const agi = assetT / assetT1;    // Asset-Growth-Index
  if (sgi <= 0) {
    return H.buildResult({
      computable: false, reason: `sgi <= 0`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = agi / sgi;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { sgi, agi, revT, revT1, assetT, assetT1 },
    reason: `Assets +${((agi-1)*100).toFixed(0)}% vs Sales +${((sgi-1)*100).toFixed(0)}% → ratio=${value.toFixed(2)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Asset-Growth nicht > 1.5× Sales-Growth (Bilanz-Aufblasungs-Detektor, Beneish-derivat)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
