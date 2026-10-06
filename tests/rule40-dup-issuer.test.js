'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const W = require('../scripts/write-rule40-export.js');
const shadow = require('../lib/dup-issuer-shadow-table.js');
const { baueExport, boardZeile, snapshot, setzeWachstum } = require('./rule40-fixture.js');

const writerFile = path.resolve(__dirname, '../scripts/write-rule40-export.js');
const writerSource = fs.readFileSync(writerFile, 'utf8');
const entry = shadow.loadDupIssuerShadowTable().copel;
const secondary = entry.tickers.find((ticker) => ticker !== entry.codeKeeps);
const marker = { of: entry.codeKeeps, issuer: entry.issuer, basis: 'hand-table:dup-issuer-shadow' };
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const unrelated = () => ['FBNC', 'FBP'].map((ticker, i) => ({ row: boardZeile({ ticker, revGrowthYoYPct: 60 - i * 5 }) }));
const pair = () => [entry.codeKeeps, secondary].map((ticker, i) => ({ row: boardZeile({ ticker, revGrowthYoYPct: 40 - i * 10 }) }));

// Only the shadow dependency is substituted; selection, calculations and disk writes stay real.
function writerWithShadow(overrides, fixture) {
  const module = { exports: {} };
  const nativeRequire = createRequire(writerFile);
  vm.runInNewContext(writerSource, {
    module, __dirname: path.dirname(writerFile),
    require: (id) => id === '../lib/dup-issuer-shadow-table.js' ? { ...shadow, ...overrides } : nativeRequire(id),
    process: { env: fixture ? { RULE40_V1_DIR: fixture.v1Dir, RULE40_SNAPSHOTS_DIR: fixture.snapshotsDir,
      RULE40_OUT_DIR: fixture.outDir } : {} },
    console: { log() {}, warn() {}, error() {} },
  }, { filename: writerFile });
  return module.exports;
}

function written(fixture, writer = W) {
  writer.build(fixture);
  return read(path.join(fixture.outDir, 'overview.json'));
}

// Pure assertion only: the deliberate red proof flips this in memory, never a writing test.
function assertRejected(result) {
  assert.equal(result.ok, false, 'written secondary without its exact dupIssuer must be rejected');
  assert.ok(result.errors.some((error) => error.includes(secondary) && error.includes('dupIssuer')));
}

test('real written board marks the planted pair and preserves all other bytes', () => {
  const baseline = baueExport(unrelated());
  const planted = baueExport([...unrelated(), ...pair()]);
  const bypassed = baueExport([...unrelated(), ...pair()]);
  const before = written(baseline);
  const after = written(planted);
  const withoutMarker = written(bypassed, writerWithShadow({ applyDupIssuerShadow: (row) => row }));
  assert.deepEqual(after.rows.map((row) => row.ticker), ['FBNC', 'FBP', entry.codeKeeps, secondary]);
  assert.deepEqual(after.rows.find((row) => row.ticker === secondary).dupIssuer, marker);
  assert.ok(after.rows.filter((row) => row.ticker !== secondary).every((row) => !Object.hasOwn(row, 'dupIssuer')));
  assert.equal(JSON.stringify(after.rows.slice(0, before.rows.length)), JSON.stringify(before.rows),
    'every unrelated row, including rank, must match the build without the planted pair');
  const stripped = structuredClone(after);
  for (const row of stripped.rows) delete row.dupIssuer;
  assert.equal(JSON.stringify(stripped), JSON.stringify(withoutMarker), 'only the additive marker may change');
  assert.deepEqual(fs.readFileSync(path.join(planted.outDir, 'index.json')),
    fs.readFileSync(path.join(bypassed.outDir, 'index.json')), 'index bytes must not change');
  assert.equal(W.check(planted).ok, true);
  assertRejected(W.check(bypassed));
});

test('off-board secondary is marked even without its kept ticker on the board', () => {
  const fixture = baueExport(unrelated());
  const snap = setzeWachstum(snapshot({ ticker: secondary, name: 'Separate fixture issuer' }), 30);
  fs.writeFileSync(path.join(fixture.snapshotsDir, secondary + '.json'), JSON.stringify(snap));
  const overview = written(fixture);
  const row = overview.rows.find((item) => item.ticker === secondary);
  assert.ok(row, 'routed off-board secondary must be written');
  assert.equal(row.onBoard, false);
  assert.equal(row.score, null);
  assert.deepEqual(row.dupIssuer, marker);
  assert.ok(!overview.rows.some((item) => item.ticker === entry.codeKeeps));
  assert.equal(W.check(fixture).ok, true);
});

