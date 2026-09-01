'use strict';

/**
 * HARDENING-H18R: coverage-gate counter integrity, grounded in producer output.
 *
 * The three production tuples below come from the current local manifest and two
 * committed manifests. They are regression evidence, not invented partitions.
 * Requiring coverage-gate.js is side-effect free; this test performs no I/O.
 *
 * Run: node tests/coverage-gate-count-integrity.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  manifestNumbersSane,
  classify,
  buildMarker,
  validateMarker,
} = require('../scripts/coverage-gate.js');

const WATCHLIST_SIZE = 10_000;
const HEALTHY_FILE_COUNT = 6_500;
const FALLBACK_SOURCE = 'file-count/watchlist-denom';

// snapshots/_manifest.json observed 2026-09-01. Its attempt ledger is not an
// addressable partition: 15044 + 1582 = 16626, legitimately 23 above 16603.
const CURRENT_PRODUCTION = Object.freeze({
  n_total: 20_762,
  n_ok: 15_044,
  n_full: 829,
  n_priceonly: 14_215,
  n_skipped_mcap: 3_669,
  n_skipped_owned: 490,
  n_addressable: 16_603,
  n_failed: 1_582,
  partial: false,
  n_shard_collisions: 0,
});

// fe6d6ac1738695de5700178425ddd3b06e438b50: shard sums contain
// three duplicate snapshot filenames, so mix = distinct n_ok + collisions.
const COLLISION_PRODUCTION = Object.freeze({
  n_total: 20_932,
  n_ok: 14_907,
  n_full: 358,
  n_priceonly: 14_552,
  n_skipped_mcap: 3_598,
  n_skipped_owned: 506,
  n_addressable: 16_828,
  n_failed: 1_924,
  partial: false,
  n_shard_collisions: 3,
});

// 8ff70815f12da86e7ccd1dc117e98a3fb86ea75b: the producer explicitly
// rejected its owned-adjusted denominator. The warning must degrade visibly and
// suppress >100% honest coverage without discarding otherwise usable counters.
const WARNED_PRODUCTION = Object.freeze({
  n_total: 17_719,
  n_ok: 14_918,
  n_full: 492,
  n_priceonly: 14_426,
  n_skipped_mcap: 3_678,
  n_skipped_owned: 506,
  n_addressable: 14_041,
  n_failed: 1_897,
  partial: false,
  n_shard_collisions: 0,
  _addressable_warnung: 'n_skipped_owned=506 ergibt Nenner 13535 (n_ok=14918) — unplausibel, nutze 14041',
});

// 7d6ea7f23fe5d7b4d05793994986124fc2c78389 predates both owned and
// addressable fields, but already carries the merge collision discriminator.
const LEGACY_COLLISION_PRODUCTION = Object.freeze({
  n_total: 23_689,
  n_ok: 6_088,
  n_full: 192,
  n_priceonly: 5_897,
  n_skipped_mcap: 13_352,
  n_failed: 4_248,
  partial: false,
  n_shard_collisions: 1,
});

function healthyManifest(overrides = {}) {
  return {
    n_ok: 6_500,
    n_total: 10_000,
    n_failed: 100,
    n_full: 6_000,
    n_priceonly: 500,
    n_addressable: 6_800,
    n_skipped_mcap: 3_000,
    n_skipped_owned: 200,
    n_shard_collisions: 0,
    partial: false,
    ...overrides,
  };
}

function assertRejectedToVisibleFallback(manifest, label) {
  assert.equal(manifestNumbersSane(manifest), false, `${label}: manifest must be rejected`);
  const result = classify(manifest, WATCHLIST_SIZE, HEALTHY_FILE_COUNT);
  assert.equal(result.source, FALLBACK_SOURCE, `${label}: impossible counts must lose manifest authority`);
  assert.equal(result.status, 'degradiert', `${label}: healthy raw files may degrade, never certify ok`);
}

test('real current producer tuple remains authoritative despite overlapping attempt counts', () => {
  assert.ok(CURRENT_PRODUCTION.n_ok + CURRENT_PRODUCTION.n_failed > CURRENT_PRODUCTION.n_addressable,
    'tripwire: the real tuple must contradict the rejected Tag 1134 assumption');
  assert.equal(manifestNumbersSane(CURRENT_PRODUCTION), true);
  const result = classify(CURRENT_PRODUCTION, 0, 0);
  assert.equal(result.source, 'manifest');
  assert.equal(result.status, 'ok');
  const marker = buildMarker(result, CURRENT_PRODUCTION);
  assert.deepEqual(validateMarker(marker), []);
  assert.equal(marker.n_shard_collisions, 0);
  assert.equal(marker.n_skipped_mcap, CURRENT_PRODUCTION.n_skipped_mcap);
  assert.equal(marker.n_skipped_owned, CURRENT_PRODUCTION.n_skipped_owned);
});

test('real collision tuple reconciles pull mix against distinct files plus collisions', () => {
  assert.equal(COLLISION_PRODUCTION.n_full + COLLISION_PRODUCTION.n_priceonly,
    COLLISION_PRODUCTION.n_ok + COLLISION_PRODUCTION.n_shard_collisions,
    'tripwire: production collision identity');
  assert.equal(manifestNumbersSane(COLLISION_PRODUCTION), true);
  const result = classify(COLLISION_PRODUCTION, 0, 0);
  assert.equal(result.source, 'manifest');
  const marker = buildMarker(result, COLLISION_PRODUCTION);
  assert.equal(marker.n_shard_collisions, 3);
  assert.deepEqual(validateMarker(marker), []);

  assertRejectedToVisibleFallback(
    { ...COLLISION_PRODUCTION, n_priceonly: COLLISION_PRODUCTION.n_priceonly - 1 },
    'collision-adjusted mix mismatch',
  );
  assertRejectedToVisibleFallback(
    { ...COLLISION_PRODUCTION, n_priceonly: COLLISION_PRODUCTION.n_priceonly + 1 },
    'collision-adjusted mix excess',
  );
});

test('real addressable warning degrades without publishing impossible honest coverage', () => {
  assert.ok(WARNED_PRODUCTION.n_ok > WARNED_PRODUCTION.n_addressable,
    'tripwire: warned producer fallback remains below distinct files');
  assert.equal(manifestNumbersSane(WARNED_PRODUCTION), true);
  const result = classify(WARNED_PRODUCTION, 0, 0);
  assert.equal(result.source, 'manifest', 'the other producer counters remain usable');
  assert.equal(result.status, 'degradiert', 'producer warning must remain visible');
  assert.equal(result.n_addressable, null, 'warned denominator must not drive coverage');
  assert.equal(result.honest_coverage_pct, null, 'warned denominator must not publish >100%');
  assert.ok(result.reasons.includes(
    `manifest _addressable_warnung: ${WARNED_PRODUCTION._addressable_warnung}`,
  ), 'the complete producer warning must survive classification');
  const marker = buildMarker(result, WARNED_PRODUCTION);
  assert.equal(marker.manifest_addressable_warning, true);
  assert.deepEqual(validateMarker(marker), []);

  const silentlyImpossible = { ...WARNED_PRODUCTION };
  delete silentlyImpossible._addressable_warnung;
  assertRejectedToVisibleFallback(silentlyImpossible, 'addressable below n_ok without warning');
});

test('addressable warning must be an explicit nonempty producer signal', () => {
  for (const bad of ['', '   ', true, 1, {}, []]) {
    assertRejectedToVisibleFallback(
      { ...WARNED_PRODUCTION, _addressable_warnung: bad },
      `malformed warning ${JSON.stringify(bad)}`,
    );
  }
  const withoutDenominator = { ...WARNED_PRODUCTION };
  delete withoutDenominator.n_addressable;
  assertRejectedToVisibleFallback(withoutDenominator, 'warning without reported denominator');
});

test('explicit addressable denominator must match the producing path exactly', () => {
  const merged = healthyManifest();
  assert.equal(manifestNumbersSane(merged), true, 'merged producer formula is valid');

  const direct = healthyManifest({ n_addressable: 7_000 });
  delete direct.n_shard_collisions;
  assert.equal(manifestNumbersSane(direct), true, 'direct producer formula is valid');

  assertRejectedToVisibleFallback(
    healthyManifest({ n_ok: 6_100, n_full: 6_000, n_priceonly: 100, n_addressable: 6_100 }),
    'fabricated merged denominator',
  );
  assertRejectedToVisibleFallback(
    { ...direct, n_addressable: 6_800 },
    'direct manifest must not subtract already-filtered owned tickers twice',
  );
  assertRejectedToVisibleFallback(
    { ...WARNED_PRODUCTION, n_addressable: WARNED_PRODUCTION.n_addressable - 1 },
    'warned fallback denominator must still equal total minus mcap skips',
  );
  assertRejectedToVisibleFallback(
    { ...WARNED_PRODUCTION, n_shard_collisions: null },
    'addressable warning without merge discriminator',
  );
  assertRejectedToVisibleFallback(
    { ...WARNED_PRODUCTION, n_skipped_owned: null },
    'addressable warning without owned-skip evidence',
  );

  const directMarker = buildMarker(classify(direct, WATCHLIST_SIZE, 0), direct);
  assert.notDeepEqual(validateMarker({
    ...directMarker,
    n_addressable: 6_800,
    honest_coverage_pct: 95.6,
  }), [], 'internally consistent but producer-impossible direct denominator must fail');

  const mergedMarker = buildMarker(classify(merged, WATCHLIST_SIZE, 0), merged);
  assert.notDeepEqual(validateMarker({
    ...mergedMarker,
    n_ok: 6_100,
    n_full: 6_000,
    n_priceonly: 100,
    coverage_pct: 61,
    n_addressable: 6_100,
    honest_coverage_pct: 100,
  }), [], 'internally consistent but producer-impossible merged denominator must fail');
});

test('healthy modern and independently-denominated legacy manifests retain authority', () => {
  const modern = healthyManifest();
  assert.equal(manifestNumbersSane(modern), true);
  const modernResult = classify(modern, WATCHLIST_SIZE, 0);
  assert.equal(modernResult.source, 'manifest');
  assert.equal(modernResult.status, 'ok');
  assert.deepEqual(validateMarker(buildMarker(modernResult, modern)), []);

  const legacy = { n_ok: 6_500, partial: false };
  assert.equal(manifestNumbersSane(legacy), true);
  const legacyResult = classify(legacy, WATCHLIST_SIZE, 0);
  assert.equal(legacyResult.source, 'manifest');
  assert.equal(legacyResult.n_total, WATCHLIST_SIZE);
  assert.equal(legacyResult.status, 'ok');

  const nullTotal = classify({ ...legacy, n_total: null }, WATCHLIST_SIZE, 0);
  assert.equal(nullTotal.source, 'manifest');
  assert.equal(nullTotal.n_total, WATCHLIST_SIZE);

  assert.equal(manifestNumbersSane(LEGACY_COLLISION_PRODUCTION), true);
  const legacyCollisionResult = classify(LEGACY_COLLISION_PRODUCTION, 0, 0);
  assert.equal(legacyCollisionResult.source, 'manifest');
  assert.deepEqual(
    validateMarker(buildMarker(legacyCollisionResult, LEGACY_COLLISION_PRODUCTION)),
    [],
  );

  const directCheckpoint = healthyManifest({
    n_addressable: null,
    n_shard_collisions: null,
    partial: true,
  });
  assert.equal(manifestNumbersSane(directCheckpoint), true);
  const checkpointResult = classify(directCheckpoint, WATCHLIST_SIZE, 0);
  assert.equal(checkpointResult.source, 'manifest');
  assert.equal(checkpointResult.n_addressable, 7_000);
  assert.deepEqual(validateMarker(buildMarker(checkpointResult, directCheckpoint)), []);

  assertRejectedToVisibleFallback(
    healthyManifest({ n_addressable: null }),
    'owned-aware merge missing its explicit denominator',
  );
});

test('missing or null optional counters remain compatible', () => {
  for (const field of [
    'n_failed', 'n_full', 'n_priceonly', 'n_addressable', 'n_skipped_mcap',
    'n_skipped_owned', 'n_shard_collisions',
  ]) {
    const missing = healthyManifest();
    delete missing[field];
    const nullish = healthyManifest({ [field]: null });
    for (const manifest of [missing, nullish]) {
      if (field === 'n_addressable' || field === 'n_skipped_mcap') {
        manifest.n_addressable = null;
        manifest.n_shard_collisions = null;
      }
      if (field === 'n_skipped_owned' || field === 'n_shard_collisions') {
        manifest.n_addressable = 7_000;
      }
      assert.equal(manifestNumbersSane(manifest), true,
        `${field}: missing/null legacy form must remain valid`);
    }
  }
});

test('partial must be boolean when present but remains optional for legacy manifests', () => {
  for (const partial of [undefined, null, false, true]) {
    assert.equal(manifestNumbersSane(healthyManifest({ partial })), true,
      `partial=${String(partial)} must remain compatible`);
  }
  for (const bad of ['true', 1, 0, {}, [], Symbol('partial')]) {
    assertRejectedToVisibleFallback(
      healthyManifest({ partial: bad }),
      `partial=${String(bad)}`,
    );
  }
});

test('n_skipped_owned is a count but not bounded by already-filtered n_total', () => {
  const direct = healthyManifest({ n_skipped_owned: 12_000, n_addressable: 7_000 });
  delete direct.n_shard_collisions;
  assert.equal(manifestNumbersSane(direct), true);
});

test('manifest container must be a non-array object', () => {
  const array = Object.assign([], healthyManifest());
  assert.equal(manifestNumbersSane(array), false);
  for (const hostile of [null, undefined, 1, 'manifest', true]) {
    assert.equal(manifestNumbersSane(hostile), false);
  }
});

for (const field of [
  'n_ok', 'n_total', 'n_failed', 'n_full', 'n_priceonly', 'n_addressable',
  'n_skipped_mcap', 'n_skipped_owned', 'n_shard_collisions',
]) {
  test(`${field} rejects non-count numeric domains`, () => {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '6500', true]) {
      const minimal = { n_ok: 1, n_total: 10, partial: false, [field]: bad };
      if (field === 'n_ok') delete minimal.n_total;
      if (field === 'n_full') minimal.n_priceonly = null;
      if (field === 'n_priceonly') minimal.n_full = null;
      assertRejectedToVisibleFallback(minimal, `${field}=${String(bad)}`);
    }
  });
}

test('manifest rejects impossible total, addressable, and mcap relations', () => {
  const impossible = [
    ['n_total=0', healthyManifest({ n_total: 0 })],
    ['n_ok exceeds n_total', healthyManifest({ n_ok: 10_001, n_full: null, n_priceonly: null })],
    ['addressable below n_ok', healthyManifest({ n_addressable: 1 })],
    ['addressable above n_total', healthyManifest({ n_addressable: 10_001, n_skipped_mcap: null })],
    ['mcap skips exceed n_total', healthyManifest({ n_skipped_mcap: 20_000, n_addressable: null })],
    ['mcap skips alone exceed n_total', { n_ok: 0, n_total: 100, n_skipped_mcap: 101, partial: false }],
    ['mcap fallback below n_ok', healthyManifest({ n_skipped_mcap: 9_500, n_addressable: null })],
    ['addressable above total minus mcap', healthyManifest({ n_addressable: 7_001 })],
  ];
  for (const [label, manifest] of impossible) assertRejectedToVisibleFallback(manifest, label);
});

test('n_failed is an independent attempt ledger, not an addressable partition', () => {
  const overlap = healthyManifest({ n_failed: 10_000 });
  assert.equal(manifestNumbersSane(overlap), true);
  assert.equal(classify(overlap, WATCHLIST_SIZE, 0).source, 'manifest');
  assertRejectedToVisibleFallback({
    n_ok: Number.MAX_SAFE_INTEGER,
    n_total: Number.MAX_SAFE_INTEGER,
    n_failed: 1,
    partial: false,
  }, 'n_ok+n_failed arithmetic overflow');
});

test('legacy manifest cannot use file count as a self-certifying denominator', () => {
  for (const nTotal of [undefined, null]) {
    const manifest = { n_ok: 6_500, partial: false };
    if (nTotal === null) manifest.n_total = null;
    const withFiles = classify(manifest, 0, HEALTHY_FILE_COUNT);
    assert.equal(withFiles.source, FALLBACK_SOURCE);
    assert.equal(withFiles.status, 'degradiert');
    assert.equal(classify(manifest, 0, 0).status, 'katastrophal');
  }
});

test('legacy mcap skip uses the measured watchlist denominator', () => {
  const legacy = { n_ok: 6_000, n_failed: 100, n_skipped_mcap: 3_000, partial: false };
  const result = classify(legacy, WATCHLIST_SIZE, 0);
  assert.equal(result.source, 'manifest');
  assert.equal(result.n_addressable, 7_000);
  assert.equal(result.honest_coverage_pct, 85.7);
  assert.equal(result.status, 'degradiert');
});

test('pull mix checks are collision-aware and overflow-safe', () => {
  assertRejectedToVisibleFallback(healthyManifest({ n_full: 6_001 }), 'legacy mix above n_ok');
  assertRejectedToVisibleFallback(healthyManifest({ n_full: 5_999 }), 'legacy mix below n_ok');
  assertRejectedToVisibleFallback(
    healthyManifest({ n_full: 6_501, n_priceonly: null }),
    'n_full alone exceeds collision-adjusted successes',
  );
  assertRejectedToVisibleFallback(
    healthyManifest({ n_full: null, n_priceonly: 6_501 }),
    'n_priceonly alone exceeds collision-adjusted successes',
  );
  assert.equal(manifestNumbersSane(healthyManifest({
    n_full: 6_001, n_priceonly: 500, n_shard_collisions: 1,
  })), true, 'one collision explains the one-row excess');

  const atCollisionLimit = healthyManifest({
    n_full: 6_000,
    n_priceonly: 550,
    n_shard_collisions: 50,
  });
  assert.equal(manifestNumbersSane(atCollisionLimit), true,
    'producer collision hard limit is inclusive');
  assertRejectedToVisibleFallback({
    ...atCollisionLimit,
    n_priceonly: 551,
    n_shard_collisions: 51,
  }, 'collision count above producer hard limit');
  assertRejectedToVisibleFallback({
    n_ok: Number.MAX_SAFE_INTEGER,
    n_total: Number.MAX_SAFE_INTEGER,
    n_full: Number.MAX_SAFE_INTEGER,
    n_priceonly: 1,
    partial: false,
  }, 'mix addition overflow');
  assertRejectedToVisibleFallback({
    n_ok: Number.MAX_SAFE_INTEGER,
    n_total: Number.MAX_SAFE_INTEGER,
    n_full: null,
    n_priceonly: null,
    n_shard_collisions: 1,
    partial: false,
  }, 'collision-adjusted n_ok overflow');
});

test('invalid manifest yields a sanitized, publishable degradation marker', () => {
  const invalid = healthyManifest({ n_addressable: 1, partial: true });
  const result = classify(invalid, WATCHLIST_SIZE, HEALTHY_FILE_COUNT);
  const marker = buildMarker(result, invalid);
  assert.equal(result.status, 'degradiert');
  assert.equal(result.source, FALLBACK_SOURCE);
  for (const field of [
    'n_addressable', 'n_full', 'n_priceonly', 'n_shard_collisions',
    'n_skipped_mcap', 'n_skipped_owned',
  ]) assert.equal(marker[field], null, `${field} must not leak from rejected input`);
  assert.equal(marker.manifest_partial, false);
  assert.deepEqual(validateMarker(marker), []);

  const invalidWarned = { ...WARNED_PRODUCTION, partial: 'false' };
  const invalidWarnedResult = classify(invalidWarned, WATCHLIST_SIZE, HEALTHY_FILE_COUNT);
  const invalidWarnedMarker = buildMarker(invalidWarnedResult, invalidWarned);
  assert.equal(invalidWarnedResult.source, FALLBACK_SOURCE);
  assert.equal(invalidWarnedMarker.manifest_addressable_warning, false,
    'rejected raw warning must not leak into a fallback marker');
  assert.deepEqual(validateMarker(invalidWarnedMarker), []);

  // A legacy manifest can be structurally sane against the fallback's file count
  // while still lacking an independent denominator. `source`, not a second parse,
  // is what proves that its optional fields remain untrusted.
  const untrustedLegacy = {
    n_ok: HEALTHY_FILE_COUNT,
    n_full: 6_000,
    n_priceonly: 500,
    n_skipped_owned: 200,
    partial: true,
  };
  const legacyResult = classify(untrustedLegacy, 0, HEALTHY_FILE_COUNT);
  const legacyMarker = buildMarker(legacyResult, untrustedLegacy);
  assert.equal(legacyResult.source, FALLBACK_SOURCE);
  assert.equal(legacyMarker.n_full, null, 'file-count fallback must not re-trust legacy mix');
  assert.equal(legacyMarker.n_priceonly, null);
  assert.equal(legacyMarker.n_skipped_owned, null);
  assert.equal(legacyMarker.manifest_partial, false);
  assert.deepEqual(validateMarker(legacyMarker), []);
});

test('validateMarker rejects hostile count domains without throwing', () => {
  const manifest = healthyManifest();
  const valid = buildMarker(classify(manifest, WATCHLIST_SIZE, 0), manifest);
  assert.deepEqual(validateMarker(valid), []);
  for (const [field, bad] of [
    ['n_ok', 6_500.5], ['n_total', Number.MAX_SAFE_INTEGER + 1], ['n_full', -1],
    ['n_priceonly', '500'], ['n_shard_collisions', Infinity],
    ['n_addressable', Infinity], ['n_skipped_mcap', NaN], ['n_skipped_owned', -1],
  ]) {
    assert.notDeepEqual(validateMarker({ ...valid, [field]: bad }), [],
      `${field}=${String(bad)} must violate the marker contract`);
  }
  for (const field of ['schema', 'status', 'n_ok', 'n_total']) {
    const hostile = { ...valid, [field]: Symbol('hostile') };
    assert.doesNotThrow(() => validateMarker(hostile), `${field}: validator must report, not throw`);
    assert.notDeepEqual(validateMarker(hostile), []);
  }
});

test('validateMarker pins derived percentages and producer-backed relations', () => {
  const valid = buildMarker(classify(healthyManifest(), WATCHLIST_SIZE, 0), healthyManifest());
  const cases = [
    ['coverage above 100', { coverage_pct: 100.1 }],
    ['coverage disagrees with counts', { coverage_pct: 64.9 }],
    ['negative honest coverage', { honest_coverage_pct: -0.1 }],
    ['honest coverage disagrees', { honest_coverage_pct: 92.8 }],
    ['honest coverage missing', { honest_coverage_pct: null }],
    ['honest coverage without addressable', { n_addressable: null }],
    ['n_ok above n_total', { n_ok: 10_001 }],
    ['addressable below n_ok', { n_addressable: 1 }],
    ['addressable above total minus mcap', { n_addressable: 7_001 }],
    ['mcap skips above total', { n_skipped_mcap: 10_001 }],
    ['collision-aware mix mismatch', { n_full: 6_001 }],
    ['warning flag wrong type', { manifest_addressable_warning: 'yes' }],
  ];
  for (const [label, patch] of cases) {
    assert.notDeepEqual(validateMarker({ ...valid, ...patch }), [], `${label} must be rejected`);
  }

  const isolatedMcapOverflow = {
    ...valid,
    n_ok: 0,
    n_total: 100,
    n_full: null,
    n_priceonly: null,
    n_shard_collisions: 0,
    coverage_pct: 0,
    n_addressable: null,
    honest_coverage_pct: null,
    n_skipped_mcap: 101,
    manifest_addressable_warning: true,
    status: 'degradiert',
    degraded: true,
    reasons: ['manifest _addressable_warnung: isolated ceiling fixture'],
  };
  assert.notDeepEqual(validateMarker(isolatedMcapOverflow), [],
    'mcap skips above total must fail without another denominator relation');

  const overflowMarker = {
    ...valid,
    n_ok: Number.MAX_SAFE_INTEGER,
    n_total: Number.MAX_SAFE_INTEGER,
    n_full: null,
    n_priceonly: null,
    n_shard_collisions: 1,
    coverage_pct: 100,
    n_addressable: Number.MAX_SAFE_INTEGER,
    honest_coverage_pct: 100,
    n_skipped_mcap: 0,
    n_skipped_owned: 0,
  };
  assert.notDeepEqual(validateMarker(overflowMarker), [],
    'collision-adjusted success addition must stay inside safe integer range');

  const atCollisionLimit = healthyManifest({
    n_full: 6_000,
    n_priceonly: 550,
    n_shard_collisions: 50,
  });
  const limitMarker = buildMarker(classify(atCollisionLimit, WATCHLIST_SIZE, 0), atCollisionLimit);
  assert.deepEqual(validateMarker(limitMarker), []);
  assert.notDeepEqual(validateMarker({
    ...limitMarker,
    n_priceonly: 551,
    n_shard_collisions: 51,
  }), [], 'marker must mirror the producer collision hard limit');

  const collisionMarker = buildMarker(
    classify(COLLISION_PRODUCTION, 0, 0), COLLISION_PRODUCTION,
  );
  assert.deepEqual(validateMarker(collisionMarker), []);
  assert.notDeepEqual(validateMarker({ ...collisionMarker, n_shard_collisions: 2 }), []);

  const warnedMarker = buildMarker(
    classify(WARNED_PRODUCTION, 0, 0), WARNED_PRODUCTION,
  );
  assert.notDeepEqual(validateMarker({ ...warnedMarker, n_addressable: 14_041 }), [],
    'a warned denominator must stay suppressed');
  assert.notDeepEqual(validateMarker({ ...warnedMarker, honest_coverage_pct: 106.2 }), [],
    'warned honest coverage must stay suppressed');
  assert.notDeepEqual(validateMarker({ ...warnedMarker, status: 'ok', degraded: false }), [],
    'an addressable warning must never coexist with an ok marker');
  assert.notDeepEqual(validateMarker({ ...warnedMarker, n_shard_collisions: null }), [],
    'an addressable warning must retain its merge discriminator');
  assert.notDeepEqual(validateMarker({ ...warnedMarker, n_skipped_mcap: null }), [],
    'an addressable warning must retain its mcap input');
  assert.notDeepEqual(validateMarker({ ...warnedMarker, n_skipped_owned: null }), [],
    'an addressable warning must retain its owned-skip input');
  const currentMarker = buildMarker(
    classify(CURRENT_PRODUCTION, 0, 0), CURRENT_PRODUCTION,
  );
  assert.notDeepEqual(validateMarker({ ...currentMarker, n_skipped_mcap: null }), [],
    'an explicit addressable denominator requires its mcap input');
  assert.notDeepEqual(validateMarker({
    ...currentMarker,
    n_addressable: null,
    honest_coverage_pct: null,
  }), [], 'a measurable honest denominator and percentage cannot both disappear');

  const catastrophicManifest = healthyManifest({
    n_ok: 100,
    n_full: 100,
    n_priceonly: 0,
  });
  const catastrophicMarker = buildMarker(
    classify(catastrophicManifest, WATCHLIST_SIZE, 0), catastrophicManifest,
  );
  assert.equal(catastrophicMarker.status, 'katastrophal');
  assert.equal(catastrophicMarker.n_addressable, null,
    'hard-floor early return does not compute the honest denominator');
  assert.deepEqual(validateMarker(catastrophicMarker), [],
    'catastrophic early-return marker remains publishable while deploy is blocked');
});
