#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  loadBaseline,
  validateBaseline,
  main
} = require('../scripts/watch-exchange-coverage.js');

const SHAPE_CODE = 'ERR_EXCHANGE_COVERAGE_BASELINE_SHAPE';
const BASELINE_PATH = 'C:\\fixture\\exchange-coverage-baseline.json';
const SNAP_DIR = 'C:\\fixture\\snapshots';

function jsonReader(value, calls) {
  const raw = JSON.stringify(value);
  return (file, encoding) => {
    if (calls) calls.push(['read', file, encoding]);
    return raw;
  };
}

function missingReader() {
  const error = new Error('missing');
  error.code = 'ENOENT';
  throw error;
}

function assertShapeError(value, label) {
  assert.throws(
    () => loadBaseline(BASELINE_PATH, jsonReader(value)),
    (error) => error && error.code === SHAPE_CODE && /NICHT ueberschrieben/.test(error.message),
    label
  );
}

test('valid current, legacy, empty, and underscore-metadata baselines remain accepted', () => {
  const current = {
    NYSE: [100, 101, 102],
    '(unknown)': [0, 2],
    _lastUpdated: '2026-09-01'
  };
  const legacy = { Shenzhen: [68] };
  const metadata = { NYSE: [1], _lastUpdated: '2026-08-31', _producer: { version: 2 } };

  assert.deepEqual(loadBaseline(BASELINE_PATH, jsonReader(current)), current);
  assert.deepEqual(loadBaseline(BASELINE_PATH, jsonReader(legacy)), legacy,
    'eleven historical revisions without _lastUpdated must stay compatible');
  assert.deepEqual(loadBaseline(BASELINE_PATH, jsonReader({})), {},
    'an explicitly empty seed object is a valid bootstrap state');
  assert.deepEqual(loadBaseline(BASELINE_PATH, jsonReader(metadata)), metadata,
    'the established underscore-prefixed metadata convention must remain extensible');
});

test('a genuinely missing baseline remains the supported first-run bootstrap', () => {
  assert.deepEqual(loadBaseline(BASELINE_PATH, missingReader), {});
});

test('valid JSON roots that are not plain objects fail closed', async t => {
  for (const [label, value] of [
    ['null', null],
    ['array', []],
    ['string', 'baseline'],
    ['number', 7],
    ['boolean', false]
  ]) {
    await t.test(label, () => assertShapeError(value, label));
  }
});

test('exchange histories must be bounded arrays of non-negative safe integers', async t => {
  const cases = [
    ['null history', { NYSE: null }],
    ['object history', { NYSE: {} }],
    ['string history', { NYSE: '100' }],
    ['numeric history', { NYSE: 100 }],
    ['too many entries', { NYSE: Array(15).fill(100) }],
    ['string count', { NYSE: Array(14).fill('100') }],
    ['negative count', { NYSE: [100, -1] }],
    ['fractional count', { NYSE: [100, 1.5] }],
    ['unsafe count', { NYSE: [Number.MAX_SAFE_INTEGER + 1] }],
    ['null count', { NYSE: [100, null] }],
    ['boolean count', { NYSE: [100, true] }],
    ['object count', { NYSE: [100, {}] }],
    ['nested count', { NYSE: [100, [1]] }]
  ];

  for (const [label, value] of cases) {
    await t.test(label, () => assertShapeError(value, label));
  }
});

test('_lastUpdated is optional but must be a real canonical calendar date when present', async t => {
  for (const [label, value] of [
    ['null', null],
    ['number', 20260901],
    ['empty', ''],
    ['noncanonical', '2026-9-1'],
    ['impossible day', '2026-02-30'],
    ['datetime', '2026-09-01T00:00:00Z']
  ]) {
    await t.test(label, () => assertShapeError({ NYSE: [100], _lastUpdated: value }, label));
  }
});

