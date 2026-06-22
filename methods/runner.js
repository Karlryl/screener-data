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

// audit F-A-2026-06-22: prevents per-stock re-classification — method types are
// process-static; avoids O(universe×methods) redundant REGISTRY lookups.
// Precompute each method's type/isCore/isDefaultActive ONCE after load so
// evaluateStock no longer calls MT.getType/MT.isDefaultActive per stock and no
// longer does two post-hoc Object.keys(results).filter() re-scans of the
// universe (~4,739 OK stocks × ~70 methods of pure repeated REGISTRY hashing).
// Behavior-identical: precomputed `type` equals MT.getType(m.id) (same value
// previously passed to wrapEvaluate) and `isCore` equals MT.isCore(m.id).
const METHODS_META = METHODS.map(m => ({
  method: m,
  type: MT.getType(m.id),
  isCore: MT.isCore(m.id),
  isDefaultActive: MT.isDefaultActive(m.id)
}));

function evaluateStock(stock, opts) {
  opts = opts || {};
  const filterType = opts.type || null;
  const onlyDefault = opts.onlyDefault === true;

  const results = {};
  // audit F-A-2026-06-22: iterate precomputed META and tally core counts inline,
  // matching the old two-pass Object.keys(results).filter() exactly — only
  // methods actually evaluated (added to `results`) are counted, and pass is read
  // from the just-computed result.
  let coreCount = 0;
  let coreCountPass = 0;
  for (const meta of METHODS_META) {
    const methodType = meta.type;
    if (filterType && methodType !== filterType) continue;
    if (onlyDefault && !meta.isDefaultActive) continue;
    const res = H.wrapEvaluate(meta.method, stock, { methodType });
    results[meta.method.id] = res;
    if (meta.isCore) {
      coreCount++;
      if (res.pass) coreCountPass++;
    }
  }

  const dq = MT.isDisqualifiedByDataGuards(results);

  return {
    results,
    disqualified: dq.disqualified,
    disqualifiedBy: dq.disqualified ? dq.methodId : null,
    coreCount,
    coreCountPass
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
