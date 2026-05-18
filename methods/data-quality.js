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

// Tag 232c-4 (audit F-DQ-001 CRITICAL): extended CRITICAL_FIELDS to cover the
// Tag 211l / 219 / 220c schema additions. Pre-fix, a snapshot missing every
// newer field but having all 15 legacy fields graded A+, hiding the real data-
// quality gap that the schema-stale probe in pull-yahoo.js (Tag 226a-2) was
// firing on. Pre-fix total weight = 12.5; post-fix = 19.5 (14 new fields at
// weight 0.5 each). GRADE_THRESHOLDS unchanged for A+/A/B; C tightened to make
// D reachable (F-DQ-003 companion fix below).
const CRITICAL_FIELDS = [
  // === Legacy fields (Tag 133c era) — weight 1.0 ===
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
  // === Legacy fields (Tag 133c era) — weight 0.5 ===
  { id: 'annual.annualOpInc>=3', weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualOpInc) >= 3 },
  { id: 'annual.annualFCF>=2',  weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualFCF) >= 2 },
  { id: 'annual.annualBalance>=2', weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualBalance) >= 2 },
  { id: 'timeseries.revenueQ>=4', weight: 0.5, check: s => _arrLen(s.timeseries && s.timeseries.revenueQ) >= 4 },
  { id: 'timeseries.opIncQ>=2', weight: 0.5, check: s => _arrLen(s.timeseries && s.timeseries.opIncQ) >= 2 },
  // === Tag 211l additions (SGA + Depreciation income/cashflow + balance fields) ===
  { id: 'annual.annualSGA>=2',  weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualSGA) >= 2 },
  { id: 'annual.annualDepreciation>=2', weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualDepreciation) >= 2 },
  { id: 'annualBalance[0].currentAssets', weight: 0.5, check: s => _hasBalanceField(s, 'currentAssets') },
  { id: 'annualBalance[0].currentLiabilities', weight: 0.5, check: s => _hasBalanceField(s, 'currentLiabilities') },
  { id: 'annualBalance[0].totalLiabilities', weight: 0.5, check: s => _hasBalanceField(s, 'totalLiabilities') },
  { id: 'annualBalance[0].accountsReceivable', weight: 0.5, check: s => _hasBalanceField(s, 'accountsReceivable') },
  { id: 'annualBalance[0].netPPE', weight: 0.5, check: s => _hasBalanceField(s, 'netPPE') },
  // === Tag 219 additions (shares + market-data fields for beneish/buyback/BAB) ===
  { id: 'annual.annualShares>=2', weight: 0.5, check: s => _arrLen(s.annual && s.annual.annualShares) >= 2 },
  { id: 'metrics.ebitda',       weight: 0.5, check: s => _hasMetric(s.metrics && s.metrics.ebitda) },
  { id: 'metrics.enterpriseValue', weight: 0.5, check: s => _hasMetric(s.metrics && s.metrics.enterpriseValue) },
  { id: 'metrics.beta',         weight: 0.5, check: s => _hasMetric(s.metrics && s.metrics.beta) },
  { id: 'metrics.forwardPE',    weight: 0.5, check: s => _hasMetric(s.metrics && s.metrics.forwardPE) },
  // === Tag 220c additions ===
  { id: 'timeseries.netIncomeQ>=4', weight: 0.5, check: s => _arrLen(s.timeseries && s.timeseries.netIncomeQ) >= 4 },
  { id: 'meta.earningsHistory', weight: 0.5, check: s => !!(s.meta && s.meta.earningsHistory) }
];

const TOTAL_WEIGHT = CRITICAL_FIELDS.reduce((sum, f) => sum + f.weight, 0);

