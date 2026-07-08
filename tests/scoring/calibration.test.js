'use strict';
/**
 * 2.9 Slice 1 — Kalibrier-Artefakt. scoreUniverse haengt an das results-Array ein
 * NICHT-enumerierbares `calibration`-Objekt (die pro Lauf gelernten globalen "Lineale":
 * winsor/growth/cycleDD/mcap/ipo). Prueft: Contract (Felder present + finit), Replay-
 * Determinismus (gleiches Universum -> deep-gleiche calibration), und dass das Feld die
 * Alt-Konsumenten NICHT stoert (nicht in Array-Iteration/length/JSON.stringify).
 * Der Score-Inertness-Beleg liegt in anchors.fixture/score.integration (dort byte-identisch).
 *
 * Usage:  node tests/scoring/calibration.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
try {
  for (const f of fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) { /* defekt -> skip */ }
  }
} catch (_) { /* snapshots/ fehlt (pre-pull-Gate) */ }

if (universe.length === 0) {
  console.log('  (Universum leer -> Kalibrier-Anker uebersprungen, KEIN Fail)');
  console.log('calibration.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}

console.log(`  (Universum: ${universe.length} Snapshots geladen)`);
const results = scoreUniverse(universe, formulas);
const cal = results.calibration;

test('calibration: existiert mit schema + allen gelernten Schranken', () => {
  assert.ok(cal && typeof cal === 'object', 'results.calibration ist ein Objekt');
  assert.equal(cal.schema, 'calibration/v4'); // v4 (2.11 Stufe B): gDistByCohort (kohorten-relativer Wachstums-Bonus)
  for (const k of ['winsorBounds', 'growthBounds', 'cycleDDThreshold', 'mcapBounds', 'ipoBounds', 'cohortBases', 'gDist', 'gDistByCohort', 'nRouted', 'nTotal']) {
    assert.ok(k in cal, `Feld '${k}' present`);
  }
  assert.ok(cal.cohortBases && typeof cal.cohortBases === 'object' && Object.keys(cal.cohortBases).length > 0, 'cohortBases nicht leer');
  assert.ok(Array.isArray(cal.gDist) && cal.gDist.length > 0, 'gDist nicht leer');
  assert.ok(Number.isInteger(cal.nRouted) && cal.nRouted > 0, 'nRouted > 0');
  assert.equal(cal.nTotal, universe.length, 'nTotal == Universumsgroesse');
});

test('calibration: gelernte Schranken sind finit/plausibel (kein NaN/Inf)', () => {
  // cycleDDThreshold darf null sein (Degenerations-Guard); die uebrigen Bounds tragen Zahlen.
  if (cal.cycleDDThreshold !== null) assert.ok(Number.isFinite(cal.cycleDDThreshold), 'cycleDDThreshold finit|null');
  const allFinite = (o) => JSON.stringify(o).match(/(NaN|Infinity)/) === null; // JSON serialisiert NaN/Inf als null -> zusatz:
  assert.ok(allFinite(cal.winsorBounds), 'winsorBounds ohne NaN/Inf');
  assert.ok(Array.isArray(cal.mcapBounds) && cal.mcapBounds.every(Number.isFinite), 'mcapBounds finit');
  assert.ok(Array.isArray(cal.ipoBounds) && cal.ipoBounds.every(Number.isFinite), 'ipoBounds finit');
});

test('calibration: Replay-Determinismus (gleiches Universum -> deep-gleiche calibration)', () => {
  const cal2 = scoreUniverse(universe, formulas).calibration;
  assert.deepEqual(cal2, cal, 'zweiter Lauf liefert identische calibration (zeitstempel-frei)');
});

test('calibration: Feld ist NICHT-enumerierbar -> Alt-Konsumenten unberuehrt', () => {
  // Array-Iteration/length/Spread/JSON.stringify sehen calibration NICHT (nur indizierte Elemente).
  assert.ok(Object.getOwnPropertyDescriptor(results, 'calibration').enumerable === false, 'nicht-enumerierbar');
  assert.equal([...results].length, results.length, 'Spread ohne calibration');
  const parsed = JSON.parse(JSON.stringify(results));
  assert.equal(parsed.calibration, undefined, 'JSON.stringify(results) traegt kein calibration');
  assert.ok(results.length > 0 && typeof results[0] === 'object', 'results bleibt ein normales Array');
});

console.log(`calibration.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
