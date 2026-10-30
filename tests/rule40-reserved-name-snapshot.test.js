'use strict';

// Run standalone: node tests/rule40-reserved-name-snapshot.test.js
// Behavior guard for the reserved-name snapshot fix in cec884f.
// All data lives in independent OS-temp fixtures, removed when this test exits.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { baueExport, boardZeile, laeufer, snapshot, setzeWachstum } = require('./rule40-fixture.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const W = require('../scripts/write-rule40-export.js');
const { test, bilanz } = laeufer();
const fixtures = [];
process.once('exit', () => {
  for (const fixture of fixtures) {
    try {
      const target = path.resolve(fixture.dir);
      assert.equal(path.dirname(target), path.resolve(os.tmpdir()), 'cleanup stays in OS temp');
      assert.equal(path.basename(target).startsWith('rule40-test-'), true, 'cleanup owns this fixture');
      fixture.aufraeumen();
    } catch (error) {
      console.error('Fixture cleanup failed:', error);
      process.exitCode = 1;
    }
  }
});

function fixture(withReservedName) {
  const f = baueExport([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }) },
    { row: boardZeile({ ticker: 'BBB', revGrowthYoYPct: 50 }) },
  ]);
  fixtures.push(f);
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

test('reserved candidate carries meta.ticker, not the sanitised filename (sweep 24.10.2026, finding 6)', () => {
  assert.deepEqual(result.kandidaten.map(k => k.ticker).sort(), ['AAA', 'BBB', 'CON'].sort());
  // Until 24.10.2026 sammleKandidaten derived the ticker from datei.slice(0, -5) and returned '_CON'.
  assert.equal(result.kandidaten.some(k => k.ticker === '_CON'), false, 'the filename stem must never be the ticker');
  const candidate = result.kandidaten.find(k => k.ticker === 'CON');
  assert.ok(candidate, 'CON must be a returned candidate, not merely a counted file');
  assert.equal(candidate.ticker, 'CON');
  assert.equal(candidate.meta.ticker, 'CON');
  assert.equal(candidate.meta.name, 'CON Inc');
  assert.equal(candidate.snapshot.meta.ticker, 'CON');
  assert.equal(candidate.onBoard, false, 'no board row exists for the ticker CON (taken from meta.ticker)');
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

// Sweep 24.10.2026, finding 6: 69 snapshot files carry a sanitised name (MFRISCO/A-1.MX -> MFRISCO_A-1.MX.json);
// the live board showed MFRISCO_A-1.MX and CIE_B.MX without name and score, and the rank gate never saw them.
test('sanitised filenames: board row, score and rank gate follow meta.ticker; a missing meta.ticker warns', () => {
  const f = baueExport([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }) },
    { row: boardZeile({ ticker: 'CIE/B.MX', revGrowthYoYPct: 70, score: 77.6, rank: 23, name: 'Cie Board Name' }), snap: null },
    { row: boardZeile({ ticker: 'MFRISCO/A-1.MX', revGrowthYoYPct: 80, rank: null, rankGrund: 'zuWenigBelegteAchsen' }), snap: null },
  ]);
  fixtures.push(f);
  for (const [ticker, growth] of [['CIE/B.MX', 70], ['MFRISCO/A-1.MX', 80], ['NOMETA', 50]]) {
    const snap = setzeWachstum(snapshot({ ticker, name: ticker + ' Inc' }), growth);
    if (ticker === 'NOMETA') delete snap.meta.ticker;
    fs.writeFileSync(path.join(f.snapshotsDir, safeSnapshotFilename(ticker)), JSON.stringify(snap));
  }
  assert.deepEqual(fs.readdirSync(f.snapshotsDir).sort(), ['AAA.json', 'CIE_B.MX.json', 'MFRISCO_A-1.MX.json', 'NOMETA.json']);
  const warnings = [], error = console.error;
  console.error = (...args) => { warnings.push(args.join(' ')); };
  let res;
  try { res = W.sammleKandidaten({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir }); }
  finally { console.error = error; }
  const tickers = res.kandidaten.map(k => k.ticker).sort();
  assert.deepEqual(tickers, ['AAA', 'CIE/B.MX', 'NOMETA'], 'no sanitised stem, and the rank-gated name is out');
  const cie = res.kandidaten.find(k => k.ticker === 'CIE/B.MX');
  assert.equal(cie.onBoard, true, 'the board row is found under the real ticker');
  assert.equal(cie.row.score, 77.6);
  assert.equal(res.abgewiesen.ohneRang, 1, 'MFRISCO/A-1.MX has a rank reason on its board and must not bypass the gate');
  assert.equal(warnings.filter(w => w.startsWith('::warning::[rule40] NOMETA.json: meta.ticker fehlt')).length, 1, warnings.join(' | '));
  assert.equal(warnings.some(w => w.includes('CIE_B.MX') || w.includes('AAA.json')), false, 'only the snapshot without meta.ticker warns');
  // The published board row carries the board's score and name.
  // W.build reads NOMETA again and repeats the warning pinned above; only that line stays out of the test output.
  console.error = (...args) => { if (!args.join(' ').startsWith('::warning::[rule40] NOMETA.json')) error(...args); };
  try { W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir }); }
  finally { console.error = error; }
  const rows = JSON.parse(fs.readFileSync(path.join(f.outDir, 'overview.json'), 'utf8')).rows;
  assert.equal(rows.some(r => r.ticker.includes('_')), false, 'no row may carry a sanitised ticker');
  const row = rows.find(r => r.ticker === 'CIE/B.MX');
  assert.ok(row, 'CIE/B.MX must be on the Rule-of-40 board under its real ticker');
  assert.equal(row.score, 77.6);
  assert.equal(row.name, 'Cie Board Name');
  assert.equal(row.onBoard, true);
  assert.equal(rows.some(r => r.ticker === 'MFRISCO/A-1.MX'), false);
});

bilanz('rule40-reserved-name-snapshot');
