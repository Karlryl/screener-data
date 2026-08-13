#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'build-finra-form345-event-candidate-profile-v1.py');
const contractPath = path.join(root, 'research', 'early-detection-v4', 'finra-form345-event-candidate-profile-contract-v1.json');
const output = path.join(root, 'reports', 'early-detection', 'finra-form345-event-candidate-profile-v1.json');
const EXPECTED_CONTRACT_RAW = '5ce36408ab6faae88d9b0f23804f1ff51d3ae499f638a379e577b435f3d09a15';
const EXPECTED_OUTPUT_RAW = 'c4466abbd54fb0dc017b36c697ed979dbd0d8a5c1a48c26691fae1fee94ceca8';
const EXPECTED_OUTPUT_SELF = 'cf9ee1d3f78ea4af90bd4af00c85f76cd9ca676cba4f6010fef488ba1e79e444';
const EXPECTED_OUTPUT_COMMIT = 'bcf14905b8002249099357a0ec66f122de84808b';
const REMOTE_URL = 'https://github.com/Karlryl/screener-data.git';
const REMOTE_TRACKING_REF = 'refs/remotes/origin/codex/early-detection-v4-gates-20260810';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function command(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 600000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function run(optimized, commandName, runRoot = root) {
  const runScript = path.join(runRoot, 'scripts', 'build-finra-form345-event-candidate-profile-v1.py');
  const args = optimized ? ['-O', '-B', runScript, commandName] : ['-B', runScript, commandName];
  const result = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: runRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 600000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout.trim());
  assert.equal(value.status, 'PASS');
  assert.equal(value.outcomesAccessed, false);
  return value;
}

assert.equal(sha(fs.readFileSync(contractPath)), EXPECTED_CONTRACT_RAW);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
assert.equal(contract.sourceBase.commit, '6d69e42eb377b6345f7392e57e693d924b366cc3');
assert.equal(contract.expectedPopulation.candidateEvents, 8);
assert.equal(contract.expectedPopulation.candidateCiks, 5);
assert.equal(contract.expectedPopulation.matchedGapRows, 0);
assert.equal(contract.privacyContract.publicAggregateOnly, true);
assert.equal(contract.privacyContract.privateRowLevelLedgersEmitted, false);
assert.equal(contract.privacyContract.identifiersSymbolsNamesDescriptionsAccessionsAndRawRowsIncluded, false);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));

if (!fs.existsSync(output)) {
  for (const optimized of [false, true]) {
    const verified = run(optimized, 'verify-contract');
    assert.equal(verified.sourceBaseCommit, contract.sourceBase.commit);
    const tested = run(optimized, 'self-test');
    assert.deepEqual(new Set(Object.values(tested.selectionKills)), new Set([true]));
    assert.deepEqual(new Set(Object.values(tested.reportKills)), new Set([true]));
  }

  const rebuilt = run(false, 'rebuild-digest');
  assert.equal(rebuilt.aggregateSha256, 'f4617a5801e9596c15d56bdeb55becc723da60e18764044ea71a27db48fed7d3');
  assert.equal(rebuilt.candidateEvents, 8);
  assert.equal(rebuilt.candidateCiks, 5);
  assert.equal(rebuilt.matchedGapRows, 0);
  assert.equal(rebuilt.twoIndependentFullRebuilds, true);
  assert.equal(fs.existsSync(output), false, 'pre-output tests must not write the production output');
} else {
  assert.equal(command('git', ['merge-base', '--is-ancestor', EXPECTED_OUTPUT_COMMIT, 'HEAD'], root), '');
  assert.equal(command('git', ['hash-object', '--no-filters', '--', output], root), command('git', ['rev-parse', `${EXPECTED_OUTPUT_COMMIT}:reports/early-detection/finra-form345-event-candidate-profile-v1.json`], root));
  const sealedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'finra-form345-tag842-'));
  try {
    command('git', ['clone', '--shared', '--no-checkout', root, sealedRoot], root);
    command('git', ['remote', 'set-url', 'origin', REMOTE_URL], sealedRoot);
    command('git', ['config', 'core.autocrlf', 'false'], sealedRoot);
    command('git', ['config', 'core.eol', 'lf'], sealedRoot);
    command('git', ['checkout', '--detach', EXPECTED_OUTPUT_COMMIT], sealedRoot);
    command('git', ['update-ref', REMOTE_TRACKING_REF, EXPECTED_OUTPUT_COMMIT], sealedRoot);
    for (const optimized of [false, true]) {
      const verified = run(optimized, 'verify-output', sealedRoot);
      assert.equal(verified.privateSourceRebuildVerified, true);
      assert.equal(verified.rawSha256, EXPECTED_OUTPUT_RAW);
      assert.equal(verified.reportSha256, EXPECTED_OUTPUT_SELF);
      assert.equal(verified.candidateEvents, 8);
      assert.equal(verified.candidateCiks, 5);
      assert.equal(verified.matchedGapRows, 0);
    }
  } finally {
    fs.rmSync(sealedRoot, { recursive: true, force: true });
  }

  const raw = fs.readFileSync(output);
  const report = JSON.parse(raw);
  const body = { ...report };
  delete body.reportSha256;
  assert.equal(sha(raw), EXPECTED_OUTPUT_RAW);
  assert.equal(report.reportSha256, EXPECTED_OUTPUT_SELF);
  assert.equal(sha(Buffer.from(JSON.stringify(canonical(body)))), EXPECTED_OUTPUT_SELF);
  assert.equal(report.aggregate.candidateEvents, 8);
  assert.equal(report.aggregate.candidateCiks, 5);
  assert.equal(report.aggregate.matchedGapRows, 0);
  assert.equal(report.aggregate.candidateEventGapPairs, 0);
  assert.equal(report.interpretation.resolvedRows, 0);
  assert.deepEqual(report.privacy, {
    accessionsIncluded: false,
    aggregateOnly: true,
    candidateRowHashesIncluded: false,
    identifiersIncluded: false,
    namesOrDescriptionsIncluded: false,
    privateRowsIncluded: false,
    symbolsIncluded: false,
  });
  assert.deepEqual(Object.keys(report.claimLocks).sort(), Object.keys(contract.claimLocks).sort());
  assert.deepEqual(new Set(Object.values(report.claimLocks)), new Set([false]));
  assert.equal(report.outcomesAccessed, false);
  assert.equal(report.interpretation.mayInferIdentityListingIntervalOrTickerReuse, false);
  assert.equal(report.interpretation.mayInferTerminalSessionPaymentWealthOrReturn, false);
  assert.equal(report.interpretation.originalV4GateCredit, false);

  const forbiddenKeys = new Set([
    'rows', 'row', 'issuerCik', 'cik', 'accession', 'accessionNumber', 'workItemId',
    'OTCDailyListID', 'oldSymbolCode', 'newSymbolCode', 'issuerTradingSymbol',
    'issuerName', 'oldSecurityDescription', 'newSecurityDescription',
  ]);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        assert.equal(forbiddenKeys.has(key), false, `private row-level key in public output: ${key}`);
        visit(item);
      }
    }
  };
  visit(report);
}

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /urllib|requests\.|http\.client|socket\.|aiohttp|fetch\(/);
console.log('build-finra-form345-event-candidate-profile-v1.test.js: PASS');
