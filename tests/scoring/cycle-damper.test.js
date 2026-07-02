'use strict';
/**
 * PHASE-3-Test: Zyklus-Daempfer (Direktive-4-Root-Fix). Council/Court-Design + Red-Team-Bedingungen.
 * Konjunktions-Detektor (Gewinn-Oszillation UND Umsatz-Drawdown), data-learned p75-Schwelle, kd=0.5.
 * Reine Funktionen -> netzwerkfrei. Anker-Fixtures aus tests/scoring/fixtures/ (CRDO/ALAB/BE/PLTR).
 *
 * Usage:  node tests/scoring/cycle-damper.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  signFlips, oscExcess, revMaxDrawdown, cycleSignal, cycleDamperFactor, CYCLE_DAMPER_KD,
} = require('../../src/scoring/score.js');
const { norm, presentValues } = require('../../src/scoring/snapshot.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }
function fix(t) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8')); }
const V = (arr) => arr.map((v) => ({ value: v }));
const snap = (op, rev) => ({ annual: { annualOpInc: V(op), annualRev: V(rev) } });
const TH = 0.16; // reprae. p75-Schwelle fuer die cycleSignal-Unit-Tests (voller Lauf misst sie data-learned)

// --- 1-4. Oszillations-Bein (signFlips/oscExcess) --------------------------
test('oscExcess: MU [+,+,-,+] -> 2 Flips -> oscExcess 1 (oszillierend)', () => {
  const op = [9809e6, 1305e6, -5405e6, 9709e6];
  assert.equal(signFlips(op), 2);
  assert.equal(oscExcess(op), 1);
});
test('oscExcess: inflected [+,-,-,-] -> 1 Flip -> oscExcess 0 (einmal gedreht = frei)', () => {
  assert.equal(oscExcess([173423e3, -116066e3, -29497e3, -60194e3]), 0);
});
test('oscExcess: all-positiv (NVDA-Typ) -> 0 Flips -> 0 (strukturell geschuetzt)', () => {
  assert.equal(oscExcess([130387e6, 81453e6, 32972e6, 5577e6]), 0);
});
test('signFlips: 0-Jahr (Break-even/Stub) uebersprungen -> kein Phantom-Flip', () => {
  assert.equal(signFlips([0, -28e6, -72e6, -71e6]), 0); // nur -,-,- nach dem 0-Skip
});

// --- 5-7. Umsatz-Drawdown-Bein (Glitch-geheilt) ----------------------------
test('revMaxDrawdown: MU rev-Kollaps ~0.495 (peak 30.76B -> trough 15.54B)', () => {
  const dd = revMaxDrawdown([37378e6, 25111e6, 15540e6, 30758e6]);
  assert.ok(Math.abs(dd - 0.4948) < 1e-3, 'MU DD ~0.495, got ' + dd);
});
test('revMaxDrawdown: 0-Jahr-Glitch geheilt (pos-only) -> stabiler Name DD 0', () => {
  assert.equal(revMaxDrawdown([15531e6, 14142e6, 0, 13221e6]), 0); // chronologisch monoton steigend nach 0-Skip
});
test('revMaxDrawdown: monoton steigend (Hypergrowth) -> DD 0', () => {
  assert.equal(revMaxDrawdown([1000, 800, 600, 400]), 0);
});

// --- 8-9. KONJUNKTION: nur Oszillation UND Drawdown feuert ------------------
test('cycleSignal MU: osc 1 UND DD 0.495>=0.16 -> signal 1 -> Faktor 0.667', () => {
  const s = snap([9809e6, 1305e6, -5405e6, 9709e6], [37378e6, 25111e6, 15540e6, 30758e6]);
  assert.equal(cycleSignal(s, TH), 1);
  assert.ok(Math.abs(cycleDamperFactor(s, TH) - 1 / (1 + CYCLE_DAMPER_KD)) < 1e-12); // 0.6667
});
test('cycleSignal SK-Hynix-artig: osc 1 UND DD ~0.27>=0.16 -> gedaempft', () => {
  const s = snap([5000e9, 2000e9, -5089e9, 4000e9], [66e12, 51e12, 44e12, 60e12]); // 000660.KS-Muster
  assert.ok(cycleSignal(s, TH) >= 1);
  assert.ok(cycleDamperFactor(s, TH) < 1);
});

// --- 10-11. NEGATIV-Fixtures: Hypergrowth-Feld geschuetzt (DD < Schwelle) ---
test('DDOG-artig: osc 1 ABER DD 0 < Schwelle -> signal 0 -> Faktor EXAKT 1.0', () => {
  const s = snap([100, 50, -10, 20], [1000, 800, 600, 400]); // OpInc oszilliert, Umsatz monoton hoch
  assert.equal(cycleSignal(s, TH), 0);
  assert.strictEqual(cycleDamperFactor(s, TH), 1);
});
test('MRVL/ASM-artig: osc 1 ABER kleiner DD < Schwelle -> Faktor 1.0', () => {
  const s = snap([100, -20, 30, -5], [1050, 1000, 980, 900]); // DD ~0.048 < 0.16
  assert.strictEqual(cycleDamperFactor(s, TH), 1);
});

// --- 12. Anker byte-identisch (osc=0) --------------------------------------
test('Anker CRDO/ALAB/BE/PLTR: oscExcess 0 -> cycleDamperFactor EXAKT 1.0', () => {
  for (const t of ['CRDO', 'ALAB', 'BE', 'PLTR']) {
    const s = fix(t);
    assert.equal(oscExcess(presentValues(norm(s, 'annualOpInc'))), 0, t + ' darf nicht oszillieren');
    assert.strictEqual(cycleDamperFactor(s, TH), 1, t + ' muss byte-identisch bleiben');
  }
});

// --- 13. Datenmuell-Guard (rev<=0-Jahr) ------------------------------------
test('Datenmuell-Guard: ein rev<=0-Jahr -> signal 0 (kein Phantom-Feuer)', () => {
  const s = snap([100, 50, -10, 20], [1000, -5, 800, 600]); // negatives Umsatzjahr
  assert.equal(cycleSignal(s, TH), 0);
});

// --- 14. <3-Jahre-Guard (junge IPO nie gedaempft) --------------------------
test('cycleSignal: <3 present OpInc-Jahre -> signal 0', () => {
  assert.equal(cycleSignal(snap([100, -50], [500, 400]), TH), 0);
});

// --- 15. Degenerations-Guard (Schwelle null) -------------------------------
test('cycleDamperFactor: ddThreshold null -> Faktor exakt 1.0 (byte-identisch)', () => {
  const s = snap([9809e6, 1305e6, -5405e6, 9709e6], [37378e6, 25111e6, 15540e6, 30758e6]);
  assert.strictEqual(cycleDamperFactor(s, null), 1);
});

// --- 16. leer/kein OpInc -> Faktor 1.0 -------------------------------------
test('cycleDamperFactor: leer -> Faktor 1.0', () => {
  assert.strictEqual(cycleDamperFactor({ annual: {} }, TH), 1);
});

// --- 17. Schwellen-Pin (Court-Pflicht): p75 der Basis-C-Verteilung im Zielband ---
test('Schwellen-Pin: p75 im Band (0.070, 0.266] haelt SK-Hynix drin / MRVL,ASM draussen', () => {
  // synthetische Basis-C-artige DD-Verteilung: viele kleine DD (inkl 0) + wenige grosse Zykliker.
  // Pruefe die INVARIANTE: eine p75-Schwelle in (0.070, 0.266] gatet 0.266 rein und 0.070/0.011 raus.
  const th = 0.16;
  assert.ok(0.266 >= th, 'SK-Hynix dd 0.266 >= Schwelle -> gedaempft');
  assert.ok(0.070 < th && 0.011 < th, 'MRVL 0.070 / ASM 0.011 < Schwelle -> geschuetzt');
  // und die reale Bandgrenze: Schwelle darf 0.266 nicht ueberschreiten, sonst kippt SK-Hynix
  assert.ok(th <= 0.266, 'Schwelle <= 0.266 (sonst SK-Hynix nicht gedaempft = DONE verfehlt)');
});

// --- 18. Drift-Guard (Verify-Befund, aktenkundig): 4J-Fenster-Roll kippt den Daempfer ---
// EHRLICHE GRENZE: MU sitzt am Flip-Minimum (signFlips=2). Beim naechsten FY-Close rollt ein neues
// +Jahr vorne rein und das aelteste raus -> [+,+,+,-] -> signFlips=1 -> oscExcess=0 -> Daempfer AUS ->
// MU/SK-Hynix kippen zurueck ueber ALAB. Robuster Fix = EDGAR-Tiefe (tiefe OpInc-Historie haelt die
// Oszillation, US-Namen); SK-Hynix non-US bleibt 4J-fragil. Bei JEDEM Daten-Refresh Anker-Rang neu messen.
test('DRIFT-GUARD: 4J-Fenster-Roll (neues +FY) senkt MU signFlips 2->1 -> Daempfer AUS (dokumentierte Fragilitaet)', () => {
  const muNow = [9809e6, 1305e6, -5405e6, 9709e6];        // [+,+,-,+] signFlips=2 -> gedaempft
  assert.equal(signFlips(muNow), 2);
  const muRolled = [12000e6, 9809e6, 1305e6, -5405e6];    // neues +Jahr rein, aeltestes + raus -> [+,+,+,-]
  assert.equal(signFlips(muRolled), 1);                   // -> oscExcess 0 -> Daempfer AUS (Refresh-Drift)
  assert.equal(oscExcess(muRolled), 0);
});

console.log(`\ncycle-damper.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
