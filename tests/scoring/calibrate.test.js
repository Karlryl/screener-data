'use strict';
/**
 * Kalibrier-Harness-Test (schliesst die Testluecke aus der Bug-Suche).
 * Sichert die Doppel-Implementierung: scoreWithWeights MUSS identisch zu
 * weightedScore sein (sonst weicht die Kalibrierung vom Live-Scoring ab) +
 * diagnostics-Form/Polaritaet.
 *
 * Usage:  node tests/scoring/calibrate.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { scoreWithWeights, diagnostics, rankCohort } = require('../../src/scoring/calibrate.js');
const { weightedScore } = require('../../src/scoring/engine.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- scoreWithWeights == weightedScore (gleiche Mechanik) --------------------
test('scoreWithWeights identisch zu weightedScore (renorm-on-drop)', () => {
  const cases = [
    { pct: { a: 80, b: 40 }, w: { a: 2, b: 1 } },
    { pct: { a: 80, b: 40, c: null }, w: { a: 2, b: 1, c: 1 } }, // c gedroppt
    { pct: { a: 90, b: 10 }, w: { a: 1, b: 0 } },                 // weight 0 ignoriert
    { pct: { a: null, b: null }, w: { a: 1, b: 1 } },             // alle weg -> null
  ];
  for (const c of cases) {
    const viaCalib = scoreWithWeights(c.pct, c.w);
    const axes = Object.keys(c.w).map((k) => ({ value: c.pct[k], weight: c.w[k] }));
    const viaEngine = weightedScore(axes);
    if (viaCalib === null || viaEngine === null) assert.equal(viaCalib, viaEngine, JSON.stringify(c));
    else assert.ok(near(viaCalib, viaEngine), JSON.stringify(c) + ` ${viaCalib} vs ${viaEngine}`);
  }
});

// --- rankCohort sortiert absteigend, droppt null-Scores ---------------------
test('rankCohort: absteigend, null-Score gedroppt', () => {
  const cohort = { axisKeys: ['a'], rows: [
    { ticker: 'X', pct: { a: 90 }, lamps: [] },
    { ticker: 'Y', pct: { a: 10 }, lamps: [] },
    { ticker: 'Z', pct: { a: null }, lamps: [] },
  ] };
  const r = rankCohort(cohort, { a: 1 });
  assert.equal(r.length, 2); // Z (null) gedroppt
  assert.equal(r[0].ticker, 'X');
  assert.equal(r[1].ticker, 'Y');
});

// --- diagnostics: Anker-Position + Peak-Falle -------------------------------
test('diagnostics: Anker-Rank, peakTrapTop10, Form', () => {
  const cohort = { axisKeys: ['a'], rows: [
    { ticker: 'TOP', pct: { a: 95 }, lamps: ['peakMargin'] },
    { ticker: 'MID', pct: { a: 50 }, lamps: [] },
    { ticker: 'LOW', pct: { a: 5 }, lamps: [] },
  ] };
  const d = diagnostics(cohort, { a: 1 }, { anchors: ['TOP'], decliners: ['LOW'], peakLamps: ['peakMargin'] });
  assert.equal(d.n, 3);
  assert.equal(d.anchorPos[0].rank, 1);          // TOP an der Spitze
  assert.equal(d.declinerPos[0].rank, 3);        // LOW unten
  assert.ok(near(d.peakTrapTop10, 1 / 3));       // 1 von 3 Top-10 mit Peak-Lampe
  assert.equal(d.top10[0].ticker, 'TOP');
});

console.log(`\ncalibrate.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
