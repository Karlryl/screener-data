'use strict';
const H = require('./_helpers.js');

const ID = 'quarterly-earnings-stability';
const LABEL = '8Q Earnings-Stability';
const THRESHOLD = 6;  // ≥6 von 8 Quartalen profitable
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  const ts = (stock && stock.timeseries && stock.timeseries.netIncomeQ) || [];
  if (ts.length < 4) {
    return H.buildResult({
      computable: false,
      reason: `need ≥4 quarterly NI (got ${ts.length})`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  // Use up to 8 most recent quarters
  const window = ts.slice(0, 8);
  let positive = 0;
  for (const q of window) {
    const v = q && (typeof q === 'number' ? q : q.value);
    if (v != null && v > 0) positive++;
  }
  // Scale threshold by available window length to avoid penalizing stocks with fewer than 8 quarters.
  // F-ME-003 (Tag 184): Math.ceil pushed small-window stocks to stricter pass rates
  // than the canonical 6/8 = 75% — same pattern as piotroski Bug #19. E.g. window=5
  // → Math.ceil(3.75)=4 → 80% required, harsher than intended. Use Math.round to
  // keep the effective rate ~75% across window sizes.
  const scaled = Math.max(1, Math.round(THRESHOLD * window.length / 8));
  return H.buildResult({
    value: positive,
    pass: positive >= scaled,
    computable: true,
    components: { positiveQuarters: positive, totalQuarters: window.length, scaledThreshold: scaled },
    reason: `${positive} / ${window.length} Quartale NI > 0 (need >=${scaled})`,
    threshold: scaled, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'NetIncome > 0 in ≥6 von letzten 8 Quartalen (Earnings-Konsistenz)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
