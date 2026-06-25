'use strict';
/**
 * Engine Schicht 3 — Lampen-Test. Warn-Flags gegen echte BE/NVTS/CRDO-Snapshots
 * + Synthetik. Kernpunkt: Lampen sind reine Warnungen, Turnarounds (BE/CRDO)
 * werden NICHT als FCF-Artefakt fehl-geflaggt.
 *
 * Usage:  node tests/scoring/lamps.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../src/scoring/lamps.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'snapshots', t + '.json'), 'utf8'));
}
const BE = snap('BE'), NVTS = snap('NVTS'), CRDO = snap('CRDO');

// --- fcfArtefact: NUR echtes Artefakt, NICHT Turnarounds --------------------
test('fcfArtefact: NVTS true (+108% bei neg. juengstem Jahr)', () => {
  assert.equal(L.fcfArtefact(NVTS), true);
});
test('fcfArtefact: BE false (Turnaround, juengstes FCF-Jahr positiv)', () => {
  assert.equal(L.fcfArtefact(BE), false);
});
test('fcfArtefact: CRDO false (Turnaround, juengstes Jahr +29M)', () => {
  assert.equal(L.fcfArtefact(CRDO), false);
});

// --- unprofit / burning -----------------------------------------------------
test('unprofit: BE false (jetzt profitabel), NVTS true', () => {
  assert.equal(L.unprofit(BE), false);
  assert.equal(L.unprofit(NVTS), true);
  assert.equal(L.unprofit(CRDO), false);
});
test('burning: BE false (juengstes FCF +57M), NVTS true', () => {
  assert.equal(L.burning(BE), false);
  assert.equal(L.burning(NVTS), true);
});

// --- crashRisk (Beta) -------------------------------------------------------
test('crashRisk: BE true (Beta 3.7 > 2.5)', () => {
  assert.equal(L.crashRisk(BE), true);
});
test('crashRisk: kein Beta -> null', () => {
  assert.equal(L.crashRisk({ metrics: {} }), null);
});

// --- highDilution -----------------------------------------------------------
test('highDilution: CRDO true (SBC/Rev 0.177 > 0.15), BE false (0.069)', () => {
  assert.equal(L.highDilution(CRDO), true);
  assert.equal(L.highDilution(BE), false);
});
test('highDilution: kein SBC -> null', () => {
  assert.equal(L.highDilution({ annual: { annualSBC: [] } }), null);
});

// --- shortRunway (synthetisch) ----------------------------------------------
test('shortRunway: brennend + wenig Cash -> true', () => {
  const s = { annual: { annualFCF: [{ value: -400 }], annualBalance: [{ totalCash: 200 }] } };
  assert.equal(L.shortRunway(s), true); // 200 / (400/4=100) = 2 Quartale < 8
});
test('shortRunway: cash-generierend -> false', () => {
  assert.equal(L.shortRunway({ annual: { annualFCF: [{ value: 50 }], annualBalance: [{ totalCash: 10 }] } }), false);
});
test('shortRunway: kein FCF -> null', () => {
  assert.equal(L.shortRunway({ annual: {} }), null);
});

// --- arDivergence (synthetisch) ---------------------------------------------
test('arDivergence: AR waechst viel schneller als Umsatz -> true', () => {
  const s = { annual: { annualRev: [{ value: 110 }, { value: 100 }],
    annualBalance: [{ accountsReceivable: 150 }, { accountsReceivable: 100 }] } };
  assert.equal(L.arDivergence(s), true); // AR +50% vs Rev +10%
});

// --- lowRoic (synthetisch) --------------------------------------------------
test('lowRoic: schwacher OpInc/Invested -> true', () => {
  const s = { annual: { annualOpInc: [{ value: 1 }],
    annualBalance: [{ totalAssets: 1000, currentLiabilities: 0 }] } };
  assert.equal(L.lowRoic(s), true); // 1/1000 = 0.001 < 0.09
});

// --- evaluateLamps Aggregat -------------------------------------------------
test('evaluateLamps: aktive Liste enthaelt true-Lampen, Score unberuehrt', () => {
  const r = L.evaluateLamps(BE);
  assert.ok(Array.isArray(r.active));
  assert.ok(r.active.includes('crashRisk')); // BE hat Crash-Lampe
  assert.equal(r.flags.unprofit, false);     // aber profitabel
  assert.equal(typeof r.flags, 'object');
});

console.log(`\nlamps.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
