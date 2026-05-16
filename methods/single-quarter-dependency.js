'use strict';
/**
 * Tag 199: Single-Quarter-Dependency Guard
 * ==========================================
 * DIAGNOSTIC: detects whether a company's headline revenue growth is
 * being driven by ONE anomalous quarter. Test: re-compute TTM revenue
 * without the largest quarter and check if "growth-vs-prior-4Q-window"
 * collapses by more than 50%.
 *
 *   maxQ      = max(revQ[0..3])
 *   ttm       = sum(revQ[0..3])
 *   ttmExMax  = sum(revQ[0..3]) - maxQ
 *   priorTTM  = sum(revQ[4..7])  (or sum*3/4 if 7 quarters)
 *   priorEx   = priorTTM scaled to 3-quarter basis
 *
 *   gFull = (ttm - priorTTM) / priorTTM
 *   gEx   = (ttmExMax - priorEx) / priorEx
 *   collapse = gFull > 0 && (gFull - gEx) / gFull > 0.50
 *
 *   pass = !collapse
 *
 * What this catches:
 *   - Single-Q government contract booking spikes
 *   - One-time license / milestone revenue
 *   - Q-Spike-Fake patterns missed by q-spike-dataguard's 55% concentration
 *     threshold (this works at lower concentrations — e.g. 35-40% — when
 *     the spike is on top of a steady base)
 *
 * What this does NOT catch:
 *   - Sustained acceleration (each quarter higher than the previous):
 *     removing the latest Q drops growth, but doesn't collapse it by 50%.
 *   - Seasonal Q4 spikes (handled separately in q-spike-dataguard).
 *
 * Requires ≥ 8 quarterly revenue points. Yahoo snapshots typically have
 * only ~5 quarters → falls back to "not computable" rather than guessing.
 *
 * DIAGNOSTIC (not DATAGUARD): visible warning in scorecard, but score-
 * aggregator can still apply it as a soft penalty for downgrade.
 */
const H = require('./_helpers.js');

const ID = 'single-quarter-dependency';
const LABEL = 'Single-Q-Dependency';
const THRESHOLD = 0.50;
const THRESHOLD_OP = 'lte';
const MIN_QUARTERS = 8;

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const revQ = (stock.timeseries && stock.timeseries.revenueQ) || [];
  if (revQ.length < MIN_QUARTERS) {
    return H.buildResult({
      computable: false,
      reason: 'need ≥ ' + MIN_QUARTERS + ' quarterly revenue points (got ' + revQ.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const recent = [];
  const prior = [];
  for (let i = 0; i < 4; i++) {
    const v = _unwrap(revQ[i]);
    if (v == null || v < 0) {
      return H.buildResult({
        computable: false,
        reason: 'recent revQ[' + i + ']=' + v + ' (invalid)',
        threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
      });
    }
    recent.push(v);
  }
  for (let i = 4; i < 8; i++) {
    const v = _unwrap(revQ[i]);
    if (v == null || v < 0) {
      return H.buildResult({
        computable: false,
        reason: 'prior revQ[' + i + ']=' + v + ' (invalid)',
        threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
      });
    }
    prior.push(v);
  }

  const ttm = recent.reduce((s, x) => s + x, 0);
  const priorTtm = prior.reduce((s, x) => s + x, 0);
  if (priorTtm <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'prior TTM = ' + priorTtm + ' (cannot compute growth)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const maxQ = Math.max(...recent);
  const ttmExMax = ttm - maxQ;
  // Compare 3-quarter window (recent ex-max) to 3/4 of prior TTM for apples-to-apples.
  const priorScaled = priorTtm * 0.75;

  const gFull = (ttm - priorTtm) / priorTtm;
  const gEx = (ttmExMax - priorScaled) / priorScaled;

  // If full growth wasn't positive, single-Q dependency is irrelevant.
  if (gFull <= 0) {
    return H.buildResult({
      value: 0, pass: true, computable: true,
      components: { gFull, gEx, ttm, ttmExMax, priorTtm, maxQ, collapsePct: 0 },
      reason: 'no positive TTM growth to depend on (gFull=' + (gFull*100).toFixed(0) + '%)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const collapsePct = (gFull - gEx) / gFull;
  const pass = collapsePct <= THRESHOLD;
  return H.buildResult({
    value: collapsePct,
    pass,
    computable: true,
    components: {
      gFull: Math.round(gFull * 10000) / 10000,
      gEx: Math.round(gEx * 10000) / 10000,
      maxQuarterShareOfTtm: Math.round(maxQ / ttm * 10000) / 10000,
      collapsePct: Math.round(collapsePct * 10000) / 10000
    },
    reason: 'gFull=' + (gFull*100).toFixed(0) + '% gEx=' + (gEx*100).toFixed(0) +
            '% collapse=' + (collapsePct*100).toFixed(0) + '% (gate: ≤ 50%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Single-Quarter-Dependency: TTM-Growth bricht >50% ein wenn Top-Q entfernt → Fail',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
