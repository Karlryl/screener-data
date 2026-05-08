'use strict';
const H = require('./_helpers.js');

const ID = 'stable-quarterly-growth';
const LABEL = '4Q Stable Growth';
const THRESHOLD = 1;  // alle 3 Quartal-zu-Quartal-Vergleiche pass
const THRESHOLD_OP = 'gte';

// Karl's Anforderung: Revenue-Wachstum konsistent über 4 Quartale.
// Filter ARWR-Style Spike-Stocks raus (1 Quartal +99%, andere flat/negativ).
// Pass: alle 3 von Q[i]/Q[i+1] zwischen 0.95 und 5.0 (kein -50% Drop, kein 5x-Spike)
const MIN_RATIO = 0.95;
const MAX_RATIO = 5.0;

function evaluate(stock) {
  const ts = (stock && stock.timeseries && stock.timeseries.revenueQ) || [];
  if (ts.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need ≥4 quarterly rev (got ${ts.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const values = ts.slice(0, 4).map(q => q && (typeof q === 'number' ? q : q.value)).filter(v => v != null && v > 0);
  if (values.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need 4 positive quarterly rev (got ${values.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // Q[0] is latest, Q[3] is oldest
  const ratios = [
    values[0] / values[1],  // Q latest vs Q-1
    values[1] / values[2],  // Q-1 vs Q-2
    values[2] / values[3]   // Q-2 vs Q-3
  ];
  const allStable = ratios.every(r => r >= MIN_RATIO && r <= MAX_RATIO);
  // Value: minimum ratio across the 3 (worst-case stability indicator)
  const minRatio = Math.min(...ratios);
  return H.buildResult({
    value: minRatio,
    pass: allStable,
    computable: true,
    components: { values, ratios },
    reason: `Q-Ratios: ${ratios.map(r => r.toFixed(2)).join(', ')} (alle in [${MIN_RATIO},${MAX_RATIO}]: ${allStable})`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: '4-Quartal Revenue-Stability: alle Q/Q-Ratios in [0.95, 5.0] (kein Spike, kein Crash)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
