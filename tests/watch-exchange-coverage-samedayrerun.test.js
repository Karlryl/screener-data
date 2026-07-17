// T2 (Karl-Audit, Runde 4): watch-exchange-coverage.js updateBaseline() appended
// today's count into the rolling WINDOW history WITHOUT a date key. A second run
// on the same calendar day (retry, manual re-run, daily-pull.yml:612 job re-fired)
// pushed the same day's count a second time, evicting a real prior day via
// slice(-WINDOW) — median() in checkDrift then measured over 13 distinct days +
// 1 duplicate instead of 14 distinct days.
//
// Run: node tests/watch-exchange-coverage-samedayrerun.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const { updateBaseline, checkDrift } = require('../scripts/watch-exchange-coverage.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// 14 distinct, ordered history entries so a wrongly-evicted day is observable
// (identical values would hide a duplication bug).
function seedHistory() {
  const h = [];
  for (let i = 0; i < 14; i++) h.push(10 + i); // [10,11,...,23]
  return h;
}

check('first run of a NEW day appends normally (control, no regression)', () => {
  const baseline = { NYSE: seedHistory() };
  const next = updateBaseline(baseline, { NYSE: 24 }, '2026-07-18');
  assert.deepEqual(next.NYSE, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    'normal day-over-day append is broken: ' + JSON.stringify(next.NYSE));
  assert.equal(next._lastUpdated, '2026-07-18');
});

check('SAME-DAY rerun does not push a second entry (THE BUG)', () => {
  const baseline = { NYSE: seedHistory() };
  const afterRun1 = updateBaseline(baseline, { NYSE: 24 }, '2026-07-18');
  // Rerun on the SAME day (e.g. retry after a partial pull) observes a different count.
  const afterRun2 = updateBaseline(afterRun1, { NYSE: 99 }, '2026-07-18');
  assert.equal(afterRun2.NYSE.length, 14, 'window size must stay 14: ' + JSON.stringify(afterRun2.NYSE));
  // The bug: a same-day rerun must REPLACE today's slot, not push a second one.
  // If it pushes, entry 11 (a real prior day) is evicted on top of 10, and both
  // 24 (run1's transient "today") and 99 (run2) end up coexisting as if they were
  // two different real days.
  assert.equal(afterRun2.NYSE[0], 11,
    'a real prior day was evicted by the same-day rerun — history starts at ' +
    afterRun2.NYSE[0] + ' instead of 11: ' + JSON.stringify(afterRun2.NYSE));
  assert.equal(afterRun2.NYSE[13], 99, 'the latest slot must reflect the rerun value');
  assert.ok(!afterRun2.NYSE.includes(24),
    'run1\'s transient same-day value (24) must not linger as a separate history entry: ' +
    JSON.stringify(afterRun2.NYSE));
});

check('next calendar day still advances the window normally after a same-day rerun', () => {
  const baseline = { NYSE: seedHistory() };
  const afterRun1 = updateBaseline(baseline, { NYSE: 24 }, '2026-07-18');
  const afterRerun = updateBaseline(afterRun1, { NYSE: 99 }, '2026-07-18');
  const nextDay = updateBaseline(afterRerun, { NYSE: 30 }, '2026-07-19');
  assert.equal(nextDay.NYSE.length, 14);
  assert.equal(nextDay.NYSE[13], 30);
  assert.equal(nextDay.NYSE[0], 12, 'new day must evict exactly one more day: ' + JSON.stringify(nextDay.NYSE));
  assert.equal(nextDay._lastUpdated, '2026-07-19');
});

check('backward-compatible: legacy baseline without _lastUpdated still works (first post-fix run)', () => {
  const legacy = { Shenzhen: [68, 68, 68, 68, 68, 68, 68, 68, 68, 68, 68, 68, 68, 68] };
  const next = updateBaseline(legacy, { Shenzhen: 70 }, '2026-07-18');
  assert.equal(next.Shenzhen.length, 14);
  assert.equal(next.Shenzhen[13], 70);
  assert.equal(next._lastUpdated, '2026-07-18');
});

check('checkDrift ignores the _lastUpdated marker key (no crash, not treated as an exchange)', () => {
  const baseline = { NYSE: seedHistory(), _lastUpdated: '2026-07-18' };
  const alerts = checkDrift({ NYSE: 22 }, baseline);
  assert.ok(Array.isArray(alerts), 'checkDrift must not throw on a baseline carrying _lastUpdated');
});

console.log(fail ? `\nwatch-exchange-coverage-samedayrerun: ${fail} FAILED` : '\nwatch-exchange-coverage-samedayrerun: all passed');
process.exit(fail ? 1 : 0);
