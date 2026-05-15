'use strict';
const H = require('./_helpers.js');

const ID = 'working-capital-anomaly';
const LABEL = 'WC-Growth vs Sales-Growth';
const THRESHOLD = 1.3;
const THRESHOLD_OP = 'lte';

// Yahoo's annualBalance hat aktuell keine direkten Receivables/Inventories.
// Approximation: Working-Capital-Proxy = TotalAssets - TotalDebt - TotalCash
// (operative Vermögen ohne Cash und Schulden — Receivables + Inventories + andere)
// Wenn dieser WC-Proxy schneller wächst als Sales → Manipulation-Verdacht.
function evaluate(stock) {
  const balances = (stock && stock.annual && stock.annual.annualBalance) || [];
  const revs = (stock && stock.annual && stock.annual.annualRev) || [];
  if (balances.length < 2 || revs.length < 2) {
    return H.buildResult({
      computable: false,
      reason: `need 2y balance+rev (bal=${balances.length} rev=${revs.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  function wcProxy(b) {
    const a = b.totalAssets, d = b.totalDebt || 0, c = b.totalCash || 0;
    if (a == null) return null;
    return a - d - c;
  }
  // F-ME-005 (Tag 183): unwrap plain numbers AND {value} envelopes uniformly.
  // Previously rev[i] && rev[i].value treated plain-number rev[i] as undefined.
  function _unwrap(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
    return null;
  }
  const wcT = wcProxy(balances[0]);
  const wcT1 = wcProxy(balances[1]);
  const revT = _unwrap(revs[0]);
  const revT1 = _unwrap(revs[1]);
  if (wcT == null || wcT1 == null || revT == null || revT1 == null) {
    return H.buildResult({
      computable: false, reason: `missing values`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (wcT1 <= 0 || revT1 <= 0) {
    return H.buildResult({
      computable: false, reason: `wcT1 or revT1 <= 0`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const wcGrowth = wcT / wcT1;
  const salesGrowth = revT / revT1;
  if (salesGrowth <= 0) {
    return H.buildResult({
      computable: false, reason: `sales growth <= 0`, threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = wcGrowth / salesGrowth;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { wcT, wcT1, revT, revT1, wcGrowth, salesGrowth },
    reason: `WC growth ${((wcGrowth-1)*100).toFixed(0)}% vs Sales ${((salesGrowth-1)*100).toFixed(0)}% → ratio=${value.toFixed(2)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Working-Capital-Wachstum / Sales-Wachstum ≤ 1.3 (WC-Manipulation-Detektor)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
