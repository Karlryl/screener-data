'use strict';
const H = require('./_helpers.js');

const ID = 'emerging-profitable';
const LABEL = 'Emerging Profitable';
const THRESHOLD = 1;
const THRESHOLD_OP = 'gte';

// Hypergrowth-Discovery-Variante: letztes Jahr profitable + verbessert sich gegenüber vor 2 Jahren.
// Pass: Y-0 NI > 0 UND Y-0 NI > Y-1 NI (improvement trend).
// Fängt Recent-IPO-Hypergrowth (CRDO, ALAB) die GERADE profitabel werden.
function evaluate(stock) {
  const ni = (stock.annual?.annualNetIncome) || [];
  if (ni.length < 2) {
    return H.buildResult({
      computable: false, reason: `need 2y NI (got ${ni.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const niY0 = ni[0]?.value;
  const niY1 = ni[1]?.value;
  if (niY0 == null || niY1 == null) {
    return H.buildResult({
      computable: false, reason: 'missing NI values', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const isProfitable = niY0 > 0;
  const isImproving = niY0 > niY1;
  const value = isProfitable && isImproving ? 1 : 0;
  return H.buildResult({
    value,
    pass: value >= THRESHOLD,
    computable: true,
    components: { niY0, niY1, isProfitable, isImproving },
    reason: `Y-0 NI=${(niY0/1e6).toFixed(0)}M${isProfitable ? '✓>0' : '✗≤0'}, Y-1 NI=${(niY1/1e6).toFixed(0)}M (improving=${isImproving})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'NI > 0 im letzten Jahr UND besser als Y-1 (für Hypergrowth-Discovery, Recent-IPOs)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
