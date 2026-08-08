'use strict';

// Outcome-free execution tests for the complete sealed confirmatory runner.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'early-detection-confirmatory.py');
const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
const python = process.env.FEM_PYTHON || (fs.existsSync(bundled) ? bundled : (process.platform === 'win32' ? 'python' : 'python3'));

assert.ok(fs.existsSync(script), 'confirmatory runner must exist');
const result = spawnSync(python, [script, '--self-test'], { cwd: root, encoding: 'utf8', timeout: 120000 });
assert.strictEqual(result.status, 0, String(result.stderr || result.stdout));
const report = JSON.parse(result.stdout);
assert.deepStrictEqual(report, { checks: 27, protocol: 'FEM-SEC-US@1.2.0', status: 'PASS' });

console.log('early-detection-confirmatory: outcome-free runner tests passed');
