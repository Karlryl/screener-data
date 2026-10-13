'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');

function valid(overrides = {}) {
  return {
    n_ok: 2,
    n_full: 1,
    n_priceonly: 1,
    n_failed: 0,
    n_skipped_mcap: 0,
    n_skipped_owned: 0,
    n_ccy_missing_completely: 0,
    partial: false,
    watchlist_version: 'schema-test',
    ...overrides,
  };
}

function assertQuarantined(manifest, message) {
  const merged = mergeManifests([manifest], 100, 1);
  assert.equal(merged.n_ok, 0, message);
  assert.equal(merged.n_full, 0, message);
  assert.equal(merged.n_priceonly, 0, message);
  assert.equal(merged.n_failed, 0, message);
  assert.equal(merged.n_skipped_mcap, 0, message);
  assert.equal(merged.n_skipped_owned, 0, message);
  assert.equal(merged.n_ccy_missing_completely, 0, message);
  assert.equal(merged.n_addressable, 100, message);
  assert.equal(merged.n_shards_present, 1, message);
  assert.equal(merged.n_shards_valid, 0, message);
  assert.equal(merged.n_shards_invalid, 1, message);
  assert.equal(merged.partial, true, message);
}

test('valid zero and current-schema manifests remain complete', () => {
  const zero = valid({
    n_ok: 0,
    n_full: 0,
    n_priceonly: 0,
    watchlist_version: 'zero',
  });
  const current = valid({
    n_ok: 7,
    n_full: 4,
    n_priceonly: 3,
    n_failed: 2,
    n_skipped_mcap: 5,
    n_skipped_owned: 6,
    n_ccy_missing_completely: 1,
  });

  for (const manifest of [zero, current]) {
    const merged = mergeManifests([manifest], 100, 1);
    assert.equal(merged.n_ok, manifest.n_ok);
    assert.equal(merged.n_full, manifest.n_full);
    assert.equal(merged.n_priceonly, manifest.n_priceonly);
    assert.equal(merged.n_failed, manifest.n_failed);
    assert.equal(merged.n_skipped_mcap, manifest.n_skipped_mcap);
    assert.equal(merged.n_skipped_owned, manifest.n_skipped_owned);
    assert.equal(merged.n_ccy_missing_completely, manifest.n_ccy_missing_completely);
    assert.equal(
      merged.n_addressable,
      100 - manifest.n_skipped_mcap - manifest.n_skipped_owned,
    );
    assert.equal(merged.n_shards_present, 1);
    assert.equal(merged.n_shards_valid, 1);
    assert.equal(merged.n_shards_invalid, 0);
    assert.equal(merged.partial, false);
  }
});

test('missing optional diagnostic counters remain backward compatible', () => {
  const manifest = valid();
  delete manifest.n_skipped_mcap;
  delete manifest.n_skipped_owned;
  delete manifest.n_ccy_missing_completely;

  const merged = mergeManifests([manifest], 100, 1);
  assert.equal(merged.n_shards_valid, 1);
  assert.equal(merged.n_shards_invalid, 0);
  assert.equal(merged.partial, false);
  assert.equal(merged.n_skipped_mcap, 0);
  assert.equal(merged.n_skipped_owned, 0);
  assert.equal(merged.n_ccy_missing_completely, 0);
});

test('plain objects with a null prototype are valid manifest containers', () => {
  const manifest = Object.assign(Object.create(null), valid());
  const merged = mergeManifests([manifest], 100, 1);
  assert.equal(merged.n_shards_valid, 1);
  assert.equal(merged.n_shards_invalid, 0);
  assert.equal(merged.partial, false);
});

test('non-object and non-plain roots are observed but quarantined', () => {
  class ManifestRecord {}
  const invalidRoots = [
    ['array with valid counters', Object.assign([], valid())],
    ['string', 'manifest'],
    ['number', 7],
    ['boolean', false],
    ['date with valid counters', Object.assign(new Date(0), valid())],
    ['class instance with valid counters', Object.assign(new ManifestRecord(), valid())],
  ];
  for (const [name, root] of invalidRoots) {
    assertQuarantined(root, name);
  }
});

test('null and undefined slots are missing rather than malformed', () => {
  for (const missing of [null, undefined]) {
    const merged = mergeManifests([missing], 100, 1);
    assert.equal(merged.n_shards_present, 0);
    assert.equal(merged.n_shards_valid, 0);
    assert.equal(merged.n_shards_invalid, 0);
    assert.equal(merged.partial, true);
  }
});

