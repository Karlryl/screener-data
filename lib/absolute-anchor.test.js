#!/usr/bin/env node
/**
 * lib/absolute-anchor.test.js — Synthetische Unit-Tests für lib/absolute-anchor.js
 *
 * Eigenständiger Runner: node lib/absolute-anchor.test.js
 * Exit 1 bei Fehler. Alle Erwartungswerte handgerechnet (keine Rundungs-Approximationen
 * aus dem Quellcode übernommen).
 *
 * Bucket für alle Tests: 'medtech_devices'
 *   growth: { floor: 0.15, elite: 0.29 }
 *   gm:     { floor: 0.55, elite: 0.70 }
 *   eff:    { floor: 0.08, elite: 0.25 }
 */

'use strict';

const { q, NORMS, effGatePass, gateOpen, absKaliber, blendScore, normTableId } = require('./absolute-anchor');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL ' + name + ' — ' + e.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertClose(actual, expected, tol, label) {
  const diff = Math.abs(actual - expected);
  if (diff > tol) {
    throw new Error(`${label}: got ${actual}, expected ${expected} (tol ${tol}, diff ${diff})`);
  }
}

// Norm-Referenz für handgerechnete Tests
const NORM = NORMS.medtech_devices;

console.log('\n=== lib/absolute-anchor.test.js ===\n');

// ---------------------------------------------------------------------------
// q() — Clip-Funktion
// ---------------------------------------------------------------------------
console.log('--- q() ---');

test('q: am Floor → 0', () => {
  // q(0.15, growth) = clip((0.15-0.15)/(0.29-0.15), 0, 1) = clip(0, 0, 1) = 0
  assert(q(0.15, NORM.growth) === 0, `got ${q(0.15, NORM.growth)}`);
});

test('q: am Elite → 1', () => {
  // q(0.29, growth) = clip((0.29-0.15)/0.14, 0, 1) = clip(1.0, 0, 1) = 1
  assert(q(0.29, NORM.growth) === 1, `got ${q(0.29, NORM.growth)}`);
});

test('q: in der Mitte → 0.5', () => {
  // Mitte zwischen floor=0.15 und elite=0.29 → 0.15 + 0.14/2 = 0.22
  // q(0.22, growth) = (0.22-0.15)/0.14 = 0.07/0.14 = 0.5
  assertClose(q(0.22, NORM.growth), 0.5, 1e-10, 'q mid');
});

test('q: unter Floor → geclippt auf 0', () => {
  // q(0.08, growth): (0.08-0.15)/0.14 = -0.5 → clip to 0
  assert(q(0.08, NORM.growth) === 0, `got ${q(0.08, NORM.growth)}`);
});

test('q: über Elite → geclippt auf 1', () => {
  // q(0.40, growth): (0.40-0.15)/0.14 = 1.785... → clip to 1
  assert(q(0.40, NORM.growth) === 1, `got ${q(0.40, NORM.growth)}`);
});

test('q: null → 0', () => {
  assert(q(null, NORM.growth) === 0, `got ${q(null, NORM.growth)}`);
});

test('q: NaN → 0', () => {
  assert(q(NaN, NORM.growth) === 0, `got ${q(NaN, NORM.growth)}`);
});

// ---------------------------------------------------------------------------
// effGatePass() — Disjunktions-Gate
// ---------------------------------------------------------------------------
console.log('--- effGatePass() ---');

test('effGatePass: Arm 1 (opMargin >= floor) → true', () => {
  // opMargin=0.10 >= eff.floor=0.08
  const rec = { growth: 0.16, gm: 0.56, opMargin: 0.10, fcfMargin: -0.05 };
  assert(effGatePass(rec, NORM) === true);
});

test('effGatePass: Arm 2 (fcfMargin >= 0.05) → true, auch wenn opMargin zu tief', () => {
  // opMargin=0.02 < 0.08, fcfMargin=0.06 >= 0.05
  const rec = { growth: 0.20, gm: 0.60, opMargin: 0.02, fcfMargin: 0.06 };
  assert(effGatePass(rec, NORM) === true);
});

