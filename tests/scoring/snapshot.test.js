'use strict';
/**
 * Engine Schicht 0 — Normalisierungs-Test (Success-Gate (0)).
 * Verifiziert norm() gegen die ECHTEN CRDO-Realwerte + alle Edge-Cases
 * (leeres/all-null/non-finite Feld, Multi-Key, [].every()-Falle, NaN-Freiheit).
 *
 * Usage:  node tests/scoring/snapshot.test.js
 * Exit:   0 alle gruen, 1 mindestens ein Fehler.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { norm, hasPresent, firstPresent, sumPresent, sign } = require('../../src/scoring/snapshot.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const CRDO = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'snapshots', 'CRDO.json'), 'utf8')
);

// --- (i) Objekt-Array [{value:N}] -> Zahlen-Serie, Reihenfolge erhalten -----
test('CRDO annualGP {value}-unwrap == Realwerte', () => {
  assert.deepEqual(norm(CRDO, 'annualGP'), [282909000, 119431000, 106194000, 64015000]);
});
test('CRDO annualFCF {value}-unwrap (mit negativen Jahren)', () => {
  assert.deepEqual(norm(CRDO, 'annualFCF'), [29022000, 17085000, -46328000, -48412000]);
});
test('CRDO annualRev/annualOpInc/annualNetIncome/annualOCF sind reine Zahlen', () => {
  for (const f of ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualOCF']) {
    const s = norm(CRDO, f);
    assert.ok(s.length === 4, f + ' length');
    assert.ok(s.every((v) => typeof v === 'number' && Number.isFinite(v)), f + ' finite');
  }
});
test('CRDO timeseries.revenueQ -> 5 Zahlen, Index 0 = juengstes', () => {
  assert.deepEqual(norm(CRDO, 'revenueQ'),
    [407012000, 268027000, 223074000, 170025000, 135002000]);
});

// --- (ii) Skalar-Array [N] -> identisch durchgereicht -----------------------
test('CRDO annualSBC Skalar-Array unveraendert', () => {
  assert.deepEqual(norm(CRDO, 'annualSBC'), [77355000, 39022000, 23516000, 9188000]);
});
test('CRDO annualCapex (negative Skalare) unveraendert', () => {
  assert.deepEqual(norm(CRDO, 'annualCapex'), [-36061000, -15652000, -21713000, -17580000]);
});

// --- (iii) Multi-Key-Objekt-Array -> Key-Serie ------------------------------
test('CRDO annualBalance totalAssets-Projektion', () => {
  assert.deepEqual(norm(CRDO, 'annualBalance', 'totalAssets'),
    [809257000, 601932000, 397289000, 375689000]);
});
test('CRDO annualBalance totalDebt all-null -> null-Luecken erhalten', () => {
  // totalDebt ist in CRDO durchgehend null -> Serie aus null-Luecken, Laenge 4.
  const s = norm(CRDO, 'annualBalance', 'totalDebt');
  assert.equal(s.length, 4);
  assert.ok(s.every((v) => v === null));
  assert.equal(hasPresent(s), false);
});
test('annualBalance ohne key wirft', () => {
  assert.throws(() => norm(CRDO, 'annualBalance'), /multi-key/);
});

// --- (iii) fehlendes/leeres Feld -> [] --------------------------------------
test('fehlendes Feld -> []', () => {
  assert.deepEqual(norm({ annual: {} }, 'annualGP'), []);
});
test('leeres Array -> []', () => {
  assert.deepEqual(norm({ annual: { annualSBC: [] } }, 'annualSBC'), []);
});
test('fehlender container -> []', () => {
  assert.deepEqual(norm({}, 'annualGP'), []);
  assert.deepEqual(norm(null, 'annualGP'), []);
});

// --- (ii) Fehlwerte -> null-Luecken (NICHT 0, NICHT entfernt) ---------------
test('{value:null} und {} ohne value -> null-Luecke, Laenge erhalten', () => {
  const snap = { annual: { annualGP: [{ value: 5 }, { value: null }, {}, { value: 7 }] } };
  assert.deepEqual(norm(snap, 'annualGP'), [5, null, null, 7]);
});
test('NaN / Infinity / String -> null-Luecke (value-Format)', () => {
  const snap = { annual: { annualGP: [{ value: NaN }, { value: Infinity }, { value: '9' }, { value: 3 }] } };
  assert.deepEqual(norm(snap, 'annualGP'), [null, null, null, 3]);
});
test('Skalar-Array mit null/NaN -> null-Luecke', () => {
  const snap = { annual: { annualSBC: [10, null, NaN, 4] } };
  assert.deepEqual(norm(snap, 'annualSBC'), [10, null, null, 4]);
});

// --- unbekanntes Feld wirft (Tippfehler-Schutz, kein stilles []) ------------
test('unbekanntes Feld wirft', () => {
  assert.throws(() => norm(CRDO, 'annualNope'), /unbekanntes Feld/);
});

// --- Helfer -----------------------------------------------------------------
test('hasPresent: [] / [null,null] false, [null,5] true', () => {
  assert.equal(hasPresent([]), false);
  assert.equal(hasPresent([null, null]), false);
  assert.equal(hasPresent([null, 5]), true);
  assert.equal(hasPresent(undefined), false);
});
test('firstPresent: ueberspringt fuehrende Luecken; null wenn keiner', () => {
  assert.equal(firstPresent([null, 5, 6]), 5);
  assert.equal(firstPresent([9, 1]), 9);
  assert.equal(firstPresent([]), null);
  assert.equal(firstPresent([null, null]), null);
});
test('sumPresent: nur present Werte; []/all-null -> 0', () => {
  assert.equal(sumPresent([null, 5, null, 6]), 11);
  assert.equal(sumPresent([]), 0);
  assert.equal(sumPresent([null, null]), 0);
});
test('sign: +1/-1/0', () => {
  assert.equal(sign(5), 1);
  assert.equal(sign(-3), -1);
  assert.equal(sign(0), 0);
});

// --- (v) GESAMT-INVARIANTE: keine Serie enthaelt je NaN ---------------------
test('NaN-Freiheit: alle CRDO-Serien sind finite-oder-null', () => {
  const fields = ['annualRev', 'annualGP', 'annualFCF', 'annualOCF', 'annualOpInc',
    'annualNetIncome', 'annualSBC', 'annualRnD', 'annualCapex', 'annualSGA',
    'annualDepreciation', 'revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ'];
  for (const f of fields) {
    const s = norm(CRDO, f);
    assert.ok(s.every((v) => v === null || Number.isFinite(v)), f + ' enthielt NaN/Infinity');
  }
  for (const k of ['totalAssets', 'totalCash', 'accountsReceivable', 'currentAssets',
    'currentLiabilities', 'totalLiabilities', 'netPPE']) {
    const s = norm(CRDO, 'annualBalance', k);
    assert.ok(s.every((v) => v === null || Number.isFinite(v)), 'annualBalance.' + k + ' NaN');
  }
});

// --- zentrale Helfer (dedupliziert aus axes/lamps/router/overview) ----------
test('presentValues / firstTwoPresent / recentSumPresent / metricVal', () => {
  const H = require('../../src/scoring/snapshot.js');
  assert.deepEqual(H.presentValues([5, null, 6, undefined]), [5, 6]);
  assert.deepEqual(H.firstTwoPresent([null, 9, 8, 7]), [9, 8]);
  assert.equal(H.firstTwoPresent([5]), null);
  assert.equal(H.recentSumPresent([10, 20, 30], 2), 30); // 2 juengste
  assert.equal(H.recentSumPresent([null, null], 2), null);
  assert.equal(H.recentSumPresent([], 2), null);
  assert.equal(H.metricVal({ metrics: { x: { value: 4 } } }, 'x'), 4);
  assert.equal(H.metricVal({ metrics: {} }, 'x'), null);
  assert.equal(H.metricVal({}, 'x'), null);
});

console.log(`\nsnapshot.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
