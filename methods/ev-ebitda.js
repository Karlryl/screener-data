'use strict';
const H = require('./_helpers.js');

const ID = 'ev-ebitda';
const LABEL = 'EV/EBITDA';
const THRESHOLD = 20;
const THRESHOLD_OP = 'lte';

function evaluate(stock) {
  const mcap = stock && stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value);
  const totalDebt = H.latestBalance(stock, 'totalDebt');
  const totalCash = H.latestBalance(stock, 'totalCash');
  const opInc = H.latestAnnual(stock, 'annualOpInc');
  if (mcap == null || opInc == null || totalDebt == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: mcap=${mcap} opInc=${opInc} debt=${totalDebt}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ev = mcap + totalDebt - (totalCash || 0);
  const ebitda = opInc * 1.2;
  if (ebitda <= 0) {
    return H.buildResult({
      computable: false, reason: 'EBITDA ≤ 0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = ev / ebitda;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { mcap, totalDebt, totalCash: totalCash || 0, ev, ebitda, opInc },
    reason: `EV=${(ev/1e9).toFixed(1)}B / EBITDA=${(ebitda/1e9).toFixed(1)}B = ${value.toFixed(1)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'EV / EBITDA-Approx ≤ 20 (klassische Bewertung)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
