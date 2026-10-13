'use strict';

/**
 * Hermetic regression tests for the runtime harness.
 * Run: node tests/test-laufzeit.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { PassThrough } = require('node:stream');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { messen } = require('../scripts/test-laufzeit.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (error) { fail++; console.error('FAIL   ' + name + '\n' + error.stack); }
}

function verifyShape(result, jobs, root) {
  assert.equal(result.wurzel, root);
  assert.equal(result.jobs, jobs);
  assert.equal(new Date(result.generated_at).toISOString(), result.generated_at);
  assert.equal(result.dateien.length, 4, 'all four synthetic files must be measured');
  for (const name of ['gesamt_ms', 'median_ms', 'top10_anteil']) {
    assert.ok(Number.isFinite(result[name]) && result[name] >= 0, name);
  }
  // Actual process startup is variable; only the controlled-clock probe pins a named winner.
  for (const [index, row] of result.dateien.entries()) {
    assert.equal(typeof row.datei, 'string');
    assert.ok(Number.isFinite(row.ms) && row.ms > 0, row.datei + ' measured time');
    assert.ok(Number.isInteger(row.exit), row.datei + ' exit');
    assert.ok(row.anteil > 0 && row.anteil <= 1, row.datei + ' share');
    if (index > 0) assert.ok(result.dateien[index - 1].ms >= row.ms, 'descending times');
  }
  assert.ok(result.dateien.find(row => row.datei === 'lib/langsam.test.js').ms >= 300,
    'the measured child includes its 300 ms delay');
  assert.equal(result.top10_anteil, 1, 'four files are all within the top ten');
  assert.ok(Math.abs(result.dateien.reduce((sum, row) => sum + row.anteil, 0) - 1) < 1e-12);
  const expectedMedian = Math.round((result.dateien[1].ms + result.dateien[2].ms) / 2 * 1000) / 1000;
  assert.equal(result.median_ms, expectedMedian);
  assert.deepEqual(Object.fromEntries(result.dateien.map(row => [row.datei, row.exit])), {
    'lib/langsam.test.js': 0,
    'lib/nurparallel.test.js': 0,
    'lib/rot.test.js': 1,
    'lib/schnell.test.js': 0,
  });
  assert.ok(result.dateien.some(row => row.exit !== 0), 'persistent red must keep the result red');
}

// Load the unchanged production module with only process execution and its clock controlled.
// Real files, glob expansion, sorting, summary calculations and report writes still run.
function controlledHarness(filename, root) {
  let clock = 0;
  const attempts = [];
  const durations = {
    'lib/langsam.test.js': 300,
    'lib/nurparallel.test.js': 20,
    'lib/rot.test.js': 10,
    'lib/schnell.test.js': 30,
  };
  const localRequire = createRequire(filename);
  const controlledRequire = id => {
    if (id === 'node:perf_hooks') return { performance: { now: () => clock } };
    if (id !== 'node:child_process') return localRequire(id);
    return {
      spawn(executable, args, options) {
        assert.equal(executable, process.execPath);
        assert.equal(options.cwd, root);
        assert.equal(options.stdio.join(','), 'ignore,pipe,pipe');
        assert.equal(options.env.TEST_LAUFZEIT_PARALLEL, undefined);
        const datei = path.relative(root, args[0]).split(path.sep).join('/');
        assert.ok(Object.hasOwn(durations, datei), 'known controlled child: ' + datei);
        attempts.push(datei);
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        queueMicrotask(() => {
          clock += durations[datei];
          child.stdout.end();
          child.stderr.end();
          child.emit('close', datei === 'lib/rot.test.js' ? 1 : 0, null);
        });
        return child;
      },
    };
  };
  const loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: controlledRequire, module: loaded, __dirname: path.dirname(filename), process, console,
  }, { filename });
  return { messen: loaded.exports.messen, attempts };
}

async function main() {
  const started = performance.now();
  const tempBase = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempBase, 'test-laufzeit-'));
  const cli = path.resolve(__dirname, '../scripts/test-laufzeit.js');
  const readReport = out => JSON.parse(fs.readFileSync(path.join(root, out, 'test-laufzeit.json'), 'utf8'));
  const launch = args => new Promise(resolve => {
    execFile(process.execPath, [cli, '--wurzel=' + root, ...args], {
      cwd: tempBase, encoding: 'utf8', timeout: 4000,
    }, (error, stdout, stderr) => resolve({
      error: error && !Number.isInteger(error.code) ? error : null,
      status: error ? error.code : 0,
      stdout,
      stderr,
    }));
  });
  try {
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'lib/schnell.test.js'),
      "const fs = require('node:fs'); process.exit(fs.existsSync('lib/schnell.test.js') ? 0 : 2);\n");
    fs.writeFileSync(path.join(root, 'lib/langsam.test.js'), 'setTimeout(() => process.exit(0), 300);\n');
    fs.writeFileSync(path.join(root, 'lib/rot.test.js'), 'process.exit(1);\n');
    fs.writeFileSync(path.join(root, 'lib/nurparallel.test.js'),
      'process.exit(process.env.TEST_LAUFZEIT_PARALLEL ? 1 : 0);\n');

    await test('controlled durations pin slow-first, full sort order and exact summary values', async () => {
      const controlled = controlledHarness(cli, root);
      // Normalize VM-realm prototypes; retain every serializable result field.
      const result = JSON.parse(JSON.stringify(await controlled.messen({
        wurzel: root, globs: ['lib/*test.js'], jobs: 1, out: 'controlled',
      })));
      assert.deepEqual(result.dateien.map(row => [row.datei, row.ms]), [
        ['lib/langsam.test.js', 300],
        ['lib/schnell.test.js', 30],
        ['lib/nurparallel.test.js', 20],
        ['lib/rot.test.js', 10],
      ], 'known durations must put the slow fixture first and fully sort the remaining files');
      assert.equal(result.gesamt_ms, 360);
      assert.equal(result.median_ms, 25);
      assert.equal(controlled.attempts.length, 4);
      assert.equal(new Set(controlled.attempts).size, 4);
      verifyShape(result, 1, root);
      assert.deepEqual(result.isolationsdefekte, []);
      assert.deepEqual(readReport('controlled'), result);
    });

    let serial, serialChild;
    await test('serial timings, shape, final exits and empty isolation list', async () => {
      const previous = process.env.TEST_LAUFZEIT_PARALLEL;
      process.env.TEST_LAUFZEIT_PARALLEL = 'inherited';
      try {
        // Reuse this real CLI run for the default-option checks below instead of
        // launching the same four serial children twice.
        serialChild = await launch([]);
        assert.ifError(serialChild.error);
        assert.equal(serialChild.status, 1, serialChild.stderr);
        serial = readReport('outputs');
      } finally {
        if (previous === undefined) delete process.env.TEST_LAUFZEIT_PARALLEL;
        else process.env.TEST_LAUFZEIT_PARALLEL = previous;
      }
      verifyShape(serial, 1, root);
      assert.deepEqual(serial.isolationsdefekte, []);
    });

    await test('JSON and Markdown contain the same sorted four-row table', () => {
      assert.deepEqual(readReport('outputs'), serial);
      const markdown = fs.readFileSync(path.join(root, 'outputs/test-laufzeit.md'), 'utf8');
      assert.match(markdown, /\| Rang \| ms \| Datei \| Exit \| Anteil \|/);
      assert.match(markdown, /Gesamt: .* ms \| Median: .* ms \| Top-10-Anteil: 100\.00%/);
      const rows = markdown.split('\n').filter(line => /^\| \d+ \|/.test(line));
      assert.equal(rows.length, 4);
      rows.forEach((line, index) => {
        const row = serial.dateien[index];
        assert.equal(line, '| ' + (index + 1) + ' | ' + row.ms + ' | ' + row.datei
          + ' | ' + row.exit + ' | ' + (row.anteil * 100).toFixed(2) + '% |');
      });
      assert.match(markdown, /Isolationsdefekte: keine/);
      assert.ok(!markdown.includes('Delta ms'));
    });

    // Independent reports can be generated concurrently after the serial baseline.
    await Promise.all([
      test('two workers overlap; serial rechecks identify exactly the isolation defect', async () => {
        const parallel = await messen({
          wurzel: root, globs: ['lib/*test.js'], jobs: 2, out: 'parallel',
          vergleich: 'outputs/test-laufzeit.json',
        });
        verifyShape(parallel, 2, root);
        const sum = parallel.dateien.reduce((total, row) => total + row.ms, 0);
        assert.ok(parallel.gesamt_ms < sum,
          'worker wall time ' + parallel.gesamt_ms + ' must be below file-time sum ' + sum);
        assert.deepEqual(parallel.isolationsdefekte, ['lib/nurparallel.test.js']);
        for (const row of parallel.dateien) {
          const previous = serial.dateien.find(old => old.datei === row.datei);
          assert.equal(row.delta_ms, Math.round((row.ms - previous.ms) * 1000) / 1000);
        }
        assert.deepEqual(readReport('parallel'), parallel);
        const markdown = fs.readFileSync(path.join(root, 'parallel/test-laufzeit.md'), 'utf8');
        assert.match(markdown, /\| Anteil \| Delta ms \|/);
        assert.match(markdown, /Isolationsdefekte: lib\/nurparallel\.test\.js/);
        console.log('       jobs=2 wall=' + parallel.gesamt_ms + ' ms, sum=' + sum.toFixed(3) + ' ms');
      }),

      test('CLI repeated filters replace defaults and deduplicate; recovered failures exit 0', async () => {
        const child = await launch([
          '--nur=lib/nurparallel.test.js', '--nur=lib/schnell.test.js',
          '--nur=lib/schnell.test.js', '--jobs=2', '--out=cli-green',
          '--vergleich=outputs/test-laufzeit.json',
        ]);
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = readReport('cli-green');
        assert.equal(result.dateien.length, 2);
        assert.deepEqual(result.isolationsdefekte, ['lib/nurparallel.test.js']);
        assert.ok(result.dateien.every(row => row.exit === 0));
        assert.ok(result.dateien.every(row => Number.isFinite(row.delta_ms)));
      }),
    ]);

    await test('CLI defaults use gate globs, one worker and outputs; persistent red exits 1', () => {
      assert.ifError(serialChild.error);
      assert.equal(serialChild.status, 1, serialChild.stderr);
      const result = readReport('outputs');
      verifyShape(result, 1, root);
      assert.deepEqual(result.isolationsdefekte, []);
    });

    await test('invalid jobs, empty matches and malformed comparison reject without reports', async () => {
      for (const jobs of [0, -1, 1.5, NaN, Infinity, '2']) {
        await assert.rejects(messen({ wurzel: root, jobs, out: 'invalid' }), /jobs/);
      }
      await assert.rejects(messen({ wurzel: root, globs: [], out: 'invalid' }), /globs/);
      await assert.rejects(messen({ wurzel: root, globs: ['missing/*test.js'], out: 'invalid' }), /No test files/);
      fs.writeFileSync(path.join(root, 'bad.json'), '{"dateien":[{"datei":"x","ms":null}]}');
      await assert.rejects(messen({ wurzel: root, vergleich: 'bad.json', out: 'invalid' }), /invalid timing row/);
      assert.equal(fs.existsSync(path.join(root, 'invalid')), false);
    });
  } finally {
    // Delete only our own resolved, direct child of the OS temp directory.
    const resolved = fs.realpathSync(root);
    assert.equal(resolved, path.resolve(root));
    assert.equal(path.dirname(resolved), tempBase);
    assert.match(path.basename(resolved), /^test-laufzeit-/);
    fs.rmSync(resolved, { recursive: true, force: true });
    assert.equal(fs.existsSync(resolved), false, 'temporary fixtures are cleaned');
  }
  console.log('\ntest-laufzeit: ' + pass + ' ok, ' + fail + ' fail; '
    + Math.round(performance.now() - started) + ' ms');
  process.exitCode = fail ? 1 : 0;
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
