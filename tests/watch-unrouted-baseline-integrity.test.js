'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const watcher = require('../scripts/watch-unrouted-quote.js');

const SHAPE_CODE = 'ERR_UNROUTED_LABEL_BASELINE_SHAPE';
const BASELINE_PATH = path.join(__dirname, '..', 'data-health', 'unrouted-labels-baseline.json');

function jsonReader(value) {
  return () => JSON.stringify(value);
}

function readError(code, message = code) {
  return () => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
}

function expectShapeError(fn) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, SHAPE_CODE);
    assert.match(error.message, /NICHT ueberschrieben/);
    return true;
  });
}

function harness({ baseline, readFileSync, scan } = {}) {
  const calls = [];
  const logs = [];
  const errors = [];
  const exits = [];
  const writes = [];
  const baselinePath = 'C:\\fixture\\unrouted-labels-baseline.json';
  const snapDir = 'C:\\fixture\\snapshots';

  const options = {
    baselinePath,
    snapDir,
    readFileSync: readFileSync || (() => JSON.stringify(baseline)),
    scanSnapshots: (actualPath) => {
      calls.push(['scan', actualPath]);
      return scan || { routable: 1, noSector: 0, labels: new Set(['sector:Technology']) };
    },
    mkdirSync: (actualPath, actualOptions) => calls.push(['mkdir', actualPath, actualOptions]),
    writeJsonAtomic: (actualPath, value) => {
      calls.push(['write', actualPath]);
      writes.push(value);
    },
    nowIso: () => '2026-09-01T12:34:56.000Z',
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
    setExitCode: (code) => exits.push(code),
  };

  return { options, calls, logs, errors, exits, writes, baselinePath, snapDir };
}

function runMain(state) {
  assert.equal(typeof watcher.main, 'function', 'main must be exported for hermetic behavior tests');
  return watcher.main(state.options);
}

test('accepts the current artifact and the deliberately minimal historical contract', () => {
  assert.equal(typeof watcher.validateBaseline, 'function');

  const current = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  assert.strictEqual(watcher.validateBaseline(current), current);
  assert.ok(current.labels.length > 0);
  assert.ok(current.labels.every((label) => typeof label === 'string'));

  for (const valid of [
    { labels: [] },
    { labels: ['industry:Software', 'sector:Technology'] },
    { labels: ['sector:B', 'sector:B', 'industry:A'], updatedAt: null, _producer: { version: 2 } },
  ]) {
    assert.deepEqual(watcher.loadBaseline('fixture.json', jsonReader(valid)), valid);
  }
});

test('rejects every parseable non-object root instead of treating it as first-run state', () => {
  for (const value of [null, [], 'labels', 7, true, false]) {
    expectShapeError(() => watcher.loadBaseline('fixture.json', jsonReader(value)));
  }
});

test('requires an own labels array but does not invent an updatedAt contract', () => {
  const inherited = Object.create({ labels: [] });
  for (const value of [
    {},
    inherited,
    { labels: null },
    { labels: {} },
    { labels: 'sector:Technology' },
    { labels: 2 },
  ]) {
    expectShapeError(() => watcher.validateBaseline(value));
  }

  for (const updatedAt of [undefined, null, 17, 'not-a-date', { producer: 'legacy' }]) {
    const value = { labels: [], updatedAt };
    assert.strictEqual(watcher.validateBaseline(value), value);
  }
});

test('rejects non-string labels without constraining order, uniqueness, or spelling', () => {
  for (const element of [null, 3, true, {}, []]) {
    expectShapeError(() => watcher.validateBaseline({ labels: ['sector:Technology', element] }));
  }

  const intentionallyLoose = { labels: ['', 'anything', 'anything', 'sector:Z', 'industry:A'] };
  assert.strictEqual(watcher.validateBaseline(intentionallyLoose), intentionallyLoose);
});

