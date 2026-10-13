// Batch w2-earnings — standalone tests for the pure decisions extracted from
// pull-earnings-dates.js (BH-055 rollover grace, BH-056 failure carry-forward,
// BH-057 per-call timeout). No framework: assert, process.exit(fail?1:0). Hermetic —
// no network, no fs. Run: node tests/scoring/bh-w2-earnings.test.js
const assert = require('assert');
const { resolveEntry, withTimeout } = require('../../pull-earnings-dates.js');

let fail = 0;
function check(name, got, want) {
  try {
    assert.deepStrictEqual(got, want);
    console.log(`  ok   ${name} => ${JSON.stringify(got)}`);
  } catch (_) {
    fail++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

async function checkAsync(name, promise, want) {
  try {
    const got = await promise;
    assert.deepStrictEqual(got, want);
    console.log(`  ok   ${name} => ${JSON.stringify(got)}`);
  } catch (e) {
    if (want === 'THROW') {
      console.log(`  ok   ${name} => threw as expected (${e.message})`);
      return;
    }
    fail++;
    console.log(`  FAIL ${name}: threw/rejected ${e.message}`);
  }
}

const today = '2026-07-16';

// --- BH-055: rollover grace ---------------------------------------------------------

// Normal case: no prior date, or new date not a future rollover past today -> just use it.
check('no-prior-entry', resolveEntry(undefined, '2026-07-20', today, 3), { date: '2026-07-20', pulledAt: today });
check('past-date-no-rollover', resolveEntry({ date: '2026-06-01' }, '2026-06-15', today, 3), { date: '2026-06-15', pulledAt: today });

// Rollover just happened (prev date = yesterday, new date = next quarter) -> keep prev, within grace.
check('rollover-within-grace', resolveEntry({ date: '2026-07-15' }, '2026-10-14', today, 3), { date: '2026-07-15', pulledAt: today });

// Rollover happened but grace window already elapsed -> accept the new (future) date.
check('rollover-beyond-grace', resolveEntry({ date: '2026-07-10' }, '2026-10-09', today, 3), { date: '2026-10-09', pulledAt: today });

// Exactly at the grace boundary -> still kept (daysSincePrev <= graceDays).
check('rollover-at-grace-boundary', resolveEntry({ date: '2026-07-13' }, '2026-10-12', today, 3), { date: '2026-07-13', pulledAt: today });

// --- BH-056: failure carry-forward ----------------------------------------------------

// Failed/timed-out call (newDate === null) with a known prior entry -> carried forward verbatim.
check('failure-carries-forward-prior', resolveEntry({ date: '2026-06-01', pulledAt: '2026-06-01' }, null, today, 3), { date: '2026-06-01', pulledAt: '2026-06-01' });

// Failed call with no prior entry (new ticker, never resolved) -> nothing to write.
check('failure-no-prior-entry', resolveEntry(undefined, null, today, 3), null);

// --- BH-057: per-call timeout -------------------------------------------------------

(async () => {
  // A never-resolving call must still reject once the timeout elapses, instead of hanging
  // its Promise.all batch forever.
  await checkAsync('timeout-rejects-hung-call', withTimeout(new Promise(() => {}), 30), 'THROW');
  // A call that resolves comfortably before the timeout must win the race normally.
  await checkAsync('timeout-lets-fast-call-through', withTimeout(Promise.resolve('ok'), 1000), 'ok');

  console.log(fail === 0 ? '\nPASS (all assertions ok)' : `\nFAIL (${fail} assertion(s) failed)`);
  process.exit(fail ? 1 : 0);
})();
