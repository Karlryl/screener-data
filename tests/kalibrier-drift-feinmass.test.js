'use strict';
/**
 * T138 — Drift-Feinmass: der Anteil bewegter Verteilungen, den der Waechter verwirft.
 * ==================================================================================
 *
 * BEFUND (23.08.2026): `[run-screener] Kalibrier-Drift ok` im Tageslauf-Log, waehrend sich
 * 147 von 156 Kohorten/Achsen-Verteilungen bewegen (maxKS 0,103 gegen Schwelle 0,15,
 * Median 0,015). Kein Fehler — die Schwelle ist fuer grobe Basisverschiebungen gebaut.
 * Aber "ok" heisst NICHT "das Lineal steht still"; wer es so liest, haelt zwei Laeufe
 * fuer vergleichbar, die es nicht sind.
 *
 * URSACHE, am Code (`src/scoring/score.js` calibrationDrift): eine Verteilung landet nur
 * bei `ks > ksThreshold` in `drifted` — die unterschwellig bewegten werden berechnet und
 * VERWORFEN, ueberlebt nur `maxKs`. Beide Stellen liegen unter dem GQS-Siegel, deshalb
 * ist das Feinmass ein freier Zweitleser (`scripts/kalibrier-drift-feinmass.js`), der die
 * versiegelte Funktion UNVERAENDERT mit ksThreshold = 0 aufruft.
 *
 * WAS HIER FESTGENAGELT WIRD — die AUSSAGE, nicht die Schreibweise:
 *   (a) ANWESENHEIT: genau die Konstellation des Befunds (alles bewegt, maxKS unter der
 *       Schwelle) muss einen hohen Anteil ausweisen, WAEHREND der Waechter ok meldet
 *   (b) ABWESENHEIT: identische Lineale muessen 0 % ergeben (kein Ueber-Trigger)
 *   (c) die produktive Schwelle 0,15 wird AUSGEWIESEN, nicht gesenkt (T138 verbietet das
 *       Senken ausdruecklich: es erzeugt rote Laeufe)
 *   (d) der Nenner spiegelt exakt die Auswahl der versiegelten Funktion
 *
 * Hermetisch: kein Substrat, keine Snapshots — synthetische Lineale.
 */
const test = require('node:test');
const assert = require('node:assert');
const { driftFeinmass, vergleichbareVerteilungen, PROD_SCHWELLE } =
  require('../scripts/kalibrier-drift-feinmass.js');
const { calibrationDrift } = require('../src/scoring/score.js');

const ACHSEN = ['revGrowthLevel', 'revAcceleration', 'gpGrowth'];

/** Baut ein Lineal mit `nKohorten` Kohorten; `verschiebung(kohorte, achse)` addiert auf jeden Wert. */
function lineal(nKohorten, verschiebung = () => 0) {
  const cohortBases = {}, gDistByCohort = {};
  for (let c = 0; c < nKohorten; c++) {
    const key = `sektor${c}|profitable`;
    const axes = {};
    for (const ax of ACHSEN) {
      const d = verschiebung(c, ax);
      axes[ax] = Array.from({ length: 100 }, (_, i) => i / 100 + d);
    }
    cohortBases[key] = { axes };
    gDistByCohort[key] = Array.from({ length: 100 }, (_, i) => i / 100 + verschiebung(c, 'gDist'));
  }
  return { cohortBases, gDistByCohort };
}

test('(a) T138-Konstellation: Waechter meldet ok, Feinmass weist die Bewegung aus', () => {
  // Winzige, aber durchgaengige Verschiebung: jede Verteilung bewegt sich, keine ueber 0,15.
  const ref = lineal(8);
  const live = lineal(8, () => 0.05);
  const waechter = calibrationDrift(live, ref); // produktive Schwelle 0,15
  assert.strictEqual(waechter.ok, true, 'Vorbedingung: der versiegelte Waechter meldet gruen');
  assert.ok(waechter.maxKs < PROD_SCHWELLE, 'Vorbedingung: maxKS unter der Schwelle');
  assert.strictEqual(waechter.drifted.length, 0, 'Vorbedingung: der Waechter verwirft alle Bewegung');

  const m = driftFeinmass(live, ref);
  assert.strictEqual(m.gesamt, 8 * ACHSEN.length + 8, 'Nenner: alle Achsen plus gDist je Kohorte');
  assert.strictEqual(m.bewegt, m.gesamt, 'genau das, was der Waechter fallen laesst');
  assert.strictEqual(m.anteilBewegt, 1);
  assert.strictEqual(m.ueberSchwelle, 0, 'kein lauter Drift — die Schwelle bleibt unangetastet');
  assert.ok(m.medianKs > 0, 'der Median steht nicht bei null');
});

