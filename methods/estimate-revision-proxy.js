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
  if (!Array.isArray(rq) || rq.length < 5) return null;

  // Compute QoQ growth rates from most-recent to oldest
  // rq[0] = most recent quarter
  const growths = [];
  for (let i = 0; i < 4 && i + 1 < rq.length; i++) {
    const curr = rq[i] && (typeof rq[i] === 'number' ? rq[i] : rq[i].value);
    const prev = rq[i + 1] && (typeof rq[i + 1] === 'number' ? rq[i + 1] : rq[i + 1].value);
    if (curr == null || prev == null || prev <= 0) return null;
    // YoY comparison: compare quarter i to same quarter 4 periods ago
    const base = rq[i + 4] && (typeof rq[i + 4] === 'number' ? rq[i + 4] : rq[i + 4].value);
    if (base == null || base <= 0) {
      growths.push((curr - prev) / Math.abs(prev));
    } else {
      growths.push((curr - base) / Math.abs(base));
    }
    if (growths.length >= 4) break;
  }

  if (growths.length < 4) return null;
  const recentAvg = (growths[0] + growths[1]) / 2;
  const priorAvg  = (growths[2] + growths[3]) / 2;
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
