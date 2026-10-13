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

const OFFLINE_LANES = Object.freeze({
  intake: Object.freeze([
    'tests/cn-jahresreihen.test.js',
    'tests/exit-event-resolver.test.js',
    'tests/in-nse-adapter.test.js',
    'tests/jp-konzern-einzel.test.js',
    'tests/kr-sjdiv-eindeutigkeit.test.js',
    'tests/tag229a-spiegel-produktionsgleich.test.js',
    'tests/tw-jahresaggregation.test.js',
    'tests/pull-diet.test.js',
    'tests/pull-shard.test.js',
    'tests/voll-pull-ticker.test.js',
    'tests/pull-insider-form4-daily-date-validation.test.js',
    'tests/check-pull-stats-count-shape.test.js',
    'tests/t564-datenkanal.test.js',
  ]),
  preis: Object.freeze([
    'tests/backfill-prices.test.js',
    'tests/backfill-prices-arg-presence.test.js',
    'tests/backfill-prices-max-minimum-bars-guard.test.js',
    'tests/backfill-prices-max-resume.test.js',
    'tests/backfill-prices-research-resume.test.js',
    'tests/merge-price-shards-expected-count.test.js',
    'tests/migrate-price-history-shards-partial-set.test.js',
    'tests/price-history-store.test.js',
    'tests/price-history-store-layout-paths-guard.test.js',
    'tests/price-history-store-shard-filename-guard.test.js',
    'tests/price-history-store-shard-path-guard.test.js',
    'tests/pull-price-order.test.js',
    'tests/s4-price-001-preis-abdeckung.test.js',
    'tests/waehrung-handelskurs.test.js',
  ]),
  earnings: Object.freeze([
    'tests/e2-earnings-blowout.test.js',
    'tests/earnings-cli-root-shape.test.js',
    'tests/p1-welle6-vollabruf-wahrheit.test.js',
    'tests/stage-public-data.test.js',
  ]),
});

const OFFLINE_TEST_FILES = Object.freeze(Object.values(OFFLINE_LANES).flat());

function resolveLanes(names) {
  const validNames = Object.keys(OFFLINE_LANES);
  if (!names || names.length === 0) return validNames;
  for (const name of names) {
    if (!Object.hasOwn(OFFLINE_LANES, name)) {
      throw new Error(`Unknown offline lane "${name}". Valid lanes: ${validNames.join(', ')}`);
    }
  }
  return [...names];
}

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

function run({ lanes, log = console.log, error = console.error } = {}) {
  const selectedLanes = resolveLanes(lanes);
  const total = selectedLanes.reduce((sum, name) => sum + OFFLINE_LANES[name].length, 0);
  let failures = 0;

  for (const lane of selectedLanes) {
    log(`\n[offline-fixtures] lane: ${lane}`);
    for (const relativeFile of OFFLINE_LANES[lane]) {
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
  }

  if (failures) {
    error(`\n[offline-fixtures] ${failures}/${total} suite(s) failed (lanes: ${selectedLanes.join(', ')}).`);
    return 1;
  }
  log(`\n[offline-fixtures] ${total}/${total} suites passed with the network guard active (lanes: ${selectedLanes.join(', ')}).`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run({ lanes: process.argv.slice(2) });
  } catch (error) {
    console.error(`[offline-fixtures] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  GUARD_PATH,
  OFFLINE_LANES,
  OFFLINE_TEST_FILES,
  resolveLanes,
  appendGuardRequire,
  guardedEnvironment,
  markerPathFor,
  networkAttempts,
  suiteFailed,
  run,
};
