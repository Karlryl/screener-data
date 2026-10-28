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

// ---- Parity with the score lamp (sweep 24.10.2026, finding 5) ----
// The lamp in src/scoring/lamps.js adds two de-fire legs (seasonal, ramp). Legs 1-4 alone flagged
// these shapes, so meta._newestQtrSuspect dropped such US firms from the Druckenmiller universe.
const { newestQtrSuspect: lamp } = require('../src/scoring/lamps.js');
const lampSays = (series) => lamp({ timeseries: series }) === true;

// 11) VCEL-style seasonal Q4 (the Dec-25, Sep-25 and Jun-25 quarters from the VCEL snapshot of 24.10.2026,
//     Mar-25/Dec-24 constructed):
//     q0opm 24.1% vs trailing median 1.0%, gm 78.7%, revenue x1.42, q1opm 5.1% -> legs 1-4 hold; the year-ago
//     quarter has 22.5% -> seasonal, MUST NOT flag. Moving the year-ago margin away MUST flag (the leg is the reason).
{
  const rev = [92.918, 67.503, 63.24, 52.6, 86.7], gp = [73.128, 49.585, 46.613, 36.0, 67.0];
  const seasonal = ts(rev, [22.415, 3.45, -2.029, -11.0, 19.5], gp);
  check('VCEL-style seasonal quarter NOT flagged', detectNewestQtrSuspect(seasonal).suspect === false);
  const dated = { ...seasonal, revenueQEnds: ['2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31', '2024-12-31'] };
  check('VCEL-style seasonal quarter with period ends NOT flagged', detectNewestQtrSuspect(dated).suspect === false);
  check('same shape without a similar year-ago margin IS flagged', detectNewestQtrSuspect(ts(rev, [22.415, 3.45, -2.029, -11.0, -5], gp)).suspect === true);
}

// 12) LQDA-style ramp (newest four quarters from the LQDA snapshot of 24.10.2026 shifted by one, Mar-25 constructed):
//     every QoQ revenue step is above 1.35x (3.0 -> 8.8 -> 54.3 -> 92.0 -> 132.9) -> early commercial ramp, MUST NOT flag.
//     Breaking one step (oldest quarter 8.0) MUST flag.
{
  const op = [61.504, 19.787, 1.767, -37.505, -45], gp = [121.013, 84.966, 51.169, 7.34, 2.5];
  check('LQDA-style revenue ramp NOT flagged', detectNewestQtrSuspect(ts([132.865, 92.021, 54.342, 8.837, 3.0], op, gp)).suspect === false);
  check('same shape with one flat QoQ step IS flagged', detectNewestQtrSuspect(ts([132.865, 92.021, 54.342, 8.837, 8.0], op, gp)).suspect === true);
}

// 13) Parity: every fixture above plus a seeded sweep of near-trigger shapes gives the lamp's answer.
{
  const fixed = [
    ts([133.87, 93.84, 86.06, 74.57, 79.14], [57.23, 20.08, 8.61, 7.46, 6.65], [81.91, 38, 35, 30, 32]),
    ts([100, 35.4, 33, 30, 31], [70, 12.5, 3, 2.5, 1.5], [78, 20, 18, 17, 18]),
    ts([100, 82, 65, 52, 46], [67.6, 36.9, 21.45, 11.96, 10.12], [74, 50, 40, 32, 28]),
    ts([100, 60, 60, 60, 90], [30, 3, 3, 3, 27], [60, 30, 30, 30, 50]),
    { revenueQ: [200, 100, 100, 100, 100], opIncQ: [100, 10, 10, 10, 10], grossProfitQ: [140, 40, 40, 40, 40] },
    ts([100, 50, 40, 30], [60, 10, 8, 6], [70, 30, 25, 20]), {}, undefined,
  ];
  let seed = 20261024;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const shapes = [];
  for (let i = 0; i < 4000; i++) {
    const n = 5 + Math.floor(rnd() * 2), ramp = rnd() < 0.25, rev = [], op = [], gp = [];
    for (let q = 0; q < n; q++) rev.push(ramp ? (q ? rev[q - 1] / (1.2 + rnd() * 0.6) : 100) : 40 + rnd() * 60);
    if (!ramp) rev[0] = rev[1] * (0.8 + rnd() * 1.8);
    for (let q = 0; q < n; q++) {
      const opm = q === 0 ? rnd() * 0.8 : -0.1 + rnd() * 0.35;
      op.push(rev[q] * opm);
      gp.push(rev[q] * (q === 0 ? 0.3 + rnd() * 0.6 : 0.3 + rnd() * 0.3));
    }
    if (rnd() < 0.3) op[4] = rev[4] * (op[0] / rev[0] + (rnd() - 0.5) * 0.5);   // year-ago margin near q0 or not
    for (const arr of [rev, op, gp]) for (let q = 0; q < n; q++) if (rnd() < 0.02) arr[q] = null;
    const s = ts(rev, op, gp);
    if (rnd() < 0.5) {
      const day = Date.UTC(2026, 5, 30);
      s.revenueQEnds = rev.map((_, q) => new Date(day - q * 91.3 * 86400000 + (rnd() < 0.1 ? 40 * 86400000 : 0)).toISOString().slice(0, 10));
    }
    shapes.push(s);
  }
  let mismatches = 0, flagged = 0;
  for (const s of fixed.concat(shapes)) {
    const lib = detectNewestQtrSuspect(s).suspect;
    if (lib !== lampSays(s)) mismatches++;
    if (lib) flagged++;
  }
  check('lib decision equals the score lamp on ' + (fixed.length + shapes.length) + ' shapes (' + flagged + ' flagged)', mismatches === 0 && flagged >= 20);
}

if (failed) { console.error(`\nnewest-qtr-guard: ${failed} assertion(s) FAILED`); process.exit(1); }
console.log('\nnewest-qtr-guard: all anchor + edge assertions passed');
