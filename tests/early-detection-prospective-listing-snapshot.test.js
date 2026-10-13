'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
const python = process.env.FEM_PYTHON || (fs.existsSync(bundled) ? bundled : (process.platform === 'win32' ? 'python' : 'python3'));

function runSelfTest(scriptName) {
  const script = path.join(root, 'scripts', scriptName);
  assert.equal(fs.existsSync(script), true, `${scriptName} must exist`);
  const run = spawnSync(python, [script, 'self-test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(run.status, 0, String(run.stderr || run.stdout));
  return JSON.parse(run.stdout);
}

test('prospective listing collector is immutable and fail-closed', () => {
  const result = runSelfTest('early-detection-prospective-listing-snapshot.py');
  assert.deepEqual(result, {
    immutableDeduplication: true,
    overwriteRejected: true,
    resultComputationAllowed: false,
    status: 'PASS',
  });
});

test('prospective listing verifier rejects tampering independently', () => {
  const result = runSelfTest('early-detection-prospective-listing-snapshot-verifier.py');
  assert.deepEqual(result, {
    panelCompared: true,
    status: 'PASS',
    tamperedSnapshotRejected: true,
    validSnapshotAccepted: true,
  });
});