// F-DQ-007/F-DQ-008: Grade thresholds recalibrated to be percentage-of-max-score based,
// not absolute-weight based. Previous thresholds were calibrated against TOTAL_WEIGHT=12.5
// but expressed as nanRatio (missingWeight/TOTAL_WEIGHT), which is correct in principle —
// but the docstring claimed "B has C+ cap" while tierCapForGrade('B') returned null (no cap).
//
// Fix: thresholds now expressed as PRESENT score ratio (1 - nanRatio = presentRatio):
//   A+: ≥ 80% of max score present  → full evaluation
//   A:  ≥ 60% of max score present  → full evaluation
//   B:  ≥ 40% of max score present  → full evaluation (no tier cap — B is trustworthy)
//   C:  ≥ 0%  of max score present  — NEAR_MISS cap
//   D:  presentRatio < threshold     — REJECT
//
// Equivalently as nanRatio (missing weight / total weight):
//   A+: nanRatio ≤ 0.20 (≤ 20% missing)
//   A:  nanRatio ≤ 0.40 (20–40% missing)
//   B:  nanRatio ≤ 0.60 (40–60% missing)
//   C:  nanRatio ≤ 1.00 (60–100% missing → NEAR_MISS cap)
//   D:  nanRatio > 1.00  — impossible (kept for safety)
// Tag 232c-4 (audit F-DQ-003): C upper bound tightened from 1.00 to 0.85
// so D is actually reachable (the prior 1.00 made D mathematically impossible
// because max nanRatio = 1.0 satisfied ≤1.00, falling into C). Now >85%
// missing → D → REJECT via tierCapForGrade. C still wide (60-85%) so
// realistic mid-quality snapshots don't get rejected outright.
const GRADE_THRESHOLDS = {
  Aplus: 0.20,  // ≤20% missing → A+
  A:     0.40,  // 20–40% missing → A
  B:     0.60,  // 40–60% missing → B
  C:     0.85   // 60–85% missing → C (NEAR_MISS cap); >85% → D (REJECT)
};

function _hasMetric(m) {
  if (!m) return false;
  if (typeof m === 'number') return Number.isFinite(m);
  return m.value != null && (typeof m.value !== 'number' || Number.isFinite(m.value));
}

// Tag 232c-4: check the LATEST annualBalance row for a named field. The Tag 211l
// balance-sheet additions (currentAssets/currentLiabilities/totalLiabilities/
// accountsReceivable/netPPE) sit per-row inside annualBalance[i], not as top-
// level arrays. Yahoo's FTS returns null for missing line items so we require
// a finite numeric value, not just key presence.
function _hasBalanceField(snap, key) {
  const bs = snap && snap.annual && snap.annual.annualBalance;
  if (!Array.isArray(bs) || bs.length === 0) return false;
  const row = bs[0];
  if (!row || typeof row !== 'object') return false;
  const v = row[key];
  return v != null && Number.isFinite(v);
}

function _arrLen(arr) {
  if (!Array.isArray(arr)) return 0;
  // Bug #17: x != null passes NaN through — NaN entries count as present data.
  // F-DQ-004 (Tag 179): {value: null} envelopes are positional-alignment placeholders
  // (Bug #26 preserves nulls to keep array indices aligned across series). They must
  // NOT count as present data — previously `v === null` short-circuited them as
  // "non-numeric object → count", which gamed the data-quality grade. Now: an
  // envelope object with a `value` key is only counted when value is finite.
  // Other objects (balance rows like {totalCash, totalDebt}) still count.
  return arr.filter(x => {
    if (x == null) return false;
    if (typeof x === 'number') return Number.isFinite(x);
    if (typeof x === 'object' && 'value' in x) return Number.isFinite(x.value);
    // Other objects (balance rows etc.) count as present
    return true;
  }).length;
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
  // F-DQ-007/F-DQ-008: use recalibrated percentage-of-max-score thresholds
  let grade;
  if (nanRatio <= GRADE_THRESHOLDS.Aplus) grade = 'A+';
  else if (nanRatio <= GRADE_THRESHOLDS.A) grade = 'A';
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
// F-DQ-007/F-DQ-008: tierCapForGrade updated to match recalibrated grades.
// A+ and A: no cap — full evaluation.
// B: no cap — trustworthy enough for picks (40–60% of fields present).
// C: NEAR_MISS cap — docstring now matches actual behavior (was previously unenforced).
// D: REJECT — excluded from picks.
function tierCapForGrade(grade) {
  switch (grade) {
    case 'A+': return null;       // no cap — excellent data quality
    case 'A':  return null;       // no cap — good data quality
    case 'B':  return null;       // no cap — B is trustworthy (40–60% of max score)
    case 'C':  return 'NEAR_MISS'; // C+ cap enforced: can only be NEAR_MISS, not A/B pick
    case 'D':  return 'REJECT';    // D excluded from all picks
    default:   return null;
  }
}

module.exports = {
  gradeSnapshot,
  tierCapForGrade,
  CRITICAL_FIELDS,
  GRADE_THRESHOLDS,
  TOTAL_WEIGHT
};
