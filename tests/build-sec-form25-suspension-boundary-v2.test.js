#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = 'scripts/build-sec-form25-suspension-boundary-v2.py';
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-form25-suspension-boundary-contract-v2.json');
const BUILDER = path.join(ROOT, 'scripts', 'build-sec-form25-suspension-boundary-v2.py');
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'sec-form25-suspension-boundary-v2.json');
const EXPECTED_CEILING = 'EXACT_SOURCE_ROW_AND_PRIMARY_SEC_SENTENCE_STATE_EXCHANGE_TRADING_WAS_SUSPENDED_ON_OR_AT_A_QUALIFIED_BOUNDARY_OF_THE_STATED_DATE';

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

function normalizedBuilder(raw) {
  let text = raw.toString('utf8').replaceAll('\r\n', '\n');
  for (const name of ['CONTRACT_RAW', 'CONTRACT_SELF']) {
    const expression = new RegExp(`^${name} = "[0-9a-f]{64}"$`, 'm');
    assert.equal((text.match(expression) || []).length, 1, `${name} normalization structure changed`);
    text = text.replace(expression, `${name} = "${'0'.repeat(64)}"`);
  }
  return Buffer.from(text, 'utf8');
}

function run(optimized, command) {
  const args = optimized ? ['-O', '-B'] : ['-B'];
  args.push(SCRIPT, command, '--remote');
  const result = spawnSync(process.env.PYTHON || 'python', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 240000,
    maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return { raw: result.stdout, value: JSON.parse(result.stdout.trim()) };
}

const outputExistedBefore = fs.existsSync(OUTPUT);
const introduction = spawnSync('git', [
  'log', '--diff-filter=A', '--format=%H', '--reverse', '--',
  'research/early-detection-v4/sec-form25-suspension-boundary-contract-v2.json',
], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
assert.equal(introduction.status, 0, introduction.stderr);
const expectedPhase = !introduction.stdout.trim()
  ? 'PRE_INTRODUCTION'
  : (outputExistedBefore ? 'OUTPUT_INTRODUCED' : 'IMPLEMENTED_NO_OUTPUT');
const contractRaw = fs.readFileSync(CONTRACT);
const builderRaw = fs.readFileSync(BUILDER);
const contract = JSON.parse(contractRaw.toString('utf8'));
const contractBody = { ...contract };
delete contractBody.contractSha256;
assert.equal(contract.contractSha256, sha(Buffer.from(canonical(contractBody), 'utf8')));
assert.equal(contract.implementationContract.baseCommit, 'cb95704a6d989e6595908056c1b4e5d686cc519d');
assert.equal(contract.implementationContract.baseTag, 873);
assert.equal(contract.supersededV1.studyCredit, 'ZERO');
assert.equal(contract.supersededV1.executionAllowed, false);
assert.equal(contract.populationContract.expectedRows, 12727);
assert.equal(contract.populationContract.expectedUniqueAccessions, 6366);
assert.equal(contract.populationContract.expectedEvidenceOccurrences, 12739);
assert.deepEqual(contract.timingQualifierContract.expectedCounts, {
  AT_CLOSE_OF_TRADING_SESSION: 6,
  AT_OPEN_OF_TRADING: 12,
  DATE_ONLY_TIME_UNSPECIFIED: 12709,
});
assert.equal(contract.semanticContract.claimCeiling, EXPECTED_CEILING);
assert.deepEqual(new Set(Object.values(contract.claimLocks)), new Set([false]));
assert.equal(sha(normalizedBuilder(builderRaw)), contract.implementationContract.ownedByteBindings.builderNormalizedSha256);
assert.equal(sha(fs.readFileSync(__filename)), contract.implementationContract.ownedByteBindings.testRawSha256);

const builderText = builderRaw.toString('utf8');
const rawMatch = builderText.match(/^CONTRACT_RAW = "([0-9a-f]{64})"$/m);
const selfMatch = builderText.match(/^CONTRACT_SELF = "([0-9a-f]{64})"$/m);
assert.ok(rawMatch && selfMatch, 'builder contract bindings missing');
assert.equal(rawMatch[1], sha(contractRaw));
assert.equal(selfMatch[1], contract.contractSha256);

for (const optimized of [false, true]) {
  const verified = run(optimized, 'verify-contract').value;
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.phase, expectedPhase);
  assert.equal(verified.expectedRows, 12727);
  assert.equal(verified.remoteVerified, true);
  assert.equal(verified.outcomesAccessed, false);

  const selfTest = run(optimized, 'self-test').value;
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.verifiedRows, 12727);
  assert.equal(selfTest.uniqueAccessions, 6366);
  assert.ok(Object.keys(selfTest.mutationKills).length >= 30);
  assert.deepEqual(new Set(Object.values(selfTest.mutationKills)), new Set([true]));
  assert.equal(selfTest.outcomesAccessed, false);

  const first = run(optimized, 'dry-run');
  const second = run(optimized, 'dry-run');
  assert.equal(first.raw, second.raw, 'dry-run must be byte-identical');
  const report = first.value.report;
  assert.equal(first.value.status, 'PASS');
  assert.equal(first.value.outputCreated, false);
  assert.equal(report.schema, 'early-detection-sec-form25-suspension-boundary/v2');
  assert.equal(report.population.rows, 12727);
  assert.equal(report.population.uniqueAccessions, 6366);
  assert.equal(report.population.uniqueBlobs, 6366);
  assert.equal(report.population.evidenceOccurrences, 12739);
  assert.deepEqual(report.population.timingQualifierCounts, {
    AT_CLOSE_OF_TRADING_SESSION: 6,
    AT_OPEN_OF_TRADING: 12,
    DATE_ONLY_TIME_UNSPECIFIED: 12709,
  });
  assert.equal(report.semanticCeiling, EXPECTED_CEILING);
  assert.equal(report.rows.length, 12727);
  assert.equal(report.rows.every((row) => row.outcomesAccessed === false), true);
  assert.equal(report.rows.every((row) => row.lastTradePriceObserved === false), true);
  assert.equal(report.rows.every((row) => row.lastConsolidatedSessionObserved === false), true);
  assert.equal(report.rows.every((row) => row.laterOtcTradingExcluded === false), true);
  assert.equal(report.rows.every((row) => row.terminalWealthComplete === false), true);
  assert.deepEqual(new Set(Object.values(report.claimLocks)), new Set([false]));

  if (outputExistedBefore) {
    const stored = run(optimized, 'verify-output').value;
    assert.equal(stored.status, 'PASS');
    assert.equal(stored.phase, 'OUTPUT_INTRODUCED');
    assert.equal(stored.verifiedRows, 12727);
    assert.equal(stored.outcomesAccessed, false);
  }
}

assert.equal(fs.existsSync(OUTPUT), outputExistedBefore, 'verification and dry-run must not change output existence');
console.log(JSON.stringify({
  status: 'PASS',
  modes: ['normal', 'optimized'],
  verifiedRows: 12727,
  uniqueAccessions: 6366,
  outputPresent: outputExistedBefore,
  outcomesAccessed: false,
}));
