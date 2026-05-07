'use strict';
const H = require('./_helpers.js');

const ID = 'fcf-yield';
const LABEL = 'FCF-Yield';
const THRESHOLD = 0.05;  // 5%
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  const fcf = H.latestAnnual(stock, 'annualFCF');
  const mcap = stock && stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value);
  const eff = H.effectiveThreshold(stock, ID, THRESHOLD);
  if (fcf == null || mcap == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: fcf=${fcf}, marketCap=${mcap}`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  if (mcap <= 0) {
    return H.buildResult({
      computable: false,
      reason: `marketCap <= 0`,
      threshold: eff.threshold, thresholdOp: THRESHOLD_OP
    });
  }
  const value = fcf / mcap;
  return H.buildResult({
    value,
    pass: value >= eff.threshold,
    computable: true,
    components: { fcf, marketCap: mcap, thresholdSource: eff.source },
    reason: `${(fcf/1e9).toFixed(2)}B / ${(mcap/1e9).toFixed(1)}B = ${(value*100).toFixed(2)}% (vs ${(eff.threshold*100).toFixed(1)}%, ${eff.source})`,
    threshold: eff.threshold, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'FCF / Market Cap ≥ 5% (Bewertungs-Sanity-Check, "wie teuer ist Profitabilität")',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
