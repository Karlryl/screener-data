const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-continuous-free-source-v12.py');

function run(args, optimized = false) {
  const full = optimized ? ['-O', script, ...args] : [script, ...args];
  const out = spawnSync('python', full, { cwd: root, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  return JSON.parse(out.stdout);
}

test('V12 binds the audited Q003 V5 trust root under normal and optimized Python', () => {
  for (const optimized of [false, true]) {
    const result = run(['self-test'], optimized);
    assert.equal(result.status, 'PASS');
    assert.equal(result.v11SemanticsPass, true);
    assert.equal(result.q003V5BindingsExact, true);
    assert.equal(result.q003V4CannotSubstituteV5, true);
    assert.equal(result.outcomesAccessed, false);
  }
});
