'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const builder = path.join(root, 'scripts', 'build-sec-primary-security-descriptor-v1.py');
const contractPath = path.join(
  root,
  'research',
  'early-detection-v4',
  'sec-primary-security-descriptor-contract-v1.json',
);
const output = path.join(
  root,
  'reports',
  'early-detection',
  'sec-primary-security-descriptor-v1.json',
);

function sha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function runPython(optimized, command) {
  const args = [];
  if (optimized) args.push('-O');
  args.push('-B', builder, command);
  const result = spawnSync('python', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(
    result.status,
    0,
    `${optimized ? 'python -O' : 'python'} ${command} failed:\n${result.stderr || result.stdout}`,
  );
  const lines = result.stdout.trim().split(/\r?\n/);
  return JSON.parse(lines.at(-1));
}

assert.equal(fs.existsSync(output), false, 'production output must remain absent before tests');

const contractRaw = fs.readFileSync(contractPath);
assert.equal(
  sha256(contractRaw),
  'fd16eac12600c8d297677a5801d1429cb6706c22bf294dd9b5a8933f4e9516ad',
  'contract raw binding changed',
);
const contract = JSON.parse(contractRaw);
assert.equal(contract.populationContract.expectedRows, 656);
assert.deepEqual(contract.populationContract.expectedSourceLaneCounts, {
  FORM15_V2: 65,
  FORM25_V2: 591,
});
assert.equal(contract.populationContract.tickerJoinAllowed, false);
assert.equal(contract.populationContract.crossAccessionSelectionAllowed, false);
assert.ok(Object.values(contract.claimLocks).every((value) => value === false));
assert.equal(contract.selectionContract.fieldSplittingAllowed, false);
assert.equal(contract.selectionContract.sourceRefsPreservedVerbatim, true);

const builderText = fs.readFileSync(builder, 'utf8');
assert.doesNotMatch(builderText, /^\s*(?:from\s+(?:requests|urllib)|import\s+(?:requests|urllib))/mu);
assert.match(builderText, /EXACT_ACCESSION_PLUS_EXCLUSIVE_SOURCE_LANE_WITH_QUEUE_CIK_CONSISTENCY_GUARD/);
assert.match(builderText, /PRESERVE_ALL_SOURCE_ROW_IDS_AND_DEDUPLICATE_ONLY_BYTE_IDENTICAL_EVIDENCE/);

const runs = [];
for (const optimized of [false, true]) {
  const verification = runPython(optimized, 'verify-contract');
  const selfTest = runPython(optimized, 'self-test');
  const rebuild = runPython(optimized, 'rebuild-digest');
  assert.equal(verification.status, 'PASS');
  assert.equal(verification.outcomesAccessed, false);
  assert.equal(selfTest.status, 'PASS');
  assert.equal(selfTest.rows, 656);
  assert.deepEqual(Object.keys(selfTest.kills).sort(), [
    'crossAccession',
    'descriptorPromotion',
    'outcomes',
    'rowLoss',
    'rowReorder',
    'sourceRefHash',
  ]);
  assert.ok(Object.values(selfTest.kills).every((value) => value === true));
  assert.equal(rebuild.status, 'PASS');
  assert.equal(rebuild.rows, 656);
  assert.equal(rebuild.uniqueAccessions, 652);
  assert.equal(rebuild.uniqueSourceMetadataRows, 1239);
  assert.deepEqual(rebuild.sourceLaneCounts, { FORM15_V2: 65, FORM25_V2: 591 });
  assert.equal(rebuild.twoRebuildsIdentical, true);
  assert.equal(rebuild.outcomesAccessed, false);
  runs.push(rebuild);
}

assert.equal(runs[0].rowsCanonicalSha256, runs[1].rowsCanonicalSha256);
assert.deepEqual(runs[0].fieldStatusCounts, runs[1].fieldStatusCounts);
assert.equal(fs.existsSync(output), false, 'tests must not create a production output');

console.log(JSON.stringify({
  status: 'PASS',
  rows: runs[0].rows,
  uniqueAccessions: runs[0].uniqueAccessions,
  uniqueSourceMetadataRows: runs[0].uniqueSourceMetadataRows,
  sourceLaneCounts: runs[0].sourceLaneCounts,
  rowsCanonicalSha256: runs[0].rowsCanonicalSha256,
  normalAndOptimizedIdentical: true,
  productionOutputAbsent: true,
  outcomesAccessed: false,
}));
