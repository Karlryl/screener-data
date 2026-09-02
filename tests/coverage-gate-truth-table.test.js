'use strict';

/**
 * Rat Q2-1 / Q2-2 (Beschluss 2026-09-02, §5 Q2) — BH-126 truth table + generated_at carry.
 *
 * Q2-1: degradedMarkerBroken() decides whether a 'degradiert' run may still deploy
 * despite a broken or unwritten coverage marker. BH-126 has hard-blocked that branch
 * since Tag 368; the council REJECTED any new hard block (2:0). This file therefore
 * only PINS the existing behaviour — it changes nothing.
 *
 * Why all TWELVE rows and not six: the function has arity 3
 * (status, markerErrors, markerWriteFailed). A two-argument call does not return
 * false — it returns `undefined`, because `false.length` / `true.length` is undefined.
 * A loosely written table (`assert(!broken('ok', true))`) would pass VACUUM-GREEN,
 * i.e. green because an argument is missing. That is exactly the silent failure this
 * pinning exists to prevent, so the arity and the undefined result are asserted
 * explicitly below.
 *
 * Q2-2: loadCoverage() carries generated_at out of outputs/coverage-status.json into
 * its return object, and thereby into every embedded marker copy in the v1 export.
 * Additive field, no schema bump (docs/findash-export-v1.md §5 allows this in v1).
 *
 * Run: node tests/coverage-gate-truth-table.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { degradedMarkerBroken } = require('../scripts/coverage-gate.js');
const { loadCoverage } = require('../scripts/write-findash-export.js');

const STATUS = ['ok', 'degradiert', 'katastrophal'];
const ERRORS = [[], ['x']];
const WRITE_FAILED = [false, true];

// The full cross product, written out as data so the count is checkable by eye.
// Expected true ONLY for 'degradiert' AND (errors non-empty OR write failed).
const TABLE = [];
for (const status of STATUS)
  for (const markerErrors of ERRORS)
    for (const markerWriteFailed of WRITE_FAILED)
      TABLE.push({
        status,
        markerErrors,
        markerWriteFailed,
        expected: status === 'degradiert' && (markerErrors.length > 0 || markerWriteFailed),
      });

test('Q2-1: degradedMarkerBroken has arity 3 — a two-argument table is not writable', () => {
  // Guards Bruchprobe (c): if this function ever loses its third parameter, or a
  // future table is written two-argument, this line falls before any row is checked.
  assert.equal(degradedMarkerBroken.length, 3, 'degradedMarkerBroken must take (status, markerErrors, markerWriteFailed)');

  // The vacuum-green case pinned explicitly: two arguments yield undefined, NOT true.
  // `markerErrors` is then a boolean, `.length` is undefined, `undefined > 0` is false,
  // and `false || undefined` is undefined.
  assert.equal(degradedMarkerBroken('degradiert', false), undefined);
  assert.equal(degradedMarkerBroken('degradiert', true), undefined);
});

test('Q2-1: BH-126 truth table — all 12 combinations, three-argument', () => {
  assert.equal(TABLE.length, 12, 'the cross product is 3 statuses x 2 error states x 2 write states');
  assert.equal(TABLE.filter(r => r.expected).length, 3, 'exactly three rows must block');

  for (const r of TABLE) {
    const got = degradedMarkerBroken(r.status, r.markerErrors, r.markerWriteFailed);
    const label = `(${r.status}, ${JSON.stringify(r.markerErrors)}, ${r.markerWriteFailed})`;
    assert.equal(typeof got, 'boolean', `${label} must return a boolean, got ${String(got)}`);
    assert.equal(got, r.expected, `${label} expected ${r.expected}`);
  }
});

test('Q2-1: the two blocking dimensions are load-bearing (mutant coverage)', () => {
  // Bruchprobe (a): a mutant that drops `status === 'degradiert'` from the condition
  // would return true here. Rows 'ok'/'katastrophal' with a broken marker pin that.
  assert.equal(degradedMarkerBroken('ok', ['x'], true), false);
  assert.equal(degradedMarkerBroken('katastrophal', ['x'], true), false);

  // Bruchprobe (b): a mutant that ignores the third argument would return false here.
  // Contract violation and write failure must each block on their own.
  assert.equal(degradedMarkerBroken('degradiert', [], true), true);
  assert.equal(degradedMarkerBroken('degradiert', ['x'], false), true);

  // ... and a healthy degraded run must still deploy (the banner works).
  assert.equal(degradedMarkerBroken('degradiert', [], false), false);
});

test('Q2-2: loadCoverage carries generated_at out of the marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-coverage-'));
  const file = path.join(dir, 'coverage-status.json');
  const marker = {
    schema: 'coverage-status@1', generated_at: '2026-09-02T19:44:15.000Z',
    status: 'degradiert', degraded: true, blocked: false, coverage_pct: 20.1,
    n_ok: 6088, n_total: 30228,
  };
  fs.writeFileSync(file, JSON.stringify(marker, null, 2));
  try {
    const cov = loadCoverage(file);
    // Key presence AND value: dropping generated_at from the return object fails here.
    assert.ok('generated_at' in cov, 'loadCoverage must carry generated_at into the export');
    assert.equal(cov.generated_at, marker.generated_at);
    // The pre-existing four fields stay exactly as they were (no silent reshaping).
    assert.deepEqual(cov, {
      status: 'degradiert', degraded: true, blocked: false, coverage_pct: 20.1,
      generated_at: '2026-09-02T19:44:15.000Z',
    });
    // Absent marker stays null — the export still builds (diagnostic passenger).
    assert.equal(loadCoverage(path.join(dir, 'does-not-exist.json')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