test('effGatePass: Arm 3 (growth+opMargin >= 0.30, RoX-Arm) → true', () => {
  // growth=0.35, opMargin=0.02: 0.35+0.02=0.37 >= 0.30 → true
  // fcfMargin=-0.10 (kein FCF), opMargin=0.02 < 0.08 → Arme 1+2 false
  const rec = { growth: 0.35, gm: 0.60, opMargin: 0.02, fcfMargin: -0.10 };
  assert(effGatePass(rec, NORM) === true, 'RoX-Arm 3 sollte feuern');
});

test('effGatePass: alle drei Arme false → false', () => {
  // opMargin=0.03 < 0.08, fcfMargin=0 < 0.05, growth+opMargin=0.12+0.03=0.15 < 0.30
  const rec = { growth: 0.12, gm: 0.50, opMargin: 0.03, fcfMargin: 0 };
  assert(effGatePass(rec, NORM) === false);
});

// ---------------------------------------------------------------------------
// gateOpen() — hartes SI-1-Gate
// ---------------------------------------------------------------------------
console.log('--- gateOpen() ---');

test('gateOpen: knapp drüber (growth .16, gm .56, opMargin .10) → true', () => {
  // growth=0.16 >= 0.15 ✓, gm=0.56 >= 0.55 ✓, opMargin=0.10 >= 0.08 ✓
  const rec = { growth: 0.16, gm: 0.56, opMargin: 0.10, fcfMargin: 0 };
  assert(gateOpen(rec, 'medtech_devices') === true);
});

test('gateOpen: growth knapp drunter (growth .14) → false', () => {
  // growth=0.14 < 0.15 → Gate schlägt sofort fehl
  const rec = { growth: 0.14, gm: 0.56, opMargin: 0.10, fcfMargin: 0 };
  assert(gateOpen(rec, 'medtech_devices') === false);
});

test('gateOpen: Land-Grab (growth .35, gm .60, opMargin .02, fcfMargin -.10) → true via RoX-Arm', () => {
  // growth=0.35 >= 0.15 ✓, gm=0.60 >= 0.55 ✓
  // effGatePass: opMargin=0.02 < 0.08 → false; fcfMargin=-0.10 < 0.05 → false
  //             growth+opMargin = 0.37 >= 0.30 → true → effGatePass true
  const rec = { growth: 0.35, gm: 0.60, opMargin: 0.02, fcfMargin: -0.10 };
  assert(gateOpen(rec, 'medtech_devices') === true);
});

test('gateOpen: echter Durchfaller (growth .12, gm .50, opMargin .03, fcfMargin 0) → false', () => {
  // growth=0.12 < 0.15 → schlägt schon an erster Bedingung fehl
  const rec = { growth: 0.12, gm: 0.50, opMargin: 0.03, fcfMargin: 0 };
  assert(gateOpen(rec, 'medtech_devices') === false);
});

// ---------------------------------------------------------------------------
// absKaliber() — absolute Kaliber-Punktzahl
// ---------------------------------------------------------------------------
console.log('--- absKaliber() ---');

test('absKaliber: Median-naher Name → ≈0.1324', () => {
  // growth=0.08: q(0.08, {floor:0.15, elite:0.29}) = clip(-0.5, 0,1) = 0
  // gm=0.54:     q(0.54, {floor:0.55, elite:0.70}) = clip(-0.0667, 0,1) = 0
  // opMargin=0.17: q(0.17, {floor:0.08, elite:0.25}) = (0.17-0.08)/(0.25-0.08) = 0.09/0.17 = 0.529411...
  // absK = 0.45*0 + 0.30*0 + 0.25*0.529411... = 0.132353...
  const rec = { growth: 0.08, gm: 0.54, opMargin: 0.17 };
  const expected = 0.25 * (0.09 / 0.17); // = 0.132352941...
  assertClose(absKaliber(rec, 'medtech_devices'), expected, 1e-10, 'absKaliber median-near');
});

