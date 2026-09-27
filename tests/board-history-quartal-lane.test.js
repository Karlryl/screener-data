'use strict';
// Quartals-Spur (SHADOW ONLY, Nachtlauf 26.09.2026): pins the guards P/S/J of
// neuesQuartalErklaert() and that the shadow NEVER changes the real gate verdict.
// Run date is injected everywhere — no wall-clock dependence.
const assert = require('assert');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const RUN = '2026-09-25';
const ALT = { revenueQ: [100, 95, 90], revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30'] };
const NEU = { revenueQ: [110, 100, 95], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'] };
const row = (ticker, score, pit) => ({ ticker, score, pit });

check('P+S+J valid row counts as explained', () => {
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, NEU), RUN), true);
});
check('order of the series is not assumed', () => {
  const rev = { revenueQ: [...NEU.revenueQ].reverse(), revenueQEnds: [...NEU.revenueQEnds].reverse() };
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, rev), RUN), true);
});
check('P: same quarter (no new quarter) is NOT explained', () => {
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, ALT), RUN), false);
});
check('P: backwards quarter is NOT explained', () => {
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, NEU), row('A', 80, ALT), RUN), false);
});
check('P: quarter end > 120 d before the run date is NOT explained', () => {
  // 2026-06-30 + 121 d = 2026-10-29; at 120 d (2026-10-28) it still counts
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, NEU), '2026-10-28'), true);
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, NEU), '2026-10-29'), false);
});
check('P: quarter end after the run date is NOT explained', () => {
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, NEU), '2026-06-29'), false);
});
check('S: broken overlap (ratio outside [0.5, 2]) is NOT explained', () => {
  const kaputt = { ...NEU, revenueQ: [110, 100 * 2.01, 95] };
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, kaputt), RUN), false);
  const unten = { ...NEU, revenueQ: [110, 100, 95 * 0.49] };
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, unten), RUN), false);
});
check('S: no overlapping quarter at all is NOT explained', () => {
  const fremd = { revenueQ: [110, 100], revenueQEnds: ['2026-06-30', '2026-05-31'] };
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, fremd), RUN), false);
});
check('J: jump outside [0.5, 2] is NOT explained', () => {
  const hoch = { ...NEU, revenueQ: [100 * 2.01, 100, 95] };
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, hoch), RUN), false);
  const tief = { ...NEU, revenueQ: [100 * 0.49, 100, 95] };
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), row('A', 80, tief), RUN), false);
});
check('missing pit / series is NOT explained (and does not throw)', () => {
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, null), row('A', 80, NEU), RUN), false);
  assert.strictEqual(W.neuesQuartalErklaert(row('A', 50, ALT), { ticker: 'A', score: 80 }, RUN), false);
});

