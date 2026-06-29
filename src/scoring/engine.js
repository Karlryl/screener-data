'use strict';
/**
 * Hypergrowth Engine — Schicht 2: Kern-Mechanik
 * =============================================
 * Generisch, einmal. Konsumiert ausschliesslich normalisierte Serien aus
 * Schicht 0 (src/scoring/snapshot.js) — NIE Rohfelder.
 *
 *  - q()/percentileRank: lineare, cohort-relative Perzentil-Normierung 0..100.
 *  - weightedScore(): gewichtete Summe vorhandener Achsen mit renorm-on-drop;
 *    eine fehlende/verworfene Achse wird GEDROPPT und die Gewichte renormiert —
 *    NIE ein Fake-Neutralwert (50) eingesetzt.
 *  - fcfMarginValid()/fcfTrack(): fcfSignGuard G0-G3 — haertet die FCF-Marge
 *    (Effizienz-Achse UND Default-Split-Linie) gegen Vorzeichen-/Basis-Artefakte
 *    (NVTS +108% bei 4 Verlustjahren), ohne einen Turnaround (CRDO) faelschlich
 *    in den Unprofitable-Track zu druecken.
 *  - signTrack(): Track ueber das Vorzeichen einer OpInc-/NetIncome-Serie.
 */

const { hasPresent, firstPresent, sumPresent, recentSumPresent, sign } = require('./snapshot.js');

// --- q() / Perzentil ---------------------------------------------------------

/**
 * Linearer Mid-Rank-Perzentil von x INNERHALB der Kohorte (0..1).
 * Mid-Rank (#{<x} + 0.5*#{==x}) / N behandelt Bindungen symmetrisch.
 * Nicht-finite/null Kohorten-Werte werden ignoriert. x nicht-finit -> null,
 * leere Kohorte -> null (Achse droppt dann via weightedScore).
 */
function percentileRank(x, cohort) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  if (!Array.isArray(cohort)) return null;
  let n = 0, lt = 0, eq = 0;
  for (const v of cohort) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    n++;
    if (v < x) lt++;
    else if (v === x) eq++;
  }
  if (n === 0) return null;
  return (lt + 0.5 * eq) / n;
}

// 0..100 Perzentil-Score (null wenn nicht berechenbar -> Achse droppt).
function q(x, cohort) {
  const p = percentileRank(x, cohort);
  return p === null ? null : p * 100;
}

// --- gewichtete Summe mit renorm-on-drop ------------------------------------

/**
 * axes: Array<{ value: number|null, weight: number }>
 * Gewichtete Summe NUR ueber vorhandene (finite) Achsen, Gewichte renormiert.
 * Eine gedroppte Achse (value null/nicht-finit ODER weight<=0) faellt komplett
 * heraus — sie wird NICHT als 50 oder 0 eingespeist. Alle Achsen weg -> null.
 */
function weightedScore(axes) {
  if (!Array.isArray(axes)) return null;
  let wsum = 0, vsum = 0;
  for (const a of axes) {
    if (!a) continue;
    const v = a.value;
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (!(a.weight > 0) || !Number.isFinite(a.weight)) continue; // Infinity-Gewicht -> NaN-Schutz
    wsum += a.weight;
    vsum += a.weight * v;
  }
  if (wsum <= 0) return null;
  const r = vsum / wsum;
  return Number.isFinite(r) ? r : null;
}

/**
 * audit/fix (Court Phase A Runde 3, Fall C4): Achsen-Gewichts-Coverage eines Namens =
 * Summe der Gewichte PRESENT-er Achsen / Summe ALLER Achsen-Gewichte. Das ist genau das
 * Gewicht, das renorm-on-drop bei fehlenden Achsen still verwirft. Dient als data-gelernter
 * Shrinkage-Faktor (score.js): wcov=1 (alle Achsen present) -> keine Schrumpfung; wcov<1
 * (unvollstaendige Achsen) -> Score Richtung Kohorten-Median schrumpfen (effektives N / Inv. 4).
 * GEWICHTS-basiert (nicht achsen-ZAHL-basiert), da Achsen ungleich gewichtet sind.
 */
