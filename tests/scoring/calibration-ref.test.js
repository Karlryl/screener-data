'use strict';
/**
 * 2.9 Slice 2 — Referenz-Scoring-Modus (der T1-Fix). scoreUniverse(u, f, {refCalibration}) scort
 * gegen ein EINGEFRORENES Lineal statt neu zu lernen. Drei Beweise:
 *  (1) REPLAY: gleiches Universum live -> calibration -> ref-Lauf gegen die -> identische Scores.
 *  (2) GROWN-UNIVERSE (der eigentliche Korrektheitsbeweis): Lineal auf Teil-Universum A einfrieren,
 *      dann A∪B im ref-Modus scoren -> jeder A-Name behaelt EXAKT seinen Score (Universe-Ausbau
 *      verschiebt bestehende Scores nicht mehr — genau der T1-Architektur-Befund). MUSS einen
 *      subCohortByProfit-Namen (it-services/real-estate) enthalten (capitalEfficiency-Fehlerquelle #1).
 *  (3) DRIFT: calibrationDrift(identisch) -> ok; synthetisch verschobene Basis -> feuert.
 *
 * Usage:  node tests/scoring/calibration-ref.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, calibrationDrift } = require('../../src/scoring/score.js');
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

if (universe.length < 100) {
  console.log('  (Universum < 100 -> Referenz-Anker uebersprungen, KEIN Fail)');
  console.log('calibration-ref.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}

console.log(`  (Universum: ${universe.length} Snapshots geladen)`);
const roundtrip = (o) => JSON.parse(JSON.stringify(o)); // simuliert den calibration.json-Datei-Weg
const routedScores = (results) => {
  const m = new Map();
  for (const e of results) if (e.action === 'route' && Number.isFinite(e.score)) m.set(e.ticker, e.score);
  return m;
};
const routedMeta = (results) => {
  const m = new Map();
  for (const e of results) if (e.action === 'route' && Number.isFinite(e.score)) m.set(e.ticker, e.formulaId);
  return m;
};

// (1) REPLAY: gleiches Universum, live -> ref(calFull) -> identisch.
test('Replay-Determinismus: ref-Lauf gegen das eigene Lineal == live-Lauf (Score-exakt)', () => {
  const live = scoreUniverse(universe, formulas);
  const calFull = roundtrip(live.calibration);
  const replay = scoreUniverse(universe, formulas, { refCalibration: calFull });
  const a = routedScores(live), b = routedScores(replay);
  assert.equal(a.size, b.size, 'gleiche Menge gerouteter Namen');
  assert.ok(a.size > 100, 'nicht-triviale Menge');
  let mism = 0;
  for (const [t, s] of a) if (b.get(t) !== s) mism++;
  assert.equal(mism, 0, `${mism} Score-Abweichungen im Replay (muss 0 sein)`);
});

// (2) GROWN-UNIVERSE: Lineal auf A einfrieren, A∪B ref -> A-Namen exakt unveraendert.
// A = jeder 2. Name (interleaved) -> beide Haelften tragen alle Sektoren/Kohorten inkl. it-services/real-estate.
const A = universe.filter((_, i) => i % 2 === 0);
const runA = scoreUniverse(A, formulas);
const scoreA = routedScores(runA);
const metaA = routedMeta(runA);
const calA = roundtrip(runA.calibration);
const grown = scoreUniverse(universe, formulas, { refCalibration: calA });
const scoreGrown = routedScores(grown);

test('Grown-Universe: A-Namen behalten im ref(A)-Lauf ueber A∪B EXAKT ihren Score', () => {
  let compared = 0, mism = 0;
  for (const [t, s] of scoreA) {
    if (!scoreGrown.has(t)) continue; // Routing kann sich durch B aendern (dup-issuer) -> nur Schnittmenge
    compared++;
    if (scoreGrown.get(t) !== s) mism++;
  }
  assert.ok(compared > 200, `nicht-triviale Schnittmenge (${compared} Namen)`);
  assert.equal(mism, 0, `${mism}/${compared} A-Namen driften beim Universe-Ausbau (muss 0 sein — der T1-Fix)`);
});

test('Grown-Universe deckt die capitalEfficiency-Sub-Kohorte ab (it-services/real-estate)', () => {
  // subCohortByProfit-Boards aus der formulas-Map (Objekt, kein Array) ableiten.
  const subCohortIds = new Set(Object.entries(formulas).filter(([, f]) => f && f.subCohortByProfit).map(([id]) => id));
  assert.ok(subCohortIds.size > 0, 'es gibt subCohortByProfit-Formeln');
  let covered = 0;
  for (const [t] of scoreA) {
    if (scoreGrown.has(t) && subCohortIds.has(metaA.get(t))) covered++;
  }
  assert.ok(covered > 0, `mind. ein subCohortByProfit-Name (${[...subCohortIds].join('/')}) im Grown-Universe-Vergleich (capitalEfficiency-Pfad geprueft)`);
});

// (3) DRIFT-Waechter.
test('Drift: identisches Lineal -> maxKs 0, ok=true', () => {
  const d = calibrationDrift(calA, calA);
  assert.equal(d.ok, true);
  assert.ok(d.maxKs < 1e-9, `maxKs ~0 (war ${d.maxKs})`);
});

test('Drift: synthetisch verschobene Basis -> feuert (ok=false, drifted nicht leer)', () => {
  const shifted = roundtrip(calA);
  // eine beliebige Kohorten-Achse massiv verschieben
  const key = Object.keys(shifted.cohortBases)[0];
  const ax = Object.keys(shifted.cohortBases[key].axes)[0];
  shifted.cohortBases[key].axes[ax] = shifted.cohortBases[key].axes[ax].map((v) => (Number.isFinite(v) ? v + 1e6 : v));
  const d = calibrationDrift(shifted, calA);
  assert.equal(d.ok, false, 'verschobene Basis muss anschlagen');
  assert.ok(d.drifted.length > 0 && d.maxKs > 0.15, `drifted=${d.drifted.length} maxKs=${d.maxKs}`);
});

// (4) 2.11 Stufe B FAIL-LOUD (Verify-T2): ein pre-v4-Lineal (ohne gDistByCohort) darf NICHT still gegen die
// Live-Wachstums-Verteilung scoren (das de-friere ~600 Board-Scores beim Universe-Ausbau) -> harter Abbruch.
test('Fail-loud: refCalibration ohne gDistByCohort (pre-v4) -> scoreUniverse wirft', () => {
  const preV4 = roundtrip(runA.calibration);
  delete preV4.gDistByCohort; // simuliert ein altes Lineal von VOR 2.11 Stufe B
  assert.throws(() => scoreUniverse(universe, formulas, { refCalibration: preV4 }), /gDistByCohort|v4/,
    'ein pre-v4-Lineal muss hart abbrechen statt still gegen die Live-Verteilung zu scoren');
});

// (5) 2.11 Stufe B: Drift-Waechter faengt gDistByCohort-Drift (nicht nur cohortBases-Achsen).
test('Drift: verschobene gDistByCohort -> feuert (Verify-T2-Haertung)', () => {
  const shifted = roundtrip(calA);
  const key = Object.keys(shifted.gDistByCohort)[0];
  shifted.gDistByCohort[key] = shifted.gDistByCohort[key].map((v) => (Number.isFinite(v) ? v + 1e6 : v));
  const d = calibrationDrift(shifted, calA);
  assert.equal(d.ok, false, 'verschobene gDistByCohort muss den Waechter ausloesen');
  assert.ok(d.drifted.some((x) => x.axis === 'gDist'), 'ein gDist-Drift-Eintrag muss auftauchen');
});

console.log(`calibration-ref.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
