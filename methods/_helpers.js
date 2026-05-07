'use strict';
/**
 * Tag 28: Method-Plugin-Helpers
 * Gemeinsame Helper für alle 5 Methoden.
 */

// Holt einen Wert aus stock-snapshot, returnt null wenn nicht vorhanden.
function val(obj, path) {
  if (!obj) return null;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}

// Wert aus canonical-input metric-Object {value, source, confidence, asOf}
function metricValue(stock, metricKey) {
  const m = val(stock, `metrics.${metricKey}`);
  if (m == null) return null;
  if (typeof m === 'number') return m;
  if (typeof m === 'object' && 'value' in m) return m.value;
  return null;
}

// Letzter Wert aus annual-Array (latest first → index 0)
function latestAnnual(stock, key) {
  const arr = val(stock, `annual.${key}`);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = arr[0];
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return null;
}

// Latest balance-sheet field
function latestBalance(stock, field) {
  const arr = val(stock, 'annual.annualBalance');
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[0] && arr[0][field];
}

// 3-Year-CAGR aus annual-Array. Latest first.
function cagr3y(annualArr) {
  if (!Array.isArray(annualArr) || annualArr.length < 4) return null;
  const latest = annualArr[0] && (typeof annualArr[0] === 'number' ? annualArr[0] : annualArr[0].value);
  const oldest = annualArr[3] && (typeof annualArr[3] === 'number' ? annualArr[3] : annualArr[3].value);
  if (latest == null || oldest == null || oldest <= 0) return null;
  return (Math.pow(latest / oldest, 1/3) - 1) * 100;
}

// Standard Pass/Fail-Result-Builder
function buildResult({ value, pass, computable, reason, components, threshold, thresholdOp }) {
  return {
    value: value != null && Number.isFinite(value) ? value : null,
    pass: !!pass,
    computable: !!computable,
    reason: reason || '',
    components: components || {},
    threshold,
    thresholdOp
  };
}

module.exports = { val, metricValue, latestAnnual, latestBalance, cagr3y, buildResult };


// Tag-38: Sub-Profile-Klassifikation (delegiert an Engine v7.3 die wir noch haben)
let _subProfileCache = null;
function _getEngine() {
  if (_subProfileCache) return _subProfileCache;
  try {
    _subProfileCache = require('../engine-v7.3.js');
    return _subProfileCache;
  } catch (e) {
    return null;
  }
}
function classifySubProfile(stock) {
  const E = _getEngine();
  if (!E || !E.classifySubProfile) return null;
  try { return E.classifySubProfile(stock); } catch (e) { return null; }
}

// Lade Sektor-Median-Overrides
const fs = require('fs');
const path = require('path');
let _sectorMediansCache = null;
function _loadSectorMedians() {
  if (_sectorMediansCache) return _sectorMediansCache;
  try {
    const p = path.join(__dirname, 'sector-medians.json');
    _sectorMediansCache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { _sectorMediansCache = {}; }
  return _sectorMediansCache;
}

// Tag-38: gibt sektor-überschriebene Schwelle zurück oder fallback
function effectiveThreshold(stock, methodId, defaultThreshold) {
  const sp = classifySubProfile(stock);
  if (!sp || !sp.id) return { threshold: defaultThreshold, source: 'default' };
  const medians = _loadSectorMedians();
  const sectorEntry = medians[sp.id];
  if (sectorEntry && sectorEntry[methodId] != null) {
    return { threshold: sectorEntry[methodId], source: 'sector:' + sp.id };
  }
  return { threshold: defaultThreshold, source: 'default' };
}

module.exports.classifySubProfile = classifySubProfile;
module.exports.effectiveThreshold = effectiveThreshold;
