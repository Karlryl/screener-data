'use strict';
/**
 * Tag 141: Estimate-Revision-Proxy
 * =================================
 * Two-signal proxy for positive analyst estimate revision trend.
 * (No earningsTrend pull required — uses existing snapshot data.)
 *
 * Signal 1 — Forward PE discount:
 *   forwardPE < pe * 0.90 → market/analysts expect 10%+ EPS growth → +1
 *
 * Signal 2 — Revenue acceleration:
 *   Avg growth rate of last 2 quarters > avg growth rate of prior 2 quarters → +1
 *   (uses timeseries.revenueQ[])
 *
 * Pass: at least 1 of 2 signals positive AND at least 1 signal computable.
 * Value: 0, 1, or 2 (count of positive signals).
 */
const H = require('./_helpers.js');

const ID = 'estimate-revision-proxy';
const THRESHOLD = 1;
const THRESHOLD_OP = 'gte';

function _revenueAcceleration(stock) {
  const rq = stock && stock.timeseries && stock.timeseries.revenueQ;
  // Bug #29 fix: require >= 8 quarters so ALL 4 growth points use true YoY
  // (rq[i] vs rq[i+4]). With < 8 entries, some iterations fell back to QoQ
  // (rq[i] vs rq[i+1]), mixing QoQ and YoY in the same growths array —
  // comparing recentAvg vs priorAvg of mixed metrics is meaningless.
  if (!Array.isArray(rq) || rq.length < 8) return null;

  // Compute YoY growth for quarters i=0..3 (need rq[i+4] → indices 4..7)
  // rq[0] = most recent quarter
  const _val = v => (v == null ? null : (typeof v === 'number' ? v : v.value));
  // growthSlots[i] = null if that YoY computation failed, or the growth rate if valid
  const growthSlots = [];
  for (let i = 0; i < 4; i++) {
    const curr = _val(rq[i]);
    const base = _val(rq[i + 4]);  // same quarter, one year ago
    if (curr == null || base == null || base <= 0) { growthSlots.push(null); continue; }
    growthSlots.push((curr - base) / Math.abs(base));
  }

  // Require at least 2 valid growth entries total to produce a meaningful comparison
  const validCount = growthSlots.filter(v => v !== null).length;
  if (validCount < 2) return null;

  // recent = slots 0-1, prior = slots 2-3
  const recentVals = growthSlots.slice(0, 2).filter(v => v !== null);
  const priorVals  = growthSlots.slice(2).filter(v => v !== null);
  // Need at least one valid entry in each half
  if (recentVals.length === 0 || priorVals.length === 0) return null;

  const recentAvg = recentVals.reduce((s, v) => s + v, 0) / recentVals.length;
  const priorAvg  = priorVals.reduce((s, v) => s + v, 0) / priorVals.length;
  return { accelerating: recentAvg > priorAvg, recentAvg, priorAvg };
}

function evaluate(stock) {
  const signals = [];

  // Signal 1: forward PE discount
  const fpe = H.metricValue(stock, 'forwardPE');
  const pe  = H.metricValue(stock, 'pe');
  if (fpe != null && fpe > 0 && pe != null && pe > 0) {
    const discount = fpe / pe;
    signals.push({ name: 'forward_pe_discount', pass: discount < 0.90, value: discount });
  }

  // Signal 2: revenue acceleration
  const accel = _revenueAcceleration(stock);
  if (accel !== null) {
    signals.push({ name: 'rev_acceleration', pass: accel.accelerating, recentAvg: accel.recentAvg, priorAvg: accel.priorAvg });
  }

  if (signals.length === 0) {
    return H.buildResult({ computable: false, reason: 'no signals computable (need forwardPE+PE or 8+ quarterly revenue)', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  }

  const positive = signals.filter(s => s.pass).length;
  const pass = positive >= THRESHOLD;

  return H.buildResult({
    value: positive,
    pass,
    computable: true,
    threshold: THRESHOLD,
    thresholdOp: THRESHOLD_OP,
    reason: `${positive}/${signals.length} signals positive: ${signals.map(s => s.name + ':' + (s.pass ? 'yes' : 'no')).join(', ')}`,
    components: { positiveSignals: positive, totalSignals: signals.length, signals }
  });
}

module.exports = {
  id: ID,
  label: 'Estimate-Revision-Proxy',
  description: 'Proxy for positive estimate revision trend: forward PE discount and/or revenue acceleration (>=1 of 2)',
  threshold: THRESHOLD,
  thresholdOp: THRESHOLD_OP,
  unit: 'count',
  evaluate
};