test('absKaliber: Hypergrowth (alle Achsen am Elite) → 1.0', () => {
  // growth=0.29 → q=1, gm=0.70 → q=1, opMargin=0.25 → q=1
  // absK = 0.45*1 + 0.30*1 + 0.25*1 = 1.0
  const rec = { growth: 0.29, gm: 0.70, opMargin: 0.25 };
  assertClose(absKaliber(rec, 'medtech_devices'), 1.0, 1e-10, 'absKaliber hypergrowth');
});

test('absKaliber: alle Achsen am Floor → 0', () => {
  // growth=0.15→q=0, gm=0.55→q=0, opMargin=0.08→q=0 → absK=0
  const rec = { growth: 0.15, gm: 0.55, opMargin: 0.08 };
  assertClose(absKaliber(rec, 'medtech_devices'), 0.0, 1e-10, 'absKaliber all-floor');
});

test('absKaliber: custom weights { growth:1, gm:0, eff:0 } → nur growth-Anteil', () => {
  // growth=0.22 → q=0.5; mit w={growth:1} → absK=0.5
  const rec = { growth: 0.22, gm: 0.62, opMargin: 0.17 };
  assertClose(absKaliber(rec, 'medtech_devices', { growth: 1, gm: 0, eff: 0 }), 0.5, 1e-10, 'custom weights');
});

// ---------------------------------------------------------------------------
// blendScore() — Blending ABS + REL
// ---------------------------------------------------------------------------
console.log('--- blendScore() ---');

test('blendScore: beta=0.6, absK=0.132353, rel=0.5 → 27.941...', () => {
  // 100*(0.6 * 0.132353 + 0.4 * 0.5) = 100*(0.079412 + 0.2) = 100*0.279412 = 27.941...
  // Handgerechnet exakt: absK = 0.09/0.17 * 0.25 = 9/1700
  // blendScore = 100*(0.6*(9/1700) + 0.4*0.5) = 100*(5.4/1700 + 0.2) = 100*(0.003176... + 0.2)
  // = 100*(0.279412...) = 27.9412...
  const absK = 0.25 * (0.09 / 0.17); // exact same as absKaliber test
  const expected = 100 * (0.6 * absK + 0.4 * 0.5);
  assertClose(blendScore(absK, 0.5, 0.6), expected, 1e-10, 'blendScore 0.6');
  // Note: task description said 27.92, exact value is ~27.94 (rounding of intermediate ≈0.132 → 27.92)
});

test('blendScore: beta=0 → pure REL = 100*rel', () => {
  // blendScore = 100*(0*absK + 1*rel) = 100*rel
  assertClose(blendScore(0.8, 0.5, 0), 50.0, 1e-10, 'beta=0 pure rel');
});

test('blendScore: beta=1 → pure ABS = 100*absK', () => {
  assertClose(blendScore(0.75, 0.0, 1), 75.0, 1e-10, 'beta=1 pure abs');
});

test('blendScore: default beta (omitted) = 0.6', () => {
  // blendScore(0.5, 0.5) = 100*(0.6*0.5 + 0.4*0.5) = 100*0.5 = 50
  assertClose(blendScore(0.5, 0.5), 50.0, 1e-10, 'default beta');
});

// ---------------------------------------------------------------------------
// normTableId() — Governance-Audit
// ---------------------------------------------------------------------------
console.log('--- normTableId() ---');

test('normTableId: medtech_devices → korrekte id', () => {
  assert(normTableId('medtech_devices') === 'medtech-norms-2026-06-20');
});

test('normTableId: system_app_software → TODO-retrofit-Kennung', () => {
  assert(normTableId('system_app_software').includes('TODO-retrofit'));
});

test('normTableId: fabless_semi → TODO-retrofit-Kennung', () => {
  assert(normTableId('fabless_semi').includes('TODO-retrofit'));
});

// ---------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------
console.log(`\n=== Ergebnis: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
