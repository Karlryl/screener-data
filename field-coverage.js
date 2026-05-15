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
// F-DQ-006: added fcfMarginTTM, forwardPE, annualSBC, annualCapex, totalDebt, insiderOwnerPercent
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
  'metrics.grossMargin.value',
  // F-DQ-006: previously missing fields — methods depend on these
  'metrics.fcfMarginTTM.value',    // FCF margin TTM — used by fcf-yield, rule-of-40
  'metrics.forwardPE.value',       // Forward P/E — used by forward-pe method
  'annual.annualSBC',              // Stock-based compensation — used by sbc-revenue method
  'annual.annualCapex',            // Capital expenditures — used by capex-trend, reinvestment-rate
  'annual.annualBalance',          // Balance sheet (includes totalDebt) — used by altman-z, net-debt-ebitda
  'metrics.insiderOwnerPercent.value', // Insider ownership % — used by insider-ownership method
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
  const extended = [...safe, newEntry];
  // F-SM-010: log when history is truncated due to HISTORY_WINDOW change
  if (extended.length > HISTORY_WINDOW) {
    console.warn('fieldCoverage: history truncated from', extended.length, 'to', HISTORY_WINDOW);
  }
  return extended.slice(-HISTORY_WINDOW);
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

// F-DQ-005: Absolute floor for coverage — below this level always alert regardless of baseline.
const ABSOLUTE_FLOOR = 0.50;  // 50% coverage floor

// Liefert Liste der Fields die signifikant gedroppt sind.
// F-DQ-005: Also emits HIGH-severity alert for any field below ABSOLUTE_FLOOR,
// even on cold start when baseline is unavailable (history < 2 entries).
function detectDrift(currentCoverage, baseline) {
  const drifts = [];
  const seenFields = new Set();

  // F-DQ-005: Absolute floor check — independent of baseline, catches cold-start silent drops
  for (const field of TRACKED_FIELDS) {
    const cur = currentCoverage[field];
    if (typeof cur !== 'number') continue;
    if (cur < ABSOLUTE_FLOOR) {
      drifts.push({
        field,
        current:  Math.round(cur * 100) / 100,
        baseline: typeof baseline[field] === 'number' ? Math.round(baseline[field] * 100) / 100 : null,
        drop:     typeof baseline[field] === 'number' ? Math.round((baseline[field] - cur) * 100) / 100 : null,
        severity: 'HIGH',
        reason:   'below-50pct-floor'
      });
      seenFields.add(field);
    }
  }

  // Standard baseline-vs-current drift detection
  for (const field of TRACKED_FIELDS) {
    if (seenFields.has(field)) continue; // already reported via floor check
    const cur = currentCoverage[field];
    const base = baseline[field];
    if (typeof cur !== 'number' || typeof base !== 'number') continue;
    const drop = base - cur;
    if (drop >= DROP_THRESHOLD) {
      drifts.push({
        field,
        current:  Math.round(cur * 100) / 100,
        baseline: Math.round(base * 100) / 100,
        drop:     Math.round(drop * 100) / 100,
        severity: 'MEDIUM',
        reason:   'baseline-drop'
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
  ABSOLUTE_FLOOR,
  computeCoverage,
  updateHistory,
  computeBaseline,
  detectDrift,
  _internal: { getField, isPresent }
};
