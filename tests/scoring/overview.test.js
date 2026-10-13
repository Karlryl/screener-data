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
const axes = require('../../src/scoring/axes.js'); // Kohaerenz-Test Anzeige <-> Achse (R-Gate 2.R)

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8'));
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

// --- grossProfitGrowthYoY: TTM-Pfad + Off-by-One-Guard (Bug 24) -------------
// Sauberer 8-Quartals-Block (luecken-frei) -> echtes TTM-ueber-TTM.
test('grossProfitGrowthYoY: 8 luecken-freie Q -> TTM/TTM (110*4 / 100*4 -1 = 0.1)', () => {
  const s = { timeseries: { grossProfitQ: [110, 110, 110, 110, 100, 100, 100, 100].map((v) => ({ value: v })) } };
  assert.ok(Math.abs(ov.grossProfitGrowthYoY(s) - 0.1) < 1e-9);
});
// Interne null-Luecke in den ersten 8 Q -> KEIN positionaler TTM (waere 0.075
// auf der komprimierten Serie), sondern Fallback auf annualGP-YoY.
test('grossProfitGrowthYoY: null-Luecke -> Fallback auf annualGP, nicht 0.075', () => {
  const s = {
    timeseries: { grossProfitQ: [110, 110, 110, null, 100, 100, 100, 100, 100].map((v) => ({ value: v })) },
    annual: { annualGP: [{ value: 120 }, { value: 100 }] }, // YoY = 0.20, distinkt von 0.075
  };
  assert.ok(Math.abs(ov.grossProfitGrowthYoY(s) - 0.20) < 1e-9);
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

// --- cashRunway: cash-generierend -> endlicher Sentinel (nicht Infinity) ----
test('cashRunwayQuarters: positiver FCF -> 9999 (JSON-/q()-sicher)', () => {
  assert.equal(ov.cashRunwayQuarters({ annual: { annualBalance: [{ totalCash: 10 }], annualFCF: [{ value: 5 }] } }), 9999);
});

// --- BE companion (Rule-of-X) gross, da +130% Umsatz ------------------------
// (Datenrichtigkeits-Fix 14.07.2026: rev-Bein selbst gerechnet aus revenueQ —
// gesunde Namen wie BE aendern sich nicht, Pin bleibt.)
// R-Gate 2.R Fund F6-2: Die Assertion war einseitig nach oben offen und blieb
// deshalb gruen, waehrend die Spalte ein Phantom-Extrem von +90121 ausgab.
// Jetzt beidseitig geklemmt — BE liegt real bei ~300.
test('ruleOfXCompanion(BE) gross aber plausibel (>250 und <1000, +130% Umsatz)', () => {
  const v = ov.ruleOfXCompanion(BE);
  assert.ok(v > 250, 'untere Schranke: ' + v);
  assert.ok(v < 1000, 'obere Schranke (Phantom-Extrem-Detektor): ' + v);
});

// --- Kohaerenz Anzeige <-> Achse (R-Gate 2.R, Fund F6-1) --------------------
// Die Begleitspalte IST dieselbe Kennzahl wie die Score-Achse. Vor dem Fix stoppte
// growthBounds am Score-Rand: die Achse war geklemmt, die an Karl ausgelieferte
// Spalte nicht (JOBY 90121 statt 1048). Dieser Test waere vorher rot gewesen.
test('ruleOfXCompanion == ruleOfX-Achse bei identischen growthBounds (Anzeige darf nie von der Achse abweichen)', () => {
  const gb = [-0.2, 0.3]; // enger als BEs +130% -> die Klemmung MUSS sichtbar greifen
  const viaCompanion = ov.ruleOfXCompanion(BE, gb);
  const viaAxis = axes.ruleOfX(BE, 2.3, true, gb);
  assert.equal(viaCompanion, viaAxis, 'Anzeige ' + viaCompanion + ' != Achse ' + viaAxis);
  // Und die Klemmung wirkt ueberhaupt (sonst waere der Test tautologisch gruen):
  assert.ok(viaCompanion < ov.ruleOfXCompanion(BE), 'geklemmt muss kleiner sein als ungeklemmt');
});

test('overviewMetric reicht growthBounds bis in die Begleitspalte durch', () => {
  const gb = [-0.2, 0.3];
  const geklemmt = ov.overviewMetric(BE, { gpClass: 'real', growthBounds: gb });
  const ohne = ov.overviewMetric(BE, { gpClass: 'real' });
  assert.equal(geklemmt.companion, axes.ruleOfX(BE, 2.3, true, gb), 'opts.growthBounds wird durchgereicht');
  assert.ok(geklemmt.companion < ohne.companion, 'ohne Bounds bleibt das Alt-Verhalten (ungeklemmt)');
});

console.log(`\noverview.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
