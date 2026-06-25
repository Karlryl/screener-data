'use strict';
/**
 * Hypergrowth Engine — Overview-Metrik (Cross-Branchen-Vergleichbarkeit)
 * =====================================================================
 * Primaer: Bruttogewinn-Wachstum (YoY) — die fairste branchenuebergreifende
 * Growth-Zahl (Novy-Marx), respektiert Margen-Niveaus, bestraft Unprofitabilitaet
 * nicht (GP fast immer positiv), kein KGV. Wird universumsweit perzentil-normiert.
 *
 * Track-eigene Badges (klar als Nicht-GP markiert, nur intra-kohort verglichen):
 *   - degenerierte-GP-Financials (Master-r >= 0.99) -> Revenue-YoY-Badge
 *   - REITs            -> FFO-Proxy-YoY-Badge
 *   - Pre-Revenue/Biotech -> Cash-Runway-Quartale-Badge
 * Begleitspalte: Rule-of-X (alpha=2.3) fuer den Wachstum-vs-Effizienz-Blick.
 */

const { norm, firstPresent } = require('./snapshot.js');
const { ruleOfX } = require('./axes.js');

function firstTwoPresent(series) {
  const out = [];
  for (const v of (Array.isArray(series) ? series : [])) {
    if (v !== null && v !== undefined) { out.push(v); if (out.length === 2) break; }
  }
  return out.length === 2 ? out : null;
}
function presentVals(series) {
  return (Array.isArray(series) ? series : []).filter((v) => v !== null && v !== undefined);
}

// YoY-Wachstum einer {value}-Jahres-/Quartalsserie via norm()-Feldname.
function yoyAnnual(s, field) {
  const two = firstTwoPresent(norm(s, field));
  if (!two || two[1] <= 0) return null;
  return two[0] / two[1] - 1;
}

// Bruttogewinn-Wachstum YoY: TTM-ueber-TTM wenn >=8 present Quartale, sonst
// annualGP-YoY. (Aktuell 5 Quartale -> annual; zukunftssicher bei 8 Quartalen.)
function grossProfitGrowthYoY(s) {
  const present = presentVals(norm(s, 'grossProfitQ'));
  if (present.length >= 8) {
    const ttmNew = present.slice(0, 4).reduce((p, c) => p + c, 0);
    const ttmOld = present.slice(4, 8).reduce((p, c) => p + c, 0);
    if (ttmOld > 0) return ttmNew / ttmOld - 1;
  }
  return yoyAnnual(s, 'annualGP');
}

// FFO-Proxy-YoY (REIT-Badge): (NetIncome + Depreciation) je GJ, YoY.
function ffoProxyGrowthYoY(s) {
  const ni = norm(s, 'annualNetIncome');
  const dep = norm(s, 'annualDepreciation');
  const ffo = ni.map((v, i) => (v !== null && dep[i] !== null) ? v + dep[i] : null);
  const two = firstTwoPresent(ffo);
  if (!two || two[1] === 0) return null;
  return two[0] / two[1] - 1;
}

// Cash-Runway in Quartalen (Pre-Revenue/Biotech-Badge): Cash / (Burn/4).
function cashRunwayQuarters(s) {
  const cash = firstPresent(norm(s, 'annualBalance', 'totalCash'));
  const fcf = firstPresent(norm(s, 'annualFCF'));
  if (cash === null || fcf === null) return null;
  if (fcf >= 0) return Infinity; // generiert Cash
  return cash / (Math.abs(fcf) / 4);
}

// Rule-of-X-Begleitspalte (growth-dominant, aus 2 freien Feldern).
function ruleOfXCompanion(s) {
  return ruleOfX(s, 2.3, true);
}

/**
 * overviewMetric(s, opts) -> { kind, value, companion }
 * opts: { gpClass:'real'|'degenerate'|'none', specialTrack:'reit'|'biotech'|null }
 * kind: 'gp' | 'revenue-badge' | 'ffo-badge' | 'runway-badge'
 */
function overviewMetric(s, opts = {}) {
  const companion = ruleOfXCompanion(s);
  if (opts.specialTrack === 'reit') {
    return { kind: 'ffo-badge', value: ffoProxyGrowthYoY(s), companion };
  }
  if (opts.specialTrack === 'biotech') {
    return { kind: 'runway-badge', value: cashRunwayQuarters(s), companion };
  }
  if (opts.gpClass === 'degenerate') {
    return { kind: 'revenue-badge', value: yoyAnnual(s, 'annualRev'), companion };
  }
  // Default / echter GP
  return { kind: 'gp', value: grossProfitGrowthYoY(s), companion };
}

module.exports = {
  overviewMetric, grossProfitGrowthYoY, ffoProxyGrowthYoY,
  cashRunwayQuarters, ruleOfXCompanion, yoyAnnual,
};
