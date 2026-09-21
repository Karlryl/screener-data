'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  OFFLINE_LANES, OFFLINE_TEST_FILES, resolveLanes, guardedEnvironment,
} = require('../scripts/test-offline-fixtures.js');
const { scripts } = require('../package.json');
const ROOT = path.resolve(__dirname, '..');
const EXPECTED = {
  intake: [
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
  ],
  preis: [
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
  ],
  earnings: [
    'tests/e2-earnings-blowout.test.js',
    'tests/earnings-cli-root-shape.test.js',
    'tests/p1-welle6-vollabruf-wahrheit.test.js',
    'tests/stage-public-data.test.js',
  ],
};
const NAMES = ['intake', 'preis', 'earnings'];

function pruefeBahnen(tabelle) {
  assert.deepEqual(Object.keys(tabelle), NAMES);
  for (const name of NAMES) {
    assert.ok(Array.isArray(tabelle[name]) && tabelle[name].length > 0);
  }
  assert.deepEqual(tabelle, EXPECTED);
}

function fehlendeDateien(tabelle) {
  return Object.values(tabelle).flat().filter((file) => !fs.existsSync(path.join(ROOT, file)));
}

function doppelte(tabelle) {
  const seen = new Set();
  const duplicates = new Set();
  for (const file of Object.values(tabelle).flat()) {
    if (seen.has(file)) duplicates.add(file);
    seen.add(file);
  }
  return [...duplicates];
}

function pruefeVereinigung(files, tabelle) {
  assert.deepEqual(files, Object.values(tabelle).flat());
}

function fehlendeRouten(routes, bahnen) {
  const command = 'node scripts/test-offline-fixtures.js';
  const expected = { 'test:offline': command };
  for (const name of Object.keys(bahnen)) expected[`test:offline:${name}`] = `${command} ${name}`;
  return Object.keys(expected).filter((route) => routes[route] !== expected[route]);
}

function pruefeFreeze(tabelle, files) {
  assert.ok(Object.isFrozen(tabelle));
  for (const lane of Object.values(tabelle)) assert.ok(Object.isFrozen(lane));
  assert.ok(Object.isFrozen(files));
}

function pruefeUmgebung(environment, marker) {
  const guard = path.join(ROOT, 'tests', 'helpers', 'offline-network-guard.js').replace(/\\/g, '/');
  assert.equal(environment.NODE_OPTIONS, `--require=${JSON.stringify(guard)} --trace-warnings`);
  assert.equal(environment.SCREENER_OFFLINE_NETWORK_MARKER, marker);
  assert.equal(Object.hasOwn(environment, 'SCREENER_OFFLINE_NETWORK_MARKER'), marker !== undefined);
}

