'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'merge-shard-manifests.js');
const {
  mergeManifests,
  parseExpectedShards,
  resolveExpectedShards,
} = require(SCRIPT);

const shard = () => ({
  n_ok: 1,
  n_full: 1,
  n_priceonly: 0,
  n_failed: 0,
  partial: false,
});

test('omitted expected count includes unreadable manifest slots', () => {
  const merged = mergeManifests([shard(), null], 100);
  assert.equal(merged.n_shards_present, 1);
  assert.equal(merged.n_shards_expected, 2);
  assert.equal(merged.partial, true);
});

test('omitted expected count keeps a complete input complete', () => {
  const merged = mergeManifests([shard(), shard()], 100);
  assert.equal(merged.n_shards_present, 2);
  assert.equal(merged.n_shards_expected, 2);
  assert.equal(merged.partial, false);
});

test('only explicit Boolean false proves a present shard complete', () => {
  const cases = [
    ['Boolean true', true],
    ['string true', 'true'],
    ['string false', 'false'],
    ['number one', 1],
    ['number zero', 0],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['array', []],
  ];

  for (const [label, value] of cases) {
    const manifest = shard();
    manifest.partial = value;
    const merged = mergeManifests([manifest], 100, 1);
    assert.equal(merged.partial, true, label + ' must fail closed');
    assert.equal(merged.n_shards_partial, 1, label + ' must count as a partial shard');
    assert.equal(merged.n_shards_present, 1, label + ' must remain a present shard');
    assert.equal(merged.n_ok, 1, label + ' must not discard otherwise usable counts');
  }

  const missing = shard();
  delete missing.partial;
  const mergedMissing = mergeManifests([missing], 100, 1);
  assert.equal(mergedMissing.partial, true);
  assert.equal(mergedMissing.n_shards_partial, 1);
  assert.equal(mergedMissing.n_shards_present, 1);
  assert.equal(mergedMissing.n_ok, 1);

  const malformed = shard();
  malformed.partial = 'true';
  const mixed = mergeManifests([shard(), malformed], 100, 2);
  assert.equal(mixed.partial, true);
  assert.equal(mixed.n_shards_partial, 1);
  assert.equal(mixed.n_shards_present, 2);
  assert.equal(mixed.n_ok, 2);
});

test('non-object missing slots stay distinct from malformed present partial flags', () => {
  const merged = mergeManifests([shard(), null], 100, 2);
  assert.equal(merged.partial, true);
  assert.equal(merged.n_shards_present, 1);
  assert.equal(merged.n_shards_partial, 0);
});

test('explicit expected count still exposes completely absent shards', () => {
  const merged = mergeManifests([shard(), null], 100, 3);
  assert.equal(merged.n_shards_present, 1);
  assert.equal(merged.n_shards_expected, 3);
  assert.equal(merged.partial, true);
});

test('invalid direct expected counts fail closed', () => {
  for (const invalid of [null, 0, -1, 1.5, NaN, Infinity, '2']) {
    assert.throws(
      () => resolveExpectedShards([shard()], invalid),
      /positive integer/,
      `expectedShards=${String(invalid)} must be rejected`,
    );
  }
});

test('explicit expected count cannot be smaller than observed slots', () => {
  assert.throws(
    () => mergeManifests([shard(), shard()], 100, 1),
    /smaller than 2 observed manifest slots/,
  );
});

test('CLI expected-shards parser accepts only strict positive integers', () => {
  assert.equal(parseExpectedShards(['node', SCRIPT]), undefined);
  assert.equal(parseExpectedShards(['node', SCRIPT, '--expected-shards', '17']), 17);

  for (const args of [
    ['--expected-shards'],
    ['--expected-shards', '0'],
    ['--expected-shards', '-1'],
    ['--expected-shards', '1.5'],
    ['--expected-shards', '17junk'],
    ['--expected-shards', '9007199254740992'],
  ]) {
    assert.throws(() => parseExpectedShards(['node', SCRIPT, ...args]), /positive integer/);
  }

  assert.throws(
    () => parseExpectedShards([
      'node',
      SCRIPT,
      '--expected-shards',
      '1',
      '--expected-shards',
      '17',
    ]),
    /must not be repeated/,
  );
});

test('CLI rejects an invalid expected count before reading inputs', () => {
  for (const invalid of ['0', '1.5', '17junk']) {
    const run = spawnSync(process.execPath, [SCRIPT, '--expected-shards', invalid], { encoding: 'utf8' });
    assert.equal(run.status, 1, `invalid value ${invalid} must fail`);
    assert.match(run.stderr, /::error::merge-shard-manifests/);
    assert.match(run.stderr, /positive integer/);
  }

  const duplicate = spawnSync(process.execPath, [
    SCRIPT,
    '--expected-shards',
    '1',
    '--expected-shards',
    '17',
  ], { encoding: 'utf8' });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /must not be repeated/);
});
