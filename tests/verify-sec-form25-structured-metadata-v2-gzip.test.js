const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
for (const optimized of [false, true]) {
  const args = [];
  if (optimized) args.push('-O');
  args.push('-B', 'scripts/verify-sec-form25-structured-metadata-v2-gzip.py', 'self-test');
  const run = spawnSync('python', args, { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.status, 'PASS');
  assert.equal(result.outcomesAccessed, false);
  assert.deepEqual(result.mutationKills, { candidate: true, claim: true, rowOrder: true });

  const verifyArgs = [];
  if (optimized) verifyArgs.push('-O');
  verifyArgs.push('-B', 'scripts/verify-sec-form25-structured-metadata-v2-gzip.py', 'verify');
  const verifyRun = spawnSync('python', verifyArgs, { cwd: root, encoding: 'utf8' });
  assert.equal(verifyRun.status, 0, verifyRun.stderr);
  const verified = JSON.parse(verifyRun.stdout.trim());
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.rows, 27285);
  assert.equal(verified.candidateOnlySnippets, 1993);
  assert.equal(verified.sourceRebuild, false);
  assert.equal(verified.outcomesAccessed, false);
}
console.log('verify-sec-form25-structured-metadata-v2-gzip.test.js: PASS');