let ok = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    ok += 1;
    console.log(`OK ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}

test('exact lane names, order and membership, with missing/empty/extra controls', () => {
  pruefeBahnen(OFFLINE_LANES);
  const { preis, ...missing } = OFFLINE_LANES;
  assert.throws(() => pruefeBahnen(missing), assert.AssertionError);
  assert.throws(() => pruefeBahnen({ ...OFFLINE_LANES, preis: [] }), assert.AssertionError);
  assert.throws(() => pruefeBahnen({ ...OFFLINE_LANES, extra: preis }), assert.AssertionError);
  assert.throws(() => pruefeBahnen({ ...OFFLINE_LANES, preis: preis.slice(1) }), assert.AssertionError);
  assert.throws(() => pruefeBahnen({ ...OFFLINE_LANES, preis: [...preis, 'extra'] }), assert.AssertionError);
});

test('every listed file exists; invented file is reported exactly', () => {
  assert.deepEqual(fehlendeDateien(OFFLINE_LANES), []);
  const invented = 'tests/offline-vertragsnetz-invented-missing.test.js';
  assert.deepEqual(fehlendeDateien({ ...OFFLINE_LANES, earnings: [...OFFLINE_LANES.earnings, invented] }), [invented]);
});

test('no duplicate files, including within and across lanes', () => {
  assert.deepEqual(doppelte(OFFLINE_LANES), []);
  const file = OFFLINE_LANES.intake[0];
  assert.deepEqual(doppelte({ ...OFFLINE_LANES, intake: [...OFFLINE_LANES.intake, file] }), [file]);
  assert.deepEqual(doppelte({ ...OFFLINE_LANES, preis: [...OFFLINE_LANES.preis, file] }), [file]);
});

test('compatibility export is exactly the ordered union', () => {
  pruefeVereinigung(OFFLINE_TEST_FILES, OFFLINE_LANES);
  assert.throws(() => pruefeVereinigung(OFFLINE_TEST_FILES.slice(1), OFFLINE_LANES), assert.AssertionError);
  assert.throws(() => pruefeVereinigung([...OFFLINE_TEST_FILES, 'extra'], OFFLINE_LANES), assert.AssertionError);
  assert.throws(() => pruefeVereinigung([...OFFLINE_TEST_FILES].reverse(), OFFLINE_LANES), assert.AssertionError);
});

test('table, lane arrays and compatibility export are frozen', () => {
  pruefeFreeze(OFFLINE_LANES, OFFLINE_TEST_FILES);
  assert.throws(() => pruefeFreeze({ ...OFFLINE_LANES }, OFFLINE_TEST_FILES), assert.AssertionError);
  assert.throws(() => pruefeFreeze(Object.freeze({ ...OFFLINE_LANES, preis: [...OFFLINE_LANES.preis] }), OFFLINE_TEST_FILES), assert.AssertionError);
  assert.throws(() => pruefeFreeze(OFFLINE_LANES, [...OFFLINE_TEST_FILES]), assert.AssertionError);
});

test('aggregate and lane routes pass exactly the specified arguments', () => {
  assert.deepEqual(fehlendeRouten(scripts, OFFLINE_LANES), []);
  for (const route of ['test:offline', ...NAMES.map((name) => `test:offline:${name}`)]) {
    const missing = { ...scripts };
    delete missing[route];
    assert.deepEqual(fehlendeRouten(missing, OFFLINE_LANES), [route]);
    assert.deepEqual(fehlendeRouten({ ...scripts, [route]: 'node scripts/test-offline-fixtures.js quatsch' }, OFFLINE_LANES), [route]);
    assert.deepEqual(fehlendeRouten({ ...scripts, [route]: `${scripts[route]} extra` }, OFFLINE_LANES), [route]);
  }
});

test('resolver defaults, selection and unknown-name error', () => {
  assert.deepEqual(resolveLanes(), NAMES);
  assert.deepEqual(resolveLanes([]), NAMES);
  assert.deepEqual(resolveLanes(['preis']), ['preis']);
  assert.deepEqual(resolveLanes(['earnings', 'intake']), ['earnings', 'intake']);
  for (const unknown of ['quatsch', 'toString']) {
    assert.throws(() => resolveLanes(['intake', unknown]), (error) =>
      error instanceof Error && [unknown, ...NAMES].every((name) => error.message.includes(name)));
  }
});

test('guard path and marker are set, with absent-marker and sabotaged controls', () => {
  const base = { NODE_OPTIONS: '--trace-warnings' };
  const marker = path.join(ROOT, 'unused-offline-marker');
  const environment = guardedEnvironment(base, marker);
  pruefeUmgebung(environment, marker);
  pruefeUmgebung(guardedEnvironment(base), undefined);
  assert.throws(() => pruefeUmgebung({ ...environment, NODE_OPTIONS: '--trace-warnings' }, marker), assert.AssertionError);
  const missing = { ...environment };
  delete missing.SCREENER_OFFLINE_NETWORK_MARKER;
  assert.throws(() => pruefeUmgebung(missing, marker), assert.AssertionError);
  assert.throws(() => pruefeUmgebung(environment, undefined), assert.AssertionError);
  assert.deepEqual(base, { NODE_OPTIONS: '--trace-warnings' });
});

console.log(`\n${ok} OK, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
