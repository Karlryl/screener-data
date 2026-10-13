'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const plan = require('../scripts/plan-check.js');

const SHAPE_CODE = 'ERR_PLAN_CHECK_MANIFEST_SHAPE';
const REAL_MANIFEST = path.join(__dirname, '..', 'snapshots', '_manifest.json');

function expectShapeError(fn) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, SHAPE_CODE);
    assert.match(error.message, /manifest/i);
    return true;
  });
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function runScenario({ manifest, rawText, readError, readdirError, missingDetector, mkdirErrorAt, writeErrorAt, expectRunError = false } = {}) {
  assert.equal(typeof plan.run, 'function', 'run must be exported for the hermetic production-path proof');

  const outPath = 'C:\\fixture\\outputs\\plan-check-status.json';
  const reportPath = 'C:\\fixture\\reports\\plan-check-2026-09.md';
  const events = [];
  const writes = [];
  const logs = [];
  const errors = [];
  const exits = [];
  let mkdirCount = 0;
  let writeCount = 0;

  const fsImpl = {
    existsSync(filePath) {
      events.push(['exists', filePath]);
      return filePath !== missingDetector;
    },
    readFileSync(filePath, encoding) {
      events.push(['read', filePath, encoding]);
      if (readError) throw readError;
      return rawText === undefined ? JSON.stringify(manifest) : rawText;
    },
    readdirSync(dirPath) {
      events.push(['readdir', dirPath]);
      if (readdirError) throw readdirError;
      return ['ABC.json', '_manifest.json'];
    },
    mkdirSync(dirPath, options) {
      events.push(['mkdir', dirPath, options]);
      mkdirCount++;
      if (mkdirErrorAt === mkdirCount) throw codedError('EIO', `mkdir ${mkdirCount} failed`);
    },
  };

  let result;
  let runError = null;
  try {
    result = await plan.run({
      argv: ['node', 'scripts/plan-check.js', '--out', outPath, '--report', reportPath],
      now: new Date('2026-09-01T12:34:56.000Z'),
      fsImpl,
      probeFn: async (vendor, timeoutMs) => {
        events.push(['probe', vendor.name, timeoutMs]);
        return { name: vendor.name, ok: true, code: 200 };
      },
      writeAtomicFn(filePath, contents) {
        events.push(['write', filePath]);
        writeCount++;
        if (writeErrorAt === writeCount) throw codedError('EIO', `write ${writeCount} failed`);
        writes.push({ filePath, contents });
      },
      logger: {
        log(message) { logs.push(message); },
        error(message) { errors.push(message); },
      },
      exitFn(code) {
        exits.push(code);
        return code;
      },
    });
  } catch (error) {
    runError = error;
  }

  if (expectRunError) assert.ok(runError, 'the injected persistence failure must propagate');
  else assert.ifError(runError);

  const statusWrite = writes.find((write) => write.filePath === outPath);
  const reportWrite = writes.find((write) => write.filePath === reportPath);
  if (!expectRunError) {
    assert.ok(statusWrite, 'status artifact must still be written for a measurable red result');
    assert.ok(reportWrite, 'human-readable report must still be written for a measurable red result');
  }

  return {
    result,
    runError,
    status: statusWrite ? JSON.parse(statusWrite.contents) : null,
    report: reportWrite ? reportWrite.contents : null,
    events,
    writes,
    logs,
    errors,
    exits,
    outPath,
    reportPath,
  };
}

test('accepts the current artifact and only the narrow count-domain contract', () => {
  assert.equal(typeof plan.validateManifest, 'function');

  const current = JSON.parse(fs.readFileSync(REAL_MANIFEST, 'utf8'));
  assert.strictEqual(plan.validateManifest(current), current);
  assert.ok(Number.isSafeInteger(current.n_total) && current.n_total >= 0);

  for (const valid of [
    { n_total: 0 },
    { n_total: 21878, partial: true, schema: null, arbitrary: ['future'] },
    { n_total: Number.MAX_SAFE_INTEGER },
  ]) {
    assert.strictEqual(plan.validateManifest(valid), valid);
  }
});

