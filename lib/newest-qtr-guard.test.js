'use strict';
/**
 * Anchor-fixture test for newest-qtr-guard (mandated by the A2 court ruling).
 * Standalone — run with:  node lib/newest-qtr-guard.test.js
 * MUST flag the true-corruption anchors (Samsung 005930.KS, SNDK shape) and MUST NOT
 * flag legitimate cyclical ramps (MU) or flat-margin hypergrowth (NVDA). Also locks the
 * sharp leg-4 threshold (FRO-shape at ~1.88x must NOT flag) and the null/short-history edges.
 */
const assert = require('assert');
const { detectNewestQtrSuspect } = require('./newest-qtr-guard.js');

const env = (arr) => arr.map(v => (v == null ? null : { value: v }));
const ts = (rev, oi, gp) => ({ revenueQ: env(rev), opIncQ: env(oi), grossProfitQ: env(gp) });

let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ FAIL: ${name}`); failed++; }
}

// 1) Samsung 005930.KS — real corrupt-quarter shape (newest opm 42.8%, gm 61.2%, spike x2.0). MUST FLAG.
{
  const r = detectNewestQtrSuspect(ts(
    [133.87, 93.84, 86.06, 74.57, 79.14],
    [57.23, 20.08, 8.61, 7.46, 6.65],
    [81.91, 38, 35, 30, 32]));
  check('Samsung-shape flagged', r.suspect === true && /opMargin/.test(r.reason || ''));
}

// 2) SNDK — impossible gm 78%, opm spike ~2x. MUST FLAG.
{
  const r = detectNewestQtrSuspect(ts(
    [100, 35.4, 33, 30, 31],
    [70, 12.5, 3, 2.5, 1.5],
    [78, 20, 18, 17, 18]));
  check('SNDK-shape flagged', r.suspect === true);
}

// 3) MU (Micron) — legitimate MONOTONIC margin ramp (opm 22→23→33→45→68). MUST NOT flag (leg4: 0.676 < 1.9*0.45).
{
  const r = detectNewestQtrSuspect(ts(
    [100, 82, 65, 52, 46],
    [67.6, 36.9, 21.45, 11.96, 10.12],
    [74, 50, 40, 32, 28]));
  check('MU ramp NOT flagged', r.suspect === false);
}

// 4) NVDA — flat high margins, legitimate +revenue growth. MUST NOT flag (leg1 fails: 0.65 - 0.605 < 0.20).
{
  const r = detectNewestQtrSuspect(ts(
    [120, 90, 70, 60, 55],
    [78, 55.8, 42.7, 36, 33],
    [85, 63, 49, 42, 38]));
  check('NVDA flat-margin NOT flagged', r.suspect === false);
}

// 5) FRO-shape — sharp-threshold regression: q0/q1 op-margin ratio ~1.88x (< 1.9). MUST NOT flag.
{
  const r = detectNewestQtrSuspect(ts(
    [160, 100, 95, 90, 92],
    [131, 43.6, 30, 22, 20],   // q0opm=0.819, q1opm=0.436 -> 1.88x, just under the 1.9 cutoff
    [90, 60, 55, 52, 53]));
  check('FRO-shape (1.88x) NOT flagged', r.suspect === false);
}

// 6) Edge: fewer than 5 quarters -> no flag, no throw.
check('short history (<5) NOT flagged', detectNewestQtrSuspect(ts([100, 50, 40, 30], [60, 10, 8, 6], [70, 30, 25, 20])).suspect === false);

// 7) Edge: nulls in the newest slots -> no flag, no throw.
check('null newest quarter NOT flagged', detectNewestQtrSuspect(ts([null, 90, 80, 70, 75], [null, 10, 9, 8, 7], [null, 40, 38, 35, 36])).suspect === false);

// 8) Edge: zero/negative newest revenue -> no flag, no throw.
check('zero newest revenue NOT flagged', detectNewestQtrSuspect(ts([0, 90, 80, 70, 75], [50, 10, 9, 8, 7], [60, 40, 38, 35, 36])).suspect === false);

// 9) Edge: empty / undefined input -> no flag, no throw.
check('empty timeseries NOT flagged', detectNewestQtrSuspect({}).suspect === false);
check('undefined timeseries NOT flagged', detectNewestQtrSuspect(undefined).suspect === false);

// 10) Breakeven prior quarter: legs 1-3 fire but q1 op-margin ~0.01% makes the spike ratio
//     meaningless; the leg-4 >2% floor blocks it (would FLAG without the floor). MUST NOT flag.
{
  const r = detectNewestQtrSuspect(ts(
    [100, 40, 40, 40, 40],
    [30, 0.004, 2, 2, 2],   // q0opm=0.30, q1opm=0.0001 (near-breakeven) -> leg4 floor blocks
    [60, 22, 22, 22, 22]));
  check('breakeven prior-quarter NOT flagged', r.suspect === false);
}

if (failed) { console.error(`\nnewest-qtr-guard: ${failed} assertion(s) FAILED`); process.exit(1); }
console.log('\nnewest-qtr-guard: all anchor + edge assertions passed');
