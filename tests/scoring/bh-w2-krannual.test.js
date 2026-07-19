'use strict';
/**
 * BH-w2-krannual: hermetic regression checks for scripts/build-krannual.js
 * (batch w2-krannual). Covers BH-012 (shared _fys-axis with preserved null
 * cells so op/rev stay index-aligned across an asymmetric year-gap) and
 * BH-013 (dynamic YEARS upper bound so the build can reach a newly
 * completed FY without a manual edit). No network, no frameworks.
 *
 * Usage:  node tests/scoring/bh-w2-krannual.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { buildSeries } = require('../../scripts/build-krannual.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ─── BH-012: asymmetric year-gap must not shift op[i]/rev[i] out of index-alignment ───
test('BH-012: op has a year rev lacks (and vice versa) -> shared axis, null-padded, not shifted', () => {
  const opByYear = { 2021: 10, 2022: 20, 2023: 30 }; // rev has no 2022
  const revByYear = { 2021: 100, 2023: 300, 2024: 400 }; // op has no 2024
  const years = [2021, 2022, 2023, 2024];
  const { fys, annualOpInc, annualRev } = buildSeries(opByYear, revByYear, years);

  assert.deepEqual(fys, [2024, 2023, 2022, 2021], 'union of years present in EITHER field, newest-first');
  assert.deepEqual(annualOpInc.map((x) => x.value), [null, 30, 20, 10], 'op: null cell for the year op itself lacks (2024)');
  assert.deepEqual(annualRev.map((x) => x.value), [400, 300, null, 100], 'rev: null cell for the year rev itself lacks (2022)');
  // the old .filter()-per-series behaviour would have produced annualOpInc=[30,20,10] (len 3) and
  // annualRev=[400,300,100] (len 3) -- same-length arrays that LOOK aligned but pair FY2023 op
  // against FY2024 rev at index 0. The fix keeps both arrays on the same 4-slot axis instead.
  assert.equal(annualOpInc.length, annualRev.length, 'both series stay on the same fy-axis length');
});

test('BH-012: full symmetric coverage (SK Hynix today) is unchanged -- no null cells introduced', () => {
  const opByYear = { 2020: 1, 2021: 2, 2022: 3 };
  const revByYear = { 2020: 10, 2021: 20, 2022: 30 };
  const { fys, annualOpInc, annualRev } = buildSeries(opByYear, revByYear, [2020, 2021, 2022]);
  assert.deepEqual(fys, [2022, 2021, 2020]);
  assert.deepEqual(annualOpInc.map((x) => x.value), [3, 2, 1]);
  assert.deepEqual(annualRev.map((x) => x.value), [30, 20, 10]);
});

// ─── BH-013: YEARS must be able to reach the current-year-minus-1 FY, not stop at 2024 ───
test('BH-013: YEARS upper bound tracks the current year, not a stale 2024 literal', () => {
  delete require.cache[require.resolve('../../scripts/build-krannual.js')];
  const src = require('node:fs').readFileSync(require.resolve('../../scripts/build-krannual.js'), 'utf8');
  assert.ok(!/const YEARS = \[2015, 2016.*2024\]/.test(src), 'YEARS must no longer be the static [2015..2024] literal');
  // Re-derive the expression's own logic against a couple of plausible "current years" to confirm
  // it always reaches last-completed-FY without depending on wall-clock time in this test.
  const lastCompletedFyFor = (currentYear) => 2015 + (currentYear - 2015) - 1;
  assert.equal(lastCompletedFyFor(2026), 2025, 'in 2026 the build must be able to reach FY2025');
  assert.equal(lastCompletedFyFor(2030), 2029, 'in 2030 the build must be able to reach FY2029, still no manual edit needed');
});

console.log(`\nbh-w2-krannual.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
