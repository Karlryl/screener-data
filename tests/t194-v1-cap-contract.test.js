'use strict';

/**
 * T194 - machine-readable delivery completeness for HG v1 boards.
 *
 * The fast board intentionally contains at most 100 rows per track while index.json
 * reports the full cohort. A consumer must not infer completeness from array length.
 * This fixture pins both directions: a capped track says so, and a genuinely complete
 * track (including full/) stays green.
 *
 * Hermetic: no network, no production outputs. Run with:
 *   node tests/t194-v1-cap-contract.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const wfe = require('../scripts/write-findash-export.js');

const TRACK_COUNTS = Object.freeze({ profitable: 292, unprofitable: 78 });
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (n) => Array.from({ length: n }, (_, i) => ({ fixture: i }));
const board = (profitable, unprofitable) => ({
  profitable: rows(profitable),
  unprofitable: rows(unprofitable),
});

function deliveryErrors(mk, mode, counts = TRACK_COUNTS) {
  const errs = [];
  wfe.validateCohortDelivery(mk, 'semiconductors', errs, { mode, counts });
  return errs;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}

function writeCleanExport() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 't194-export-'));
  const fullDir = path.join(outDir, 'full');
  fs.mkdirSync(fullDir, { recursive: true });
  const counts = Object.fromEntries(
    wfe.BRANCHES.map((id) => [id, { profitable: 0, unprofitable: 0 }]));
  const boardHull = (id, mode) => {
    const mk = {
      schema: wfe.SCHEMA,
      generated_at: 'fixture',
      coverage: null,
      branch: id,
      boardStatus: 'core',
      profitable: [],
      unprofitable: [],
    };
    mk.cohortDelivery = wfe.cohortDeliveryFor(id, mk, mode, counts[id]);
    return mk;
  };
  for (const id of wfe.BRANCHES) {
    writeJson(path.join(outDir, id + '.json'), boardHull(id, 'topN'));
    writeJson(path.join(fullDir, id + '.json'), boardHull(id, 'full'));
  }
  writeJson(path.join(outDir, 'overview.json'), {
    schema: wfe.SCHEMA, generated_at: 'fixture', coverage: null, rows: [],
  });
  writeJson(path.join(outDir, 'survival.json'), {
    schema: wfe.SCHEMA, generated_at: 'fixture', coverage: null, rows: [],
  });
  writeJson(path.join(outDir, 'index.json'), {
    schema: wfe.SCHEMA,
    generated_at: 'fixture',
    coverage: null,
    generatedFromSnapshots: 0,
    branches: [...wfe.BRANCHES],
    boardStatus: Object.fromEntries(wfe.BRANCHES.map((id) => [id, 'core'])),
    counts,
    survivalCount: 0,
    excluded: {},
  });
  return outDir;
}

test('top board declares the 100/292 cap and the complete 78/78 track', () => {
  const mk = board(100, 78);
  mk.cohortDelivery = wfe.cohortDeliveryFor('semiconductors', mk, 'topN', TRACK_COUNTS);
  assert.deepEqual(mk.cohortDelivery, {
    cap: 100,
    fullBoard: 'full/semiconductors.json',
    profitable: { delivered: 100, total: 292, truncated: true },
    unprofitable: { delivered: 78, total: 78, truncated: false },
  });
  assert.deepEqual(deliveryErrors(mk, 'topN'), []);
  assert.throws(
    () => wfe.cohortDeliveryFor('semiconductors', board(50, 78), 'topN', TRACK_COUNTS),
    /expected 100 for topN/,
    'the v1 export contract is fixed at 100 and must reject a non-default upstream --topN');
});

test('full board is explicitly uncapped and complete in both tracks', () => {
  const mk = board(292, 78);
  mk.cohortDelivery = wfe.cohortDeliveryFor('semiconductors', mk, 'full', TRACK_COUNTS);
  assert.deepEqual(mk.cohortDelivery, {
    cap: null,
    fullBoard: null,
    profitable: { delivered: 292, total: 292, truncated: false },
    unprofitable: { delivered: 78, total: 78, truncated: false },
  });
  assert.deepEqual(deliveryErrors(mk, 'full'), []);
});

test('full fixture callers may derive totals from their complete arrays', () => {
  const mk = board(17, 3);
  assert.deepEqual(wfe.cohortDeliveryFor('semiconductors', mk, 'full'), {
    cap: null,
    fullBoard: null,
    profitable: { delivered: 17, total: 17, truncated: false },
    unprofitable: { delivered: 3, total: 3, truncated: false },
  });
});

test('validator rejects a capped track falsely marked complete', () => {
  const mk = board(100, 78);
  mk.cohortDelivery = wfe.cohortDeliveryFor('semiconductors', mk, 'topN', TRACK_COUNTS);
  mk.cohortDelivery.profitable.truncated = false;
  assert.match(deliveryErrors(mk, 'topN').join('; '), /profitable\.truncated/);
});

test('validator ties delivered and total to arrays, cap rule, and index counts', () => {
  const base = board(100, 78);
  base.cohortDelivery = wfe.cohortDeliveryFor('semiconductors', base, 'topN', TRACK_COUNTS);

  const wrongDelivered = clone(base);
  wrongDelivered.cohortDelivery.profitable.delivered = 99;
  assert.match(deliveryErrors(wrongDelivered, 'topN').join('; '), /array length=100/);

  const hiddenTail = clone(base);
  hiddenTail.cohortDelivery.profitable.total = 100;
  hiddenTail.cohortDelivery.profitable.truncated = false;
  assert.match(deliveryErrors(hiddenTail, 'topN').join('; '), /index count=292/);

  const shortCap = board(99, 78);
  shortCap.cohortDelivery = clone(base.cohortDelivery);
  shortCap.cohortDelivery.profitable.delivered = 99;
  assert.match(deliveryErrors(shortCap, 'topN').join('; '), /expected 100 for topN/);

  assert.match(deliveryErrors(base, 'topN', null).join('; '), /index count missing\/invalid/,
    'when an index exists but omits this board, delivery metadata must not self-certify');
});

test('validator rejects top/full mode confusion in both directions', () => {
  const top = board(100, 78);
  top.cohortDelivery = wfe.cohortDeliveryFor('semiconductors', top, 'topN', TRACK_COUNTS);
  assert.match(deliveryErrors(top, 'full').join('; '), /cap=100|fullBoard|expected 292 for full/);

  const full = board(292, 78);
  full.cohortDelivery = wfe.cohortDeliveryFor('semiconductors', full, 'full', TRACK_COUNTS);
  assert.match(deliveryErrors(full, 'topN').join('; '), /cap=null|fullBoard|expected 100 for topN/);
});

test('production board validator requires the disclosure when delivery mode is known', () => {
  const hull = {
    schema: wfe.SCHEMA,
    generated_at: 'fixture',
    coverage: null,
    branch: 'semiconductors',
    boardStatus: 'core',
    profitable: [],
    unprofitable: [],
  };
  hull.cohortDelivery = wfe.cohortDeliveryFor(
    'semiconductors', hull, 'topN', { profitable: 0, unprofitable: 0 });
  let errs = [];
  wfe.validateFile(hull, 'semiconductors', errs, {
    deliveryMode: 'topN',
    cohortCounts: { profitable: 0, unprofitable: 0 },
  });
  assert.deepEqual(errs, []);

  delete hull.cohortDelivery;
  errs = [];
  wfe.validateFile(hull, 'semiconductors', errs, {
    deliveryMode: 'topN',
    cohortCounts: { profitable: 0, unprofitable: 0 },
  });
  assert.match(errs.join('; '), /cohortDelivery missing/);
});

test('production index validation requires non-negative counts for every board and track', () => {
  const counts = Object.fromEntries(wfe.BRANCHES.map((id) => [id, { profitable: 0, unprofitable: 0 }]));
  const index = {
    schema: wfe.SCHEMA,
    generated_at: 'fixture',
    coverage: null,
    generatedFromSnapshots: 0,
    branches: [...wfe.BRANCHES],
    boardStatus: Object.fromEntries(wfe.BRANCHES.map((id) => [id, 'core'])),
    counts,
    survivalCount: 0,
    excluded: {},
  };
  let errs = [];
  wfe.validateFile(index, 'index', errs, { requireCohortCounts: true });
  assert.deepEqual(errs, []);

  delete index.counts.semiconductors.unprofitable;
  errs = [];
  wfe.validateFile(index, 'index', errs, { requireCohortCounts: true });
  assert.match(errs.join('; '), /counts\.semiconductors\.unprofitable/);
});

test('validateExport wires top, full, and index counts into one mutation-sensitive gate', () => {
  const outDir = writeCleanExport();
  assert.deepEqual(wfe.validateExport(outDir), [], 'complete top/full export must stay green');

  const topPath = path.join(outDir, 'semiconductors.json');
  const top = JSON.parse(fs.readFileSync(topPath, 'utf8'));
  delete top.cohortDelivery;
  writeJson(topPath, top);
  let errs = wfe.validateExport(outDir);
  assert.ok(errs.some((e) => /^semiconductors: cohortDelivery missing/.test(e)),
    'removing deliveryMode from the production top validator must make this probe fail');

  top.cohortDelivery = wfe.cohortDeliveryFor(
    'semiconductors', top, 'topN', { profitable: 0, unprofitable: 0 });
  writeJson(topPath, top);
  const fullPath = path.join(outDir, 'full', 'semiconductors.json');
  const full = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  full.cohortDelivery.cap = 100;
  writeJson(fullPath, full);
  errs = wfe.validateExport(outDir);
  assert.ok(errs.some((e) => /^full\/semiconductors: cohortDelivery\.cap=100/.test(e)),
    'removing the full validation branch must make this probe fail');

  full.cohortDelivery.cap = null;
  writeJson(fullPath, full);
  const indexPath = path.join(outDir, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.counts.semiconductors.profitable = 1;
  writeJson(indexPath, index);
  errs = wfe.validateExport(outDir);
  assert.ok(errs.some((e) => /^semiconductors: cohortDelivery\.profitable\.total=0, index count=1/.test(e)),
    'top board must be tied to index counts');
  assert.ok(errs.some((e) => /^full\/semiconductors: cohortDelivery\.profitable\.total=0, index count=1/.test(e)),
    'full board must be tied to the same index counts');
});

test('buildBoard emits disclosure only for the explicit production delivery mode', () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 't194-board-'));
  fs.writeFileSync(path.join(srcDir, 'semiconductors.json'), JSON.stringify({ profitable: [], unprofitable: [] }));

  const production = wfe.buildBoard('semiconductors', null, {
    srcDir,
    deliveryMode: 'topN',
    cohortCounts: { profitable: 0, unprofitable: 0 },
  });
  assert.equal(production.cohortDelivery.cap, wfe.BOARD_TRACK_CAP);
  assert.equal(production.cohortDelivery.fullBoard, 'full/semiconductors.json');

  const reusableSeam = wfe.buildBoard('semiconductors', null, { srcDir });
  assert.equal(Object.hasOwn(reusableSeam, 'cohortDelivery'), false,
    'generic fixture seam remains backward-compatible; production build passes deliveryMode');
});
