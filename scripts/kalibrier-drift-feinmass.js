#!/usr/bin/env node
/**
 * T138 — zweite, feinere Kennzahl zum Drift-Waechter: ANTEIL BEWEGTER VERTEILUNGEN.
 *
 * Warum ausserhalb von src/scoring/: der Waechter selbst (score.js calibrationDrift) und seine
 * Log-Zeile (run-screener.js) liegen unter dem GQS-Siegel. calibrationDrift() legt eine Verteilung
 * nur bei ks > ksThreshold in `drifted` ab — die unterschwellig bewegten Verteilungen werden
 * gezaehlt und VERWORFEN, ueberlebt nur maxKs. Ein feineres Mass hiesse Rueckgabe-Form der
 * versiegelten Funktion aendern.
 *
 * Dieses Skript ist statt dessen ein FREIER ZWEITLESER (gleiches Muster wie
 * scripts/write-excluded-list.js): es ruft die versiegelte Funktion UNVERAENDERT auf, nur mit
 * ksThreshold = 0. Damit landet jede Verteilung mit ks > 0 in `drifted` — der Anteil bewegter
 * Verteilungen faellt als Arithmetik ab, ohne eine Zeile im Siegel zu beruehren und ohne die
 * produktive Schwelle 0.15 zu senken (ein Absenken erzeugt rote Laeufe; T138 verbietet es
 * ausdruecklich).
 *
 * Aufruf:  node scripts/kalibrier-drift-feinmass.js <live-calibration.json> <ref-calibration.json> [--json]
 *   z. B.  node scripts/kalibrier-drift-feinmass.js board-history/2026-09-12/calibration.json \
 *                                                   board-history/2026-09-10/calibration.json
 *
 * Kennzahlen: anteilBewegt (ks > 0), anteilUeberSchwelle (ks > 0.15 = das, was der Waechter sieht),
 * medianKs, p90Ks, maxKs, nUnvergleichbar. Das Skript URTEILT NICHT (kein Exit-Code-Gate) —
 * es weist aus. Die Schwelle bleibt, wo sie ist.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { calibrationDrift } = require(path.join(__dirname, '..', 'src', 'scoring', 'score.js'));

const PROD_SCHWELLE = 0.15; // Default von calibrationDrift; hier nur zum AUSWEISEN, nie zum Gaten.

/**
 * Nenner: genau die Verteilungspaare, die calibrationDrift ueberhaupt betrachtet.
 * Spiegelt dessen Auswahl (Ref-Kohorten ohne `axes` werden dort per `continue` uebersprungen).
 */
function vergleichbareVerteilungen(refCal) {
  const rb = (refCal && refCal.cohortBases) || {};
  let n = 0;
  for (const key of Object.keys(rb)) {
    const ra = rb[key] && rb[key].axes;
    if (!ra) continue;
    n += Object.keys(ra).length;
  }
  return n + Object.keys((refCal && refCal.gDistByCohort) || {}).length;
}

function quantil(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Reine Funktion — das Mass. */
function driftFeinmass(liveCal, refCal, prodSchwelle = PROD_SCHWELLE) {
  const gesamt = vergleichbareVerteilungen(refCal);
  // Ein Referenz-Lineal ohne EINE vergleichbare Verteilung macht jeden Anteil zum 0/0 —
  // und ein Anteil ohne Nenner ist genau die Sorte Aussage, gegen die T138 geschrieben ist.
  // Laut abbrechen statt eine Kennzahl auszuweisen, die nichts gemessen hat (BH-074-Regel:
  // nicht-vergleichbar ist der maximale Drift-Fall, nicht "kein Drift").
  if (!gesamt) throw new Error('[drift-feinmass] Referenz-Lineal enthaelt keine vergleichbare Verteilung (cohortBases[*].axes und gDistByCohort beide leer) — kein Nenner, keine Kennzahl.');
  // ksThreshold 0 => `drifted` enthaelt JEDE bewegte Verteilung mit ihrem ks, nicht nur die lauten.
  const alle = calibrationDrift(liveCal, refCal, 0);
  const bewegt = alle.drifted;
  const ksWerte = bewegt.map((d) => d.ks).sort((a, b) => a - b);
  const ueberSchwelle = bewegt.filter((d) => d.ks > prodSchwelle).length;
  const unvergleichbar = bewegt.filter((d) => d.reason === 'uncomparable').length;
  // Median ueber ALLE vergleichbaren Verteilungen (die unbewegten sind ks = 0 und zaehlen mit) —
  // sonst wuerde der Median genau die Stillstehenden unterschlagen, um die es hier geht.
  const volleReihe = ksWerte.concat(new Array(Math.max(0, gesamt - ksWerte.length)).fill(0))
    .sort((a, b) => a - b);
  return {
    gesamt,
    bewegt: bewegt.length,
    anteilBewegt: gesamt ? bewegt.length / gesamt : null,
    ueberSchwelle,
    anteilUeberSchwelle: gesamt ? ueberSchwelle / gesamt : null,
    prodSchwelle,
    medianKs: quantil(volleReihe, 0.5),
    p90Ks: quantil(volleReihe, 0.9),
    maxKs: alle.maxKs,
    unvergleichbar,
  };
}

function lies(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main(argv) {
  const alsJson = argv.includes('--json');
  const pfade = argv.filter((a) => !a.startsWith('--'));
  if (pfade.length !== 2) {
    console.error('Aufruf: node scripts/kalibrier-drift-feinmass.js <live-calibration.json> <ref-calibration.json> [--json]');
    return 2;
  }
  const [livePfad, refPfad] = pfade;
  const m = driftFeinmass(lies(livePfad), lies(refPfad));
  if (alsJson) {
    console.log(JSON.stringify({ live: livePfad, ref: refPfad, ...m }, null, 2));
    return 0;
  }
  const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)} %`);
  console.log(`[drift-feinmass] live=${livePfad} ref=${refPfad}`);
  console.log(`[drift-feinmass] bewegt: ${m.bewegt}/${m.gesamt} Verteilungen (${pct(m.anteilBewegt)}) — Median-KS ${m.medianKs.toFixed(3)}, p90 ${m.p90Ks.toFixed(3)}, maxKS ${m.maxKs.toFixed(3)}`);
  console.log(`[drift-feinmass] davon ueber der produktiven Schwelle ${m.prodSchwelle}: ${m.ueberSchwelle} (${pct(m.anteilUeberSchwelle)})${m.unvergleichbar ? ` · unvergleichbar: ${m.unvergleichbar}` : ''}`);
  console.log('[drift-feinmass] Lesehilfe: "Kalibrier-Drift ok" heisst NUR maxKS <= Schwelle. Ein hoher Anteil bewegter Verteilungen bei gruenem Waechter bedeutet, dass zwei Laeufe NICHT auf demselben Lineal stehen.');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { driftFeinmass, vergleichbareVerteilungen, PROD_SCHWELLE };
