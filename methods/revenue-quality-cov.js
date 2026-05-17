'use strict';
/**
 * Tag 212b: Revenue-Quality (Quarterly QoQ CoV over 8 quarters)
 * ==============================================================
 * RESEARCH BASIS:
 *   Asness, C., Frazzini, A. & Pedersen, L. (2019). "Quality Minus Junk."
 *   Review of Accounting Studies, 24, 34-112. The QMJ framework includes a
 *   "Revenue Quality" subscore in its Safety / Stability pillar — businesses
 *   with smooth, recurring revenue earn higher quality scores than businesses
 *   with lumpy, project-based revenue. This method implements that subscore
 *   via the coefficient-of-variation of QUARTERLY revenue growth over the
 *   last 8 quarters.
 *
 * DISTINCT FROM existing methods:
 *   - revenue-quality (Tag 197): annual YoY CoV over 4 years (low-frequency
 *     view, smooths through one-time effects).
 *   - revenue-quality-cov (this method): quarterly QoQ CoV over 8 quarters
 *     (high-frequency view, exposes lumpy/project revenue patterns hidden in
 *     annual smoothing).
 *   - q-spike-dataguard (Tag 113): single-quarter concentration check
 *     (top-Q > 55% of TTM = spike). Catches one extreme quarter.
 *   - revenue-quality-cov: statistical dispersion across ALL 8 quarters —
 *     catches systematic lumpiness even when no single quarter is extreme
 *     enough to trip the spike guard.
 *
 * Formula:
 *   Need at least 8 consecutive quarters in stock.timeseries.revenueQ
 *   (latest-first array, entries may be {value: N} or scalar N).
 *   For i = 0..6 compute:
 *     qoq_i = (revQ[i] - revQ[i+1]) / revQ[i+1]
 *   Skip pairs where revQ[i+1] <= 0 (sign-flipped or zero baseline makes
 *   the ratio uninterpretable). Require at least 6 valid qoq deltas.
 *   meanQoq = arithmetic mean of qoq[]
 *   stdevQoq = population stdev of qoq[]
 *   CoV_qoq = stdevQoq / |meanQoq|     (|.| matches earnings-power-stability)
 *   Guard meanQoq == 0 (degenerate normalization) -> incomputable.
 *
 * Pass: CoV_qoq < 1.5
 *   Recurring SaaS / subscription businesses typically show CoV < 0.5.
 *   Mature growth businesses with normal seasonality: CoV ~ 0.5-1.0.
 *   Threshold 1.5 catches the truly volatile lumpy-revenue businesses
 *   (government contracts, project-based engineering, large-deal-dependent
 *   software) without false-flagging normal growth choppiness.
 *
 * FAILURE MODE THIS DETECTS:
 *   - "Lumpy" revenue: single huge quarter followed by quiet quarters.
 *     Project-based businesses (defense contractors, engineering firms),
 *     government contracts with milestone billing, large-deal-dependent
 *     enterprise software with quarter-end concentration risk.
 *   - Sub-threshold spikes that don't trip q-spike-dataguard (a 50%
 *     single-Q concentration won't trip the 55% guard but will absolutely
 *     blow out QoQ CoV).
 *
 * Edge cases / why it might be incomputable:
 *   - Fewer than 8 quarters in revenueQ -> incomputable (cannot make 7 qoq
 *     deltas, definitely not the >= 6 we need).
 *   - Fewer than 6 valid qoq deltas after sign filtering -> incomputable.
 *   - meanQoq exactly 0 -> incomputable (denominator degenerate; we cannot
 *     express dispersion relative to a zero baseline).
 *
 * NOT in SCORE_WEIGHTS -> DIAGNOSTIC-only -> fixture-hash safe by construction.
 */
const H = require('./_helpers.js');

const ID = 'revenue-quality-cov';
const LABEL = 'Rev-Quality (QoQ CoV, 8Q)';
const THRESHOLD = 1.5;
const THRESHOLD_OP = 'lt';
const MIN_QUARTERS = 8;
const MIN_QOQ_DELTAS = 6;

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
  if (!Array.isArray(revQ)) {
    return H.buildResult({
      computable: false, pass: false, reason: 'timeseries.revenueQ not array',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (revQ.length < MIN_QUARTERS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + revQ.length + ' quarters in revenueQ (need >= ' + MIN_QUARTERS + ')',
      components: { quartersAvailable: revQ.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Unwrap once for the first MIN_QUARTERS positions (positional alignment matters).
  const vals = [];
  for (let i = 0; i < MIN_QUARTERS; i++) {
    vals.push(_unwrap(revQ[i]));
  }

  // QoQ deltas: i = 0..6 -> 7 potential deltas. Skip pairs where baseline <= 0.
  const qoqDeltas = [];
  for (let i = 0; i < MIN_QUARTERS - 1; i++) {
    const newer = vals[i];
    const older = vals[i + 1];
    if (newer == null || older == null || older <= 0) continue;
    const d = (newer - older) / older;
    if (!Number.isFinite(d)) continue;
    qoqDeltas.push(d);
  }

  if (qoqDeltas.length < MIN_QOQ_DELTAS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'only ' + qoqDeltas.length + ' valid QoQ deltas (need >= ' + MIN_QOQ_DELTAS + ')',
      components: { quartersUsed: MIN_QUARTERS, qoqDeltasValid: qoqDeltas.length },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const n = qoqDeltas.length;
  const mean = qoqDeltas.reduce((s, x) => s + x, 0) / n;

  if (mean === 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'mean QoQ exactly 0 — denominator degenerate, CoV uninformative',
      components: {
        quartersUsed: MIN_QUARTERS,
        qoqDeltas: qoqDeltas.map(d => Math.round(d * 10000) / 10000),
        meanQoq: 0
      },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const variance = qoqDeltas.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n;
  const stdev = Math.sqrt(variance);
  const cov = stdev / Math.abs(mean);

  const pass = cov < THRESHOLD;

  return H.buildResult({
    value: cov,
    pass,
    computable: true,
    components: {
      cov: Math.round(cov * 10000) / 10000,
      meanQoq: Math.round(mean * 10000) / 10000,
      stdevQoq: Math.round(stdev * 10000) / 10000,
      qoqDeltas: qoqDeltas.map(d => Math.round(d * 10000) / 10000),
      quartersUsed: MIN_QUARTERS,
      threshold: THRESHOLD
    },
    reason: 'QoQ mean=' + (mean * 100).toFixed(1) + '% sigma=' + (stdev * 100).toFixed(1)
          + '% CoV=' + cov.toFixed(2) + ' over n=' + n + ' deltas (floor < ' + THRESHOLD + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Quarterly QoQ-Revenue CoV < 1.5 over 8 quarters — recurring-revenue / smoothness signal (Asness/Frazzini/Pedersen 2019 QMJ Revenue Quality)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};
