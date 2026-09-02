#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RUNNER_PATH = path.join(ROOT, 'scripts', 'test-offline-fixtures.js');
const runner = require(RUNNER_PATH);
const GUARD_OPTION_PATH = path.resolve(runner.GUARD_PATH).replace(/\\/g, '/');
const GUARD_REQUIRE_OPTION = `--require=${JSON.stringify(GUARD_OPTION_PATH)}`;
const GUARD_PATH_DECOY = `--conditions=${JSON.stringify(GUARD_OPTION_PATH)}`;

const EXPECTED_FILES = [
  'tests/cn-jahresreihen.test.js',
  'tests/exit-event-resolver.test.js',
  'tests/in-nse-adapter.test.js',
  'tests/jp-konzern-einzel.test.js',
  'tests/kr-sjdiv-eindeutigkeit.test.js',
  'tests/tag229a-spiegel-produktionsgleich.test.js',
  'tests/tw-jahresaggregation.test.js',
];

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

function runGuardedInline(source, extraEnvironment = {}) {
  const markerPath = runner.markerPathFor('route-test');
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
    env: runner.guardedEnvironment({ ...process.env, ...extraEnvironment }, markerPath),
    timeout: 30_000,
    windowsHide: true,
    shell: false,
  });
  result.markerPath = markerPath;
  return result;
}

test('package route is pinned to the dedicated runner', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['test:offline'], 'node scripts/test-offline-fixtures.js');
});

test('runner allowlist is exact and every pinned fixture suite exists', () => {
  assert.deepEqual(runner.OFFLINE_TEST_FILES, EXPECTED_FILES);
  for (const relativeFile of EXPECTED_FILES) {
    assert.equal(fs.statSync(path.join(ROOT, relativeFile)).isFile(), true, relativeFile);
  }
});

test('guard path text outside --require cannot suppress the real preload', () => {
  const combined = runner.appendGuardRequire(GUARD_PATH_DECOY);
  assert.equal(combined, `${GUARD_REQUIRE_OPTION} ${GUARD_PATH_DECOY}`);
});

test('guard path decoy cannot hide a caught direct network attempt', () => {
  const source = [
    "(async () => {",
    "  try { await fetch('data:text/plain,t064-decoy-direct'); } catch {}",
    "  process.exit(0);",
    "})();",
  ].join('\n');
  const result = runGuardedInline(source, { NODE_OPTIONS: GUARD_PATH_DECOY });
  assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stderr, /offline-network-guard.*fetch/);
  assert.match(runner.networkAttempts(result.markerPath).join('\n'), /:fetch$/m);
});

test('guard path decoy cannot hide a caught descendant network attempt', () => {
  const source = [
    "const { spawnSync } = require('node:child_process');",
    "const child = spawnSync(process.execPath, ['-e', \"(async () => { try { await fetch('data:text/plain,t064-decoy-child'); } catch {} process.exit(0); })();\"], { env: process.env, stdio: 'ignore' });",
    "process.exit(child.status === null ? 2 : child.status);",
  ].join('\n');
  const result = runGuardedInline(source, { NODE_OPTIONS: GUARD_PATH_DECOY });
  assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(runner.networkAttempts(result.markerPath).join('\n'), /:fetch$/m);
});

test('guard preserves NODE_OPTIONS and is active in descendant Node processes', () => {
  const source = [
    "const { spawnSync } = require('node:child_process');",
    "const active = Boolean(globalThis[Symbol.for('screener.offlineNetworkGuard')]);",
    "const child = spawnSync(process.execPath, ['-e', \"process.stdout.write(String(Boolean(globalThis[Symbol.for('screener.offlineNetworkGuard')])));\"], { encoding: 'utf8', env: process.env });",
    "process.stdout.write(JSON.stringify({ active, childStatus: child.status, childActive: child.stdout, preserved: process.env.NODE_OPTIONS.includes('--no-warnings') }));",
  ].join('\n');
  const result = runGuardedInline(source, { NODE_OPTIONS: '--no-warnings' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    active: true,
    childStatus: 0,
    childActive: 'true',
    preserved: true,
  });
  assert.deepEqual(runner.networkAttempts(result.markerPath), []);
});

test('caught data: fetch still forces a nonzero exit (mutation-sensitive probe)', () => {
  const source = [
    "(async () => {",
    "  try { await fetch('data:text/plain,t064-offline-probe'); } catch {}",
    "  process.exit(0);",
    "})();",
  ].join('\n');
  const result = runGuardedInline(source);
  assert.equal(result.status, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stderr, /offline-network-guard.*fetch/);
  assert.match(runner.networkAttempts(result.markerPath).join('\n'), /:fetch$/m);
});

test('a swallowed descendant failure remains visible through the shared marker', () => {
  const source = [
    "const { spawnSync } = require('node:child_process');",
    "spawnSync(process.execPath, ['-e', \"(async () => { try { await fetch('data:text/plain,t064-descendant-probe'); } catch {} process.exit(0); })();\"], { env: process.env, stdio: 'ignore' });",
    "process.exit(0);",
  ].join('\n');
  const result = runGuardedInline(source);
  assert.equal(result.status, 0, result.stderr);
  assert.match(runner.networkAttempts(result.markerPath).join('\n'), /:fetch$/m);
});

test('production adjudication rejects a zero-status suite with a descendant marker', () => {
  assert.equal(runner.suiteFailed({ error: null, status: 0 }, []), false);
  assert.equal(runner.suiteFailed({ error: null, status: 0 }, ['123:fetch']), true);
  assert.equal(runner.suiteFailed({ error: null, status: 1 }, []), true);
});

test('the real seven-suite route passes under the network guard', () => {
  const result = spawnSync(process.execPath, [RUNNER_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000,
  });
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /7\/7 suites passed with the network guard active/);
  for (const relativeFile of EXPECTED_FILES) assert.match(result.stdout, new RegExp(relativeFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

let passed = 0;
let failed = 0;
(async () => {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS: ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL: ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  console.log(`\nT064 offline fixture route: ${passed} passed, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
})();