// ── Codex critique 26.09. (F2/F3/F4): each case below PASSED before the fix ──────
const ex = (alt, neu, run = RUN) => W.neuesQuartalErklaert(row('A', 50, alt), row('A', 80, neu), run);
check('F2: missing quarter (newest two not adjacent) is NOT explained', () => {
  // March is missing: J would compare June with December (181 d apart)
  assert.strictEqual(ex(ALT, { revenueQ: [110, 95, 90], revenueQEnds: ['2026-06-30', '2025-12-31', '2025-09-30'] }), false);
});
check('F2: duplicate newest quarter (J compares June with itself) is NOT explained', () => {
  assert.strictEqual(ex(ALT, { revenueQ: [110, 110, 100, 95], revenueQEnds: ['2026-06-30', '2026-06-30', '2026-03-31', '2025-12-31'] }), false);
});
check('F2: duplicate quarter in the previous series (ambiguous overlap) is NOT explained', () => {
  assert.strictEqual(ex({ revenueQ: [300, 100, 95], revenueQEnds: ['2026-03-31', '2026-03-31', '2025-12-31'] }, NEU), false);
});
check('F2: predecessor gap band is [80, 100] days, inclusive', () => {
  const mit = (vorEnde) => ex({ revenueQ: [100, 95], revenueQEnds: [vorEnde, '2025-12-20'] },
    { revenueQ: [110, 100, 95], revenueQEnds: ['2026-06-30', vorEnde, '2025-12-20'] });
  assert.strictEqual(mit('2026-04-11'), true, '80 d');
  assert.strictEqual(mit('2026-03-22'), true, '100 d');
  assert.strictEqual(mit('2026-04-12'), false, '79 d');
  assert.strictEqual(mit('2026-03-21'), false, '101 d');
});
check('F3: null / non-finite revenue in the newest two quarters is NOT explained', () => {
  assert.strictEqual(ex(ALT, { ...NEU, revenueQ: [110, null, 95] }), false);
  assert.strictEqual(ex(ALT, { ...NEU, revenueQ: [Infinity, 100, 95] }), false);
  assert.strictEqual(ex(ALT, { ...NEU, revenueQ: ['110', 100, 95] }), false);
});
check('F3: null revenue in an overlapping quarter (either side) is NOT explained', () => {
  assert.strictEqual(ex(ALT, { ...NEU, revenueQ: [110, 100, null] }), false);
  assert.strictEqual(ex({ ...ALT, revenueQ: [100, null, 90] }, NEU), false);
  assert.strictEqual(ex({ ...ALT, revenueQ: [100, 95, NaN] }, { revenueQ: [110, 100, 95, 90], revenueQEnds: [...NEU.revenueQEnds, '2025-09-30'] }), false);
  // numeric strings would coerce into an in-band ratio ('95' / 95 = 1)
  assert.strictEqual(ex(ALT, { ...NEU, revenueQ: [110, 100, '95'] }), false);
  assert.strictEqual(ex({ ...ALT, revenueQ: [100, '95', 90] }, NEU), false);
});
check('F3: an overlapping quarter null on BOTH sides is a stable gap — skipped, does not block S', () => {
  assert.strictEqual(ex({ ...ALT, revenueQ: [100, null, 90] }, { ...NEU, revenueQ: [110, 100, null] }), true);
  assert.strictEqual(ex({ ...ALT, revenueQ: [100, NaN, 90] }, { ...NEU, revenueQ: [110, 100, Infinity] }), true);
});
check('F3: a both-sides gap is not an overlap — S still needs one finite overlapping quarter', () => {
  assert.strictEqual(ex({ revenueQ: [null], revenueQEnds: ['2025-12-31'] }, { ...NEU, revenueQ: [110, 100, null] }), false);
});
check('F3: a both-sides gap in the newest two quarters still blocks', () => {
  assert.strictEqual(ex({ ...ALT, revenueQ: [null, 95, 90] }, { ...NEU, revenueQ: [110, null, 95] }), false);
});
check('F3: a null in an older, non-overlapping quarter does not block', () => {
  assert.strictEqual(ex(ALT, { revenueQ: [110, 100, 95, null], revenueQEnds: [...NEU.revenueQEnds, '2025-06-30'] }), true);
});
check('F4: impossible calendar dates are NOT explained (no Date.parse rollover)', () => {
  assert.strictEqual(ex(ALT, { ...NEU, revenueQEnds: ['2026-06-31', '2026-03-31', '2025-12-31'] }), false);
  assert.strictEqual(ex({ ...ALT, revenueQEnds: ['2026-02-30', '2025-12-31', '2025-09-30'] }, NEU), false);
  assert.strictEqual(ex(ALT, { ...NEU, revenueQEnds: ['2026-6-30', '2026-03-31', '2025-12-31'] }), false);
  assert.strictEqual(ex(ALT, NEU, '2026-09-31'), false, 'run date rolls over to 10-01');
});

// ── Shadow vs. real verdict ──────────────────────────────────────────────────
// 200 quiet rows (|D| 1) + 5 rows that jump 40 points because a NEW quarter arrived.
// Real gate: p99 over all rows sees the jumps → SUSPECT. Shadow: jumps explained → OK.
const GATE = { dailyP99Samples: [], sampleDates: [], threshold: 10, frozen: true };
function paar(springer) {
  const pr = [], nw = [];
  for (let i = 0; i < 200; i++) { pr.push(row('Q' + i, 50, ALT)); nw.push(row('Q' + i, 51, ALT)); }
  for (let i = 0; i < 5; i++) { pr.push(row('J' + i, 20, ALT)); nw.push(row('J' + i, 60, springer)); }
  return [
    { date: '2026-09-25', cohort: { profitable: nw, unprofitable: [] }, pitCoverage: {} },
    { date: '2026-09-24', cohort: { profitable: pr, unprofitable: [] }, pitCoverage: {} },
  ];
}
const still = (fn) => { const log = console.log, out = []; console.log = (s) => out.push(String(s)); try { return [fn(), out]; } finally { console.log = log; } };