test('keeps only genuine ENOENT as the bootstrap state', () => {
  assert.equal(watcher.loadBaseline('missing.json', readError('ENOENT')), null);

  for (const [code, message] of [['EACCES', 'access denied'], ['EIO', 'disk error']]) {
    assert.throws(
      () => watcher.loadBaseline('broken.json', readError(code, message)),
      (error) => error.code !== SHAPE_CODE && /NICHT ueberschrieben/.test(error.message),
    );
  }

  assert.throws(
    () => watcher.loadBaseline('broken.json', () => '{broken'),
    (error) => error.code !== SHAPE_CODE && /NICHT ueberschrieben/.test(error.message),
  );
});

test('retains a real CLI entry point while exposing the injectable main', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'watch-unrouted-quote.js'), 'utf8');
  assert.match(source, /if\s*\(require\.main\s*===\s*module\)/);
  assert.match(source, /try\s*\{\s*main\(\);\s*\}/);
  assert.match(source, /catch\s*\(e\)\s*\{[^}]*::error::watch-unrouted-quote hat NICHT geprueft:[^}]*process\.exitCode\s*=\s*1[^}]*\}/s);
  assert.match(source, /module\.exports\s*=\s*\{[^}]*\bmain\b/s);
});

test('validates before scan, directory creation, writes, and success output', () => {
  for (const malformed of [null, [], {}, { labels: null }, { labels: ['ok', 4] }]) {
    const state = harness({ baseline: malformed });
    expectShapeError(() => runMain(state));
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.logs, []);
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.exits, []);
  }
});

test('an unseen label against an existing baseline alarms and is not learned away', () => {
  const state = harness({
    baseline: { labels: ['sector:Technology'], updatedAt: '2026-08-31T00:00:00.000Z' },
    scan: { routable: 1, noSector: 0, labels: new Set(['sector:Quantum Ponies']) },
  });

  runMain(state);

  assert.deepEqual(state.writes, [{
    labels: ['sector:Technology'],
    updatedAt: '2026-09-01T12:34:56.000Z',
  }]);
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /new industry\/sector label\(s\) not in baseline: sector:Quantum Ponies/);
  assert.deepEqual(state.exits, [1]);
  assert.ok(!state.writes[0].labels.includes('sector:Quantum Ponies'));
});

test('a genuinely missing baseline still seeds the first observed label', () => {
  const state = harness({
    readFileSync: readError('ENOENT'),
    scan: { routable: 1, noSector: 0, labels: new Set(['sector:Quantum Ponies']) },
  });

  runMain(state);

  assert.deepEqual(state.writes, [{
    labels: ['sector:Quantum Ponies'],
    updatedAt: '2026-09-01T12:34:56.000Z',
  }]);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.exits, []);
  assert.match(state.logs.at(-1), /No unrouted\/taxonomy drift/);
});

test('the healthy path keeps exact scan and persistence targets and logs success after write', () => {
  const state = harness({ baseline: { labels: ['sector:Technology'] } });

  runMain(state);

  assert.deepEqual(state.calls, [
    ['scan', state.snapDir],
    ['mkdir', path.dirname(state.baselinePath), { recursive: true }],
    ['write', state.baselinePath],
  ]);
  assert.deepEqual(state.writes, [{
    labels: ['sector:Technology'],
    updatedAt: '2026-09-01T12:34:56.000Z',
  }]);
  assert.match(state.logs[0], /Routable: 1, no-sector: 0 \(0\.0%\)/);
  assert.match(state.logs[1], /Baseline updated:/);
  assert.match(state.logs[2], /No unrouted\/taxonomy drift/);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.exits, []);
});

test('directory and atomic-write failures propagate without a false success', () => {
  for (const failingStep of ['mkdir', 'write']) {
    const state = harness({ baseline: { labels: ['sector:Technology'] } });
    const expected = new Error(failingStep + ' failed');
    if (failingStep === 'mkdir') {
      state.options.mkdirSync = () => { throw expected; };
    } else {
      state.options.writeJsonAtomic = () => { throw expected; };
    }

    assert.throws(() => runMain(state), expected);
    assert.ok(!state.logs.some((line) => line.includes('Baseline updated:')));
    assert.ok(!state.logs.some((line) => line.includes('No unrouted/taxonomy drift.')));
    assert.deepEqual(state.exits, []);
  }
});
