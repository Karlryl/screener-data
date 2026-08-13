#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_REL = 'scripts/build-sec-form345-primary-descriptor-crosswalk-v1.py';
const CONTRACT_REL = 'research/early-detection-v4/sec-form345-primary-descriptor-crosswalk-contract-v1.json';
const TEST_REL = 'tests/build-sec-form345-primary-descriptor-crosswalk-v1.test.js';
const OUTPUT_REL = 'reports/early-detection/sec-form345-primary-descriptor-crosswalk-v1.json';
const SCRIPT = path.join(ROOT, SCRIPT_REL);
const CONTRACT = path.join(ROOT, CONTRACT_REL);
const OUTPUT = path.join(ROOT, OUTPUT_REL);
const SEALED_BASE = '996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c';
const EXPECTED_CONTRACT_RAW = '2c866f99e723e8faf72750eb99f695864a38199a415bbb2c738d11fd0cf7dc33';
const EXPECTED_CONTRACT_SELF = 'e142799d16e7d0764792486627740c3dd224a3d46b154678e6b75941bdf80cdb';
const EXPECTED_BUILDER_RAW = '3284504bb527ccb3fe5dbce6233daf3d609048a6019a8de27abc9ebb32ef8b49';
const EXPECTED_POPULATION = {
  rows: 656,
  uniqueAccessions: 652,
  uniqueIssuerCiks: 607,
  sourceLaneCounts: { FORM15_V2: 65, FORM25_V2: 591 },
  pointStatusCounts: {
    CONFLICTING_LATEST_LITERALS: 2,
    NO_PRIOR_POINT: 62,
    ONE_LATEST_LITERAL: 592,
  },
  archiveComparisonCounts: {
    EXACT_LITERAL_MATCH: 157,
    EXACT_LITERAL_MISMATCH: 13,
    NO_COMPARABLE_CANDIDATE: 486,
  },
  gapClassCounts: {
    GAP_NO_ARCHIVE_SNAPSHOT: 452,
    GAP_PRIOR_SNAPSHOT_ISSUER_ABSENT: 19,
    GAP_PRIOR_SNAPSHOT_MULTIPLE_TICKERS: 42,
    GAP_SINGLE_POINT_TICKER_NEEDS_INTERVAL_AND_CORROBORATION: 143,
  },
  latestPointAgeDaysCounts: {
    EXACT_EVENT_DAY: 194,
    DAYS_1_TO_7: 142,
    DAYS_8_TO_30: 103,
    DAYS_31_TO_90: 74,
    DAYS_91_TO_365: 57,
    OVER_365_DAYS: 24,
    NO_PRIOR_POINT: 62,
  },
  rowsWithMultiplePreEventRawLiterals: 140,
  latestEvidenceRows: 4226,
  workItemObservationReferences: 181080,
  priorObservationReferences: 163764,
  futureObservationReferences: 17316,
  priorUsableObservationReferences: 163562,
  futureUsableObservationReferences: 17313,
  priorPlaceholderObservationReferences: 202,
  futurePlaceholderObservationReferences: 3,
  rawLiteralsReusedAcrossTargetCiks: 15,
  reusedRawLiteralsWithOverlappingObservedDateSpans: 5,
  resolvedRows: 0,
};

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function git(...args) {
  const run = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout.trim();
}

function treeExists(commit, relative) {
  return spawnSync('git', ['cat-file', '-e', `${commit}:${relative}`], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  }).status === 0;
}

