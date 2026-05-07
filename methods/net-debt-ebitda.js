'use strict';
const H = require('./_helpers.js');

const ID = 'net-debt-ebitda';
const LABEL = 'Net-Debt/EBITDA';
const THRESHOLD = 3;
const THRESHOLD_OP = 'lte';

function evaluate(stock) {
  // EBITDA-Approximation: OpInc + Depreciation+Amortization. Yahoo's annualOpInc available.
  // Simpler approximation: use 1.2× annualOpInc as EBITDA-proxy (D&A is typically 15-25% of OpInc).
  // BUT: better — use FCF + Capex + Tax + Interest as EBITDA proxy. We don't have all.
  // Pragmatic: EBITDA ≈ annualOpInc × 1.2 (industry-rough). Document this approximation.
  const opInc = H.latestAnnual(stock, 'annualOpInc');
  const totalDebt = H.latestBalance(stock, 'totalDebt');
  const totalCash = H.latestBalance(stock, 'totalCash');
  if (opInc == null || totalDebt == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: opInc=${opInc}, totalDebt=${totalDebt}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ebitda = opInc * 1.2;
  if (ebitda <= 0) {
    return H.buildResult({
      computable: false,
      reason: `EBITDA <= 0 (opInc=${opInc})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const netDebt = totalDebt - (totalCash || 0);
  const value = netDebt / ebitda;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { netDebt, ebitda, totalDebt, totalCash: totalCash || 0, opInc },
    reason: `(${(totalDebt/1e9).toFixed(1)}B - ${((totalCash||0)/1e9).toFixed(1)}B) / ${(ebitda/1e9).toFixed(1)}B = ${value.toFixed(2)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Net Debt / EBITDA ≤ 3 (EBITDA approx via OpInc × 1.2)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
