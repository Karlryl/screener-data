// TASK 0.11 (Stille-Fehler-Härtung) — standalone test that the previously-SILENT catch
// blocks are now countable/loud. No framework: assert, process.exit(fail?1:0).
// Run: node tests/silent-errors.test.js
const assert = require('assert');
const { runLamp, needsFullPull, _silentErrorCounts, _resetSilentErrorCounts } = require('../pull-yahoo.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// --- runLamp: a throwing lamp is COUNTED (run-level + per-snapshot meta), never rethrown ---
check('runLamp: throwing lamp does not rethrow', () => {
  _resetSilentErrorCounts();
  const meta = {};
  assert.doesNotThrow(() => runLamp('boom', meta, () => { throw new Error('lamp exploded'); }));
});
check('runLamp: throwing lamp bumps run-level + per-snapshot counter + records name', () => {
  _resetSilentErrorCounts();
  const meta = {};
  runLamp('boom', meta, () => { throw new Error('x'); });
  assert.strictEqual(_silentErrorCounts().lamp, 1, 'run-level lamp counter');
  assert.strictEqual(meta._lampErrors, 1, 'per-snapshot meta._lampErrors');
  assert.deepStrictEqual(meta._lampErrorNames, ['boom'], 'lamp name recorded');
});
check('runLamp: a SUCCESSFUL lamp does not count and still runs its side effect', () => {
  _resetSilentErrorCounts();
  const meta = {};
  runLamp('ok', meta, () => { meta.touched = true; });
  assert.strictEqual(_silentErrorCounts().lamp, 0, 'no error counted on success');
  assert.strictEqual(meta.touched, true, 'lamp side effect ran');
  assert.strictEqual(meta._lampErrors, undefined, 'no per-snapshot error flag on success');
});
check('runLamp: missing/garbage meta is tolerated (only run-level counts)', () => {
  _resetSilentErrorCounts();
  assert.doesNotThrow(() => runLamp('boom', null, () => { throw new Error('x'); }));
  assert.strictEqual(_silentErrorCounts().lamp, 1);
});

// --- needsFullPull: the (near-unreachable) catch is now LOUD (count) instead of silent ---
// Force the catch: a date whose valueOf/toString throws makes new Date(date).getTime() throw.
const today = new Date('2026-07-06T00:00:00Z');
const throwingDate = { toString() { throw new Error('exotic'); }, valueOf() { throw new Error('exotic'); } };
check('needsFullPull: exotic throwing input still returns price-only (behaviour preserved)', () => {
  _resetSilentErrorCounts();
  const got = needsFullPull({ fundamentalsAsOf: '2026-05-01' }, { date: throwingDate }, today);
  assert.strictEqual(got, 'price-only');
});
check('needsFullPull: exotic throw is COUNTED (no longer silent)', () => {
  _resetSilentErrorCounts();
  needsFullPull({ fundamentalsAsOf: '2026-05-01' }, { date: throwingDate }, today);
  assert.strictEqual(_silentErrorCounts().needsFullPull, 1, 'needsFullPull throw counter');
});
check('needsFullPull: normal valid input does NOT touch the counter (catch unreachable)', () => {
  _resetSilentErrorCounts();
  needsFullPull({ fundamentalsAsOf: '2026-05-01' }, { date: '2026-06-15' }, today); // valid → 'full'
  assert.strictEqual(_silentErrorCounts().needsFullPull, 0, 'no throw on valid input');
});

console.log(fail ? `\nsilent-errors: ${fail} FAILED` : '\nsilent-errors: all passed');
process.exit(fail ? 1 : 0);
