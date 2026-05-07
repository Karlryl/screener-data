'use strict';
/**
 * Tag 28: Methods-Runner
 * Lädt alle Methoden, runnt sie auf einem Stock, returnt Ergebnis-Matrix.
 */
const fs = require('fs');
const path = require('path');

const METHODS = [
  require('./rule-of-40.js'),
  require('./rule-of-x.js'),
  require('./roic.js'),
  require('./net-debt-ebitda.js'),
  require('./sloan-ratio.js')
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
