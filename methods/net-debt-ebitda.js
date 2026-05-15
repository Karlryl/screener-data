'use strict';
const H = require('./_helpers.js');

const ID = 'net-debt-ebitda';
const LABEL = 'Net-Debt/EBITDA';
// Threshold set to 2.5: aligns with QC-mode "healthy leverage" expectation (≤2.5).
// Red-flag rule triggers at >4.0 (score-aggregator). Range 2.5–4.0 = graduated partial score.
const THRESHOLD = 2.5;
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
  const netDebt = totalDebt - (totalCash || 0);
  // F-ME-010 (Tag 179): when EBITDA<=0 (loss-making) and netDebt>0 (real leverage),
  // the metric is mathematically undefined but the leverage concern is real — the
  // stock has debt with no operating cash flow to service it. Previously this
  // returned computable:false, silently bypassing the QC must-gate and TURNAROUND
  // soft-guard. Now report value=999 (sentinel "infinitely high") with pass:false.
  // If netDebt<=0 (net cash, no debt service risk), keep incomputable as before.
  if (ebitda <= 0) {
    if (netDebt > 0) {
      return H.buildResult({
        value: 999, pass: false, computable: true,
        components: { netDebt, ebitda, totalDebt, totalCash: totalCash || 0, opInc, distressedFlag: true,
          approximationFlag: true, approxReason: 'EBITDA<=0 with positive net-debt — synthetic ratio=999' },
        reason: `EBITDA <= 0 (opInc=${(opInc/1e9).toFixed(1)}B) with netDebt=${(netDebt/1e9).toFixed(1)}B — DISTRESSED`,
        threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
      });
    }
    return H.buildResult({
      computable: false,
      reason: `EBITDA <= 0 but net-cash positive (opInc=${opInc}, netDebt=${netDebt})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = netDebt / ebitda;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    // Tag 121g: approximationFlag macht die EBITDA-Synthese sichtbar.
    // EBITDA = OpInc × 1.2 ist eine ~20%-Inflation gegenueber realem EBITDA.
    // Net-Debt-Ratio ist entsprechend ~20% niedriger als real - QC-Hard-Guard
    // darf nicht silent passen wenn EBITDA gar nicht aus Originaldaten kommt.
    components: {
      netDebt, ebitda, totalDebt, totalCash: totalCash || 0, opInc,
      approximationFlag: true,
      approxReason: 'EBITDA approximated as OpInc x 1.2 (D&A synthesized)'
    },
    reason: `(${(totalDebt/1e9).toFixed(1)}B - ${((totalCash||0)/1e9).toFixed(1)}B) / ${(ebitda/1e9).toFixed(1)}B = ${value.toFixed(2)} [EBITDA approx]`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Net Debt / EBITDA ≤ 2.5 (EBITDA approx via OpInc × 1.2)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