check('real verdict is byte-identical with and without the shadow (explained jumps)', () => {
  const [now, prior] = paar(NEU);
  const vorN = JSON.stringify(now), vorP = JSON.stringify(prior), vorG = JSON.stringify(GATE);
  const ohne = W.evaluateGate(now, prior, GATE, null, 'energy', {});
  const ohneJson = JSON.stringify(ohne);
  const [sh, out] = still(() => W.quartalLaneShadow(now, prior, ohne, GATE, null, 'energy', {}, RUN));
  const mit = W.evaluateGate(now, prior, GATE, null, 'energy', {});
  assert.strictEqual(JSON.stringify(ohne), ohneJson, 'shadow mutated the gate result');
  assert.strictEqual(JSON.stringify(mit), ohneJson, 'gate result differs after the shadow ran');
  assert.strictEqual(JSON.stringify(now), vorN); assert.strictEqual(JSON.stringify(prior), vorP); assert.strictEqual(JSON.stringify(GATE), vorG);
  assert.strictEqual(ohne.suspect, true); assert.deepStrictEqual(ohne.reasons, ['p99-delta-exceeds-threshold']);
  assert.strictEqual(sh.wouldSuspect, false); assert.strictEqual(sh.realSuspect, true);
  assert.deepStrictEqual(sh.explained, ['J0', 'J1', 'J2', 'J3', 'J4']); assert.strictEqual(sh.n, 205);
  assert.ok(Math.abs(sh.p99Unexplained - 1) < 1e-9, 'p99 unexplained ' + sh.p99Unexplained);
  assert.strictEqual(sh.thr, ohne.wirksameSchwelle);
  assert.strictEqual(sh.measured, 205); assert.strictEqual(sh.measuredUnexplained, 200);
  assert.ok(/^\[quartal-lane SHADOW\] energy: real-gate p99=40\.00 over 205 measured rows; p99 unexplained=1\.00 over 200; thr=10\.00; quarter-explained=5 of 205 candidates → would be OK \(real: SUSPECT\)$/.test(out[0]), out[0]);
});
check('F6: on a lamp-exclusion day the measured population is logged apart from the quarter candidates', () => {
  const [now, prior] = paar(NEU);
  for (let i = 0; i < 10; i++) now.cohort.profitable[i].lamps = ['defbruch'];
  const bruch = { boards: new Set(['energy']), erklaerendeLampe: 'defbruch', typ: 'definition', tag: '2026-09-25' };
  const g = W.evaluateGate(now, prior, GATE, bruch, 'energy', {});
  const [sh, out] = still(() => W.quartalLaneShadow(now, prior, g, GATE, bruch, 'energy', {}, RUN));
  assert.strictEqual(g.fanOutNenner, 195);
  assert.strictEqual(sh.measured, 195); assert.strictEqual(sh.n, 205); assert.strictEqual(sh.measuredUnexplained, 190);
  assert.ok(out[0].includes('real-gate p99=40.00 over 195 measured rows; p99 unexplained=1.00 over 190;'), out[0]);
  assert.ok(out[0].includes('quarter-explained=5 of 205 candidates'), out[0]);
  assert.ok(!out[0].includes('p99 all'), out[0]);
});
check('unexplained jumps (J broken) stay in the shadow p99 → would be SUSPECT', () => {
  const [now, prior] = paar({ ...NEU, revenueQ: [300, 100, 95] });
  const g = W.evaluateGate(now, prior, GATE, null, 'energy', {});
  const [sh] = still(() => W.quartalLaneShadow(now, prior, g, GATE, null, 'energy', {}, RUN));
  assert.strictEqual(sh.explained.length, 0); assert.strictEqual(sh.wouldSuspect, true);
});
check('other reasons (nan-break) keep the shadow SUSPECT even when p99 is explained', () => {
  const [now, prior] = paar(NEU);
  now.cohort.profitable[0] = row('Q0', NaN, ALT);
  const g = W.evaluateGate(now, prior, GATE, null, 'energy', {});
  const [sh] = still(() => W.quartalLaneShadow(now, prior, g, GATE, null, 'energy', {}, RUN));
  assert.ok(g.reasons.includes('nan-break')); assert.strictEqual(sh.wouldSuspect, true);
});
check('every row explained → NO-SURFACE counts as would-be SUSPECT, never OK', () => {
  const pr = [], nw = [];
  for (let i = 0; i < 50; i++) { pr.push(row('A' + i, 10, ALT)); nw.push(row('A' + i, 90, NEU)); }
  const now = { date: RUN, cohort: { profitable: nw, unprofitable: [] }, pitCoverage: {} };
  const prior = { date: '2026-09-24', cohort: { profitable: pr, unprofitable: [] }, pitCoverage: {} };
  const g = W.evaluateGate(now, prior, GATE, null, 'energy', {});
  const [sh, out] = still(() => W.quartalLaneShadow(now, prior, g, GATE, null, 'energy', {}, RUN));
  assert.strictEqual(sh.p99Unexplained, null); assert.strictEqual(sh.wouldSuspect, true);
  assert.ok(out[0].includes('quarter-explained=50 of 50 candidates → would be SUSPECT (NO-SURFACE)'), out[0]);
});
check('failure isolation: a throwing helper is caught, logged as ::warning::, verdict untouched', () => {
  const [now, prior] = paar(NEU);
  const g = W.evaluateGate(now, prior, GATE, null, 'energy', {});
  const vor = JSON.stringify(g);
  const boom = () => { throw new Error('boom'); };
  const [sh, out] = still(() => W.quartalLaneShadow(now, prior, g, GATE, null, 'energy', {}, RUN, boom));
  assert.strictEqual(sh, null);
  assert.deepStrictEqual(out, ['::warning::[quartal-lane SHADOW] failed: energy: boom']);
  assert.strictEqual(JSON.stringify(g), vor);
});
check('failure isolation: malformed vintage is caught, not thrown', () => {
  const [, prior] = paar(NEU);
  const g = W.evaluateGate({ date: RUN, cohort: { profitable: [], unprofitable: [] }, pitCoverage: {} }, prior, GATE, null, 'energy', {});
  const [sh, out] = still(() => W.quartalLaneShadow(null, prior, g, GATE, null, 'energy', {}, RUN));
  assert.strictEqual(sh, null); assert.ok(out[0].startsWith('::warning::[quartal-lane SHADOW] failed: energy: '), out[0]);
});
check('summary names every excluded row (first 50 + count) and never throws', () => {
  const s = (b, k, w) => ({ board: b, explained: Array.from({ length: k }, (_, i) => 'T' + i), wouldSuspect: w, realSuspect: true });
  const [, out] = still(() => W.quartalLaneShadowSummary([s('a', 30, false), null, s('b', 30, true)]));
  assert.ok(out[0].startsWith('[quartal-lane SHADOW] summary: would-be SUSPECT 1/2 boards (real SUSPECT 2/2; boards without shadow 1, see lines above); excluded rows 60: a:T0, '), out[0]);
  assert.ok(out[0].endsWith(' … +10 more'), out[0]);
  const [, bad] = still(() => W.quartalLaneShadowSummary(null));
  assert.ok(bad[0].startsWith('::warning::[quartal-lane SHADOW] failed: summary: '), bad[0]);
});
check('failure isolation: even a throwing logger never throws into run()', () => {
  const [now, prior] = paar(NEU);
  const g = W.evaluateGate(now, prior, GATE, null, 'energy', {});
  const orig = console.log;
  console.log = () => { throw new Error('logger down'); };
  let sh, sum;
  try {
    sh = W.quartalLaneShadow(now, prior, g, GATE, null, 'energy', {}, RUN, () => { throw Symbol('odd'); });
    sum = W.quartalLaneShadowSummary(null);
  } finally { console.log = orig; }
  assert.strictEqual(sh, null); assert.strictEqual(sum, undefined);
});
check('run() wires the shadow as log-only: its return value never reaches anySuspect/results', () => {
  const src = require('fs').readFileSync(require.resolve('../scripts/write-board-history.js'), 'utf8');
  const calls = src.match(/[^ ]quartalLaneShadow\(vintage,/g) || [];
  assert.strictEqual(calls.length, 1, 'exactly one call site');
  assert.ok(/\n    quartalShadows\.push\(quartalLaneShadow\(vintage, priorVintage, gate, /.test(src));
  assert.ok(!/quartalShadows[^\n]*(anySuspect|results\.push|vintage\.gate)/.test(src));
});

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exit(fail ? 1 : 0);
