'use strict';
/**
 * Engine — Achsen-Test. Die 8 Achsen-Berechner gegen echte CRDO/NVTS-Snapshots
 * + Drop-Verhalten (null -> renorm-on-drop) bei fehlenden Daten.
 *
 * Usage:  node tests/scoring/axes.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ax = require('../../src/scoring/axes.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'snapshots', t + '.json'), 'utf8'));
}
const CRDO = snap('CRDO');
const NVTS = snap('NVTS');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- 1 revGrowthLevel -------------------------------------------------------
test('revGrowthLevel(CRDO) == metrics.revenueGrowthYoY (201.5)', () => {
  assert.ok(near(ax.revGrowthLevel(CRDO), CRDO.metrics.revenueGrowthYoY.value));
  assert.ok(ax.revGrowthLevel(CRDO) > 100);
});
test('revGrowthLevel: fehlende metrics -> null', () => {
  assert.equal(ax.revGrowthLevel({}), null);
  assert.equal(ax.revGrowthLevel({ metrics: {} }), null);
});

// --- 2 revAcceleration ------------------------------------------------------
test('revAcceleration(CRDO) > 0 (beschleunigt)', () => {
  assert.ok(ax.revAcceleration(CRDO) > 0);
});
test('revAcceleration: < 3 Quartale -> null', () => {
  assert.equal(ax.revAcceleration({ timeseries: { revenueQ: [{ value: 10 }, { value: 9 }] } }), null);
});

// --- 3 gpGrowth -------------------------------------------------------------
test('gpGrowth(CRDO) > 1 (starkes GP-Wachstum)', () => {
  assert.ok(ax.gpGrowth(CRDO) > 1);
});
test('gpGrowth: nur 1 GP-Jahr -> null', () => {
  assert.equal(ax.gpGrowth({ annual: { annualGP: [{ value: 100 }], annualRev: [{ value: 200 }] } }), null);
});

// --- 4 ruleOfX --------------------------------------------------------------
test('ruleOfX(CRDO): includeFcf addiert gueltige FCF-Marge', () => {
  const withFcf = ax.ruleOfX(CRDO, 2.3, true);
  const without = ax.ruleOfX(CRDO, 2.3, false);
  assert.ok(withFcf > without); // CRDO FCF gilt als gueltig (G2+G3)
  assert.ok(near(withFcf - without, CRDO.metrics.fcfMarginTTM.value, 1e-6));
  assert.ok(near(without, 2.3 * CRDO.metrics.revenueGrowthYoY.value, 1e-6));
});
test('ruleOfX(NVTS) < 0 und FCF-Term gedroppt (Artefakt nicht addiert)', () => {
  assert.ok(ax.ruleOfX(NVTS, 2.3, true) < 0); // negatives Umsatzwachstum
  // NVTS +108% FCF-Artefakt ist ungueltig -> includeFcf aendert nichts
  assert.ok(near(ax.ruleOfX(NVTS, 2.3, true), ax.ruleOfX(NVTS, 2.3, false), 1e-9));
});

// --- 5 marginTrajectory -----------------------------------------------------
test('marginTrajectory(CRDO) > 0 (Operating-Leverage greift)', () => {
  assert.ok(ax.marginTrajectory(CRDO) > 0);
});
test('marginTrajectory: < 2 Quartale -> null', () => {
  assert.equal(ax.marginTrajectory({ timeseries: { opIncQ: [{ value: 5 }], revenueQ: [{ value: 50 }] } }), null);
});

// --- 6 capitalEfficiency ----------------------------------------------------
test('capitalEfficiency(CRDO) ist finit', () => {
  const v = ax.capitalEfficiency(CRDO);
  assert.ok(v === null || Number.isFinite(v));
  assert.ok(Number.isFinite(v));
});
test('capitalEfficiency: keine Bilanz -> null', () => {
  assert.equal(ax.capitalEfficiency({ annual: { annualOpInc: [{ value: 10 }] } }), null);
});

// --- 7 revisionsMomentum ----------------------------------------------------
test('revisionsMomentum(CRDO) finit (in [-1,1])', () => {
  const v = ax.revisionsMomentum(CRDO);
  assert.ok(Number.isFinite(v) && v >= -1 && v <= 1);
});
test('revisionsMomentum: keine Daten -> null', () => {
  assert.equal(ax.revisionsMomentum({}), null);
  assert.equal(ax.revisionsMomentum({ external: { estimateRevisions: { '0y': {} } } }), null);
});

// --- 8 dilution -------------------------------------------------------------
test('dilution(CRDO) finit', () => {
  assert.ok(Number.isFinite(ax.dilution(CRDO)));
});
test('dilution: kein present annualSBC -> null (drop+renorm, KEIN Fake-50)', () => {
  assert.equal(ax.dilution({ annual: { annualSBC: [], annualRev: [{ value: 100 }] } }), null);
  assert.equal(ax.dilution({ annual: { annualSBC: [null, null], annualRev: [{ value: 100 }] } }), null);
});

// --- Regression: revAcceleration ignoriert 0/negative Zwischenquartale ------
test('revAcceleration: 0/negatives Quartal erzeugt keine Riesen-Rate', () => {
  const s = { timeseries: { revenueQ: [{ value: 120 }, { value: 100 }, { value: 0 }, { value: 80 }, { value: 70 }] } };
  const v = ax.revAcceleration(s);
  assert.ok(Number.isFinite(v) && Math.abs(v) < 1); // nur positive Quartalspaare zaehlen
});

console.log(`\naxes.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