test('syntax and non-ENOENT read failures remain loud and preserve the baseline', () => {
  assert.throws(
    () => loadBaseline(BASELINE_PATH, () => '{broken-json'),
    /Baseline nicht lesbar.*Baseline wird NICHT ueberschrieben/
  );
  const denied = new Error('access denied');
  denied.code = 'EACCES';
  assert.throws(
    () => loadBaseline(BASELINE_PATH, () => { throw denied; }),
    /Baseline nicht lesbar.*access denied.*Baseline wird NICHT ueberschrieben/
  );
});

test('the executable CLI bootstrap remains wired to fail visibly', () => {
  const source = fs.readFileSync(require.resolve('../scripts/watch-exchange-coverage.js'), 'utf8');
  assert.match(source, /if \(require\.main === module\) \{\s*try \{ main\(\); \}/,
    'direct execution must still invoke the production main path');
  assert.match(source, /catch \(e\) \{ console\.error\('::error::watch-exchange-coverage hat NICHT geprueft:/,
    'direct execution must still expose unexpected failures as a workflow error');
  assert.match(source, /process\.exitCode = 1; \}\s*\}/,
    'the direct-execution catch path must still fail the process');
});

test('validation rejects the malformed state before snapshot scan, mkdir, or write', () => {
  assert.equal(typeof main, 'function', 'the real production path must be directly testable');
  assert.equal(typeof validateBaseline, 'function', 'the shape contract must be directly testable');
  const calls = [];

  assert.throws(() => main({
    baselinePath: BASELINE_PATH,
    snapDir: SNAP_DIR,
    readFileSync: jsonReader({ NYSE: Array(14).fill('100') }, calls),
    countByExchange: () => { calls.push(['scan']); return { NYSE: 0 }; },
    mkdirSync: () => calls.push(['mkdir']),
    writeJsonAtomic: () => calls.push(['write']),
    log: () => calls.push(['log']),
    error: () => calls.push(['error']),
    setExitCode: () => calls.push(['exit'])
  }), (error) => error && error.code === SHAPE_CODE);

  assert.deepEqual(calls, [['read', BASELINE_PATH, 'utf8']],
    'no snapshot or write-side effect may occur after malformed baseline evidence is read');
});

test('the injected production control keeps read -> scan -> mkdir -> write ordering', () => {
  const calls = [];
  let written = null;
  let exitCode = null;
  const history = Array(14).fill(100);

  main({
    baselinePath: BASELINE_PATH,
    snapDir: SNAP_DIR,
    dateStr: '2026-09-01',
    readFileSync: jsonReader({ NYSE: history, _lastUpdated: '2026-08-31' }, calls),
    countByExchange: (dir) => { calls.push(['scan', dir]); return { NYSE: 100 }; },
    mkdirSync: (dir, options) => calls.push(['mkdir', dir, options.recursive]),
    writeJsonAtomic: (file, value) => { calls.push(['write', file]); written = value; },
    log: (line) => calls.push(['log', line]),
    error: (line) => calls.push(['error', line]),
    setExitCode: (code) => { exitCode = code; calls.push(['exit', code]); }
  });

  assert.deepEqual(calls.slice(0, 4).map((entry) => entry[0]), ['read', 'scan', 'log', 'mkdir']);
  assert.deepEqual(calls.find((entry) => entry[0] === 'scan'), ['scan', SNAP_DIR]);
  assert.deepEqual(calls.find((entry) => entry[0] === 'mkdir'),
    ['mkdir', path.dirname(BASELINE_PATH), true]);
  assert.deepEqual(calls.find((entry) => entry[0] === 'write'), ['write', BASELINE_PATH]);
  assert.equal(calls.some((entry) => entry[0] === 'error'), false);
  assert.equal(exitCode, null);
  const writeIndex = calls.findIndex((entry) => entry[0] === 'write');
  const updatedLogIndex = calls.findIndex((entry) => entry[0] === 'log' &&
    entry[1].startsWith('Baseline updated:'));
  const healthyLogIndex = calls.findIndex((entry) => entry[0] === 'log' &&
    entry[1] === 'No exchange coverage drift.');
  assert.ok(writeIndex < updatedLogIndex && updatedLogIndex < healthyLogIndex,
    'success must only be reported after persistence succeeds');
  assert.deepEqual(written.NYSE, history);
  assert.equal(written._lastUpdated, '2026-09-01');
});

test('a malformed run date cannot poison a valid baseline or reach the writer', () => {
  const calls = [];

  assert.throws(() => main({
    baselinePath: BASELINE_PATH,
    snapDir: SNAP_DIR,
    dateStr: 'not-a-date',
    readFileSync: jsonReader({ NYSE: [100], _lastUpdated: '2026-08-31' }, calls),
    countByExchange: () => { calls.push(['scan']); return { NYSE: 100 }; },
    mkdirSync: () => calls.push(['mkdir']),
    writeJsonAtomic: () => calls.push(['write']),
    log: () => calls.push(['log']),
    error: () => calls.push(['error']),
    setExitCode: () => calls.push(['exit'])
  }), (error) => error && error.code === SHAPE_CODE);

  assert.equal(calls.some((entry) => entry[0] === 'scan'), true,
    'the current counts are still needed to build the candidate baseline');
  assert.equal(calls.some((entry) => entry[0] === 'mkdir'), false);
  assert.equal(calls.some((entry) => entry[0] === 'write'), false,
    'an output rejected by the next reader must never be persisted');
});

test('mkdir and atomic-write failures propagate without a false success report', async t => {
  for (const stage of ['mkdir', 'write']) {
    await t.test(stage, () => {
      const calls = [];
      const persistenceError = new Error(`${stage} failed`);

      assert.throws(() => main({
        baselinePath: BASELINE_PATH,
        snapDir: SNAP_DIR,
        dateStr: '2026-09-01',
        readFileSync: jsonReader({ NYSE: [100], _lastUpdated: '2026-08-31' }, calls),
        countByExchange: () => ({ NYSE: 100 }),
        mkdirSync: () => {
          calls.push(['mkdir']);
          if (stage === 'mkdir') throw persistenceError;
        },
        writeJsonAtomic: () => {
          calls.push(['write']);
          if (stage === 'write') throw persistenceError;
        },
        log: (line) => calls.push(['log', line]),
        error: (line) => calls.push(['error', line]),
        setExitCode: (code) => calls.push(['exit', code])
      }), (error) => error === persistenceError);

      assert.equal(calls.some((entry) => entry[0] === 'log' &&
        entry[1].startsWith('Baseline updated:')), false);
      assert.equal(calls.some((entry) => entry[0] === 'log' &&
        entry[1] === 'No exchange coverage drift.'), false);
    });
  }
});

test('a valid alarming run still writes first, freezes history, then exits red', () => {
  const calls = [];
  let written = null;
  const history = Array(14).fill(100);

  main({
    baselinePath: BASELINE_PATH,
    snapDir: SNAP_DIR,
    dateStr: '2026-09-01',
    readFileSync: jsonReader({ NYSE: history, _lastUpdated: '2026-08-31' }, calls),
    countByExchange: () => { calls.push(['scan']); return { NYSE: 0 }; },
    mkdirSync: () => calls.push(['mkdir']),
    writeJsonAtomic: (file, value) => { calls.push(['write']); written = value; },
    log: () => calls.push(['log']),
    error: (line) => calls.push(['error', line]),
    setExitCode: (code) => calls.push(['exit', code])
  });

  assert.deepEqual(written.NYSE, history, 'an alarming zero must remain outside the healthy window');
  assert.ok(calls.findIndex((entry) => entry[0] === 'write') <
    calls.findIndex((entry) => entry[0] === 'error'), 'baseline write must remain before the alarm branch');
  assert.match(calls.find((entry) => entry[0] === 'error')[1],
    /^::error::Exchange coverage drop detected .*NYSE/);
  assert.deepEqual(calls.at(-1), ['exit', 1]);
});
