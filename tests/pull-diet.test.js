// TASK 0.9 (Pull-Diät) — standalone test for the pure needsFullPull decision fn.
// No framework: assert, process.exit(fail?1:0). Run: node tests/pull-diet.test.js
const assert = require('assert');
const { needsFullPull } = require('../pull-yahoo.js');

const today = new Date('2026-07-06T00:00:00Z');
const meta = { fundamentalsAsOf: '2026-05-01T12:00:00Z' };

let fail = 0;
function check(name, got, want) {
  try {
    assert.strictEqual(got, want);
    console.log(`  ok   ${name} => ${got}`);
  } catch (_) {
    fail++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${want}`);
  }
}

// date > fundamentalsAsOf AND <= today => 'full' (reported since last full pull)
check('reported-after-lastpull', needsFullPull(meta, { date: '2026-06-15' }, today), 'full');

// date < fundamentalsAsOf => 'price-only' (already have that report's financials)
check('reported-before-lastpull', needsFullPull(meta, { date: '2026-04-01' }, today), 'price-only');

// no earnings entry => 'price-only'
check('no-earnings-entry', needsFullPull(meta, undefined, today), 'price-only');
check('null-earnings-entry', needsFullPull(meta, null, today), 'price-only');
check('earnings-entry-no-date', needsFullPull(meta, {}, today), 'price-only');

// date in the future => 'price-only' (not yet reported)
check('future-earnings', needsFullPull(meta, { date: '2026-08-20' }, today), 'price-only');

// malformed meta => 'price-only', no throw
check('meta-null', needsFullPull(null, { date: '2026-06-15' }, today), 'price-only');
check('meta-undefined', needsFullPull(undefined, { date: '2026-06-15' }, today), 'price-only');
check('meta-no-fundamentalsAsOf', needsFullPull({}, { date: '2026-06-15' }, today), 'price-only');
check('meta-garbage-asOf', needsFullPull({ fundamentalsAsOf: 'not-a-date' }, { date: '2026-06-15' }, today), 'price-only');

// garbage earnings date => 'price-only', no throw
check('garbage-earnings-date', needsFullPull(meta, { date: 'xyz' }, today), 'price-only');
check('garbage-today', needsFullPull(meta, { date: '2026-06-15' }, 'not-a-date'), 'price-only');

// today accepted as string too (parity with Date)
check('today-as-string', needsFullPull(meta, { date: '2026-06-15' }, '2026-07-06'), 'full');

// edge: earnings exactly on today => 'full' (reported today, after May asOf)
check('earnings-equals-today', needsFullPull(meta, { date: '2026-07-06' }, today), 'full');

// edge: earnings date equals asOf day → 'full'. Die alte Erwartung ('price-only',
// "not strictly newer") war ein gepinnter Bug: ein Pull am Earnings-Tag VOR der
// Veröffentlichung löschte den Trigger für immer (Live-Beleg 16.07.: GS/FAST/ERIC,
// date 07-14, asOf 07-14T02:39Z, nie wieder Voll-Pull).
check('earnings-equals-asOf-day', needsFullPull({ fundamentalsAsOf: '2026-06-15T00:00:00Z' }, { date: '2026-06-15' }, today), 'full');
check('earnings-equals-asOf-day-late-pull', needsFullPull({ fundamentalsAsOf: '2026-06-15T23:00:00Z' }, { date: '2026-06-15' }, today), 'full');

// … aber KEIN Dauer-Re-Pull: liegt asOf NACH dem Ende des Earnings-Tages, reicht price-only.
check('asOf-after-earnings-day', needsFullPull({ fundamentalsAsOf: '2026-06-16T05:00:00Z' }, { date: '2026-06-15' }, today), 'price-only');

console.log(fail === 0 ? '\nPASS (all assertions ok)' : `\nFAIL (${fail} assertion(s) failed)`);
process.exit(fail ? 1 : 0);
