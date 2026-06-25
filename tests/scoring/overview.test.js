'use strict';
/**
 * Engine — Overview-Test. Cross-Branchen-Metrik (Bruttogewinn-Wachstum) +
 * Badges (Revenue/FFO/Runway) + Rule-of-X-Begleiter, gegen echte Snapshots.
 *
 * Usage:  node tests/scoring/overview.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ov = require('../../src/scoring/overview.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'snapshots', t + '.json'), 'utf8'));
}
const CRDO = snap('CRDO'), ICE = snap('ICE'), BE = snap('BE');

// --- grossProfitGrowthYoY ---------------------------------------------------
test('grossProfitGrowthYoY(CRDO) > 1 (annualGP 119->283M)', () => {
  assert.ok(ov.grossProfitGrowthYoY(CRDO) > 1);
});
test('grossProfitGrowthYoY(ICE) ~0.09 (echter GP, positiv)', () => {
  const g = ov.grossProfitGrowthYoY(ICE);
  assert.ok(g > 0 && g < 0.3);
});
test('grossProfitGrowthYoY: nur 1 GP-Jahr -> null', () => {
  assert.equal(ov.grossProfitGrowthYoY({ annual: { annualGP: [{ value: 5 }] } }), null);
});

// --- overviewMetric: echter GP (Default) ------------------------------------
test('overviewMetric(CRDO) -> kind gp, value = GP-Wachstum, companion finit', () => {
  const r = ov.overviewMetric(CRDO, { gpClass: 'real' });
  assert.equal(r.kind, 'gp');
  assert.ok(r.value > 1);
  assert.ok(Number.isFinite(r.companion)); // Rule-of-X
});

// --- overviewMetric: degenerierter Financial -> Revenue-Badge ---------------
test('overviewMetric(degenerate) -> revenue-badge (Nicht-GP)', () => {
  const s = { annual: { annualRev: [{ value: 130 }, { value: 100 }], annualGP: [{ value: 130 }, { value: 100 }] },
    metrics: { revenueGrowthYoY: { value: 30 } } };
  const r = ov.overviewMetric(s, { gpClass: 'degenerate' });
  assert.equal(r.kind, 'revenue-badge');
  assert.ok(Math.abs(r.value - 0.30) < 1e-9); // 130/100-1
});

// --- overviewMetric: REIT -> FFO-Badge --------------------------------------
test('overviewMetric(reit) -> ffo-badge (NetIncome+Depreciation)', () => {
  const s = { annual: {
    annualNetIncome: [{ value: 50 }, { value: 40 }],
    annualDepreciation: [50, 40], annualRev: [{ value: 1 }], annualFCF: [{ value: 1 }] } };
  const r = ov.overviewMetric(s, { specialTrack: 'reit' });
  assert.equal(r.kind, 'ffo-badge');
  assert.ok(Math.abs(r.value - 0.25) < 1e-9); // (50+50)/(40+40)-1 = 0.25
});

// --- overviewMetric: Biotech -> Runway-Badge --------------------------------
test('overviewMetric(biotech) -> runway-badge (Quartale)', () => {
  const s = { annual: { annualBalance: [{ totalCash: 800 }], annualFCF: [{ value: -400 }] } };
  const r = ov.overviewMetric(s, { specialTrack: 'biotech' });
  assert.equal(r.kind, 'runway-badge');
  assert.ok(Math.abs(r.value - 8) < 1e-9); // 800 / (400/4=100) = 8 Quartale
});

// --- cashRunway: cash-generierend -> Infinity -------------------------------
test('cashRunwayQuarters: positiver FCF -> Infinity', () => {
  assert.equal(ov.cashRunwayQuarters({ annual: { annualBalance: [{ totalCash: 10 }], annualFCF: [{ value: 5 }] } }), Infinity);
});

// --- BE companion (Rule-of-X) gross, da +130% Umsatz ------------------------
test('ruleOfXCompanion(BE) gross (>250, da +130% Umsatz)', () => {
  assert.ok(ov.ruleOfXCompanion(BE) > 250);
});

console.log(`\noverview.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
