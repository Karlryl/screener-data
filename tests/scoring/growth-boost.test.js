'use strict';
/**
 * AUFGABE-2-Test: Wachstums-Bonus (growthBoostFactor + Helfer).
 * Court-approbierter Plan + Red-Team-Bedingungen (relative Abwaerts-Strafe via above-median,
 * MIN_DISTINCT-Degenerations-Guard, NaN-sichere Perzentil-Funktion, positional-lag4 nur bei
 * 5 lueckenlosen Quartalen). Reine Funktionen -> netzwerkfrei, deterministisch.
 *
 * Usage:  node tests/scoring/growth-boost.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const {
  growthBoostFactor, growthYoYComponents, robustG, growthPctlFn, boostFromPctl,
  GROWTH_BOOST_K,
} = require('../../src/scoring/score.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }
const V = (arr) => arr.map((v) => ({ value: v }));
const snap = (rev, q) => ({ annual: rev ? { annualRev: V(rev) } : {}, timeseries: q ? { revenueQ: V(q) } : {} });
// aufsteigende Verteilung mit >=MIN_DISTINCT distinkten Werten (fuer Perzentil-Math-Tests)
const D12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// --- 1. leer -> Faktor EXAKT 1 (byte-identisch) ----------------------------
test('leer -> growthBoostFactor === 1 (strict), robustG null', () => {
  assert.strictEqual(robustG(snap(null, null), [-1, 5]), null);
  assert.strictEqual(growthBoostFactor(snap(null, null), [-1, 5], (g) => 0.9), 1);
  // Byte-Identitaet: score * 1 === score
  const sc = 73.4172; assert.strictEqual(sc * growthBoostFactor(snap(null, null), null, null), sc);
});

// --- 2. annual-lag1 (firstTwoPresent, luecken-sicher) -----------------------
test('growthYoYComponents: annual-lag1 200/100-1=1.0; nur 1 present -> kein annual-Bein', () => {
  assert.deepEqual(growthYoYComponents(snap([200, 100], null)), [1.0]);
  assert.deepEqual(growthYoYComponents(snap([200], null)), []);
});

// --- 3. quartal-lag4 POSITIONAL nur bei 5 lueckenlosen Quartalen (Red-Team Cond 6) ---
test('quartal-lag4: 5 lueckenlose -> 0.2; interne Luecke ODER len<5 -> Bein faellt weg', () => {
  const c = growthYoYComponents(snap(null, [120, 110, 105, 102, 100]));
  assert.equal(c.length, 1); assert.ok(Math.abs(c[0] - 0.2) < 1e-12, 'q-lag4 = 120/100-1 ~ 0.2, got ' + c[0]);
  assert.deepEqual(growthYoYComponents(snap(null, [120, null, null, null, 100])), []);  // interne Luecken -> DROP (nicht 0.2!)
  assert.deepEqual(growthYoYComponents(snap(null, [120, 110, null, 108, 100, 95])), []); // interne Luecke idx2 -> DROP
  assert.deepEqual(growthYoYComponents(snap(null, [120, 110, 105, 102])), []);           // len 4 -> kein Index 4
});

// --- 4. div0-Skip strikt > 0 (Nenner 0 UND negativ) -------------------------
test('div0-Skip: Nenner 0 oder negativ -> Bein uebersprungen', () => {
  assert.deepEqual(growthYoYComponents(snap([50, 0], null)), []);         // annual Nenner 0
  assert.deepEqual(growthYoYComponents(snap([50, -10], null)), []);        // annual Nenner negativ
  assert.deepEqual(growthYoYComponents(snap(null, [120, 110, 105, 102, 0])), []); // q rev[4]=0
  assert.deepEqual(growthYoYComponents(snap(null, [120, 110, 105, 102, -5])), []); // q rev[4] negativ
});

// --- 5. Component-Winsor VOR Median (ehrlich: der Fix ist der Winsor) --------
test('robustG: Component-Winsor klemmt VOR Median (HBNB $1426-Mini-Basis)', () => {
  // eine absurde Mini-Basis-Komponente (YoY 50.0) + eine normale -> Winsor klemmt die 50 auf 5.18
  const s = snap([1426 * 51, 1426], [500, 400, 300, 200, 400]); // annual 50.0, quartal 0.25
  const comps = growthYoYComponents(s);
  assert.ok(comps.includes(50), 'roh 50.0 vorhanden');
  const g = robustG(s, [-1.0, 5.18]);
  assert.ok(g <= 5.18, 'robustG darf nach Winsor nicht > p99 sein: ' + g); // Median([5.18, 0.25]) = 2.715
  assert.ok(g < 5.18, 'Median mit der 0.25-Komponente < Deckel: ' + g);
});
test('robustG: 1-Komponenten-Pfad -> Median heilt nichts, nur Component-Winsor verteidigt', () => {
  const s = snap([1426 * 51, 1426], null); // nur annual, YoY 50.0
  assert.deepEqual(growthYoYComponents(s), [50]);
  assert.strictEqual(robustG(s, [-1.0, 5.18]), 5.18); // n=1: Median = die (geklemmte) Komponente
  assert.strictEqual(robustG(s, null), 50);           // ohne Bounds: identity (kein Crash)
});

// --- 6. AUFWAERTS-only + above-median (Red-Team Cond 3) ---------------------
test('boostFromPctl: above-median, factor in [1, 1+k], < Median -> exakt 1.0', () => {
  assert.strictEqual(boostFromPctl(0.0), 1);            // ganz unten
  assert.strictEqual(boostFromPctl(0.4), 1);            // unter Median -> KEIN Bonus (kein relativer Abwaerts-Effekt)
  assert.strictEqual(boostFromPctl(0.5), 1);            // Median -> 1.0
  assert.strictEqual(boostFromPctl(0.75), 1 + GROWTH_BOOST_K * 0.5); // 1.025
  assert.strictEqual(boostFromPctl(1.0), 1 + GROWTH_BOOST_K);        // 1.05 Deckel
  assert.strictEqual(boostFromPctl(NaN), 1);           // NaN-sicher
  // Haertung (Verify-Loop): out-of-distribution pctl>1 (nur ueber Standalone erreichbar) wird auf 1+k
  // gedeckelt -> [1,1+k] wasserdicht, unabhaengig von der Loop-Invariante pctl<=1.
  assert.strictEqual(boostFromPctl(1.111), 1 + GROWTH_BOOST_K);
  assert.strictEqual(boostFromPctl(1e9), 1 + GROWTH_BOOST_K);
});
test('growthBoostFactor: NIE < 1 ueber viele robustG/pctl (strukturell AUFWAERTS-only)', () => {
  const pctlFn = growthPctlFn(D12.slice());
  for (const rv of [[-30, -50], [200, 100], [50, 40], [10, 100]]) {
    const f = growthBoostFactor(snap(rv, null), [-1, 5.18], pctlFn);
    assert.ok(f >= 1, 'Faktor < 1: ' + f + ' fuer ' + rv);
    assert.ok(f <= 1 + GROWTH_BOOST_K + 1e-12, 'Faktor > 1+k: ' + f);
  }
});

// --- 7. Perzentil-Math: strikt-< / (n-1), Deckel-Ties gemeinsamer Rang ------
test('growthPctlFn: strikt-< / (n-1); Deckel-Ties bekommen gemeinsamen unteren Rang', () => {
  const f = growthPctlFn(D12.slice()); // 12 distinkte Werte
  assert.ok(Math.abs(f(1) - 0) < 1e-12, 'min -> 0');
  assert.ok(Math.abs(f(12) - 1) < 1e-12, 'max -> 1');
  assert.ok(Math.abs(f(6) - 5 / 11) < 1e-12, 'mittlerer Rang');
  // Deckel-Tie: 10 distinkte + Plateau bei 10 (drei 10er). n=12, count(<10)=9 -> 9/11 (nicht 1.0)
  const tie = growthPctlFn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]);
  assert.ok(Math.abs(tie(10) - 9 / 11) < 1e-12, 'Plateau-Wert bekommt gemeinsamen unteren Rang 9/11, nicht 1.0');
});

// --- 8. Degenerations-Guard (Red-Team Cond 4): MIN_DISTINCT + Tie -> null ---
test('growthPctlFn: Degeneration -> null (n<2 | min===max | <MIN_DISTINCT distinkt)', () => {
  assert.strictEqual(growthPctlFn([]), null);
  assert.strictEqual(growthPctlFn([2.5]), null);               // n<2
  assert.strictEqual(growthPctlFn([3, 3, 3]), null);            // min===max
  assert.strictEqual(growthPctlFn([1, 5, 5, 5]), null);         // nur 2 distinkt < MIN_DISTINCT
  const near = new Array(999).fill(2.5); near.push(2.5000000001); // Float-Jitter, 2 distinkt
  assert.strictEqual(growthPctlFn(near), null);                 // Red-Team-Fall: kein Phantom-Vollrang
});

// --- 9. NaN-sicher (Red-Team Cond 5) ---------------------------------------
test('growthPctlFn: NaN wird intern gefiltert, kein fehl-trunkierter Rang', () => {
  const withNaN = [1, 2, NaN, 3, 4, 5, 6, 7, 8, 9, 10, 11]; // 11 finite distinkt
  const f = growthPctlFn(withNaN);
  assert.ok(f !== null, 'genug finite distinkte Werte -> gueltig');
  assert.ok(Math.abs(f(1) - 0) < 1e-12 && Math.abs(f(11) - 1) < 1e-12, 'Raender korrekt trotz NaN im Input');
});

// --- 10. leer/pctl-null -> Faktor exakt 1 (Integrations-Byte-Identitaet) ----
test('growthBoostFactor: pctlFn null (Degeneration) -> Faktor exakt 1 fuer JEDEN Namen', () => {
  for (const rv of [[200, 100], [50, 40], null]) {
    assert.strictEqual(growthBoostFactor(snap(rv, null), [-1, 5.18], null), 1);
  }
});

console.log(`\ngrowth-boost.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