test('(b) Abwesenheit: identische Lineale -> 0 % bewegt (kein Ueber-Trigger)', () => {
  const cal = lineal(8);
  const m = driftFeinmass(cal, cal);
  assert.strictEqual(m.bewegt, 0);
  assert.strictEqual(m.anteilBewegt, 0);
  assert.strictEqual(m.medianKs, 0);
  assert.strictEqual(m.maxKs, 0);
});

test('(c) die produktive Schwelle wird ausgewiesen, nicht gesenkt', () => {
  assert.strictEqual(PROD_SCHWELLE, 0.15, 'T138: Absenken erzeugt rote Laeufe und ist verboten');
  // Eine einzige laut bewegte Verteilung: das Feinmass muss sie separat zeigen,
  // und der versiegelte Waechter muss weiterhin selbst rot werden.
  const ref = lineal(8);
  const live = lineal(8, (c, ax) => (c === 0 && ax === 'gpGrowth' ? 0.5 : 0.05));
  const m = driftFeinmass(live, ref);
  assert.strictEqual(m.ueberSchwelle, 1);
  assert.strictEqual(m.prodSchwelle, 0.15);
  assert.ok(m.maxKs > PROD_SCHWELLE);
  assert.strictEqual(calibrationDrift(live, ref).ok, false, 'der Waechter behaelt seine Entscheidung');
});

test('(d) der Nenner spiegelt die Auswahl der versiegelten Funktion', () => {
  const ref = lineal(3);
  // Eine Ref-Kohorte ohne `axes` wird von calibrationDrift per `continue` uebersprungen —
  // sie darf den Nenner nicht aufblaehen, sonst redet der Anteil ueber Verteilungen,
  // die nie verglichen wurden.
  ref.cohortBases['kaputt|profitable'] = {};
  assert.strictEqual(vergleichbareVerteilungen(ref), 3 * ACHSEN.length + 3);
  // Gegenrichtung: eine Kohorte MIT axes zaehlt mit.
  ref.cohortBases['extra|profitable'] = { axes: { gpGrowth: [1, 2, 3] } };
  assert.strictEqual(vergleichbareVerteilungen(ref), 3 * ACHSEN.length + 3 + 1);
});

test('(e) Unvergleichbares zaehlt als bewegt (BH-074-Regel bleibt sichtbar)', () => {
  const ref = lineal(2);
  const live = lineal(2);
  delete live.cohortBases['sektor0|profitable']; // Kohortenkollaps
  const m = driftFeinmass(live, ref);
  assert.strictEqual(m.unvergleichbar, ACHSEN.length, 'jede Achse der fehlenden Kohorte');
  assert.strictEqual(m.maxKs, 1);
  assert.ok(m.bewegt >= ACHSEN.length);
});

test('(f) Referenz ohne vergleichbare Verteilung bricht laut ab statt 0/0 auszuweisen', () => {
  // Reproduziert (Selbst-Review): vorher lief der Nenner auf 0 durch, medianKs wurde null und
  // die Ausgabe starb an einem TypeError-Stack — eine Kennzahl, die nichts gemessen hat, waere
  // genau die Fehlaussage, gegen die T138 geschrieben ist.
  assert.throws(() => driftFeinmass(lineal(2), { cohortBases: {}, gDistByCohort: {} }),
    /keine vergleichbare Verteilung/);
  // Gegenrichtung: eine einzige vergleichbare Verteilung genuegt und darf NICHT abbrechen.
  const winzig = { cohortBases: { 'a|profitable': { axes: { gpGrowth: [1, 2, 3] } } }, gDistByCohort: {} };
  assert.strictEqual(driftFeinmass(winzig, winzig).gesamt, 1);
});
