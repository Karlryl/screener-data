'use strict';
/**
 * Tag 111: Rule-of-X mit Smart-Switch (gleich wie Rule-of-40)
 * Definition: 1.5 × growth + fcfMargin (growth via Smart-Switch wegen Q-Spikes)
 */
const H = require('./_helpers.js');

const ID = 'rule-of-x';
const LABEL = 'Rule-of-X';
const THRESHOLD = 50;
const THRESHOLD_OP = 'gte';
const SPIKE_THRESHOLD = 200;

function _resolveGrowth(stock) {
  const yoy = H.metricValue(stock, 'revenueGrowthYoY');
  if (yoy == null) return { value: null, source: 'missing' };
  if (Math.abs(yoy) <= SPIKE_THRESHOLD) return { value: yoy, source: 'YoY' };
  const annual = H.val(stock, 'annual.annualRev');
  if (Array.isArray(annual) && annual.length >= 4) {
    const cagr = H.cagr3y(annual);
    if (Number.isFinite(cagr)) return { value: cagr, source: '3yCAGR' };
  }
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
  const value = 1.5 * g.value + fcfMargin;
  return H.buildResult({
    value, pass: value >= THRESHOLD, computable: true,
    components: { growth: g.value, fcfMargin, multiplier: 1.5, source: g.source },
    reason: '1.5×' + g.value.toFixed(0) + '[' + g.source + '] + ' + fcfMargin.toFixed(0) + ' = ' + value.toFixed(0),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Rule-of-X: 1.5×Growth + FCF-Margin (Smart-Switch bei Q-Spikes >200% auf 3y-CAGR)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'score',
  evaluate
};
