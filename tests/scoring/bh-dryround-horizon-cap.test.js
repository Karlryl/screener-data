'use strict';
/**
 * bh-dryround-horizon-cap.test.js
 *
 * Regression für den R-Gate-Dry-Round-Fund (20.07.2026): der §8-Verkürzungspfad
 * in windowReturns (rank-ic.js) hatte nur eine Untergrenze (c.newestDate > t0),
 * keine Obergrenze gegen den Horizont t1. Seit BH-101 liefert classify() auch bei
 * newestDate > exitDate den Status 'series_ended' (Datenloch am Fensterende, Serie
 * handelt danach weiter). Ohne Obergrenze VERLÄNGERT der Pfad dann das Fenster über
 * die prä-registrierte Haltedauer hinaus und bucht die Langfrist-Rendite als
 * vollwertigen Horizont-Punkt in den validierungsentscheidenden rankIC — Verletzung
 * Invariante 5 (feste Haltedauer, Struktur statt Zeit).
 *
 * audit/fix: rank-ic.js:windowReturns — Verkürzung nur für ECHTE Früh-Enden
 * (newestDate < t1); newestDate > t1 wird gedroppt (excluded_no_series), nie extendiert.
 */
const assert = require('node:assert/strict');
const ric = require('../../scripts/rank-ic.js');

const t0 = '2026-01-05';
const HORIZON = 84; // t1 = 2026-03-30

// ── Fall A (der Bug): Loch am Fensterende, Serie handelt LANGE NACH t1 weiter ──
// Bars nur bei t0 und weit nach t1. Am Exit (2026-03-30) findet der 7-Tage-
// Rückwärts-Walk keinen Kurs -> p1 null -> series_ended, newestDate '2026-08-01' > t1.
const idxA = { HOLE: new Map([[t0, 100], ['2026-08-01', 300]]) };
const rA = ric.windowReturns(idxA, [{ ticker: 'HOLE', score: 1 }], t0, HORIZON);

assert.equal(rA.quota.shortened, 0,
  'newestDate > t1 darf NICHT als shortened gebucht werden (würde das Fenster über den Horizont verlängern)');
assert.equal(rA.used.length, 0,
  'ein über den Horizont hinaus verlängerter Return darf in KEINEN IC-Punkt fließen');
assert.equal(rA.quota.excluded_no_series, 1,
  'newestDate > t1 (kein Kurs am/vor dem Horizont) gehört in excluded_no_series');

// ── Fall B (legitim, muss erhalten bleiben): echtes Früh-Ende VOR t1 (M&A) ──
// Bars bei t0 und 2026-02-14 (< t1). series_ended, newestDate < t1 -> §8-Verkürzung
// auf den letzten verfügbaren Tag ist hier korrekt und muss weiter greifen.
const idxB = { EARLY: new Map([[t0, 100], ['2026-02-14', 120]]) };
const rB = ric.windowReturns(idxB, [{ ticker: 'EARLY', score: 1 }], t0, HORIZON);

assert.equal(rB.quota.shortened, 1,
  'echtes Früh-Ende (newestDate < t1) muss weiter als shortened verkürzt werden (§8-M&A-Pfad)');
assert.equal(rB.used.length, 1, 'der verkürzte M&A-Punkt bleibt ein gültiger IC-Punkt');
assert.equal(rB.used[0].heldUntil, '2026-02-14', 'verkürzt auf den letzten verfügbaren Tag');
assert.ok(Math.abs(rB.used[0].ret - 0.2) < 1e-9, 'Rendite über das verkürzte Fenster [t0, 2026-02-14] = 120/100-1 = 0.2');

// ── Fall C (Regressionsschutz gegen ÜBER-Drop): späterer Bar NACH t1, ABER ein
// GÜLTIGER Horizont-Kurs an t1 existiert. Muss ganz normal als 'ok' über [t0,t1]
// zählen — die Obergrenze < t1 darf diesen Fall NICHT droppen, weil classify()
// hier gar nicht erst 'series_ended' liefert (p1 an t1 ist gültig -> status 'ok').
const idxC = { CONT: new Map([[t0, 100], ['2026-03-30', 130], ['2026-07-01', 200]]) };
const rC = ric.windowReturns(idxC, [{ ticker: 'CONT', score: 1 }], t0, HORIZON);
assert.equal(rC.quota.ok, 1, 'gültiger Kurs an t1 + späterer Bar: normaler Horizont-Punkt (ok), nicht gedroppt');
assert.equal(rC.quota.shortened, 0, 'kein Verkürzungs-/Verlängerungspfad, wenn der Horizont-Kurs gültig ist');
assert.ok(Math.abs(rC.used[0].ret - 0.3) < 1e-9, 'Return über den echten Horizont [t0, t1] = 130/100-1 = 0.3');

console.log('PASS bh-dryround-horizon-cap: A gedroppt (kein Overrun), B legitim verkürzt, C gültiger Horizont bleibt ok');
process.exit(0);