test('check rejects missing and wrong markers in a written temporary copy', () => {
  const fixture = baueExport([...unrelated(), ...pair()]);
  const original = written(fixture);
  const originalFile = path.join(fixture.outDir, 'overview.json');
  const beforeHash = hash(originalFile);
  const outDir = path.resolve(fixture.dir, 'tampered', 'rule40');
  assert.ok(outDir.startsWith(path.resolve(fixture.dir) + path.sep));
  assert.notEqual(outDir, path.resolve(fixture.outDir));
  assert.ok(!outDir.startsWith(path.resolve(__dirname, '../outputs') + path.sep));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.json'), fs.readFileSync(path.join(fixture.outDir, 'index.json')));
  const checkCopy = (overview) => {
    fs.writeFileSync(path.join(outDir, 'overview.json'), JSON.stringify(overview));
    return W.check({ v1Dir: fixture.v1Dir, outDir });
  };
  assert.equal(checkCopy(original).ok, true);
  for (const invalid of [undefined, null, false, {}, { ...marker, of: secondary },
    { ...marker, issuer: 'Wrong issuer' }, { ...marker, basis: 'wrong' }, { ...marker, extra: true }]) {
    const copy = structuredClone(original);
    const row = copy.rows.find((item) => item.ticker === secondary);
    if (invalid === undefined) delete row.dupIssuer;
    else row.dupIssuer = invalid;
    assertRejected(checkCopy(copy));
  }
  for (const ticker of [entry.codeKeeps, 'FBNC']) {
    const copy = structuredClone(original);
    copy.rows.find((row) => row.ticker === ticker).dupIssuer = marker;
    const result = checkCopy(copy);
    assert.equal(result.ok, false, 'kept and unlisted tickers must have no marker');
    assert.ok(result.errors.some((error) => error.includes(ticker) && error.includes('dupIssuer')));
  }
  const reordered = structuredClone(original);
  reordered.rows.find((row) => row.ticker === secondary).dupIssuer = {
    basis: marker.basis, issuer: marker.issuer, of: marker.of,
  };
  assert.equal(checkCopy(reordered).ok, true, 'object key order is not marker semantics');
  assert.equal(hash(originalFile), beforeHash, 'the original written board must stay unchanged');
});

test('table loads once per build and real loader failures reach the CLI failure marker', () => {
  const fixture = baueExport([...unrelated(), ...pair()]);
  let loads = 0;
  const counted = writerWithShadow({ loadDupIssuerShadowTable: () => { loads++; return shadow.loadDupIssuerShadowTable(); } });
  written(fixture, counted);
  assert.equal(loads, 1);
  written(fixture, counted);
  assert.equal(loads, 2, 'each build must reload the table');
  for (const malformed of [false, true]) {
    for (const argv of [[], ['--check']]) {
      const brokenFixture = baueExport(pair());
      written(brokenFixture);
      const tableFile = path.join(brokenFixture.dir, malformed ? 'malformed.json' : 'missing.json');
      if (malformed) fs.writeFileSync(tableFile, '{');
      const broken = writerWithShadow({ loadDupIssuerShadowTable: () => shadow.loadDupIssuerShadowTable(tableFile) }, brokenFixture);
      assert.throws(() => broken.build(brokenFixture), malformed ? /JSON/ : /ENOENT/);
      const checked = broken.check(brokenFixture);
      assert.equal(checked.ok, false);
      assert.ok(checked.errors.some((error) => error.includes('dupIssuer-Handtabelle')));
      assert.equal(broken.main(argv), 1);
      const failed = read(path.join(brokenFixture.outDir, W.FAILED_NAME));
      assert.equal(failed.failed, true);
      assert.match(failed.reason, malformed ? /JSON/ : /ENOENT/);
      assert.deepEqual(fs.readdirSync(brokenFixture.outDir), [W.FAILED_NAME]);
    }
  }
});
