'use strict';
const H = require('./_helpers.js');

const ID = 'rule-of-40';
const LABEL = 'Rule of 40';
const THRESHOLD = 40;
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  const growth = H.metricValue(stock, 'revenueGrowthYoY');
  const fcfMargin = H.metricValue(stock, 'fcfMarginTTM');
  if (growth == null || fcfMargin == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: growth=${growth}, fcfMargin=${fcfMargin}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = growth + fcfMargin;
  return H.buildResult({
    value,
    pass: value >= THRESHOLD,
    computable: true,
    components: { growth, fcfMargin },
    reason: `${growth.toFixed(1)} + ${fcfMargin.toFixed(1)} = ${value.toFixed(1)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL, description: 'Revenue Growth YoY + FCF Margin TTM ≥ 40',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