function coverageWeight(axes) {
  if (!Array.isArray(axes)) return null;
  let presentW = 0, totalW = 0;
  for (const a of axes) {
    if (!a || !(a.weight > 0) || !Number.isFinite(a.weight)) continue;
    totalW += a.weight;
    const v = a.value;
    if (v !== null && v !== undefined && Number.isFinite(v)) presentW += a.weight;
  }
  return totalW > 0 ? presentW / totalW : null;
}

// --- fcfSignGuard (G0-G3) + Track -------------------------------------------

/**
 * Gilt die TTM-FCF-Marge als VERTRAUENSWUERDIG (darf in Effizienz-Achse/Split)?
 * Eingaben: fcfMarginTTM (Skalar aus metrics), normFCF/normOCF = norm()-Serien.
 *   G0: TTM fehlt/nicht-finit            -> false (FCF-Term droppen).
 *   G1: weder FCF- noch OCF-Serie present -> false (HART droppen, nie sign(0)).
 *   G2: sign(TTM) == sign(juengstes present FCF-Jahr) (sonst Artefakt -> false).
 *   G3: recentSumPresent(FCF,2) >= 0  ODER  recentSumPresent(OCF,2) >= 0
 *       (juengstes 2-Jahres-Fenster, NICHT die Lebenszeit-Summe — sonst kappen
 *        alte Burn-Jahre einen echten Turnaround wie BE).
 * true nur, wenn G0-G3 alle erfuellt.
 */
function fcfMarginValid(fcfMarginTTM, normFCF, normOCF) {
  if (fcfMarginTTM === null || fcfMarginTTM === undefined || !Number.isFinite(fcfMarginTTM)) {
    return false; // G0
  }
  if (!hasPresent(normFCF) && !hasPresent(normOCF)) return false; // G1
  if (!hasPresent(normFCF)) return false; // G2 braucht juengstes present FCF-Jahr
  if (sign(fcfMarginTTM) !== sign(firstPresent(normFCF))) return false; // G2
  // G3 (OCF-/FCF-Rescue): juengstes 2-Jahres-Fenster, NICHT die Lebenszeit-Summe
  // — sonst kappen alte Burn-Jahre einen echten Turnaround (BE: sumFCF lifetime
  // -674M, aber 2 juengste Jahre +90M). Bestaetigt durable cash-gen ohne Alt-Last-Strafe.
  const rFcf = recentSumPresent(normFCF, 2);
  const rOcf = recentSumPresent(normOCF, 2);
  const fcfRescue = rFcf !== null && rFcf >= 0;
  const ocfRescue = rOcf !== null && rOcf >= 0;
  if (!fcfRescue && !ocfRescue) return false; // G3
  return true;
}

/**
 * Track ueber die FCF-Linie. Bei gueltiger TTM-Marge nach deren Vorzeichen,
 * sonst ueber den juengstes-Jahr-/OCF-Summen-Konsens. 'unknown', wenn weder
 * FCF noch OCF present sind (die Branche routet dann ueber OpInc).
 */
function fcfTrack(fcfMarginTTM, normFCF, normOCF) {
  if (fcfMarginValid(fcfMarginTTM, normFCF, normOCF)) {
    return fcfMarginTTM >= 0 ? 'profitable' : 'unprofitable';
  }
  if (hasPresent(normFCF)) return firstPresent(normFCF) >= 0 ? 'profitable' : 'unprofitable';
  if (hasPresent(normOCF)) return sumPresent(normOCF) >= 0 ? 'profitable' : 'unprofitable';
  return 'unknown';
}

/**
 * Track ueber das Vorzeichen einer Profitabilitaets-Serie (OpInc/NetIncome),
 * juengstes present Jahr. 'unknown', wenn kein present Wert.
 */
function signTrack(normSeries) {
  if (!hasPresent(normSeries)) return 'unknown';
  return firstPresent(normSeries) >= 0 ? 'profitable' : 'unprofitable';
}

module.exports = {
  percentileRank, q, weightedScore, coverageWeight,
  fcfMarginValid, fcfTrack, signTrack,
};
