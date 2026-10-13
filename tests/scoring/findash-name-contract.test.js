'use strict';

/**
 * Findash v1 company-name contract.
 *
 * Proves the real producer path:
 *   snapshot.meta.name -> scoreUniverse -> produceRankings -> export mapper/gate.
 * The field is descriptive only: removing it from the comparison must leave every
 * pre-existing score/ranking field unchanged.
 *
 * Usage: node tests/scoring/findash-name-contract.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const formulas = require('../../src/scoring/formulas/index.js');
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const wfe = require('../../scripts/write-findash-export.js');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (error) {
    fail++;
    console.error('FAIL   ' + name + '\n       ' + error.message);
  }
}

function fixture(overrides = {}) {
  const p = path.join(__dirname, 'fixtures', 'CRDO.json');
  const snapshot = JSON.parse(fs.readFileSync(p, 'utf8'));
  snapshot.meta = { ...snapshot.meta, ...overrides };
  return snapshot;
}

function roundTrip(snapshot) {
  const scored = scoreUniverse([snapshot], formulas);
  const rankings = produceRankings(scored, { topN: 50 });
  const row = rankings.branches.semiconductors.profitable[0];
  return {
    scored: scored[0],
    row,
    overview: rankings.overview[0],
    exported: wfe.mapBoardRow(row, 0),
    exportedOverview: wfe.mapOverviewRow(rankings.overview[0], 0),
  };
}

function survivalSource(name) {
  return {
    ticker: 'SURV', name, runwayQuarters: 8, lamps: [],
    country: null, region: null, sector: 'Healthcare', marketCap: null,
    phase: null, mcapBand: null, ipoRecency: null, profitTier: null, ipoYear: null,
    cohortN: null, cohortFallback: null,
  };
}

function withoutName(value) {
  if (Array.isArray(value)) return value.map(withoutName);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'name') out[key] = withoutName(item);
  }
  return out;
}

test('meta.name survives scoring, ranking and export with normalized whitespace', () => {
  const result = roundTrip(fixture({ name: '  Credo   Technology\tGroup  ' }));
  assert.equal(result.scored.name, 'Credo Technology Group');
  assert.equal(result.row.name, 'Credo Technology Group');
  assert.equal(result.overview.name, 'Credo Technology Group');
  assert.equal(result.exported.name, 'Credo Technology Group');

  const errors = [];
  wfe.validateBoardRow(result.exported, 'board[0]', errors);
  assert.deepEqual(errors, []);
});

test('missing, blank and non-string names become explicit null', () => {
  for (const badName of [undefined, '   \t ', 42]) {
    const snapshot = fixture();
    if (badName === undefined) delete snapshot.meta.name;
    else snapshot.meta.name = badName;
    const result = roundTrip(snapshot);
    assert.equal(result.scored.name, null);
    assert.equal(result.row.name, null);
    assert.equal(result.overview.name, null);
    assert.equal(result.exported.name, null);
    assert.equal(result.exportedOverview.name, null);
  }
});

test('all three export mappers normalize names and turn invalid values into null', () => {
  const routed = roundTrip(fixture({ name: 'Credo Technology Group' }));
  const cases = [
    {
      label: 'board',
      map: (name) => wfe.mapBoardRow({ ...routed.row, name }, 0),
    },
    {
      label: 'overview',
      map: (name) => wfe.mapOverviewRow({ ...routed.overview, name }, 0),
    },
    {
      label: 'survival',
      map: (name) => wfe.mapSurvivalRow(survivalSource(name), 0),
    },
  ];

  for (const item of cases) {
    assert.equal(item.map('  ACME   Holdings\tPLC  ').name, 'ACME Holdings PLC', item.label);
    assert.equal(item.map('   \t ').name, null, item.label + ' blank');
    assert.equal(item.map(42).name, null, item.label + ' non-string');
    assert.equal(item.map(undefined).name, null, item.label + ' missing upstream');
  }
});

test('name is score-neutral and leaves all pre-existing ranking fields unchanged', () => {
  const named = roundTrip(fixture({ name: 'Credo Technology Group' }));
  const unnamed = roundTrip(fixture({ name: '   ' }));
  assert.deepEqual(withoutName(named.scored), withoutName(unnamed.scored));
  assert.deepEqual(withoutName(named.row), withoutName(unnamed.row));
  assert.deepEqual(withoutName(named.overview), withoutName(unnamed.overview));
  assert.deepEqual(withoutName(named.exported), withoutName(unnamed.exported));
});

test('producer gate rejects missing, invalid and unnormalized names on every row shape', () => {
  const routed = roundTrip(fixture({ name: 'Credo Technology Group' }));
  const rows = [
    ['board', wfe.validateBoardRow, routed.exported],
    ['overview', wfe.validateOverviewRow, routed.exportedOverview],
    ['survival', wfe.validateSurvivalRow, wfe.mapSurvivalRow(survivalSource('Survival Corp'), 0)],
  ];

  for (const [label, validate, clean] of rows) {
    const missing = { ...clean };
    delete missing.name;
    const missingErrors = [];
    validate(missing, label + '[0]', missingErrors);
    assert.ok(missingErrors.some((error) => /name missing/.test(error)), label + ': ' + JSON.stringify(missingErrors));

    for (const badName of [42, '   ', '  Untrimmed Name', 'Double  Space']) {
      const errors = [];
      validate({ ...clean, name: badName }, label + '[0]', errors);
      assert.ok(errors.some((error) => /name/.test(error)), label + ' accepted ' + JSON.stringify(badName));
    }
  }
});

test('shared v1 consumer fixture keeps name optional for legacy datasets', () => {
  const p = path.join(__dirname, '..', '..', 'docs', 'findash-export-v1.contract.json');
  const contract = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(!contract.requiredBoardRow.includes('name'), 'legacy BoardRow must not require name');
  assert.ok(!contract.requiredOverviewRow.includes('name'), 'legacy OverviewRow must not require name');
  assert.ok(!contract.requiredSurvivalRow.includes('name'), 'legacy SurvivalRow must not require name');
});

console.log(`\nfindash-name-contract.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
