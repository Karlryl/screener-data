'use strict';

// Run standalone: node tests/rule40-reserved-name-snapshot.test.js
// Behavior guard for the reserved-name snapshot fix in cec884f.
// All data lives in independent OS-temp fixtures; retain them under the no-delete rule.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { baueExport, boardZeile, laeufer } = require('./rule40-fixture.js');
const W = require('../scripts/write-rule40-export.js');
const { test, bilanz } = laeufer();

function fixture(withReservedName) {
  const f = baueExport([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }) },
    { row: boardZeile({ ticker: 'BBB', revGrowthYoYPct: 50 }) },
  ]);
  if (withReservedName) {
    const reserved = JSON.parse(fs.readFileSync(path.join(f.snapshotsDir, 'AAA.json'), 'utf8'));
    reserved.meta.ticker = 'CON';
    // The production issuer deduplicator groups by name, so this is a third issuer.
    reserved.meta.name = 'CON Inc';
    fs.writeFileSync(path.join(f.snapshotsDir, '_CON.json'), JSON.stringify(reserved));
  }
  fs.writeFileSync(path.join(f.snapshotsDir, '_manifest.json'), JSON.stringify({
    pulled_at: '2026-09-17T00:00:00Z', n_total: 1, n_ok: 1,
  }));
  fs.writeFileSync(path.join(f.snapshotsDir, '_last_good_disk.json'), '{}');
  return f;
}

const withReserved = fixture(true);
const result = W.sammleKandidaten({
  v1Dir: withReserved.v1Dir, snapshotsDir: withReserved.snapshotsDir,
});

test('reserved snapshot is read while both metadata files are excluded', () => {
  assert.deepEqual(fs.readdirSync(withReserved.snapshotsDir).sort(),
    ['AAA.json', 'BBB.json', '_CON.json', '_last_good_disk.json', '_manifest.json'].sort());
  assert.equal(result.gelesen, 3, 'two normal snapshots plus _CON must be read, not two or five');
  assert.equal(result.abgewiesen.snapshotUnlesbar, 0, 'metadata files are not unreadable snapshots');
  assert.equal(result.kandidaten.length, 3, 'all three distinct issuers survive selection');
  assert.equal(result.abgewiesen.dupEmittent, 0, 'reserved snapshot must not merge with its template');
  assert.equal(result.aufBrett, 2, 'the reserved snapshot exists outside the two board entries');
});

test('reserved candidate keeps the current filename and metadata identities', () => {
  assert.deepEqual(result.kandidaten.map(k => k.ticker).sort(), ['AAA', 'BBB', '_CON'].sort());
  // sammleKandidaten currently derives ticker from datei.slice(0, -5), not meta.ticker.
  const candidate = result.kandidaten.find(k => k.ticker === '_CON');
  assert.ok(candidate, '_CON must be a returned candidate, not merely a counted file');
  assert.equal(candidate.ticker, '_CON');
  assert.equal(candidate.meta.ticker, 'CON');
  assert.equal(candidate.meta.name, 'CON Inc');
  assert.equal(candidate.snapshot.meta.ticker, 'CON');
  assert.equal(candidate.onBoard, false, 'no board row exists for the filename ticker');
  assert.equal(candidate.row, null);
});

test('independent control reads two normal snapshots and excludes both metadata files', () => {
  // Build a separate fixture rather than deleting the reserved snapshot from the first one.
  const control = fixture(false);
  assert.notEqual(control.snapshotsDir, withReserved.snapshotsDir);
  assert.deepEqual(fs.readdirSync(control.snapshotsDir).sort(),
    ['AAA.json', 'BBB.json', '_last_good_disk.json', '_manifest.json'].sort());
  const res = W.sammleKandidaten({ v1Dir: control.v1Dir, snapshotsDir: control.snapshotsDir });
  assert.equal(res.gelesen, 2, 'metadata files must not inflate the control universe');
  assert.equal(res.abgewiesen.snapshotUnlesbar, 0);
  assert.deepEqual(res.kandidaten.map(k => k.ticker).sort(), ['AAA', 'BBB']);
  assert.equal(res.aufBrett, 2);
});

bilanz('rule40-reserved-name-snapshot');
