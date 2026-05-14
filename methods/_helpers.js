'use strict';
/**
 * Tag 28 + 97c: Method-Plugin-Helpers
 * Tag 97c: wrapEvaluate() reichert Results um confidence/dataAsOf/methodType/flags an.
 * Tag 167: effectiveThreshold() now region-aware via sector-median-lookup.js.
 *   Priority: rolling12m → regional auto-median → global auto-median → static hardcoded.
 */
const fs = require('fs');
const path = require('path');
const { lookupMedian } = require('./sector-median-lookup.js');

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
let _autoMediansCache = null;     // Tag 167: v2 region-aware auto-medians
let _rollingMediansCache = null;
const ROLLING_MIN_WEEKS = 12; // require >= 12 weekly datapoints before trusting the rolling median

function _loadSectorMedians() {
  if (_sectorMediansCache) return _sectorMediansCache;
  try {
    const p = path.join(__dirname, 'sector-medians.json');
    _sectorMediansCache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { _sectorMediansCache = {}; }
  return _sectorMediansCache;
}

// Tag 167: Load v2 region-aware auto-medians. Returns the full object so
// lookupMedian() can resolve both regional and _GLOBAL buckets.
function _loadAutoMedians() {
  if (_autoMediansCache !== null) return _autoMediansCache;
  try {
    const p = path.join(__dirname, 'sector-medians-auto.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Accept both v2 (new) and old shape for safety
    if (raw && raw._version === 2 && raw.byRegion) {
      _autoMediansCache = raw; // full v2 object
    } else if (raw && raw.medians) {
      // Old shape: wrap into minimal v2-compatible structure for legacy fallback
      _autoMediansCache = { _version: 2, byRegion: { _GLOBAL: raw.medians } };
    } else {
      _autoMediansCache = {};
    }
  } catch (e) { _autoMediansCache = {}; }
  return _autoMediansCache;
}

// Tag 134 — Phase 5.5: prefer the rolling 12-month median over the static hardcoded
// table when the rolling history has matured (>= 12 weekly samples per sub-profile × metric).
function _loadRollingMedians() {
  if (_rollingMediansCache !== null) return _rollingMediansCache;
  try {
    const p = path.join(__dirname, 'sector-medians-rolling.json');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    _rollingMediansCache = (raw && raw.medians) || {};
  } catch (e) { _rollingMediansCache = {}; }
  return _rollingMediansCache;
}

/**
 * Tag 38 + 134 + 167: Effective threshold lookup priority:
 *   1. Rolling 12m median (mature = ≥12 weekly samples) — sub-profile × metric global
 *   2. Tag 167: Region-aware auto-median (regional bucket, if computed with ≥20 stocks)
 *   3. Global auto-median (_GLOBAL bucket from auto-medians)
 *   4. Static hardcoded sector-medians.json
 *   5. Method default
 */
function effectiveThreshold(stock, methodId, defaultThreshold) {
  const sp = classifySubProfile(stock);
  if (!sp || !sp.id) return { threshold: defaultThreshold, source: 'default' };

  // --- 1. Rolling 12m (most authoritative when mature) ---
  const rolling = _loadRollingMedians();
  const rEntry = rolling[sp.id] && rolling[sp.id][methodId];
  if (rEntry && rEntry.rolling12mMedian != null
      && Array.isArray(rEntry.values) && rEntry.values.length >= ROLLING_MIN_WEEKS) {
    return { threshold: rEntry.rolling12mMedian, source: 'rolling12m:' + sp.id, n: rEntry.values.length };
  }

  // --- 2+3. Tag 167: Region-aware auto-median (regional first, then _GLOBAL) ---
  const autoMedians = _loadAutoMedians();
  if (autoMedians && autoMedians._version === 2) {
    const lookup = lookupMedian(autoMedians, stock, sp.id, methodId);
    if (lookup.value != null) {
      return { threshold: lookup.value, source: 'auto:' + lookup.source };
    }
  }

  // --- 4. Static hardcoded ---
  const medians = _loadSectorMedians();
  const sectorEntry = medians[sp.id];
  if (sectorEntry && sectorEntry[methodId] != null) {
    return { threshold: sectorEntry[methodId], source: 'sector:' + sp.id };
  }

  // --- 5. Method default ---
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
