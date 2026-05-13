'use strict';
/**
 * Tag 22: Yahoo-Field-Drift-Detector
 * ====================================
 * Tracks coverage (% of stocks with non-null values) of critical Yahoo-derived
 * fields across all snapshots in a run. Maintains a rolling baseline in
 * alert-state.fieldCoverage. When current coverage drops >= DROP_THRESHOLD
 * vs baseline, signals drift — typically caused by Yahoo schema changes
 * (z.B. Nov 2024: incomeStatementHistoryQuarterly leer geliefert).
 *
 * Verwendung: aus detect-changes.js heraus.
 */

// Tracked fields — diejenigen kritisch für Engine-Scoring.
// Tag 153: paths corrected to match pull-yahoo.js canonical snapshot structure.
// Previous paths used 'metrics.*' for all fields; actual structure has annual.*/timeseries.*/meta.*
// Those 12 wrong-path fields reported 0% coverage on every run since Tag 22.
const TRACKED_FIELDS = [
  'annual.annualRev',           // array of {value,...} — check non-empty
  'annual.annualOpInc',
  'annual.annualNetIncome',
  'annual.annualGP',            // was: metrics.annualGrossProfit (field is annualGP not annualGrossProfit)
  'annual.annualFCF',
  'timeseries.revenueQ',        // was: metrics.quarterlyRev
  'timeseries.opIncQ',          // was: metrics.quarterlyOpInc
  'marketCap.value',            // was: metrics.marketCapUSD — marketCap is a _metric wrapper
  'metrics.pe.value',           // was: metrics.peRatio — pe is a _metric wrapper
  'metrics.priceSales.value',   // was: metrics.psRatio — priceSales is a _metric wrapper
  'meta.sector',                // was: metrics.sector
  'meta.industry',              // was: metrics.industry
  'metrics.operatingMargin.value', // .value to check actual data, not just wrapper presence
  'metrics.grossMargin.value'
];

const HISTORY_WINDOW = 14;      // Rolling window: letzte 14 Runs für Baseline (war 6 — zu kurz bei 2 Runs/Tag)
const DROP_THRESHOLD = 0.20;    // 20 percentage-points = Drift-Alarm
const MIN_HISTORY_FOR_ALERT = 2; // erst nach 2 Runs vergleichen

function getField(obj, path) {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isPresent(v) {
  if (v == null) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (v === '') return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  return true;
}

// Berechnet pro Field % der Stocks mit Wert.
function computeCoverage(snapshots) {
  const coverage = {};
  if (!snapshots || snapshots.length === 0) {
    for (const f of TRACKED_FIELDS) coverage[f] = 0;
    return coverage;
  }
  for (const field of TRACKED_FIELDS) {
    let count = 0;
    for (const s of snapshots) {
      if (isPresent(getField(s, field))) count++;
    }
    coverage[field] = count / snapshots.length;
  }
  return coverage;
}

// Hängt neuen Entry an History, behält nur letzte HISTORY_WINDOW.
function updateHistory(history, newEntry) {
  const safe = Array.isArray(history) ? history : [];
  return [...safe, newEntry].slice(-HISTORY_WINDOW);
}

// Baseline = Mittel aus allen Entries OHNE den aktuellen (letzten).
// Bei erstem Run: history hat 1 Entry → baseline = leer (kein Vergleich möglich).
function computeBaseline(history) {
  const safe = Array.isArray(history) ? history : [];
  if (safe.length < MIN_HISTORY_FOR_ALERT) return {};
  const useEntries = safe.slice(0, -1); // alle außer aktuellem
  const baseline = {};
  for (const field of TRACKED_FIELDS) {
    const values = useEntries
      .map(e => (e && e.coverage) ? e.coverage[field] : null)
      .filter(v => typeof v === 'number');
    if (values.length === 0) continue;
    baseline[field] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return baseline;
}

// Liefert Liste der Fields die signifikant gedroppt sind.
function detectDrift(currentCoverage, baseline) {
  const drifts = [];
  for (const field of TRACKED_FIELDS) {
    const cur = currentCoverage[field];
    const base = baseline[field];
    if (typeof cur !== 'number' || typeof base !== 'number') continue;
    const drop = base - cur;
    if (drop >= DROP_THRESHOLD) {
      drifts.push({
        field,
        current: Math.round(cur * 100) / 100,
        baseline: Math.round(base * 100) / 100,
        drop: Math.round(drop * 100) / 100
      });
    }
  }
  return drifts;
}

module.exports = {
  TRACKED_FIELDS,
  HISTORY_WINDOW,
  DROP_THRESHOLD,
  MIN_HISTORY_FOR_ALERT,
  computeCoverage,
  updateHistory,
  computeBaseline,
  detectDrift,
  _internal: { getField, isPresent }
};
