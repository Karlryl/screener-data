'use strict';
/**
 * Tag 133c: Per-Snapshot Data-Quality Grade
 * =========================================
 * Berechnet pro Snapshot einen Grade (A/B/C/D) aus dem Anteil fehlender
 * kritischer Felder. Bewahrt das System davor, Stocks mit massiven Yahoo-NaN
 * gleich wie vollständige Snapshots zu behandeln (Tag 129-konform: first-principles
 * Banding, kein single-ticker Threshold-Tuning).
 *
 * Grade-Banding (nanRatio = fehlende / total kritische Felder):
 *   A: ≤ 10% fehlend  — vollständige Bewertung möglich
 *   B: 10–30% fehlend — Tier-Cap C+ zulässig
 *   C: 30–50% fehlend — Picks nur als NEAR_MISS, nicht A/B
 *   D: > 50% fehlend  — Aus Picks ausgeschlossen
 *
 * Score-Aggregator-Integration ist OPT-IN via env DATAQUALITY_ENFORCE=1
 * (default off bis genug _quality-Historie akkumuliert ist).
 */

// 10 kritische Felder (gewichtet 1.0) + 5 wichtige Felder (gewichtet 0.5).
// Total weight = 12.5; missing weight wird gegen total normalisiert.
const CRITICAL_FIELDS = [
  { id: 'meta.sector',          weight: 1.0, check: s => !!(s.meta && s.meta.sector) },
  { id: 'meta.industry',        weight: 1.0, check: s => !!(s.meta && s.meta.industry) },
  { id: 'meta.ticker',          weight: 1.0, check: s => !!(s.meta && s.meta.ticker) },
  { id: 'marketCap',            weight: 1.0, check: s => _hasMetric(s.marketCap) },
  { id: 'metrics.revenueTTM',   weight: 1.0, check: s => _hasMetric(s.metrics && s.metrics.revenueTTM) },
  { id: 'metrics.revenueGrowthYoY', weight: 1.0, check: s => _hasMetric(s.metrics && s.metrics.revenueGrowthYoY) },
  { id: 'metrics.grossMargin',  weight: 1.0, check: s => _hasMetric(s.metrics && s.metrics.grossMargin) },
  { id: 'metrics.operatingMargin', weight: 1.0, check: s => _hasMetric(s.metrics && s.metrics.operatingMargin) },
  { id: 'metrics.fcfMarginTTM', weight: 1.0, check: s => _hasMetric(s.metrics && s.metrics.fcfMarginTTM) },
  { id: 'annual.annualRev>=3',  weight: 1.0, check: s => _arrLen(s.annual && s.annual.annualRev) >= 3 },
  { id: 'annual.annualOpInc>=3', weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualOpInc) >= 3 },
  { id: 'annual.annualFCF>=2',  weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualFCF) >= 2 },
  { id: 'annual.annualBalance>=2', weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualBalance) >= 2 },
  { id: 'timeseries.revenueQ>=4', weight: 0.5, check: s => _arrLen(s.timeseries && s.timeseries.revenueQ) >= 4 },
  { id: 'timeseries.opIncQ>=2', weight: 0.5, check: s => _arrLen(s.timeseries && s.timeseries.opIncQ) >= 2 }
];

const TOTAL_WEIGHT = CRITICAL_FIELDS.reduce((sum, f) => sum + f.weight, 0);

const GRADE_THRESHOLDS = {
  A: 0.10,  // ≤10% missing
  B: 0.30,  // 10–30% missing
  C: 0.50   // 30–50% missing
  // > 50% = D
};

function _hasMetric(m) {
  if (!m) return false;
  if (typeof m === 'number') return Number.isFinite(m);
  return m.value != null && (typeof m.value !== 'number' || Number.isFinite(m.value));
}

function _arrLen(arr) {
  if (!Array.isArray(arr)) return 0;
  return arr.filter(x => x != null).length;
}

/**
 * Grade-Berechnung eines Snapshots.
 * @param {Object} snapshot — kanonisches Snapshot-Objekt (output von mapYahooToCanonical)
 * @returns {{grade:'A'|'B'|'C'|'D', nanRatio:number, missingFields:string[], computedAt:string}}
 */
function gradeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { grade: 'D', nanRatio: 1.0, missingFields: ['<invalid-snapshot>'], computedAt: new Date().toISOString() };
  }
  const missing = [];
  let missingWeight = 0;
  for (const f of CRITICAL_FIELDS) {
    let ok = false;
    try { ok = f.check(snapshot); } catch (e) { ok = false; }
    if (!ok) {
      missing.push(f.id);
      missingWeight += f.weight;
    }
  }
  const nanRatio = missingWeight / TOTAL_WEIGHT;
  let grade;
  if (nanRatio <= GRADE_THRESHOLDS.A) grade = 'A';
  else if (nanRatio <= GRADE_THRESHOLDS.B) grade = 'B';
  else if (nanRatio <= GRADE_THRESHOLDS.C) grade = 'C';
  else grade = 'D';
  return {
    grade,
    nanRatio: Math.round(nanRatio * 1000) / 1000,
    missingFields: missing,
    computedAt: new Date().toISOString()
  };
}

/**
 * Tier-Cap-Lookup: was darf ein Stock mit diesem Grade noch werden?
 * Genutzt von score-aggregator wenn DATAQUALITY_ENFORCE=1 gesetzt ist.
 */
function tierCapForGrade(grade) {
  switch (grade) {
    case 'A': return null;       // no cap
    case 'B': return null;       // no cap (B noch vertrauenswürdig)
    case 'C': return 'NEAR_MISS'; // C kann höchstens NEAR_MISS sein
    case 'D': return 'REJECT';    // D wird ausgeschlossen
    default: return null;
  }
}

module.exports = {
  gradeSnapshot,
  tierCapForGrade,
  CRITICAL_FIELDS,
  GRADE_THRESHOLDS,
  TOTAL_WEIGHT
};
