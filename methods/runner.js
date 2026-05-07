'use strict';
/**
 * Tag 28: Methods-Runner
 * Lädt alle Methoden, runnt sie auf einem Stock, returnt Ergebnis-Matrix.
 */
const fs = require('fs');
const path = require('path');

const METHODS = [
  require('./rule-of-40.js'),
  require('./roic.js'),
  require('./net-debt-ebitda.js'),
  require('./sloan-ratio.js'),
  require('./revenue-growth-3y.js'),
  require('./fcf-yield.js'),
  require('./gross-margin-stability.js'),
  require('./margin-decay.js'),
  require('./sbc-revenue.js'),
  require('./capex-trend.js'),
  require('./working-capital-anomaly.js'),
  require('./aktienfinder-quality.js'),
  require('./forward-pe.js'),
  require('./multi-year-stability.js'),
  require('./peg.js'),
  require('./ev-ebitda.js'),
  require('./insider-ownership.js'),
  require('./quarterly-revenue-acceleration.js'),
  require('./drawdown-52w.js')
];

function evaluateStock(stock) {
  const results = {};
  for (const m of METHODS) {
    try {
      results[m.id] = m.evaluate(stock);
    } catch (e) {
      results[m.id] = {
        value: null, pass: false, computable: false,
        reason: `error: ${e.message}`, components: {},
        threshold: m.threshold, thresholdOp: m.thresholdOp
      };
    }
  }
  return results;
}

function getMethods() {
  return METHODS.map(m => ({ id: m.id, label: m.label, description: m.description, threshold: m.threshold, thresholdOp: m.thresholdOp, unit: m.unit }));
}

module.exports = { METHODS, evaluateStock, getMethods };
