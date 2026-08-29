'use strict';
/**
 * t174-loose-sanity-serie.test.js — Waechter fuer die T174-Haertung.
 *
 * looseSanity() ist die Grobmuell-Wache VOR dem Schreiben in die committete SEC-Schicht
 * (build-secannual.js:197 und build-secannual-smallcap.js:117 — EINE Funktion, zwei
 * Aufrufer). Bis 29.08.2026 prueften ihre ersten zwei Regeln nur das NEUESTE Jahr:
 *   (1) OpInc-Vorzeichen Yahoo gegen SEC
 *   (2) Umsatz-Skala Yahoo gegen SEC, Faktor 2
 * Ein Konzeptfehler, der erst in den Altjahren sitzt, lief damit durch, waehrend das
 * neueste Jahr harmlos aussah — genau die Signatur der T168-Faelle (CWCO/EXE/HE weichen
 * bis fy2018 zurueck ab). T174 dehnt den Geltungsbereich auf die ganze Reihe; die
 * SCHWELLEN bleiben unangetastet.
 *
 * Beide Richtungen sind hier festgenagelt: eine Altjahres-Abweichung muss JETZT rot
 * schlagen, eine saubere Reihe muss gruen bleiben. Ohne die Gegenrichtung waere eine
 * Wache, die einfach immer false liefert, ebenfalls "gruen".
 *
 * Usage: node tests/t174-loose-sanity-serie.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { looseSanity } = require('../scripts/build-secannual.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
// Snapshot-Zellformat (newest-first), wie norm() es liefert.
const S = (...vals) => vals.map((v) => ({ value: v }));

// ── Richtung A: Altjahre schlagen jetzt an ────────────────────────────────────
test('Umsatz: Faktor >2 NUR im Altjahr -> rot (vor T174 gruen)', () => {
  // Neuestes Jahr identisch (die alte Wache sah nur das und liess durch), fy-3 laeuft
  // um Faktor 3 auseinander — die Signatur eines Konzeptwechsels in den Altjahren.
  const yRev = S(1000, 950, 900, 850);
  const sRev = S(1000, 950, 900, 2550);
  assert.equal(looseSanity(S(100), S(100), yRev, sRev), false,
    'Altjahres-Umsatz um Faktor 3 daneben muss die Schicht-Aufnahme verhindern');
});

test('OpInc: Vorzeichen kippt NUR im Altjahr -> rot (vor T174 gruen)', () => {
  const yOp = S(50, 40, -30, 20);
  const sOp = S(50, 40, 30, 20);   // fy-2 im Vorzeichen gedreht
  assert.equal(looseSanity(yOp, sOp, S(1000), S(1000)), false,
    'ein gedrehtes Vorzeichen im Altjahr vergiftet jede Margen-Achse genauso wie im neuesten Jahr');
});

test('Faktor genau 2 im Altjahr bleibt gruen — die Schwelle wurde NICHT verschaerft', () => {
  // Belegt, dass T174 nur den Geltungsbereich dehnt. Waere die Schwelle mitgewandert
  // (z.B. auf 1,5), wuerde dieser Fall rot und der Test faellt.
  assert.equal(looseSanity(S(100), S(100), S(1000, 500), S(1000, 1000)), true);
  assert.equal(looseSanity(S(100), S(100), S(1000, 500), S(1000, 1001)), false, 'knapp UEBER 2 muss rot sein');
});

// ── Richtung B: saubere Reihen bleiben gruen ──────────────────────────────────
test('saubere Reihe ueber alle Jahre -> gruen', () => {
  assert.equal(looseSanity(
    S(120, 100, 80, 60), S(121, 99, 81, 59),
    S(1000, 900, 800, 700), S(1010, 890, 805, 695)
  ), true, 'kleine Restatement-Differenzen duerfen die Aufnahme nicht verhindern');
});

test('durchgehend negatives OpInc (Verlustfirma) -> gruen', () => {
  assert.equal(looseSanity(S(-50, -40, -30), S(-51, -39, -31), S(100, 90, 80), S(100, 90, 80)), true,
    'gleiches Vorzeichen ist gleiches Vorzeichen, auch wenn es negativ ist');
});

test('Nullen und Luecken sind kein Konflikt', () => {
  // Eine 0 im OpInc ist von der Vorzeichenregel ausgenommen (0 hat kein Vorzeichen), eine
  // null-Zelle auf einer Seite wird uebersprungen statt gegen undefined gerechnet.
  assert.equal(looseSanity(S(0, 40), S(-10, 40), S(1000, 900), S(1000, 900)), true);
  assert.equal(looseSanity(S(50, null, 30), S(50, 40, 30), S(1000), S(1000)), true);
  assert.equal(looseSanity(null, null, null, null), true, 'fehlende Reihen duerfen nicht werfen');
});

test('unterschiedlich lange Reihen: nur die Ueberlappung wird verglichen', () => {
  // Die SEC-Reihe ist die TIEFERE (das ist ihr Zweck) — ihre Jahre jenseits der Yahoo-Reihe
  // haben kein Gegenstueck und duerfen die Aufnahme nicht blockieren.
  assert.equal(looseSanity(S(100, 90), S(100, 90, 80, 70, 60), S(1000, 900), S(1000, 900, 800, 700, 600)), true);
});

// ── Keine Schwaechung: die alten newest-Pruefungen leben weiter ───────────────
test('neuestes Jahr weiterhin scharf (Vorzeichen und Skala)', () => {
  assert.equal(looseSanity(S(50), S(-50), S(1000), S(1000)), false, 'newest OpInc-Vorzeichen');
  assert.equal(looseSanity(S(50), S(50), S(141), S(738)), false, 'newest Umsatz-Skala (RGEN-Fall 141M vs 738M)');
});

test('isolierter V-Dip in der SEC-Reihe bleibt rot (dritte Regel unberuehrt)', () => {
  // ARWR-Fall: 3,5 Mio. zwischen 240 und 829 Mio. = Konzept-Mix-Phantom.
  assert.equal(looseSanity(S(100), S(100), S(240), S(829, 3.5, 240)), false);
});

console.log(`\nt174-loose-sanity-serie.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
