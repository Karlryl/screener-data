#!/usr/bin/env node
/**
 * Tag 22 — Field-Drift-Detector Tests
 * Run: node tag22-tests.js
 */
'use strict';
const FC = require('./field-coverage.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function assertEq(a, b, m) {
  const aS = JSON.stringify(a), bS = JSON.stringify(b);
  if (aS !== bS) throw new Error(`${m||'eq'}: expected ${bS}, got ${aS}`);
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 0.001); }
function assertApprox(a, b, m) {
  if (!approx(a, b)) throw new Error(`${m||'approx'}: ${a} vs ${b}`);
}

console.log('Tag-22 Field-Drift Tests');
console.log('────────────────────────');

// ─── Coverage-Calculation ───
test('computeCoverage: empty snapshots returns 0 per field', () => {
  const cov = FC.computeCoverage([]);
  assertEq(cov['metrics.annualRev'], 0);
  assertEq(cov['metrics.annualOpInc'], 0);
});

test('computeCoverage: full coverage = 1.0', () => {
  const snaps = [
    { metrics: { annualRev: [100], annualOpInc: [10], sector: 'Tech' } },
    { metrics: { annualRev: [200], annualOpInc: [20], sector: 'Health' } }
  ];
  const cov = FC.computeCoverage(snaps);
  assertEq(cov['metrics.annualRev'], 1);
  assertEq(cov['metrics.annualOpInc'], 1);
  assertEq(cov['metrics.sector'], 1);
});

test('computeCoverage: partial coverage reflects ratio', () => {
  const snaps = [
    { metrics: { annualRev: [100], annualOpInc: [10] } },
    { metrics: { annualRev: [200], annualOpInc: null } },
    { metrics: { annualRev: null,  annualOpInc: null } }
  ];
  const cov = FC.computeCoverage(snaps);
  assertApprox(cov['metrics.annualRev'], 2/3, 'rev');
  assertApprox(cov['metrics.annualOpInc'], 1/3, 'opinc');
});

test('isPresent: null/undefined/empty array/empty string/NaN are absent', () => {
  const f = FC._internal.isPresent;
  assertEq(f(null), false);
  assertEq(f(undefined), false);
  assertEq(f([]), false);
  assertEq(f(''), false);
  assertEq(f(NaN), false);
  assertEq(f(0), true);  // 0 ist VALID (nicht "absent")
  assertEq(f([1]), true);
  assertEq(f('x'), true);
});

// ─── History-Management ───
test('updateHistory: appends and trims to window', () => {
  let h = [];
  for (let i = 0; i < 8; i++) {
    h = FC.updateHistory(h, { date: '2026-05-' + i, coverage: {} });
  }
  assertEq(h.length, FC.HISTORY_WINDOW);  // 6
  assertEq(h[0].date, '2026-05-2');  // älteste die noch drin ist
  assertEq(h[h.length-1].date, '2026-05-7');
});

test('updateHistory: handles missing/non-array input', () => {
  let h = FC.updateHistory(null, { date: 'x', coverage: {} });
  assertEq(h.length, 1);
  h = FC.updateHistory(undefined, { date: 'y', coverage: {} });
  assertEq(h.length, 1);
});

// ─── Baseline ───
test('computeBaseline: single entry returns empty (no comparison possible)', () => {
  const h = [{ date: 'x', coverage: { 'metrics.annualRev': 0.8 } }];
  const b = FC.computeBaseline(h);
  assertEq(b, {});
});

test('computeBaseline: averages excl. latest', () => {
  const h = [
    { date: 'a', coverage: { 'metrics.annualRev': 0.9 } },
    { date: 'b', coverage: { 'metrics.annualRev': 0.7 } },
    { date: 'c', coverage: { 'metrics.annualRev': 0.5 } } // latest, excluded
  ];
  const b = FC.computeBaseline(h);
  assertApprox(b['metrics.annualRev'], 0.8, 'avg');  // (0.9+0.7)/2
});

// ─── Drift-Detection ───
test('detectDrift: current >= baseline → no drift', () => {
  const cur = { 'metrics.annualRev': 0.95, 'metrics.annualOpInc': 0.85 };
  const base = { 'metrics.annualRev': 0.90, 'metrics.annualOpInc': 0.80 };
  const drifts = FC.detectDrift(cur, base);
  assertEq(drifts, []);
});

test('detectDrift: drop >= threshold → drift detected', () => {
  const cur = { 'metrics.annualOpInc': 0.50 };
  const base = { 'metrics.annualOpInc': 0.90 };
  const drifts = FC.detectDrift(cur, base);
  assertEq(drifts.length, 1);
  assertEq(drifts[0].field, 'metrics.annualOpInc');
  assertEq(drifts[0].drop, 0.4);
});

test('detectDrift: drop < threshold → no drift', () => {
  const cur = { 'metrics.annualOpInc': 0.75 };
  const base = { 'metrics.annualOpInc': 0.90 };
  const drifts = FC.detectDrift(cur, base);
  assertEq(drifts.length, 0);  // 0.15 drop < 0.20 threshold
});

test('detectDrift: missing baseline field skipped', () => {
  const cur = { 'metrics.annualOpInc': 0.50 };
  const base = {};
  const drifts = FC.detectDrift(cur, base);
  assertEq(drifts, []);
});

// ─── Realistisches Szenario: Yahoo Nov-2024-Drift ───
test('integration: Yahoo Nov-2024-Drift wird erkannt', () => {
  // 4 Runs: alle ok mit ~95% coverage.
  // 5. Run: Yahoo schema bricht, annualOpInc droppt auf 10%.
  let history = [];
  for (let i = 0; i < 4; i++) {
    history = FC.updateHistory(history, {
      date: '2024-10-' + i,
      coverage: { 'metrics.annualRev': 1.0, 'metrics.annualOpInc': 0.95 }
    });
  }
  // 5. Run mit drift
  history = FC.updateHistory(history, {
    date: '2024-11-15',
    coverage: { 'metrics.annualRev': 1.0, 'metrics.annualOpInc': 0.10 }
  });
  const baseline = FC.computeBaseline(history);
  const current = history[history.length - 1].coverage;
  const drifts = FC.detectDrift(current, baseline);
  assertEq(drifts.length, 1);
  assertEq(drifts[0].field, 'metrics.annualOpInc');
});

console.log('────────────────────────');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
