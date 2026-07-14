'use strict';
/**
 * Anker-Fixture-Test (Erfolgs-Gate, hash-stabil).
 * Prueft DETERMINISTISCHE Per-Anker-Engine-Eigenschaften gegen EINGEFRORENE
 * Snapshots (tests/scoring/fixtures/), unabhaengig vom taeglich wechselnden
 * Live-Universum. Route/Track/Achsen-Rohwerte/Guard/Lampen sind cohort-unabhaengig
 * und damit stabil — faengt jede Regression in der Anker-Behandlung.
 *
 * Usage:  node tests/scoring/anchors.fixture.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { norm, metricVal } = require('../../src/scoring/snapshot.js');
const { route } = require('../../src/scoring/router.js');
const { fcfMarginValid, fcfTrack } = require('../../src/scoring/engine.js');
const { trackOf } = require('../../src/scoring/score.js');
const { evaluateLamps } = require('../../src/scoring/lamps.js');
const ax = require('../../src/scoring/axes.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function fix(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8'));
}
const lampsOf = (s) => evaluateLamps(s).active;
const trackFor = (s, id) => trackOf(s, formulas[id]);

// --- Positiv-Anker ----------------------------------------------------------
test('CRDO: semiconductors / profitable / Turnaround-FCF gueltig', () => {
  const s = fix('CRDO');
  const r = route(s);
  assert.equal(r.action, 'route'); assert.equal(r.formulaId, 'semiconductors');
  assert.equal(trackFor(s, 'semiconductors'), 'profitable');
  assert.ok(ax.revGrowthLevel(s) > 150);
  assert.equal(fcfMarginValid(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')), true);
});
test('ALAB: semiconductors, positives Wachstum', () => {
  const s = fix('ALAB');
  assert.equal(route(s).formulaId, 'semiconductors');
  assert.ok(ax.revGrowthLevel(s) > 0);
});
test('PLTR: software-comm-services, positives Wachstum', () => {
  const s = fix('PLTR');
  assert.equal(route(s).formulaId, 'software-comm-services');
  assert.ok(ax.revGrowthLevel(s) > 0);
});
test('BE/Bloom: industrials / profitable / Turnaround / Crash-Lampe, KEIN FCF-Artefakt', () => {
  const s = fix('BE');
  assert.equal(route(s).formulaId, 'industrials');
  assert.equal(trackFor(s, 'industrials'), 'profitable'); // juengstes annualOpInc > 0
  assert.equal(fcfMarginValid(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')), true);
  const L = lampsOf(s);
  assert.ok(L.includes('crashRisk')); // Beta 3.7
  assert.ok(!L.includes('fcfArtefact')); // Turnaround, kein Artefakt
  assert.ok(ax.revGrowthLevel(s) > 100); // Quartals-YoY selbst gerechnet ~130 % (== gesundes Skalar)
});

// --- Negativ-Anker ----------------------------------------------------------
test('NVTS: negatives Wachstum, FCF-Artefakt erkannt, unprofitabel', () => {
  const s = fix('NVTS');
  assert.equal(route(s).formulaId, 'semiconductors');
  assert.ok(ax.revGrowthLevel(s) < 0);
  assert.equal(fcfMarginValid(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')), false);
  const L = lampsOf(s);
  assert.ok(L.includes('fcfArtefact')); // +108% TTM bei neg. juengstem Jahr
  assert.ok(L.includes('unprofit'));
  assert.equal(fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')), 'unprofitable');
});
test('AEHR: negatives Wachstum', () => {
  assert.ok(ax.revGrowthLevel(fix('AEHR')) < 0);
});

// --- Router-Anker (Financials) ----------------------------------------------
test('SOFI: lender-gp0 Hard-Exclude (vor grossMargin)', () => {
  assert.equal(route(fix('SOFI')).reason, 'lender-gp0');
});
test('ICE/CME/NDAQ: financials, echter GP (r~0.7 trotz gm=100)', () => {
  for (const t of ['ICE', 'CME', 'NDAQ']) {
    const r = route(fix(t));
    assert.equal(r.formulaId, 'financials', t);
    assert.equal(r.gpClass, 'real', t);
  }
});

// --- Zyklus-Anker -----------------------------------------------------------
test('MU: semiconductors, Peak-Lampe aktiv (Memory-Zyklus)', () => {
  const s = fix('MU');
  assert.equal(route(s).formulaId, 'semiconductors');
  const L = lampsOf(s);
  assert.ok(L.includes('peakMargin') || L.includes('cyclePeak'), 'MU sollte Peak-Lampe tragen');
});

console.log(`\nanchors.fixture.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
