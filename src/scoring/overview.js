'use strict';
/**
 * Hypergrowth Engine — Overview-Metrik (Cross-Branchen-Vergleichbarkeit)
 * =====================================================================
 * Primaer: Bruttogewinn-Wachstum (YoY) — die fairste branchenuebergreifende
 * Growth-Zahl (Novy-Marx), respektiert Margen-Niveaus, bestraft Unprofitabilitaet
 * nicht (GP fast immer positiv), kein KGV.
 *
 * audit/fix (O1, 2026-06-26): Dieser Wert wird als branchenuebergreifend VERGLEICHBARE
 * Anzeige-Spalte je Name mitgefuehrt — er ist NICHT der Sortier-Schluessel der Overview-Liste.
 * Die Cross-Branchen-Overview wird in score.js::produceRankings nach dem per-Kohorte
 * gemischten SCORE gerankt (nicht nach einem universumsweiten GP-Perzentil): ein reines
 * GP-Wachstum-Ranking wuerde Micro-Cap-Basis-Artefakte hochspuelen (GP von ~0 auf klein =
 * +6000..+66000% bei UEC/JOBY/NUVB), die der Kohorten-Score korrekt unterdrueckt.
 *
 * Track-eigene Badges (klar als Nicht-GP markiert, nur intra-kohort verglichen):
 *   - degenerierte-GP-Financials (Master-r >= 0.99) -> Revenue-YoY-Badge
 *   - REITs            -> FFO-Proxy-YoY-Badge
 *   - Pre-Revenue/Biotech -> Cash-Runway-Quartale-Badge
 * Begleitspalte: Rule-of-X (alpha=2.3) fuer den Wachstum-vs-Effizienz-Blick.
 */

const { norm, firstPresent, firstTwoPresent, jahresFensterAusgerichtet } = require('./snapshot.js');
const { ruleOfX } = require('./axes.js');

// YoY-Wachstum einer {value}-Jahres-/Quartalsserie via norm()-Feldname.
function yoyAnnual(s, field) {
  const two = firstTwoPresent(norm(s, field));
  if (!two || two[1] <= 0) return null;
  return two[0] / two[1] - 1;
}

// Bruttogewinn-Wachstum YoY: TTM-ueber-TTM wenn >=8 present Quartale, sonst
// annualGP-YoY. (Aktuell 5 Quartale -> annual; zukunftssicher bei 8 Quartalen.)
function grossProfitGrowthYoY(s) {
  // Fix Bug 24: TTM-Fenster POSITIONAL auf der ROH-Serie schneiden (Muster
  // growthYoYComponents in score.js:162-171). presentValues() komprimiert
  // null-Luecken -> slice(4,8) wuerde bei interner Luecke das Vorjahres-Fenster
  // verschieben (kein Jahresvergleich mehr). Nur wenn die ersten 8 Quartale
  // luecken-frei finit sind, ist die positionale TTM-ueber-TTM-Bildung ehrlich.
  // F-4 (03.08.2026): "luecken-frei finit" reicht nicht — eine Reihe kann acht finite
  // Quartale tragen und trotzdem ein Quartal AUSLASSEN (bei chinesischen A-Aktien der
  // Normalfall). Dann ist slice(4,8) nicht das Vorjahr, sondern ein verschobenes Fenster.
  // jahresFensterAusgerichtet prueft genau das am Enddatum; ohne Enden ist es true und
  // das Verhalten byte-identisch zu vorher.
  const raw = norm(s, 'grossProfitQ');
  if (raw.length >= 8 && raw.slice(0, 8).every(Number.isFinite)
      && jahresFensterAusgerichtet(s, 'grossProfitQ', 4)) {
    const ttmNew = raw.slice(0, 4).reduce((p, c) => p + c, 0);
    const ttmOld = raw.slice(4, 8).reduce((p, c) => p + c, 0);
    if (ttmOld > 0) return ttmNew / ttmOld - 1;
  }
  return yoyAnnual(s, 'annualGP');
}

// FFO-Proxy-YoY (REIT-Badge): (NetIncome + Depreciation) je GJ, YoY.
function ffoProxyGrowthYoY(s) {
  const ni = norm(s, 'annualNetIncome');
  const dep = norm(s, 'annualDepreciation');
  const n = Math.min(ni.length, dep.length); // Laengen clampen (kein undefined-Zip)
  const ffo = [];
  for (let i = 0; i < n; i++) {
    const a = ni[i], b = dep[i];
    ffo.push((a !== null && b !== null && Number.isFinite(a + b)) ? a + b : null);
  }
  const two = firstTwoPresent(ffo);
  if (!two || two[1] <= 0) return null; // negative Basis kippt sonst das Vorzeichen
  return two[0] / two[1] - 1;
}

// Cash-Runway in Quartalen (Pre-Revenue/Biotech-Badge): Cash / (Burn/4).
function cashRunwayQuarters(s) {
  const cash = firstPresent(norm(s, 'annualBalance', 'totalCash'));
  const fcf = firstPresent(norm(s, 'annualFCF'));
  if (cash === null || fcf === null) return null;
  // Cash-generierend = bester (=hoechster) Runway: endlicher Sentinel statt Infinity,
  // damit q()/Perzentil und JSON (Infinity -> null) den Wert nicht verlieren.
  if (fcf >= 0) return 9999;
  return cash / (Math.abs(fcf) / 4);
}

// Rule-of-X-Begleitspalte (growth-dominant, aus 2 freien Feldern).
// growthBounds MUSS durchgereicht werden: Tag 302 hat ruleOfX um die data-learned
// Klemmung erweitert und score.js:132 reicht sie an die ACHSE durch — die Anzeige
// hier tat es nicht und zeigte dadurch dieselbe Kennzahl ungeklemmt (R-Gate 2.R,
// Fund F6-1: 131 Namen wichen ab, JOBY 90121 statt 1048, 25 davon in Top-100-Boards).
// Ohne Bounds (Aufruf aus Tests/Tools) bleibt das Verhalten wie zuvor: ungeklemmt.
function ruleOfXCompanion(s, growthBounds) {
  return ruleOfX(s, 2.3, true, growthBounds);
}

/**
 * overviewMetric(s, opts) -> { kind, value, companion }
 * opts: { gpClass:'real'|'degenerate'|'none', specialTrack:'reit'|'biotech'|null,
 *         growthBounds:[lo,hi]|null }
 * kind: 'gp' | 'revenue-badge' | 'ffo-badge' | 'runway-badge'
 */
function overviewMetric(s, opts = {}) {
  const companion = ruleOfXCompanion(s, opts.growthBounds);
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
