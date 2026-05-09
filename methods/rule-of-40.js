'use strict';
/**
 * Tag 111: Rule-of-40 mit Smart-Switch gegen Q-Spike-Verzerrung
 * - revenueGrowthYoY > 200%? → switch auf 3y-CAGR (robuster gegen Booking-Spikes)
 * - 3y-CAGR nicht computable (Stock < 3 Jahre öffentlich)? → YoY auf 200% clampen
 * - Source-Tag in components: 'YoY' | '3yCAGR' | 'YoY-clamped'
 * IONQ: 754% YoY → 127% CAGR → Score 74 statt 702
 */
const H = require('./_helpers.js');

const ID = 'rule-of-40';
const LABEL = 'Rule of 40';
const THRESHOLD = 40;
const THRESHOLD_OP = 'gte';
const SPIKE_THRESHOLD = 200;

function _resolveGrowth(stock) {
  const yoy = H.metricValue(stock, 'revenueGrowthYoY');
  if (yoy == null) return { value: null, source: 'missing' };
  if (Math.abs(yoy) <= SPIKE_THRESHOLD) return { value: yoy, source: 'YoY' };
  // YoY > 200% → versuche 3y-CAGR aus annual.annualRev
  const annual = H.val(stock, 'annual.annualRev');
  if (Array.isArray(annual) && annual.length >= 4) {
    const cagr = H.cagr3y(annual);
    if (Number.isFinite(cagr)) return { value: cagr, source: '3yCAGR' };
  }
  // Fallback: clamp YoY auf 200%
  return { value: yoy >= 0 ? SPIKE_THRESHOLD : -SPIKE_THRESHOLD, source: 'YoY-clamped' };
}

function evaluate(stock) {
  const g = _resolveGrowth(stock);
  const fcfMargin = H.metricValue(stock, 'fcfMarginTTM');
  if (g.value == null || fcfMargin == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing inputs: growth=' + g.value + ', fcfMargin=' + fcfMargin,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = g.value + fcfMargin;
  return H.buildResult({
    value, pass: value >= THRESHOLD, computable: true,
    components: { growth: g.value, fcfMargin, source: g.source },
    reason: g.value.toFixed(1) + '[' + g.source + '] + ' + fcfMargin.toFixed(1) + ' = ' + value.toFixed(1),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Revenue Growth + FCF Margin ≥ 40 (Smart-Switch bei Q-Spike >200% auf 3y-CAGR)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
