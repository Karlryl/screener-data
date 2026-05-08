'use strict';
/**
 * Tag 28 + 97c: Method-Plugin-Helpers
 * Tag 97c: wrapEvaluate() reichert Results um confidence/dataAsOf/methodType/flags an.
 */
const fs = require('fs');
const path = require('path');

function val(obj, p) {
  if (!obj) return null;
  const parts = p.split('.');
  let cur = obj;
  for (const x of parts) {
    if (cur == null) return null;
    cur = cur[x];
  }
  return cur;
}

function metricValue(stock, metricKey) {
  const m = val(stock, `metrics.${metricKey}`);
  if (m == null) return null;
  if (typeof m === 'number') return m;
  if (typeof m === 'object' && 'value' in m) return m.value;
  return null;
}

function latestAnnual(stock, key) {
  const arr = val(stock, `annual.${key}`);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = arr[0];
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return null;
}

function latestBalance(stock, field) {
  const arr = val(stock, 'annual.annualBalance');
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[0] && arr[0][field];
}

function cagr3y(annualArr) {
  if (!Array.isArray(annualArr) || annualArr.length < 4) return null;
  const latest = annualArr[0] && (typeof annualArr[0] === 'number' ? annualArr[0] : annualArr[0].value);
  const oldest = annualArr[3] && (typeof annualArr[3] === 'number' ? annualArr[3] : annualArr[3].value);
  if (latest == null || oldest == null || oldest <= 0) return null;
  return (Math.pow(latest / oldest, 1/3) - 1) * 100;
}

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

// Tag-38: Sub-Profile-Klassifikation (delegiert an Engine v7.3)
let _subProfileCache = null;
function _getEngine() {
  if (_subProfileCache) return _subProfileCache;
  try {
    _subProfileCache = require('../engine-v7.3.js');
    return _subProfileCache;
  } catch (e) { return null; }
}
function classifySubProfile(stock) {
  const E = _getEngine();
  if (!E || !E.classifySubProfile) return null;
  try { return E.classifySubProfile(stock); } catch (e) { return null; }
}

let _sectorMediansCache = null;
function _loadSectorMedians() {
  if (_sectorMediansCache) return _sectorMediansCache;
  try {
    const p = path.join(__dirname, 'sector-medians.json');
    _sectorMediansCache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { _sectorMediansCache = {}; }
  return _sectorMediansCache;
}

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

// --- Tag 97c: Extended Plugin-Interface --------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

function _dataAsOfFromStock(stock) {
  const candidates = [
    stock && stock.meta && stock.meta.dataAsOf,
    stock && stock.meta && stock.meta.fetchedAt,
    stock && stock.annual && stock.annual.lastFiscalYearEnd,
    stock && stock.meta && stock.meta.lastUpdate
  ].filter(Boolean);
  return candidates.length === 0 ? null : candidates[0];
}

function _dataAgeDays(asOf) {
  if (!asOf) return null;
  const t = (typeof asOf === 'string') ? Date.parse(asOf) : Number(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}

function _inferConfidence(result, ageDays) {
  if (result.components && Number.isFinite(result.components.confidence)) {
    return Math.max(0, Math.min(1, result.components.confidence));
  }
  if (!result.computable) return 0;
  let c = 0.7;
  if (ageDays != null) {
    if (ageDays > 365) c -= 0.3;
    else if (ageDays > 180) c -= 0.15;
    else if (ageDays > 90) c -= 0.05;
  }
  if (result.value != null && result.threshold != null && result.threshold !== 0) {
    const dist = Math.abs((result.value - result.threshold) / result.threshold);
    if (dist < 0.05) c -= 0.1;
    else if (dist < 0.10) c -= 0.05;
  }
  return Math.max(0, Math.min(1, c));
}

function _autoFlags(result, ageDays) {
  const flags = [];
  if (ageDays != null && ageDays > 180) flags.push('STALE_DATA');
  if (!result.computable) flags.push('NO_DATA');
  if (result.value != null && result.threshold != null && result.threshold !== 0) {
    const dist = Math.abs((result.value - result.threshold) / result.threshold);
    if (dist < 0.05) flags.push('NEAR_THRESHOLD');
  }
  return flags;
}

function wrapEvaluate(method, stock, opts) {
  opts = opts || {};
  let raw;
  try { raw = method.evaluate(stock); }
  catch (e) {
    raw = buildResult({
      computable: false, reason: `error: ${e.message}`,
      threshold: method.threshold, thresholdOp: method.thresholdOp
    });
  }
  const dataAsOf = (raw.components && raw.components.dataAsOf) || _dataAsOfFromStock(stock);
  const ageDays = _dataAgeDays(dataAsOf);
  const confidence = _inferConfidence(raw, ageDays);
  const methodType = opts.methodType || 'DIAGNOSTIC';
  const flags = _autoFlags(raw, ageDays).concat(Array.isArray(raw.flags) ? raw.flags : []);

  return Object.assign({}, raw, {
    methodType,
    confidence,
    dataAsOf: dataAsOf || null,
    dataAgeDays: ageDays,
    sectorPercentile: Number.isFinite(opts.sectorPercentile) ? opts.sectorPercentile : null,
    flags
  });
}

module.exports = {
  val, metricValue, latestAnnual, latestBalance, cagr3y, buildResult,
  classifySubProfile, effectiveThreshold,
  wrapEvaluate
};
