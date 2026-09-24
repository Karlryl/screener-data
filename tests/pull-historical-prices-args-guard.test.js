'use strict';
// S36 (2026-09-24): guard parseArgs() and parseCheckpointEvery() in pull-historical-prices.js.
// The bug (same class as BH-054 for PRICE_CONCURRENCY): PRICE_CHECKPOINT_BATCHES='0' or
// 'abc' went through a bare parseInt, so `batchIdx % CHECKPOINT_EVERY_BATCHES === 0` was
// `x % 0` / `x % NaN` -> NaN -> never true -> the timeout checkpoint silently never fired
// and a 25-min step-kill lost the whole pull. parseCheckpointEvery() must fall back to 100
// for anything that is not a positive integer. parseArgs() carries the fail-loud --shard
// checks and was never exported, so its throws were untested.
// require() must not start main() (guarded by require.main === module).
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, parseCheckpointEvery } = require('../pull-historical-prices.js');

// ── parseArgs ────────────────────────────────────────────────────────────────
test('parseArgs: defaults without flags', () => {
  assert.deepStrictEqual(parseArgs(['node', 'x']),
    { watchlist: './watchlist.json', out: './prices', rateLimit: 1500, shard: null });
});

test('parseArgs: --watchlist / --out / --rate-limit are applied (rateLimit as a number)', () => {
  const a = parseArgs(['node', 'x', '--watchlist', 'wl.json', '--out', 'p/', '--rate-limit', '250']);
  assert.strictEqual(a.watchlist, 'wl.json');
  assert.strictEqual(a.out, 'p/');
  assert.strictEqual(a.rateLimit, 250);
  assert.strictEqual(typeof a.rateLimit, 'number');
  assert.strictEqual(a.shard, null);
});

test('parseArgs: --shard 1/4 -> { idx: 1, anzahl: 4 }', () => {
  assert.deepStrictEqual(parseArgs(['node', 'x', '--shard', '1/4']).shard, { idx: 1, anzahl: 4 });
  assert.deepStrictEqual(parseArgs(['node', 'x', '--shard', '0/1']).shard, { idx: 0, anzahl: 1 });
});

test('parseArgs: impossible shards fail loud (i >= N, N = 0)', () => {
  assert.throws(() => parseArgs(['node', 'x', '--shard', '4/4']), /ist unmoeglich/);
  assert.throws(() => parseArgs(['node', 'x', '--shard', '0/0']), /ist unmoeglich/);
});

test('parseArgs: malformed shards fail loud (form i/N)', () => {
  assert.throws(() => parseArgs(['node', 'x', '--shard', '-1/4']), /erwartet die Form i\/N/);
  assert.throws(() => parseArgs(['node', 'x', '--shard', 'a/b']), /erwartet die Form i\/N/);
  assert.throws(() => parseArgs(['node', 'x', '--shard', '3']), /erwartet die Form i\/N/);
});

test('parseArgs: a trailing flag without a value is ignored (defaults stay)', () => {
  assert.deepStrictEqual(parseArgs(['node', 'x', '--out']),
    { watchlist: './watchlist.json', out: './prices', rateLimit: 1500, shard: null });
  assert.strictEqual(parseArgs(['node', 'x', '--shard']).shard, null);
});

// ── parseCheckpointEvery ─────────────────────────────────────────────────────
function mitStillemLog(fn) {
  // WARN goes through _log -> console.log; capture and restore so the runner output stays clean.
  const orig = console.log;
  const zeilen = [];
  console.log = (...a) => { zeilen.push(a.join(' ')); };
  try { return { wert: fn(), zeilen }; } finally { console.log = orig; }
}

test('bug proof: a zero/NaN divisor makes the checkpoint condition never true', () => {
  // This is exactly `batchIdx % CHECKPOINT_EVERY_BATCHES === 0` with PRICE_CHECKPOINT_BATCHES='0':
  // 5 % 0 is NaN, NaN === 0 is false -> no checkpoint ever, progress lost on timeout-kill.
  assert.equal(5 % 0 === 0, false);
  assert.equal(5 % parseInt('abc', 10) === 0, false);
});

test('parseCheckpointEvery: a positive integer is respected', () => {
  const r = mitStillemLog(() => parseCheckpointEvery('25'));
  assert.strictEqual(r.wert, 25);
  assert.strictEqual(r.zeilen.length, 0, 'valid value must not warn');
  assert.strictEqual(parseCheckpointEvery(' 7 '), 7);
});

test('parseCheckpointEvery: unset / blank -> default 100 without a warning', () => {
  const r1 = mitStillemLog(() => parseCheckpointEvery(undefined));
  assert.strictEqual(r1.wert, 100);
  assert.strictEqual(r1.zeilen.length, 0, 'unset env is the normal case, must not warn');
  const r2 = mitStillemLog(() => parseCheckpointEvery(''));
  assert.strictEqual(r2.wert, 100);
});

test('parseCheckpointEvery: 0 / abc / -5 / 2.5 -> 100 with a WARN line', () => {
  for (const bad of ['0', 'abc', '-5', '2.5']) {
    const r = mitStillemLog(() => parseCheckpointEvery(bad));
    assert.strictEqual(r.wert, 100, `'${bad}' must fall back to 100`);
    assert.ok(r.zeilen.some(z => /\[WARN\]/.test(z) && z.includes('PRICE_CHECKPOINT_BATCHES')),
      `'${bad}' must emit a WARN naming PRICE_CHECKPOINT_BATCHES, got: ${JSON.stringify(r.zeilen)}`);
  }
});
