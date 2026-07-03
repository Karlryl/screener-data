'use strict';
/**
 * run-screener — loadUniverse Coverage-Floor (Court Phase A Runde 3, Fall C1).
 * Der Floor floort die GELADENE on-disk-Anzahl gegen eine SELF-BASELINE (der
 * zuletzt erfolgreich geladene on-disk-Count, High-Water in snapshots/
 * _last_good_disk.json) — NICHT mehr gegen manifest.n_ok (das war eine andere,
 * desynchronisierte Population: lokal akkumulierte Disk-Union vs. OK-Count des
 * letzten Pulls). Ein still geschrumpftes Universum (defekte/fehlende Snapshots)
 * MUSS den Lauf abbrechen statt lautlos die Kohorten-Perzentile zu verschieben.
 *
 * Usage:  node tests/scoring/run-screener.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { assertCoverageFloor, COVERAGE_FLOOR_RATIO, nextHighWater } = require('../../src/scoring/run-screener.js');

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

// --- THROW: geladene Anzahl unter floorRatio * baseline ---------------------
test('throw, wenn loaded klar unter dem Floor (Universum geschrumpft ggue. Self-Baseline)', () => {
  const baseline = 4739;
  const belowFloor = Math.floor(COVERAGE_FLOOR_RATIO * baseline) - 1;
  assert.throws(() => assertCoverageFloor(belowFloor, baseline),
    /Coverage-Floor|geschrumpft|abgebrochen/i,
    'muss bei Unterschreitung lautstark werfen');
});

// --- PASS: geladene Anzahl auf/ueber dem Floor ------------------------------
test('kein throw, wenn loaded exakt auf dem Floor', () => {
  const baseline = 4739;
  const atFloor = Math.ceil(COVERAGE_FLOOR_RATIO * baseline);
  assert.doesNotThrow(() => assertCoverageFloor(atFloor, baseline));
});

test('kein throw, wenn loaded klar ueber dem Floor (heutiger Normalfall)', () => {
  assert.doesNotThrow(() => assertCoverageFloor(4681, 4739)); // 98.8% > 95%
});

// --- ROBUST: keine verwertbare Self-Baseline (Erstlauf) -> kein throw -------
test('kein throw, wenn Baseline fehlt/0/unbrauchbar (Erstlauf, fail-open)', () => {
  assert.doesNotThrow(() => assertCoverageFloor(10, 0));
  assert.doesNotThrow(() => assertCoverageFloor(10, null));
  assert.doesNotThrow(() => assertCoverageFloor(10, undefined));
  assert.doesNotThrow(() => assertCoverageFloor(10, NaN));
});

// --- C1-KERN: Self-Baseline heilt den Desync-Fehlabbruch --------------------
test('Self-Baseline: gesunder on-disk-Lauf wirft NICHT (gleiche Population)', () => {
  // Der alte Defekt verglich on-disk (z.B. 4681) gegen manifest.n_ok (volatil, z.B. 5016 aus einer
  // ANDEREN Pull-Population) -> ceil(0.95*5016)=4766 > 4681 -> FALSCH-Abbruch eines gesunden Laufs.
  // Mit Self-Baseline ist die Baseline der zuletzt-gesunde on-disk-Count (~ heutiger), also kein Sturz:
  assert.doesNotThrow(() => assertCoverageFloor(4681, 4681));
  assert.doesNotThrow(() => assertCoverageFloor(4700, 4681)); // gewachsen -> erst recht ok
});
test('Self-Baseline: ein ECHTER on-disk-Sturz (10000 -> 100) wirft weiterhin hart', () => {
  // Wenn die Self-Baseline 10000 war und jetzt nur 100 on-disk liegen, ist das echtes Schrumpfen:
  assert.throws(() => assertCoverageFloor(100, 10000), /Coverage-Floor|geschrumpft/i);
});

// --- High-Water (Self-Baseline) wird monoton angehoben, nie gesenkt ----------
test('nextHighWater: bei Wachstum anheben, bei Dip halten, Erstlauf = loaded', () => {
  assert.equal(nextHighWater(4681, 4700), 4700, 'gewachsen -> anheben');
  assert.equal(nextHighWater(4700, 4690), 4700, 'kleiner Dip (>Floor) -> High-Water halten, nicht senken');
  assert.equal(nextHighWater(null, 4681), 4681, 'Erstlauf (keine Baseline) -> Startwert');
  assert.equal(nextHighWater(0, 4681), 4681, 'leere/0-Baseline -> Startwert');
  assert.equal(nextHighWater(NaN, 4681), 4681, 'unbrauchbare Baseline -> Startwert');
});

console.log(`run-screener.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
