'use strict';
/**
 * Tag 107: Rule-of-X (Hypergrowth-Multiplier)
 * =============================================
 * Erweiterte Rule-of-40 mit höherem Wachstums-Gewicht — belohnt Hypergrowth.
 * Definition: 1.5 × revenueGrowthYoY + fcfMarginTTM
 *
 * Rationale: bei Hypergrowth-Stocks (CRDO, ALAB) ist Wachstum > Profitabilität
 * mehr wert als bei reifen Quality-Compounder (NVO). Linear-Skalierung des
 * Growth-Anteils macht den Filter weniger anfällig für Margin-fokussierte Stocks.
 */
const H = require('./_helpers.js');

const ID = 'rule-of-x';
const LABEL = 'Rule-of-X';
const THRESHOLD = 50;
const THRESHOLD_OP = 'gte';

function evaluate(stock) {
  const growth = H.metricValue(stock, 'revenueGrowthYoY');
  const fcfMargin = H.metricValue(stock, 'fcfMarginTTM');

  if (growth == null || fcfMargin == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing inputs: growth=' + growth + ', fcfMargin=' + fcfMargin,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const value = 1.5 * growth + fcfMargin;
  return H.buildResult({
    value,
    pass: value >= THRESHOLD,
    computable: true,
    components: { growth, fcfMargin, multiplier: 1.5 },
    reason: '1.5×' + growth.toFixed(0) + '% + ' + fcfMargin.toFixed(0) + '% = ' + value.toFixed(0),
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Rule-of-X: 1.5×Revenue-Growth + FCF-Margin (Hypergrowth-fokussiert)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'score',
  evaluate
};
