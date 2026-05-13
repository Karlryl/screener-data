'use strict';
/**
 * Tag 97b: Methods-Runner mit Type-Klassifikation.
 * Tag 134 — Phase 2: Loader liest jetzt aus expliziter Registry (methods/index.js)
 * statt fs.readdirSync. Verhindert dass ein typo'd module.exports.id silently
 * de-registriert oder ein syntax-error eines Method-Files silently übersprungen wird.
 */
const path = require('path');
const H = require('./_helpers.js');
const MT = require('./method-types.js');
const REGISTRY = require('./index.js');

function _loadAllMethods() {
  const out = [];
  const seenIds = new Set();
  for (const entry of REGISTRY) {
    if (!entry || !entry.file) continue;
    let mod;
    try { mod = require(path.resolve(__dirname, entry.file)); }
    catch (e) {
      const msg = '[methods/runner] FAILED to load ' + entry.file + ': ' + e.message;
      if (entry.optional) { console.warn(msg + ' (optional, skipping)'); continue; }
      throw new Error(msg);
    }
    if (!mod || typeof mod.evaluate !== 'function' || !mod.id) {
      const msg = '[methods/runner] Module ' + entry.file + ' missing evaluate() or id';
      if (entry.optional) { console.warn(msg + ' (optional, skipping)'); continue; }
      throw new Error(msg);
    }
    if (seenIds.has(mod.id)) {
      throw new Error('[methods/runner] Duplicate method id "' + mod.id + '" from ' + entry.file);
    }
    seenIds.add(mod.id);
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