test('rejects parseable non-object roots', () => {
  for (const value of [null, [], 'manifest', 7, true, false]) {
    expectShapeError(() => plan.validateManifest(value));
  }
});

test('requires an own n_total field', () => {
  expectShapeError(() => plan.validateManifest({}));
  expectShapeError(() => plan.validateManifest(Object.create({ n_total: 21878 })));
});

test('rejects every non-count n_total shape without coercion', () => {
  for (const value of [null, undefined, '21878', true, false, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expectShapeError(() => plan.validateManifest({ n_total: value }));
  }
});

for (const [name, manifest] of [
  ['null root', null],
  ['array root', []],
  ['missing n_total', {}],
  ['string root', 'manifest'],
  ['string n_total', { n_total: '21878' }],
  ['negative n_total', { n_total: -1 }],
  ['fractional n_total', { n_total: 1.5 }],
  ['unsafe n_total', { n_total: Number.MAX_SAFE_INTEGER + 1 }],
]) {
  test(`run turns ${name} into a blocking measurement failure`, async () => {
    const state = await runScenario({ manifest });

    assert.equal(state.result, 1);
    assert.deepEqual(state.exits, [1]);
    assert.equal(state.status.blocked, true);
    assert.equal(state.status.measurement_errors.length, 1);
    assert.match(state.status.measurement_errors[0], /Manifest snapshots\/_manifest\.json/);
    assert.ok(state.status.drift_flags.some((flag) => flag.includes('NICHT MESSBAR')));
    assert.match(state.report, /ROT/);
    assert.doesNotMatch(state.report, /Universe\/Detektoren\/Cache im Rahmen/);
    assert.ok(state.errors.some((line) => line.includes('MONATS-PLAN-CHECK ROT')));
    assert.ok(!state.logs.some((line) => line.includes('Kein rotes X')));
    assert.equal(state.events.filter((event) => event[0] === 'probe').length, plan.VENDORS.length);
    assert.equal(state.writes.length, 2);

    const readIndex = state.events.findIndex((event) => event[0] === 'read');
    const firstProbeIndex = state.events.findIndex((event) => event[0] === 'probe');
    assert.ok(readIndex >= 0 && readIndex < firstProbeIndex, 'manifest validation must occur before vendor probes');
  });
}

test('genuine ENOENT stays visible but non-blocking for the bare-checkout workflow', async () => {
  const state = await runScenario({ readError: codedError('ENOENT', 'file missing') });

  assert.equal(state.result, 0);
  assert.deepEqual(state.exits, [0]);
  assert.equal(state.status.blocked, false);
  assert.deepEqual(state.status.measurement_errors, ['Manifest snapshots/_manifest.json: file missing']);
  assert.ok(state.status.drift_flags.some((flag) => flag.includes('NICHT MESSBAR')));
  assert.doesNotMatch(state.report, /Universe\/Detektoren\/Cache im Rahmen/);
  assert.deepEqual(state.errors, []);
  assert.ok(state.logs.some((line) => line.includes('Kein rotes X')));
  assert.equal(state.writes.length, 2);
});

for (const [name, scenario] of [
  ['malformed JSON', { rawText: '{broken' }],
  ['EACCES', { readError: codedError('EACCES', 'access denied') }],
  ['EIO', { readError: codedError('EIO', 'disk failure') }],
]) {
  test(`${name} remains a blocking measurement failure`, async () => {
    const state = await runScenario(scenario);
    assert.equal(state.status.blocked, true);
    assert.deepEqual(state.exits, [1]);
    assert.ok(state.status.drift_flags.some((flag) => flag.includes('NICHT MESSBAR')));
    assert.doesNotMatch(state.report, /Universe\/Detektoren\/Cache im Rahmen/);
  });
}

test('n_total=0 remains structurally valid and uses only the existing plausibility warning', async () => {
  const state = await runScenario({ manifest: { n_total: 0 } });

  assert.equal(state.status.blocked, false);
  assert.deepEqual(state.status.measurement_errors, []);
  assert.ok(state.status.drift_flags.some((flag) => flag.includes('Universe-Groesse n_total=0')));
  assert.deepEqual(state.exits, [0]);
  assert.deepEqual(state.errors, []);
});

test('a normal manifest preserves the healthy report and exit path', async () => {
  const state = await runScenario({ manifest: { n_total: 21878, partial: false } });

  assert.equal(state.result, 0);
  assert.equal(state.status.blocked, false);
  assert.deepEqual(state.status.measurement_errors, []);
  assert.deepEqual(state.status.drift_flags, []);
  assert.match(state.report, /Universe\/Detektoren\/Cache im Rahmen/);
  assert.deepEqual(state.exits, [0]);
  assert.deepEqual(state.errors, []);
  assert.equal(state.writes.length, 2);
  assert.deepEqual(state.writes.map((write) => write.filePath), [state.outPath, state.reportPath]);
  assert.equal(state.events.filter((event) => event[0] === 'exists').length,
    plan.VENDORS.flatMap((vendor) => vendor.detectors || []).length);
  assert.deepEqual(state.events.filter((event) => event[0] === 'readdir'), [['readdir', 'snapshots']]);
});

test('a missing declared detector remains a hard register failure', async () => {
  const state = await runScenario({ manifest: { n_total: 21878 }, missingDetector: 'pull-yahoo.js' });

  assert.equal(state.status.blocked, true);
  assert.ok(state.status.drift_flags.some((flag) => flag.includes('DETEKTOR FEHLT: pull-yahoo.js')));
  assert.deepEqual(state.exits, [1]);
  assert.ok(state.errors.some((line) => line.includes('deklarierter Detektor fehlt')));
  assert.ok(state.events.some((event) => event[0] === 'exists' && event[1] === 'pull-yahoo.js'));
});

test('a snapshot directory read failure remains a blocking measurement failure', async () => {
  const state = await runScenario({
    manifest: { n_total: 21878 },
    readdirError: codedError('EIO', 'snapshot directory unreadable'),
  });

  assert.equal(state.status.blocked, true);
  assert.deepEqual(state.status.measurement_errors, ['Snapshot-Zahl: snapshot directory unreadable']);
  assert.ok(state.status.drift_flags.some((flag) => flag.includes('NICHT MESSBAR: Snapshot-Zahl')));
  assert.deepEqual(state.exits, [1]);
  assert.ok(state.errors.some((line) => line.includes('konnte nicht messen')));
  assert.deepEqual(state.events.filter((event) => event[0] === 'readdir'), [['readdir', 'snapshots']]);
  assert.doesNotMatch(state.report, /Universe\/Detektoren\/Cache im Rahmen/);
});

for (const [name, failure] of [
  ['first directory creation', { mkdirErrorAt: 1 }],
  ['status write', { writeErrorAt: 1 }],
  ['second directory creation', { mkdirErrorAt: 2 }],
  ['report write', { writeErrorAt: 2 }],
]) {
  test(`${name} failure propagates without a false healthy exit`, async () => {
    const state = await runScenario({ manifest: { n_total: 21878 }, ...failure, expectRunError: true });

    assert.equal(state.runError.code, 'EIO');
    assert.deepEqual(state.exits, []);
    assert.deepEqual(state.errors, []);
    assert.ok(!state.logs.some((line) => line.includes('plan-check: report=')));
    assert.ok(!state.logs.some((line) => line.includes('Kein rotes X')));
  });
}

test('the direct CLI retains both selftest routing and a loud async crash boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'plan-check.js'), 'utf8');
  const bootstrap = source.slice(source.lastIndexOf('module.exports'));

  assert.match(bootstrap, /process\.argv\.includes\('--selftest'\)/);
  assert.match(bootstrap, /else if\s*\(require\.main\s*===\s*module\)\s*run\(\)\.catch/);
  assert.match(bootstrap, /::error::plan-check crashed:/);
  assert.match(bootstrap, /process\.exit\(1\)/);
});
