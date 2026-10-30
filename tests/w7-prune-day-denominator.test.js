'use strict';
// W7 (30.10.2026): on a prune day the merged n_total is the pruned list, while the shard skip counters still
// count the pruned rows. Run 41027769596: 19624 - 5099 - 483 = 14042 < n_ok 15817, so the honest coverage came
// out blank and the marker fell back to "coverage counters impossible" text. Numbers below are that run.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');
const { classify, buildMarker, manifestNumbersSane, validateMarker } = require('../scripts/coverage-gate.js');
const { loadCoverage } = require('../scripts/write-findash-export.js');

const shard = (over = {}) => ({
  n_total: 24177, n_ok: 15817, n_full: 3910, n_priceonly: 11746, n_retained: 161, n_failed: 2012,
  n_skipped_mcap: 5099, n_skipped_owned: 483, n_missing_mcap: 1197, partial: false, watchlist_version: '9.0', ...over,
});
const asMerged = (m) => ({ ...m, n_shard_collisions: 0 });

test('prune day: the denominator is the pulled universe, not the pruned list', () => {
  const m = mergeManifests([shard()], 19624, 1);
  assert.equal(m.n_total, 19624, 'n_total keeps meaning the current list');
  assert.equal(m.n_pulled_universe, 24660);
  assert.equal(m.n_addressable, 19078);
  assert.equal(m._addressable_warnung, undefined);
});

test('prune day: the gate reports the honest coverage and keeps its 90 % alarm', () => {
  const m = asMerged(mergeManifests([shard()], 19624, 1));
  assert.equal(manifestNumbersSane(m, 19624), true);
  const res = classify(m, 19624, 15899);
  assert.equal(res.source, 'manifest');
  assert.equal(res.n_addressable, 19078);
  assert.equal(res.honest_coverage_pct, 82.9);
  assert.equal(res.status, 'degradiert');
  assert.match(res.reasons.join(' '), /honest-coverage 82\.9% < 90%/);
  const marker = buildMarker(res, m);
  assert.deepEqual(validateMarker(marker), []);
  assert.equal(marker.coverage_pct, 80.6);
  assert.equal(marker.honest_coverage_pct, 82.9);
  assert.equal(marker.n_failed, 2012);
  assert.equal(marker.n_pulled_universe, 24660);
});

test('ordinary day: pulled universe equals the list, the result does not move', () => {
  const m = mergeManifests([shard()], 24660, 1);
  assert.equal(m.n_addressable, 19078);
  assert.equal(classify(asMerged(m), 24660, 15899).honest_coverage_pct, 82.9);
});

test('old shard manifests without n_total keep the old path and its warning', () => {
  const { n_total, ...legacy } = shard();
  const m = mergeManifests([legacy], 19624, 1);
  assert.equal(m.n_pulled_universe, undefined);
  assert.equal(m.n_addressable, 14525);
  assert.match(m._addressable_warnung, /unplausibel/);
});

test('a missing shard never certifies a pulled universe', () => {
  const m = mergeManifests([shard(), null], 19624, 2);
  assert.equal(m.n_pulled_universe, undefined);
  assert.equal(m.partial, true);
});

test('a pulled universe below n_total is impossible and is not trusted as a smaller denominator', () => {
  const m = asMerged(mergeManifests([shard()], 19624, 1));
  assert.equal(manifestNumbersSane({ ...m, n_pulled_universe: 19000 }, 19624), false);
  assert.equal(manifestNumbersSane({ ...m, n_pulled_universe: 'x' }, 19624), false);
});

test('export: the honest pair travels next to coverage_pct, null when the marker lacks it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-coverage-'));
  const file = path.join(dir, 'coverage-status.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ status: 'degradiert', degraded: true, blocked: false, coverage_pct: 80.6,
      generated_at: '2026-10-30T10:03:11.796Z', honest_coverage_pct: 82.9, n_addressable: 19078, n_ok: 15817, n_total: 19624, n_failed: 2012 }));
    const c = loadCoverage(file);
    assert.equal(c.coverage_pct, 80.6);
    assert.equal(c.honest_coverage_pct, 82.9);
    assert.equal(c.n_addressable, 19078);
    assert.equal(c.n_failed, 2012);
    fs.writeFileSync(file, JSON.stringify({ status: 'ok', degraded: false, blocked: false, coverage_pct: 90 }));
    assert.equal(loadCoverage(file).honest_coverage_pct, null, 'absent stays null, never a replacement 0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
