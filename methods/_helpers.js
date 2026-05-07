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
