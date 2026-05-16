'use strict';
/**
 * Tag 199g: Operating-Margin-Acceleration
 * =========================================
 * Pre-Breakout signal: operating margin improved across 3 consecutive
 * periods. Parallel to gross-margin-acceleration (Tag 195) but applied
 * to operating margin — the cleaner leading-indicator of operating
 * leverage (GM acceleration can be commodity-price tailwind; OM
 * acceleration requires the business to actually scale fixed costs).
 *
 *   pass     = 3 consecutive period-over-period OpM improvements
 *   trend    = accelerating | stable | decelerating
 *
 * Why a separate method:
 *   - margin-quality and margin-decay focus on level + stability
 *   - opinc-margin-spike focuses on outlier detection
 *   - This one focuses on DIRECTION across multiple periods — the
 *     "operating-leverage breakthrough" pattern that precedes
 *     classification flips from TURNAROUND → RECENT → STABLE
 *
 * Yahoo data: annualOpInc and annualRev — annual fallback used because
 * Yahoo provides ~5 quarters per snapshot (need 4 OM points → 4 OI + 4
 * Rev quarters). Annual provides 4 years → 3 OM deltas.
 *
 * Research-backed: Damodaran's "Story-to-Numbers" framework explicitly
 * cites sustained operating-margin expansion as the highest-conviction
 * signal that fixed-cost leverage is real, distinguishing a structural
 * compounder from a cyclical recovery.
 */
const H = require('./_helpers.js');

const ID = 'operating-margin-acceleration';
const LABEL = 'OpM-Acceleration';
const THRESHOLD = 0;
const THRESHOLD_OP = 'gt';
const PERIODS_REQUIRED = 4;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _classify(deltas) {
  const min = Math.min(...deltas);
  const max = Math.max(...deltas);
  if (min > 0) return 'accelerating';
  if (max < 0) return 'decelerating';
  return 'stable';
}

function evaluate(stock) {
  const revArr = (stock && stock.annual && stock.annual.annualRev) || [];
  const oiArr = (stock && stock.annual && stock.annual.annualOpInc) || [];

  if (revArr.length < PERIODS_REQUIRED || oiArr.length < PERIODS_REQUIRED) {
    return H.buildResult({
      computable: false,
      reason: 'need ≥ ' + PERIODS_REQUIRED + ' annual rev+OpInc points (got rev=' +
              revArr.length + ' oi=' + oiArr.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const margins = [];
  for (let i = 0; i < PERIODS_REQUIRED; i++) {
    const r = _unwrap(revArr[i]);
    const o = _unwrap(oiArr[i]);
    if (r == null || o == null || r <= 0) {
      return H.buildResult({
        computable: false,
        reason: 'period ' + i + ': rev=' + r + ' oi=' + o,
        threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
      });
    }
    margins.push(o / r * 100);  // percentage-points
  }

  // margins[0] is the latest. 3 deltas: latest-vs-prev, prev-vs-prev2, prev2-vs-prev3.
  const deltas = [
    margins[0] - margins[1],
    margins[1] - margins[2],
    margins[2] - margins[3]
  ];
  const minDelta = Math.min(...deltas);
  const trend = _classify(deltas);
  const change3y = margins[0] - margins[3];

  return H.buildResult({
    value: minDelta,
    pass: minDelta > THRESHOLD,
    computable: true,
    components: {
      trend,
      change3y,
      om: margins.map(m => Math.round(m * 100) / 100),
      deltas: deltas.map(d => Math.round(d * 100) / 100)
    },
    reason: trend + ': ' +
            margins.slice().reverse().map(m => m.toFixed(1) + '%').join(' → ') +
            ' Δ3y=' + (change3y >= 0 ? '+' : '') + change3y.toFixed(1) + 'pp',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Operating-Margin verbessert sich in 3 aufeinanderfolgenden Jahren — Operating-Leverage-Signal',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'pp',
  evaluate
};
