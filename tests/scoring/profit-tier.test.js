'use strict';
/**
 * Task 1.2 — Profitabilitaets-Stufen-Klassifikator. Pinnt die 4 lueckenlos kachelnden
 * Stufen synthetisch (praezise Schwellen), inkl. Kipp-Fall kurz-vor->seit-kurzem und
 * dem Akzeptanz-Anker "frische seit-Boersengang-profitable IPO != langfristig".
 *
 * Usage:  node tests/scoring/profit-tier.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { profitTierOf, TIERS } = require('../../src/scoring/profit-tier.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const V = (arr) => arr.map((v) => ({ value: v }));      // Zahl -> {value:N}-Serie (newest-first)
const snap = (annualOpInc, opIncQ, annualNetIncome) => ({
  annual: { annualOpInc: V(annualOpInc || []), ...(annualNetIncome ? { annualNetIncome: V(annualNetIncome) } : {}) },
  ...(opIncQ ? { timeseries: { opIncQ: V(opIncQ) } } : {}),
});

// --- langfristig-profitabel: alle >=4 Jahre positiv --------------------------
test('langfristig: 4 Jahre alle positiv', () => {
  assert.equal(profitTierOf(snap([50, 40, 30, 20])), 'langfristig-profitabel');
});
test('langfristig: NetIncome-Fallback wenn OpInc leer', () => {
  assert.equal(profitTierOf(snap([], null, [10, 8, 6, 4])), 'langfristig-profitabel');
});

// --- seit-kurzem-profitabel: profitabel jetzt, aber nicht langfristig --------
test('seit-kurzem: profitabel jetzt, nur 2 Jahre Historie (< 4)', () => {
  assert.equal(profitTierOf(snap([10, 8])), 'seit-kurzem-profitabel');
});
test('seit-kurzem: 3 Jahre alle positiv reicht NICHT fuer langfristig (>=4 Gate)', () => {
  assert.equal(profitTierOf(snap([1, 1, 1])), 'seit-kurzem-profitabel');
});
test('seit-kurzem: juengstes positiv, aber ein Verlustjahr im 4-Jahres-Fenster', () => {
  assert.equal(profitTierOf(snap([10, -5, 8, 6])), 'seit-kurzem-profitabel');
});
test('AKZEPTANZ: frische seit-Boersengang-profitable IPO (2J, alle positiv) = seit-kurzem, NICHT langfristig', () => {
  const ipo = profitTierOf(snap([20, 15]));
  assert.equal(ipo, 'seit-kurzem-profitabel');
  assert.notEqual(ipo, 'langfristig-profitabel');
});

// --- kurz-vor-profitabel: Verlust, aber Turnaround-Trajektorie ---------------
test('kurz-vor: annual Verlust, aber juengstes Quartal schon positiv', () => {
  assert.equal(profitTierOf(snap([-5, -8], [2, -1, -3, -5])), 'kurz-vor-profitabel');
});
test('kurz-vor: Verluste schrumpfen, Breakeven binnen <=4 Q erreichbar', () => {
  // q[0]=-2, rate=(-2)-(-4)=2, q[0]+4*rate = -2+8 = 6 >= 0 -> erreichbar
  assert.equal(profitTierOf(snap([-10], [-2, -4, -6, -8])), 'kurz-vor-profitabel');
});

// --- nicht-profitabel: Verlust ohne tragfaehige Trajektorie ------------------
test('nicht: Verlust, Quartale VERSCHLECHTERN sich', () => {
  assert.equal(profitTierOf(snap([-10], [-8, -6, -4, -2])), 'nicht-profitabel');
});
test('nicht: Verlust, Verbesserung zu langsam fuer Breakeven in <=4 Q', () => {
  // q[0]=-90, rate=2, -90+8 = -82 < 0 -> nicht erreichbar
  assert.equal(profitTierOf(snap([-100], [-90, -92, -94, -96])), 'nicht-profitabel');
});
test('nicht: Verlust, keine Quartalsdaten fuer eine Trajektorie', () => {
  assert.equal(profitTierOf(snap([-10])), 'nicht-profitabel');
});

// --- Kipp-Fall: dieselbe Firma kippt kurz-vor -> seit-kurzem -----------------
test('Kipp-Fall: kurz-vor (annual noch Verlust) -> seit-kurzem (annual gedreht)', () => {
  assert.equal(profitTierOf(snap([-1], [3, -1])), 'kurz-vor-profitabel');   // Quartal schon positiv, annual noch -1
  assert.equal(profitTierOf(snap([5], [3, -1])), 'seit-kurzem-profitabel'); // annual jetzt +5 -> gekippt
});

// --- null: zu wenig Daten ---------------------------------------------------
test('null: keine annual-Profit-Serie', () => {
  assert.equal(profitTierOf(snap([])), null);
  assert.equal(profitTierOf({ annual: {} }), null);
  assert.equal(profitTierOf({}), null);
});

// --- Kachelung: jede Stufe ist eine der 4 (oder null), nie etwas anderes -----
test('Kachelung: Klassifikator liefert nur TIERS oder null', () => {
  const cases = [snap([50, 40, 30, 20]), snap([10, 8]), snap([-5], [2, -1]), snap([-10], [-8, -6]), snap([])];
  for (const c of cases) {
    const t = profitTierOf(c);
    assert.ok(t === null || TIERS.includes(t), 'unerwartete Stufe: ' + t);
  }
});

console.log(`\nprofit-tier.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
