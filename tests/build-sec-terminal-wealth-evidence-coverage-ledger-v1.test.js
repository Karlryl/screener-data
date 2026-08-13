'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-sec-terminal-wealth-evidence-coverage-ledger-v1.py');
const CONTRACT = path.join(ROOT, 'research', 'early-detection-v4', 'sec-terminal-wealth-evidence-coverage-ledger-contract-v1.json');
const OUTPUT = path.join(ROOT, 'reports', 'early-detection', 'sec-terminal-wealth-evidence-coverage-ledger-v1.json');
const EXPECTED_CONTRACT_RAW = '3c8cf48275040568c6c8c4b5f903b3dcde10d275adfee63c548d97475a8e5cb1';
const EXPECTED_BUILDER_NORMALIZED = '08221ec0d64ac51754e20f00550b53939684d86d2f029d7304905f17a1fd791d';
const EXPECTED_TEST_NORMALIZED = '3c9e62b8456514ee323bbb456214275f4fa531cb759f77d8f44187bebc2e20b0';

function sha(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function normalizedBuilder(raw) {
  let text = raw.toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['CONTRACT_RAW', 'CONTRACT_SELF']) {
    const pattern = new RegExp(`^${name} = "[0-9a-fA-Z_]+"$`, 'gm');
    assert.strictEqual((text.match(pattern) || []).length, 1);
    text = text.replace(pattern, `${name} = "${'0'.repeat(64)}"`);
  }
  return Buffer.from(text, 'utf8');
}

function normalizedTest(raw) {
  let text = raw.toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['EXPECTED_CONTRACT_RAW', 'EXPECTED_BUILDER_NORMALIZED', 'EXPECTED_TEST_NORMALIZED']) {
    const pattern = new RegExp(`^const ${name} = '[0-9a-fA-Z_]+';$`, 'gm');
    assert.strictEqual((text.match(pattern) || []).length, 1);
    text = text.replace(pattern, `const ${name} = '${'0'.repeat(64)}';`);
  }
  return Buffer.from(text, 'utf8');
}

function run(command, optimized = false, remote = false) {
  const args = [];
  if (optimized) args.push('-O');
  args.push('-B', SCRIPT, command);
  if (remote) args.push('--remote');
  const result = spawnSync('python', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  return result;
}

assert.strictEqual(sha(fs.readFileSync(CONTRACT)), EXPECTED_CONTRACT_RAW);
assert.strictEqual(sha(normalizedBuilder(fs.readFileSync(SCRIPT))), EXPECTED_BUILDER_NORMALIZED);
assert.strictEqual(sha(normalizedTest(fs.readFileSync(__filename))), EXPECTED_TEST_NORMALIZED);

for (const optimized of [false, true]) {
  const contractResult = run('verify-contract', optimized, false);
  assert.strictEqual(contractResult.status, 0, contractResult.stderr);
  const contractJson = JSON.parse(contractResult.stdout);
  assert.strictEqual(contractJson.status, 'PASS');
  assert.strictEqual(contractJson.outcomesAccessed, false);

  const selfResult = run('self-test', optimized, false);
  assert.strictEqual(selfResult.status, 0, selfResult.stderr);
  const selfJson = JSON.parse(selfResult.stdout);
  assert.strictEqual(selfJson.status, 'PASS');
  assert.ok(selfJson.mutationKillCount >= 21);
  assert.ok(Object.values(selfJson.mutationKills).every(Boolean));

  const noRemote = run('dry-run', optimized, false);
  assert.notStrictEqual(noRemote.status, 0, 'dry-run without --remote must fail');

  const command = fs.existsSync(OUTPUT) ? 'verify-output' : 'dry-run';
  const result = run(command, optimized, true);
  assert.strictEqual(result.status, 0, result.stderr);
  const resultJson = JSON.parse(result.stdout);
  assert.strictEqual(resultJson.status, 'PASS');
  assert.strictEqual(resultJson.remoteVerified, true);
  if (command === 'dry-run') assert.strictEqual(resultJson.publicOutputCreated, false);
  assert.strictEqual(resultJson.coverage.queueRows, 44352);
  assert.strictEqual(resultJson.coverage.targetSemanticCells, 221760);
  assert.strictEqual(resultJson.coverage.resolvedSemanticCells, 0);
  assert.strictEqual(resultJson.coverage.partialEvidenceSemanticCells, 12875);
  assert.strictEqual(resultJson.coverage.semanticCoverage.CONSOLIDATED_ADJUSTED_OHLCV.partialEvidenceRows, 0);
  assert.strictEqual(resultJson.outcomesAccessed, false);
}

console.log(JSON.stringify({ status: 'PASS', phase: fs.existsSync(OUTPUT) ? 'OUTPUT_INTRODUCED' : 'PRE_OUTPUT', modes: ['normal', 'optimized'], remoteVerified: true, queueRows: 44352, targetSemanticCells: 221760, resolvedSemanticCells: 0, partialEvidenceSemanticCells: 12875, outcomesAccessed: false }));
