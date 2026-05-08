'use strict';
/**
 * Tag 97b: Methods-Runner mit Type-Klassifikation
 * Plug-and-Play Method-Loader. aktienfinder-quality wird automatisch übersprungen.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_helpers.js');
const MT = require('./method-types.js');

function _loadAllMethods() {
  const dir = __dirname;
  const out = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  for (const f of files) {
    if (['runner.js', 'trend.js', 'method-types.js'].includes(f)) continue;
    const full = path.join(dir, f);
    let mod;
    try { mod = require(full); }
    catch (e) { continue; }
    if (!mod || typeof mod.evaluate !== 'function' || !mod.id) continue;
    if (MT.isDisabled(mod.id)) continue;
    out.push(mod);
  }
  return out;
}

const METHODS = _loadAllMethods();

function evaluateStock(stock, opts) {
  opts = opts || {};
  const filterType = opts.type || null;
  const onlyDefault = opts.onlyDefault === true;

  const results = {};
  for (const m of METHODS) {
    const methodType = MT.getType(m.id);
    if (filterType && methodType !== filterType) continue;
    if (onlyDefault && !MT.isDefaultActive(m.id)) continue;
    results[m.id] = H.wrapEvaluate(m, stock, { methodType });
  }

  const dq = MT.isDisqualifiedByDataGuards(results);

  return {
    results,
    disqualified: dq.disqualified,
    disqualifiedBy: dq.disqualified ? dq.methodId : null,
    coreCount: Object.keys(results).filter(id => MT.isCore(id)).length,
    coreCountPass: Object.keys(results).filter(id => MT.isCore(id) && results[id].pass).length
  };
}

function getMethods(opts) {
  opts = opts || {};
  return METHODS
    .filter(m => !opts.type || MT.getType(m.id) === opts.type)
    .filter(m => !opts.onlyDefault || MT.isDefaultActive(m.id))
    .map(m => ({
      id: m.id,
      label: m.label,
      description: m.description,
      threshold: m.threshold,
      thresholdOp: m.thresholdOp,
      unit: m.unit,
      methodType: MT.getType(m.id),
      defaultActive: MT.isDefaultActive(m.id)
    }));
}

function evaluateStockLegacy(stock) {
  const out = evaluateStock(stock);
  return out.results;
}

module.exports = {
  METHODS,
  evaluateStock: evaluateStockLegacy,
  evaluateStockExtended: evaluateStock,
  getMethods,
  METHOD_TYPES: MT.METHOD_TYPES,
  isCore: MT.isCore,
  isDataGuard: MT.isDataGuard
};
