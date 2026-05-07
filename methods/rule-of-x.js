'use strict';
const H = require('./_helpers.js');

const ID = 'rule-of-x';
const LABEL = 'Rule of X';
const THRESHOLD = 60;
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
  const value = growth * 2 + fcfMargin;
  return H.buildResult({
    value,
    pass: value >= THRESHOLD,
    computable: true,
    components: { growth, fcfMargin, growthWeighted: growth * 2 },
    reason: `${growth.toFixed(1)} × 2 + ${fcfMargin.toFixed(1)} = ${value.toFixed(1)}`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL, description: 'Bessemer: Revenue Growth × 2 + FCF Margin ≥ 60',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};
