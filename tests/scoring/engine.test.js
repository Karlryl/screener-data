'use strict';
/**
 * Engine Schicht 2 — Kern-Mechanik-Test.
 * q()/Perzentil, weightedScore (renorm-on-drop, kein Fake-50), fcfSignGuard
 * (G0-G3) + Track gegen echte CRDO/NVTS-Snapshots (Success-Gate (2b)).
 *
 * Usage:  node tests/scoring/engine.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { norm } = require('../../src/scoring/snapshot.js');
const {
  percentileRank, q, weightedScore, coverageWeight, fcfMarginValid, fcfTrack, signTrack,
} = require('../../src/scoring/engine.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8'));
}

// --- q() / Perzentil --------------------------------------------------------
test('percentileRank: Max hoch, Min niedrig, Mitte ~0.5', () => {
  const c = [10, 20, 30, 40];
  assert.ok(percentileRank(40, c) > percentileRank(20, c));
  assert.equal(percentileRank(10, c), 0.125);   // (0 + 0.5*1)/4
  assert.equal(percentileRank(40, c), 0.875);   // (3 + 0.5*1)/4
});
test('q: Bindungen symmetrisch (alle gleich -> 50)', () => {
  assert.equal(q(5, [5, 5, 5]), 50);
});
test('q: leere Kohorte / nicht-finit -> null', () => {
  assert.equal(q(5, []), null);
  assert.equal(q(NaN, [1, 2, 3]), null);
  assert.equal(q(5, [null, NaN]), null);
});
test('percentileRank ignoriert null/NaN in der Kohorte', () => {
  assert.equal(percentileRank(30, [10, null, 30, NaN, 50]), percentileRank(30, [10, 30, 50]));
});

// --- weightedScore (renorm-on-drop) -----------------------------------------
test('weightedScore: alle present -> gewichteter Schnitt', () => {
  assert.equal(weightedScore([{ value: 100, weight: 1 }, { value: 0, weight: 1 }]), 50);
  assert.equal(weightedScore([{ value: 80, weight: 3 }, { value: 40, weight: 1 }]), 70);
});
test('weightedScore: gedroppte Achse renormiert (KEIN Fake-50/0)', () => {
  // null-Achse mit Gewicht 2 darf NICHT als 50 oder 0 eingehen.
  const s = weightedScore([{ value: 100, weight: 1 }, { value: 0, weight: 1 }, { value: null, weight: 2 }]);
  assert.equal(s, 50); // (100*1+0*1)/(1+1), die null-Achse ist weg
});
test('weightedScore: alle Achsen weg -> null', () => {
  assert.equal(weightedScore([{ value: null, weight: 1 }, { value: NaN, weight: 2 }]), null);
  assert.equal(weightedScore([]), null);
});
// --- coverageWeight (C4 Shrinkage-Faktor) -----------------------------------
test('coverageWeight: alle Achsen present -> 1 (keine Schrumpfung)', () => {
  assert.equal(coverageWeight([{ value: 80, weight: 3 }, { value: 40, weight: 1 }]), 1);
});
test('coverageWeight: GEWICHTS-basiert, nicht achsen-zahl-basiert', () => {
  // 1 von 2 Achsen present, aber die present-Achse traegt 3 von 4 Gewicht -> wcov=0.75 (nicht 0.5).
  assert.equal(coverageWeight([{ value: 80, weight: 3 }, { value: null, weight: 1 }]), 0.75);
  // umgekehrt: present-Achse traegt nur 1 von 4 -> wcov=0.25.
  assert.equal(coverageWeight([{ value: 80, weight: 1 }, { value: null, weight: 3 }]), 0.25);
});
test('coverageWeight: alle Achsen weg/leer -> null', () => {
  assert.equal(coverageWeight([{ value: null, weight: 1 }]), 0); // totalW>0 aber presentW=0 -> 0
  assert.equal(coverageWeight([]), null); // totalW=0 -> null
  assert.equal(coverageWeight([{ value: 50, weight: 0 }]), null); // weight<=0 zaehlt nicht
});
test('weightedScore: weight<=0 wird ignoriert', () => {
  assert.equal(weightedScore([{ value: 90, weight: 0 }, { value: 10, weight: 1 }]), 10);
});

// --- fcfSignGuard + Track gegen ECHTE Snapshots -----------------------------
test('CRDO: fcfMarginValid true, Track profitable (Turnaround NICHT verworfen)', () => {
  const c = snap('CRDO');
  const ttm = c.metrics.fcfMarginTTM.value;
  const fcf = norm(c, 'annualFCF');
  const ocf = norm(c, 'annualOCF');
  // CRDO: TTM +16% positiv, juengstes FCF-Jahr +29M positiv -> G2 ok;
  // FCF-Summe negativ, aber OCF-Summe +42M -> G3 (OCF-Rescue) ok.
  assert.equal(fcfMarginValid(ttm, fcf, ocf), true);
  assert.equal(fcfTrack(ttm, fcf, ocf), 'profitable');
});
test('NVTS: fcfMarginValid false (+108% Artefakt verworfen), Track unprofitable', () => {
  const n = snap('NVTS');
  const ttm = n.metrics.fcfMarginTTM.value;
  const fcf = norm(n, 'annualFCF');
  const ocf = norm(n, 'annualOCF');
  // NVTS: TTM positiv, aber juengstes FCF-Jahr negativ -> G2 Vorzeichen-Mismatch.
  assert.equal(fcfMarginValid(ttm, fcf, ocf), false);
  assert.equal(fcfTrack(ttm, fcf, ocf), 'unprofitable');
});

// --- fcfSignGuard Edge-Cases (synthetisch) ----------------------------------
test('G0: TTM fehlt -> invalid', () => {
  assert.equal(fcfMarginValid(null, [10, 20], [10]), false);
});
test('G1: FCF & OCF beide leer -> invalid, Track unknown (kein sign(0))', () => {
  assert.equal(fcfMarginValid(108, [], []), false);
  assert.equal(fcfTrack(108, [], []), 'unknown');
  assert.equal(fcfTrack(108, [null, null], []), 'unknown');
});
test('G3: positive TTM, juengstes Jahr positiv, aber FCF-Summe<0 & OCF leer -> invalid', () => {
  // sign ok (beide +), aber kein gueltiger Rescue (OCF leer rettet NICHT)
  assert.equal(fcfMarginValid(5, [10, -50], []), false);
});
test('G3: OCF-Rescue greift (FCF-Summe<0, OCF-Summe>=0)', () => {
  assert.equal(fcfMarginValid(5, [10, -50], [100]), true);
});

// --- signTrack --------------------------------------------------------------
test('signTrack: juengstes present Jahr entscheidet; leer -> unknown', () => {
  assert.equal(signTrack([5, -10]), 'profitable');
  assert.equal(signTrack([-5, 10]), 'unprofitable');
  assert.equal(signTrack([null, -3]), 'unprofitable');
  assert.equal(signTrack([]), 'unknown');
});

// --- Regression: BE-Turnaround (G3 2-Jahres-Fenster, nicht Lebenszeit-Summe) -
test('BE: fcfMarginValid true + Track profitable (Court-Anker, Regression)', () => {
  const b = snap('BE');
  const ttm = b.metrics.fcfMarginTTM.value;
  const fcf = norm(b, 'annualFCF'); const ocf = norm(b, 'annualOCF');
  // Lebenszeit-Summe FCF/OCF ist negativ (Alt-Burn), 2 juengste Jahre aber positiv.
  assert.equal(fcfMarginValid(ttm, fcf, ocf), true);
  assert.equal(fcfTrack(ttm, fcf, ocf), 'profitable');
});

// --- Regression: Infinity-Gewicht darf keinen NaN-Score erzeugen ------------
test('weightedScore: Infinity-Gewicht -> null/ignoriert (kein NaN-Leak)', () => {
  assert.equal(weightedScore([{ value: 50, weight: Infinity }]), null);
  assert.equal(weightedScore([{ value: 50, weight: Infinity }, { value: 80, weight: 1 }]), 80);
});

console.log(`\nengine.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
