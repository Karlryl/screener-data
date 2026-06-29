'use strict';
/**
 * run-screener — loadUniverse Coverage-Floor (Court Phase A Runde 2, Fall 7).
 * Prueft den manifest-relativen Fail-Loud-Floor: ein still geschrumpftes
 * Universum (defekte/nicht-parsbare Snapshots) MUSS den Lauf abbrechen statt
 * lautlos die Kohorten-Perzentile zu verschieben.
 *
 * Usage:  node tests/scoring/run-screener.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { assertCoverageFloor, COVERAGE_FLOOR_RATIO } = require('../../src/scoring/run-screener.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- floorRatio ist eine kalibrierte, benannte Konstante (keine Magic Number) --
test('COVERAGE_FLOOR_RATIO ist eine plausible Quote in (0,1]', () => {
  assert.ok(typeof COVERAGE_FLOOR_RATIO === 'number', 'muss number sein');
  assert.ok(COVERAGE_FLOOR_RATIO > 0 && COVERAGE_FLOOR_RATIO <= 1, 'in (0,1]');
  assert.ok(COVERAGE_FLOOR_RATIO >= 0.9, 'streng genug, um stilles Schrumpfen zu fangen');
});

// --- THROW: geladene Anzahl unter floorRatio * n_ok --------------------------
test('throw, wenn loaded klar unter dem Floor (Universum geschrumpft)', () => {
  const nOk = 4739;
  const belowFloor = Math.floor(COVERAGE_FLOOR_RATIO * nOk) - 1;
  assert.throws(() => assertCoverageFloor(belowFloor, nOk),
    /Coverage-Floor|geschrumpft|abgebrochen/i,
    'muss bei Unterschreitung lautstark werfen');
});

// --- PASS: geladene Anzahl auf/ueber dem Floor ------------------------------
test('kein throw, wenn loaded exakt auf dem Floor', () => {
  const nOk = 4739;
  const atFloor = Math.ceil(COVERAGE_FLOOR_RATIO * nOk);
  assert.doesNotThrow(() => assertCoverageFloor(atFloor, nOk));
});

test('kein throw, wenn loaded klar ueber dem Floor (heutiger Normalfall)', () => {
  assert.doesNotThrow(() => assertCoverageFloor(4681, 4739)); // 98.8% > 95%
});

// --- ROBUST: kein verwertbares Manifest -> Floor nicht erzwingbar, kein throw -
test('kein throw, wenn manifest n_ok fehlt/0/unbrauchbar (Floor nicht berechenbar)', () => {
  assert.doesNotThrow(() => assertCoverageFloor(10, 0));
  assert.doesNotThrow(() => assertCoverageFloor(10, null));
  assert.doesNotThrow(() => assertCoverageFloor(10, undefined));
  assert.doesNotThrow(() => assertCoverageFloor(10, NaN));
});

// --- Floor ist manifest-RELATIV (skaliert mit n_ok) -------------------------
test('Floor skaliert mit n_ok (manifest-relativ, nicht absolut)', () => {
  // Bei kleinem n_ok ist ein kleines loaded ok; bei grossem n_ok wirft dasselbe loaded.
  assert.doesNotThrow(() => assertCoverageFloor(100, 100));
  assert.throws(() => assertCoverageFloor(100, 10000));
});

console.log(`run-screener.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
