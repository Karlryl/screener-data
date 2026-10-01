'use strict';
/**
 * Which leg carries the revenue growth figure (revGrowthYoYPct), and for which period.
 *
 * revGrowthLevel (src/scoring/axes.js) picks the quarterly leg when revQuartalsYoY gives a
 * number, otherwise the annual leg: the recorded newer fiscal year (annualLegNewerYear) if it
 * is valid, else annualRev[0] against annualRev[1]. This helper walks the SAME branch with the
 * SAME exported functions and returns the figure it gets, so a caller can prove that label and
 * number agree (pct === revGrowthLevel(snapshot)) instead of assuming it. src/scoring/ stays
 * untouched (GQS-00 seal); if the branch there ever changes, the agreement checks in
 * scripts/write-findash-export.js and tests/rev-growth-basis.test.js go red.
 *
 * Period ends are only what the stored data carries (revenueQEnds / annualRevEnds /
 * meta.annualRevNewerYear.end|priorEnd), as ISO days. Undated or unreadable -> null, never
 * guessed.
 */
const axes = require('../src/scoring/axes.js');
const { norm, periodEnds, jahresVergleichIdx } = require('../src/scoring/snapshot.js');

const REV_GROWTH_BASES = Object.freeze(['quarter', 'year', 'yearNewerRecord', 'none']);

/**
 * Stored ISO day or null. Round trip check: Date.parse rolls 2025-02-30 into March.
 * @param {*} d stored period end
 * @returns {string|null} YYYY-MM-DD or null
 */
function isoTag(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const tag = d.slice(0, 10);
  const t = Date.parse(tag + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === tag ? tag : null;
}

function annualRevEnds(s) {
  const roh = s && s.annual && s.annual.annualRevEnds;
  // Index integrity before data, like periodEnds: a misaligned end list dates nothing.
  return Array.isArray(roh) && roh.length === norm(s, 'annualRev').length ? roh : [];
}

/**
 * Leg, figure and period of revGrowthLevel(s): { basis, pct, periodEnd, priorPeriodEnd }.
 * @param {object} s snapshot, already through the hand-table overlay (prepareSnapshot)
 * @returns {{basis:string, pct:number|null, periodEnd:string|null, priorPeriodEnd:string|null}}
 *   basis 'quarter'          newest quarter vs the year-ago quarter (revQuartalsYoY)
 *   basis 'yearNewerRecord'  recorded newer fiscal year vs its prior year (annualLegNewerYear)
 *   basis 'year'             annualRev[0] vs annualRev[1] (revAnnualYoY)
 *   basis 'none'             no growth figure (pct null)
 * pct is the unclamped percentage, computed exactly as revGrowthLevel(s) computes it.
 */
function revGrowthLeg(s) {
  const q = axes.revQuartalsYoY(s);
  if (q !== null) {
    const v = jahresVergleichIdx(s, 'revenueQ', 0); // non-null whenever revQuartalsYoY is
    const ends = periodEnds(s, 'revenueQ');
    return { basis: 'quarter', pct: q * 100, periodEnd: isoTag(ends[0]), priorPeriodEnd: isoTag(ends[v.idx]) };
  }
  const n = axes.annualLegNewerYear(s);
  if (n) {
    return { basis: 'yearNewerRecord', pct: axes.revAnnualLegYoY(s) * 100, periodEnd: isoTag(n.end), priorPeriodEnd: isoTag(n.priorEnd) };
  }
  const a = axes.revAnnualYoY(s);
  if (a !== null) {
    const ends = annualRevEnds(s);
    return { basis: 'year', pct: a * 100, periodEnd: isoTag(ends[0]), priorPeriodEnd: isoTag(ends[1]) };
  }
  return { basis: 'none', pct: null, periodEnd: null, priorPeriodEnd: null };
}

module.exports = { revGrowthLeg, REV_GROWTH_BASES, isoTag };