function runPython(optimized, command) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const run = spawnSync(process.env.PYTHON || 'python', [...prefix, SCRIPT_REL, command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `${optimized ? '-O ' : ''}${command} failed:\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(run.stdout.trim());
}

function runPythonExpectFailure(optimized, command) {
  const prefix = optimized ? ['-O', '-B'] : ['-B'];
  const run = spawnSync(process.env.PYTHON || 'python', [...prefix, SCRIPT_REL, command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.notEqual(run.status, 0, `${optimized ? '-O ' : ''}${command} unexpectedly succeeded`);
}

function assertLinearDescendant(commit) {
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', SEALED_BASE, commit], { cwd: ROOT }).status, 0);
  const commits = git('rev-list', '--ancestry-path', '--reverse', `${SEALED_BASE}..${commit}`).split(/\r?\n/).filter(Boolean);
  let parent = SEALED_BASE;
  for (const item of commits) {
    assert.deepEqual(git('show', '-s', '--format=%P', item).split(/\s+/), [parent]);
    parent = item;
  }
}

assert.equal(sha(fs.readFileSync(CONTRACT)), EXPECTED_CONTRACT_RAW);
assert.equal(sha(fs.readFileSync(SCRIPT)), EXPECTED_BUILDER_RAW);
assert.equal(fs.existsSync(OUTPUT), false, 'future crosswalk output must remain absent');

const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
const contractBody = { ...contract };
delete contractBody.contractSha256;
assert.equal(contract.contractSha256, EXPECTED_CONTRACT_SELF);
assert.equal(sha(Buffer.from(canonical(contractBody), 'utf8')), EXPECTED_CONTRACT_SELF);
assert.equal(contract.implementationTopology.sealedBaseCommit, SEALED_BASE);
assert.equal(contract.implementationTopology.implementationIntroductionDirectChildOfSealedBaseRequired, false);
assert.equal(contract.joinContract.rawIssuerTradingSymbolMustRemainUnsplitAndUnnormalized, true);
assert.equal(contract.knownAtPolicy.historicalPublicKnownAtUtc, null);
assert.equal(contract.knownAtPolicy.historicalStudyFeatureAuthorization, false);
assert.deepEqual(contract.expectedPopulation, EXPECTED_POPULATION);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));

const head = git('rev-parse', 'HEAD');
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', SEALED_BASE, head], { cwd: ROOT }).status, 0);
assert.equal(git('rev-parse', '@{upstream}'), head);
const chain = git('rev-list', '--ancestry-path', '--reverse', `${SEALED_BASE}..${head}`).split(/\r?\n/).filter(Boolean);
let previous = SEALED_BASE;
for (const commit of chain) {
  assert.deepEqual(git('show', '-s', '--format=%P', commit).split(/\s+/), [previous]);
  previous = commit;
}
const implemented = treeExists(head, CONTRACT_REL);
if (!implemented) {
  for (const relative of [CONTRACT_REL, SCRIPT_REL, TEST_REL, OUTPUT_REL]) {
    assert.equal(treeExists(head, relative), false, `${relative} unexpectedly exists in pre-implementation HEAD`);
  }
} else {
  const introductions = new Set([CONTRACT_REL, SCRIPT_REL, TEST_REL].map((relative) => git('log', '--diff-filter=A', '-1', '--format=%H', '--', relative)));
  assert.equal(introductions.size, 1);
  const introduction = [...introductions][0];
  assert.ok(chain.includes(introduction));
  const changes = git('diff-tree', '--no-commit-id', '--name-status', '-r', introduction).split(/\r?\n/);
  assert.deepEqual(new Set(changes), new Set([`A\t${CONTRACT_REL}`, `A\t${SCRIPT_REL}`, `A\t${TEST_REL}`]));
  assert.equal(treeExists(head, OUTPUT_REL), false);
}

const reportHashes = [];
for (const optimized of [false, true]) {
  const verified = runPython(optimized, 'verify-contract');
  assert.equal(verified.status, 'PASS');
  assertLinearDescendant(verified.currentHead);
  assert.equal(verified.verifiedRows, 656);
  assert.equal(verified.fullSourceRebuild, true);
  assert.equal(verified.outcomesAccessed, false);
  assert.deepEqual(verified.population, EXPECTED_POPULATION);

  const selfTest = runPython(optimized, 'self-test');
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.verifiedRows, 656);
  assert.equal(Object.keys(selfTest.mutationKills).length >= 20, true);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  assert.deepEqual(new Set(Object.values(selfTest.fixtureKills)), new Set([true]));
  assert.match(selfTest.reportSha256, /^[0-9a-f]{64}$/);
  assert.equal(selfTest.outcomesAccessed, false);

  const dryRun = runPython(optimized, 'dry-run');
  assert.equal(dryRun.status, 'PASS');
  assertLinearDescendant(dryRun.currentHead);
  assert.equal(dryRun.verifiedRows, 656);
  assert.deepEqual(dryRun.population, EXPECTED_POPULATION);
  assert.equal(dryRun.outputCreated, false);
  assert.equal(dryRun.fullSourceRebuild, true);
  assert.equal(dryRun.outcomesAccessed, false);
  assert.equal(dryRun.reportSha256, selfTest.reportSha256);
  reportHashes.push(dryRun.reportSha256);
}
assert.equal(new Set(reportHashes).size, 1, 'normal and optimized full rebuilds differ');
if (!implemented) {
  runPythonExpectFailure(false, 'build');
  runPythonExpectFailure(true, 'build');
}

assert.equal(fs.existsSync(OUTPUT), false, 'validation created the forbidden future output');
const finalHead = git('rev-parse', 'HEAD');
assertLinearDescendant(finalHead);
assert.equal(git('rev-parse', '@{upstream}'), finalHead);
const source = fs.readFileSync(SCRIPT, 'utf8');
assert.doesNotMatch(source, /REPORTING_OWNER|NONDERIV_TRANS|DERIV_TRANS|NONDERIV_HOLDING|DERIV_HOLDING/);
assert.doesNotMatch(source, /requests\.|urllib|http\.client|aiohttp|socket\./);
console.log(JSON.stringify({
  status: 'PASS',
  sealedBase: SEALED_BASE,
  currentHead: finalHead,
  phase: implemented ? 'IMPLEMENTED_NO_OUTPUT' : 'PRE_IMPLEMENTATION',
  verifiedRows: 656,
  modes: ['normal', 'optimized'],
  outputCreated: false,
  fullSourceRebuild: true,
  outcomesAccessed: false,
}));
