// Geschwister-Fund (Runde-4-Verifier, selbe T2-Klasse wie watch-exchange-coverage.js):
// watch-fx-sanity.js's checkJump() always reads baseline.last as "yesterday's" counts.
// updateBaseline() unconditionally shifted today's counts into .last on every run —
// so a SAME-DAY rerun (retry, manual re-run) overwrote .last with an intraday value
// instead of pinning it to the last distinct calendar day. The .prev field this
// evicted the old .last into is never read by checkJump — a dead end, not a save.
// Net effect: the next comparison is silently intraday-vs-intraday instead of
// day-over-day, which can both mask a real cross-day jump and manufacture a false
// alarm against a stale intraday reading.
//
// Run: node tests/watch-fx-sanity-samedayrerun.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const { updateBaseline, checkJump } = require('../scripts/watch-fx-sanity.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

check('first-ever run seeds the baseline (control, no regression)', () => {
  const next = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  assert.deepEqual(next.last, { usOver: 100, foreignOver: 50 });
  assert.equal(next.prev, null);
  assert.equal(next.date, '2026-07-18');
});

check('a NEW calendar day advances the pointer normally (control, no regression)', () => {
  const day1 = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  const day2 = updateBaseline(day1, { usOver: 102, foreignOver: 51 }, '2026-07-19');
  assert.deepEqual(day2.prev, { usOver: 100, foreignOver: 50 });
  assert.deepEqual(day2.last, { usOver: 102, foreignOver: 51 });
  assert.equal(day2.date, '2026-07-19');
});

check('SAME-DAY rerun must NOT advance .last (THE BUG)', () => {
  const day1 = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  // Rerun later the SAME day (e.g. a retriggered daily-pull job) sees a spurious,
  // higher intraday count — not a real day-over-day move.
  const rerun = updateBaseline(day1, { usOver: 145, foreignOver: 50 }, '2026-07-18');
  assert.deepEqual(rerun.last, { usOver: 100, foreignOver: 50 },
    '.last was overwritten by a same-day rerun instead of staying pinned to the last ' +
    'distinct calendar day: ' + JSON.stringify(rerun.last));
  assert.equal(rerun.date, '2026-07-18');
});

check('end-to-end: a same-day rerun must not produce a false alarm the following day', () => {
  const day1 = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  // Intraday retry with a transient spike that self-corrects — should not poison
  // tomorrow's day-over-day baseline.
  const rerun = updateBaseline(day1, { usOver: 145, foreignOver: 50 }, '2026-07-18');
  // Day 2: back to a normal, ~2% move off the TRUE prior day (100) — must be quiet.
  const day2Today = { usOver: 102, foreignOver: 50 };
  const problems = checkJump(day2Today, rerun);
  assert.deepEqual(problems, [],
    'false alarm: comparison used the stale intraday rerun value instead of the true ' +
    'prior day. problems=' + JSON.stringify(problems));
});

console.log(fail ? `\nwatch-fx-sanity-samedayrerun: ${fail} FAILED` : '\nwatch-fx-sanity-samedayrerun: all passed');
process.exit(fail ? 1 : 0);
