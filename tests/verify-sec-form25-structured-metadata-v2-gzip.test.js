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
}
console.log('verify-sec-form25-structured-metadata-v2-gzip.test.js: PASS');