test('every required counter rejects missing or unsafe values', () => {
  const invalidValues = [
    ['string', '2'],
    ['null', null],
    ['negative', -1],
    ['fraction', 0.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', NaN],
    ['positive infinity', Infinity],
    ['negative infinity', -Infinity],
    ['object', {}],
    ['array', []],
  ];

  for (const field of ['n_ok', 'n_full', 'n_priceonly', 'n_failed']) {
    const missing = valid();
    delete missing[field];
    assertQuarantined(missing, `${field}: missing`);
    for (const [name, value] of invalidValues) {
      assertQuarantined(valid({ [field]: value }), `${field}: ${name}`);
    }
  }
});

test('present optional counters reject unsafe values', () => {
  const invalidValues = [
    ['undefined', undefined],
    ['string', '0'],
    ['null', null],
    ['negative', -1],
    ['fraction', 0.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', NaN],
    ['positive infinity', Infinity],
    ['negative infinity', -Infinity],
    ['object', {}],
    ['array', []],
  ];

  for (const field of ['n_skipped_mcap', 'n_skipped_owned', 'n_ccy_missing_completely']) {
    for (const [name, value] of invalidValues) {
      assertQuarantined(valid({ [field]: value }), `${field}: ${name}`);
    }
  }
});

test('classification counters must add up to n_ok without overflowing', () => {
  assertQuarantined(valid({ n_ok: 3 }), 'classification mismatch');
  assertQuarantined(valid({
    n_ok: Number.MAX_SAFE_INTEGER,
    n_full: Number.MAX_SAFE_INTEGER,
    n_priceonly: 1,
  }), 'classification overflow');
});

test('counterbalancing invalid shards cannot pass through an aggregate-only check', () => {
  const high = valid({ n_ok: 5, n_full: 5, n_priceonly: 1 });
  const low = valid({ n_ok: 5, n_full: 4, n_priceonly: 0 });
  const merged = mergeManifests([high, low], 100, 2);

  assert.equal(merged.n_ok, 0);
  assert.equal(merged.n_full, 0);
  assert.equal(merged.n_priceonly, 0);
  assert.equal(merged.n_shards_present, 2);
  assert.equal(merged.n_shards_valid, 0);
  assert.equal(merged.n_shards_invalid, 2);
  assert.equal(merged.partial, true);
});

test('aggregate counter overflow stops the merge instead of emitting rounded counts', () => {
  const maxClassified = valid({
    n_ok: Number.MAX_SAFE_INTEGER,
    n_full: Number.MAX_SAFE_INTEGER,
    n_priceonly: 0,
  });
  const oneClassified = valid({ n_ok: 1, n_full: 1, n_priceonly: 0 });
  assert.throws(
    () => mergeManifests([maxClassified, oneClassified], 100, 2),
    /n_ok exceeds the safe integer range/,
  );

  for (const field of [
    'n_failed',
    'n_skipped_mcap',
    'n_skipped_owned',
    'n_ccy_missing_completely',
  ]) {
    assert.throws(
      () => mergeManifests([
        valid({ [field]: Number.MAX_SAFE_INTEGER }),
        valid({ [field]: 1 }),
      ], 100, 2),
      new RegExp(`${field} exceeds the safe integer range`),
      field,
    );
  }
});

test('an invalid sibling cannot inflate sums or report a complete merge', () => {
  const good = valid({
    n_ok: 5,
    n_full: 3,
    n_priceonly: 2,
    n_failed: 1,
    n_skipped_mcap: 3,
    n_skipped_owned: 4,
    n_ccy_missing_completely: 1,
    watchlist_version: 'trusted',
  });
  const bad = valid({
    n_ok: '5000',
    n_full: 3000,
    n_priceonly: 2000,
    n_failed: 9000,
    n_skipped_mcap: 30,
    n_skipped_owned: 40,
    n_ccy_missing_completely: 10,
    watchlist_version: 'untrusted',
  });

  for (const manifests of [[good, bad], [bad, good]]) {
    const merged = mergeManifests(manifests, 100, 2);
    assert.equal(merged.n_ok, 5);
    assert.equal(merged.n_full, 3);
    assert.equal(merged.n_priceonly, 2);
    assert.equal(merged.n_failed, 1);
    assert.equal(merged.n_skipped_mcap, 3);
    assert.equal(merged.n_skipped_owned, 4);
    assert.equal(merged.n_ccy_missing_completely, 1);
    assert.equal(merged.n_addressable, 93);
    assert.equal(merged.watchlist_version, 'trusted');
    assert.equal(merged.n_shards_present, 2);
    assert.equal(merged.n_shards_valid, 1);
    assert.equal(merged.n_shards_invalid, 1);
    assert.equal(merged.partial, true);
  }
});

test('valid, invalid, and missing slots retain distinct accounting', () => {
  const merged = mergeManifests([
    valid(),
    valid({ n_failed: -1 }),
    null,
  ], 100, 3);

  assert.equal(merged.n_shards_expected, 3);
  assert.equal(merged.n_shards_present, 2);
  assert.equal(merged.n_shards_valid, 1);
  assert.equal(merged.n_shards_invalid, 1);
  assert.equal(merged.partial, true);
});

test('two valid siblings preserve a complete merged manifest', () => {
  const merged = mergeManifests([
    valid({
      n_ok: 5,
      n_full: 3,
      n_priceonly: 2,
      n_skipped_mcap: 2,
      n_skipped_owned: 3,
      n_ccy_missing_completely: 4,
    }),
    valid({
      n_ok: 4,
      n_full: 1,
      n_priceonly: 3,
      n_skipped_mcap: 5,
      n_skipped_owned: 6,
      n_ccy_missing_completely: 7,
    }),
  ], 100, 2);

  assert.equal(merged.n_ok, 9);
  assert.equal(merged.n_full, 4);
  assert.equal(merged.n_priceonly, 5);
  assert.equal(merged.n_skipped_mcap, 7);
  assert.equal(merged.n_skipped_owned, 9);
  assert.equal(merged.n_ccy_missing_completely, 11);
  assert.equal(merged.n_shards_present, 2);
  assert.equal(merged.n_shards_valid, 2);
  assert.equal(merged.n_shards_invalid, 0);
  assert.equal(merged.partial, false);
});
