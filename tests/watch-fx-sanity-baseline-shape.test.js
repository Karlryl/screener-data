'use strict';
/**
 * HARDENING-H22: valid JSON with malformed FX baseline counters must not be
 * treated like a missing baseline and then overwritten with today's counts.
 *
 * Run: node tests/watch-fx-sanity-baseline-shape.test.js (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { loadBaseline } = require('../scripts/watch-fx-sanity.js');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (error) {
    fail++;
    console.error('FAIL   ' + name + '\n       ' + (error && error.stack || error));
  }
}

function readerFor(value, calls = []) {
  return (filePath, encoding) => {
    calls.push({ filePath, encoding });
    return JSON.stringify(value);
  };
}

function assertRejected(name, value) {
  test('rejects ' + name + ' without classifying it as first-run state', () => {
    assert.throws(
      () => loadBaseline('virtual-fx-baseline.json', readerFor(value)),
      /FX-Baseline ungueltig .*Baseline wird NICHT ueberschrieben/
    );
  });
}

test('accepts the current complete baseline shape', () => {
  const baseline = {
    prev: { usOver: 2835, foreignOver: 8644 },
    last: { usOver: 2839, foreignOver: 8652 },
    date: '2026-08-29',
    updatedAt: '2026-08-29T10:12:08.326Z',
  };
  const calls = [];
  assert.deepEqual(loadBaseline('virtual-current.json', readerFor(baseline, calls)), baseline);
  assert.deepEqual(calls, [{ filePath: 'virtual-current.json', encoding: 'utf8' }]);
});

test('the committed production baseline satisfies the validated count contract', () => {
  const baseline = loadBaseline(path.join(__dirname, '..', 'data-health', 'fx-cap-count-baseline.json'));
  assert.ok(baseline, 'the committed artifact must exist');
  for (const generation of ['last', 'prev']) {
    assert.ok(baseline[generation], generation + ' must be populated in the current artifact');
    for (const bucket of ['usOver', 'foreignOver']) {
      assert.equal(Number.isSafeInteger(baseline[generation][bucket]), true,
        generation + '.' + bucket + ' must be a safe integer');
      assert.ok(baseline[generation][bucket] >= 0,
        generation + '.' + bucket + ' must be non-negative');
    }
  }
});

test('accepts legacy shape without date and first-seed prev=null', () => {
  const legacy = { prev: null, last: { usOver: 0, foreignOver: 7 } };
  assert.deepEqual(loadBaseline('virtual-legacy.json', readerFor(legacy)), legacy);
});

test('missing file remains the only legitimate no-baseline bootstrap', () => {
  const missingReader = () => {
    const error = new Error('not found');
    error.code = 'ENOENT';
    throw error;
  };
  assert.equal(loadBaseline('virtual-missing.json', missingReader), null);
});

test('malformed JSON remains fail-closed', () => {
  assert.throws(
    () => loadBaseline('virtual-broken.json', () => '{broken'),
    /FX-Baseline nicht lesbar .*Baseline wird NICHT ueberschrieben/
  );
});

test('non-ENOENT read errors remain fail-closed', () => {
  const deniedReader = () => {
    const error = new Error('access denied');
    error.code = 'EACCES';
    throw error;
  };
  assert.throws(
    () => loadBaseline('virtual-denied.json', deniedReader),
    /FX-Baseline nicht lesbar .*Baseline wird NICHT ueberschrieben/
  );
});

function runHermeticMain(baseline) {
  const sourcePath = path.join(__dirname, '..', 'scripts', 'watch-fx-sanity.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const mainGuard = 'if (require.main === module) {';
  assert.equal(source.split(mainGuard).length - 1, 1, 'main guard must have one unambiguous seam');

  const snapshotDir = path.join(__dirname, '..', 'snapshots');
  const baselinePath = path.join(__dirname, '..', 'data-health', 'fx-cap-count-baseline.json');
  const snapshotPath = path.join(snapshotDir, 'H22-SYNTHETIC.json');
  const original = {
    existsSync: fs.existsSync,
    readdirSync: fs.readdirSync,
    readFileSync: fs.readFileSync,
    mkdirSync: fs.mkdirSync,
    moduleLoad: Module._load,
    log: console.log,
    error: console.error,
    exitCode: process.exitCode,
  };
  let baselineReads = 0;
  let mkdirCalls = 0;
  const writes = [];
  const errors = [];
  let observedExitCode;

  try {
    fs.existsSync = (candidate) => path.resolve(String(candidate)) === path.resolve(snapshotDir)
      ? true : original.existsSync(candidate);
    fs.readdirSync = (candidate, ...args) => path.resolve(String(candidate)) === path.resolve(snapshotDir)
      ? ['H22-SYNTHETIC.json'] : original.readdirSync(candidate, ...args);
    fs.readFileSync = (candidate, ...args) => {
      const resolved = path.resolve(String(candidate));
      if (resolved === path.resolve(snapshotPath)) {
        return JSON.stringify({ meta: {}, marketCap: { value: 900000000 } });
      }
      if (resolved === path.resolve(baselinePath)) {
        baselineReads++;
        return JSON.stringify(baseline);
      }
      return original.readFileSync(candidate, ...args);
    };
    fs.mkdirSync = (candidate, ...args) => {
      if (path.resolve(String(candidate)) === path.resolve(path.dirname(baselinePath))) {
        mkdirCalls++;
        return undefined;
      }
      return original.mkdirSync(candidate, ...args);
    };
    Module._load = function loadHermeticDependency(request, parent, isMain) {
      if (parent && path.resolve(parent.filename) === path.resolve(sourcePath)) {
        if (request === '../lib/snapshot-fs.js') return { isMetadataSnapshot: () => false };
        if (request === '../lib/atomic-write.js') {
          return { writeJsonAtomic: (filePath, value) => { writes.push({ filePath, value }); } };
        }
        if (request === '../src/scoring/router.js') return { isUsPrimaryListing: () => true };
        if (request === '../pull-yahoo.js') return { FX_MARKER_HARDCODED: 'hardcoded-fallback' };
      }
      return original.moduleLoad.call(this, request, parent, isMain);
    };
    console.log = () => {};
    console.error = (...args) => { errors.push(args.join(' ')); };
    process.exitCode = undefined;

    const runnable = source.replace(mainGuard, 'if (true) {');
    const isolated = new Module(sourcePath, module);
    isolated.filename = sourcePath;
    isolated.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    isolated._compile(runnable, sourcePath);
    observedExitCode = process.exitCode;
  } finally {
    fs.existsSync = original.existsSync;
    fs.readdirSync = original.readdirSync;
    fs.readFileSync = original.readFileSync;
    fs.mkdirSync = original.mkdirSync;
    Module._load = original.moduleLoad;
    console.log = original.log;
    console.error = original.error;
    process.exitCode = original.exitCode;
  }

  return { baselinePath, baselineReads, mkdirCalls, writes, errors, observedExitCode };
}

test('hermetic main control reaches the mocked writer with a valid baseline', () => {
  const result = runHermeticMain({ prev: null, last: { usOver: 1, foreignOver: 0 } });
  assert.equal(result.baselineReads, 1);
  assert.equal(result.mkdirCalls, 1, 'the no-write tripwire must be reachable on a healthy run');
  assert.equal(result.writes.length, 1, 'the mocked atomic writer must fire on the control');
  assert.equal(path.resolve(result.writes[0].filePath), path.resolve(result.baselinePath));
  assert.deepEqual(result.writes[0].value.last, { usOver: 1, foreignOver: 0 });
  assert.equal(result.observedExitCode, 0);
  assert.deepEqual(result.errors, []);
});

test('real main path exits red before any baseline write on malformed valid JSON', () => {
  const result = runHermeticMain({ prev: null, last: { usOver: '2', foreignOver: 0 } });
  assert.equal(result.baselineReads, 1, 'production main must call the validating baseline loader');
  assert.equal(result.mkdirCalls, 0, 'malformed evidence must stop before baseline directory preparation');
  assert.equal(result.writes.length, 0, 'malformed evidence must never reach writeJsonAtomic');
  assert.equal(result.observedExitCode, 1, 'the real CLI wrapper must fail closed');
  assert.match(result.errors.join('\n'), /::error::.*FX-Baseline ungueltig .*NICHT ueberschrieben/);
});

assertRejected('JSON null', null);
assertRejected('an array root', []);
assertRejected('an empty object', {});
assertRejected('missing prev', { last: { usOver: 100, foreignOver: 50 } });
assertRejected('missing last', { prev: null });
assertRejected('a false last object', { prev: null, last: false });
assertRejected('a missing last bucket', { prev: null, last: { usOver: 100 } });
assertRejected('a string last count', { prev: null, last: { usOver: '100', foreignOver: 50 } });
assertRejected('a negative last count', { prev: null, last: { usOver: -1, foreignOver: 50 } });
assertRejected('a fractional last count', { prev: null, last: { usOver: 1.5, foreignOver: 50 } });
assertRejected('an unsafe last count', { prev: null, last: { usOver: Number.MAX_SAFE_INTEGER + 1, foreignOver: 50 } });
assertRejected('a partial prev object', {
  prev: { usOver: 100 },
  last: { usOver: 101, foreignOver: 50 },
});
assertRejected('a zero prev scalar', {
  prev: 0,
  last: { usOver: 101, foreignOver: 50 },
});
assertRejected('a false prev scalar', {
  prev: false,
  last: { usOver: 101, foreignOver: 50 },
});
assertRejected('an array prev', {
  prev: [100, 50],
  last: { usOver: 101, foreignOver: 50 },
});
assertRejected('a malformed prev count', {
  prev: { usOver: 100, foreignOver: NaN },
  last: { usOver: 101, foreignOver: 50 },
});

console.log(`\nwatch-fx-sanity-baseline-shape: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
