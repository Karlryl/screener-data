#!/usr/bin/env node
'use strict';

/**
 * Run the deliberately small set of direct, committed-fixture suites under a
 * strict network preload. This is an explicit allowlist: expanding it requires
 * evidence that the added suite is hermetic.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GUARD_PATH = path.join(ROOT, 'tests', 'helpers', 'offline-network-guard.js');

const OFFLINE_TEST_FILES = Object.freeze([
  'tests/cn-jahresreihen.test.js',
  'tests/exit-event-resolver.test.js',
  'tests/in-nse-adapter.test.js',
  'tests/jp-konzern-einzel.test.js',
  'tests/kr-sjdiv-eindeutigkeit.test.js',
  'tests/tag229a-spiegel-produktionsgleich.test.js',
  'tests/tw-jahresaggregation.test.js',
]);

function appendGuardRequire(existingNodeOptions, guardPath = GUARD_PATH) {
  const existing = String(existingNodeOptions || '').trim();
  const nativePath = path.resolve(guardPath);
  const optionPath = nativePath.replace(/\\/g, '/');
  const requireOption = `--require=${JSON.stringify(optionPath)}`;
  return existing ? `${requireOption} ${existing}` : requireOption;
}

function guardedEnvironment(baseEnvironment = process.env, markerPath) {
  const environment = {
    ...baseEnvironment,
    NODE_OPTIONS: appendGuardRequire(baseEnvironment.NODE_OPTIONS),
  };
  if (markerPath) environment.SCREENER_OFFLINE_NETWORK_MARKER = markerPath;
  return environment;
}

function markerPathFor(label) {
  const safeLabel = String(label).replace(/[^a-z0-9.-]+/gi, '-');
  return path.join(
    os.tmpdir(),
    `screener-offline-${process.pid}-${Date.now()}-${safeLabel}-${Math.random().toString(16).slice(2)}.marker`,
  );
}

function networkAttempts(markerPath) {
  if (!fs.existsSync(markerPath)) return [];
  return fs.readFileSync(markerPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
}

function suiteFailed(result, attempts) {
  return Boolean(
    !result
    || result.error
    || result.status !== 0
    || attempts.length > 0,
  );
}

function run({ log = console.log, error = console.error } = {}) {
  let failures = 0;

  for (const relativeFile of OFFLINE_TEST_FILES) {
    const markerPath = markerPathFor(relativeFile);
    const environment = guardedEnvironment(process.env, markerPath);
    log(`\n[offline-fixtures] ${relativeFile}`);
    const result = spawnSync(process.execPath, [path.join(ROOT, relativeFile)], {
      cwd: ROOT,
      env: environment,
      stdio: 'inherit',
    });

    if (result.error) {
      error(`[offline-fixtures] ERROR ${relativeFile}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      error(`[offline-fixtures] FAIL ${relativeFile}: exit ${String(result.status)}`);
    }
    const attempts = networkAttempts(markerPath);
    if (attempts.length) {
      error(`[offline-fixtures] NETWORK ${relativeFile}: ${attempts.join(', ')}`);
    }
    if (suiteFailed(result, attempts)) failures += 1;
  }

  if (failures) {
    error(`\n[offline-fixtures] ${failures}/${OFFLINE_TEST_FILES.length} suite(s) failed.`);
    return 1;
  }
  log(`\n[offline-fixtures] ${OFFLINE_TEST_FILES.length}/${OFFLINE_TEST_FILES.length} suites passed with the network guard active.`);
  return 0;
}

if (require.main === module) process.exitCode = run();

module.exports = {
  GUARD_PATH,
  OFFLINE_TEST_FILES,
  appendGuardRequire,
  guardedEnvironment,
  markerPathFor,
  networkAttempts,
  suiteFailed,
  run,
};
