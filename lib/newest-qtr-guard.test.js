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

// ── Leg isolation, exact thresholds, input forms, trailing history, reason pin ──────────────
// Base fixture (every number below was verified against the real function, incl. float edges):
// q0opm 0.50, trailing op-margin median 0.25, q0 gross margin 0.60, revenue x2.50 vs trailing
// median, spike x2.00 vs prior quarter -> all four legs hold -> FLAGS.
const BASE = { rev: [100, 40, 40, 40, 40], oi: [50, 10, 10, 10, 10], gp: [60, 20, 20, 20, 20] };
const base = (o = {}) => ts(o.rev || BASE.rev, o.oi || BASE.oi, o.gp || BASE.gp);

// 11) Base fixture flags, and the reason string's format is pinned number by number.
{
  const r = detectNewestQtrSuspect(base());
  check('base fixture flagged', r.suspect === true);
  check('reason is a string when suspect', typeof r.reason === 'string');
  check('reason pins opMargin 50.0%', /opMargin 50\.0%/.test(r.reason));
  check('reason pins trailing-median 25.0%', /trailing-median 25\.0%/.test(r.reason));
  check('reason pins prior-qtr 25.0%', /prior-qtr 25\.0%/.test(r.reason));
  check('reason pins spike x2.00', /spike x2\.00/.test(r.reason));
  check('reason pins grossMargin 60.0%', /grossMargin 60\.0%/.test(r.reason));
  check('reason pins revenue x2.50', /revenue x2\.50/.test(r.reason));
}

// 12) Leg isolation: each fixture breaks EXACTLY one leg; the other three stay as in base -> false.
// leg1: opInc [50,8,14,14,14] -> trailing op-margin median 0.35, discontinuity 0.15 (not > 0.20).
//       leg4 still holds (q1opm 0.20, 0.50 >= 1.9*0.20); legs 2/3 untouched.
check('leg1 alone broken (discontinuity 0.15) NOT flagged',
  detectNewestQtrSuspect(base({ oi: [50, 8, 14, 14, 14] })).suspect === false);
// leg2: gp0 = 50 -> gross margin 0.50 (not > 0.55); legs 1/3/4 untouched.
check('leg2 alone broken (grossMargin 0.50) NOT flagged',
  detectNewestQtrSuspect(base({ gp: [50, 20, 20, 20, 20] })).suspect === false);
// leg3: rev0 = 50 with opInc0 = 25 / gp0 = 30 keeps q0opm 0.50 and gm 0.60, but 50 > 1.35*40 = 54 is false.
check('leg3 alone broken (revenue x1.25) NOT flagged',
  detectNewestQtrSuspect(base({ rev: [50, 40, 40, 40, 40], oi: [25, 10, 10, 10, 10], gp: [30, 20, 20, 20, 20] })).suspect === false);
// leg4: opInc1 = 27 -> q1opm 0.675, 0.50 < 1.9*0.675; trailing median stays 0.25 so legs 1-3 hold.
check('leg4 alone broken (spike x0.74) NOT flagged',
  detectNewestQtrSuspect(base({ oi: [50, 27, 10, 10, 10] })).suspect === false);

// 13) Exact thresholds: one leg sits precisely on its boundary; the comparison operator decides.
// leg4 is >= : opInc0 = 47.5 -> q0opm 0.475 == 1.9 * 0.25 -> STILL flags (spike renders as x1.90).
{
  const r = detectNewestQtrSuspect(base({ oi: [47.5, 10, 10, 10, 10] }));
  check('leg4 boundary (q0opm == 1.9*q1opm) flagged (>=)', r.suspect === true && /spike x1\.90/.test(r.reason));
}
// leg1 is > : opInc [50,8,12,12,12] -> trailing median 0.30, discontinuity exactly 0.20 -> false.
check('leg1 boundary (discontinuity == 0.20) NOT flagged',
  detectNewestQtrSuspect(base({ oi: [50, 8, 12, 12, 12] })).suspect === false);
// leg2 is > : gp0 = 55 -> gross margin exactly 0.55 -> false.
check('leg2 boundary (grossMargin == 0.55) NOT flagged',
  detectNewestQtrSuspect(base({ gp: [55, 20, 20, 20, 20] })).suspect === false);
// leg3 is > : rev0 = 54 == 1.35 * 40 (opInc0 27 / gp0 33 keep q0opm 0.50, gm 0.61) -> false.
check('leg3 boundary (revenue == 1.35x median) NOT flagged',
  detectNewestQtrSuspect(base({ rev: [54, 40, 40, 40, 40], oi: [27, 10, 10, 10, 10], gp: [33, 20, 20, 20, 20] })).suspect === false);

// 14) Input forms: _num accepts raw numbers as well as {value}; NaN / missing arrays degrade to no flag.
check('raw numbers instead of {value} flagged',
  detectNewestQtrSuspect({ revenueQ: BASE.rev, opIncQ: BASE.oi, grossProfitQ: BASE.gp }).suspect === true);
check('{value: NaN} in newest revenue NOT flagged',
  detectNewestQtrSuspect({ revenueQ: [{ value: NaN }, ...env(BASE.rev.slice(1))], opIncQ: env(BASE.oi), grossProfitQ: env(BASE.gp) }).suspect === false);
check('grossProfitQ missing entirely NOT flagged',
  detectNewestQtrSuspect({ revenueQ: env(BASE.rev), opIncQ: env(BASE.oi) }).suspect === false);
check('opIncQ missing entirely NOT flagged',
  detectNewestQtrSuspect({ revenueQ: env(BASE.rev), grossProfitQ: env(BASE.gp) }).suspect === false);

// 15) Trailing history: only indices 1..4 count, non-positive revenues are skipped, < 3 usable -> NONE.
check('revenueQ[1] null (q1opm null) NOT flagged',
  detectNewestQtrSuspect(base({ rev: [100, null, 40, 40, 40] })).suspect === false);
check('revenueQ[3..4] null (only 2 usable trailing) NOT flagged',
  detectNewestQtrSuspect(base({ rev: [100, 40, 40, null, null] })).suspect === false);
check('6th quarter (index 5) ignored even when absurd (1e9), still flagged',
  detectNewestQtrSuspect(ts([100, 40, 40, 40, 40, 1e9], [50, 10, 10, 10, 10, 1e9], [60, 20, 20, 20, 20, 1e9])).suspect === true);
check('one negative trailing revenue (index 4) skipped, still flagged',
  detectNewestQtrSuspect(base({ rev: [100, 40, 40, 40, -40] })).suspect === true);
check('two negative trailing revenues (index 3,4) -> 2 usable -> NOT flagged',
  detectNewestQtrSuspect(base({ rev: [100, 40, 40, -40, -40] })).suspect === false);

// 16) reason is null whenever suspect is false (real-world ramp and an isolated leg break alike).
check('reason null when NOT suspect (MU ramp)',
  detectNewestQtrSuspect(ts([100, 82, 65, 52, 46], [67.6, 36.9, 21.45, 11.96, 10.12], [74, 50, 40, 32, 28])).reason === null);
check('reason null when NOT suspect (leg2 broken)',
  detectNewestQtrSuspect(base({ gp: [50, 20, 20, 20, 20] })).reason === null);

if (failed) { console.error(`\nnewest-qtr-guard: ${failed} assertion(s) FAILED`); process.exit(1); }
console.log('\nnewest-qtr-guard: all anchor + edge assertions passed');
