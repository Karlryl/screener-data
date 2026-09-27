'use strict';

// Run the real CLI in a synthetic ROOT: its fixed report path must stay in tmp.
// Run: node tests/t-kdrift-signatur-schlusssatz.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEMP_PARENT = fs.realpathSync(os.tmpdir());
const TEMP_PREFIX = 't-kdrift-schlusssatz-';
const REPORT = 't-kdrift-signatur-2026-09-20.md';
const realReport = path.join(ROOT, 'reports', REPORT);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const realReportBefore = sha256(fs.readFileSync(realReport));
const started = performance.now();

function removeFixture(root) {
  const resolved = path.resolve(root);
  assert(path.isAbsolute(root), 'Cleanup requires an absolute fixture path');
  assert.equal(path.dirname(resolved), TEMP_PARENT, 'Cleanup must stay directly inside os.tmpdir()');
  assert(path.basename(resolved).startsWith(TEMP_PREFIX), 'Cleanup requires our mkdtemp prefix');
  assert(!fs.lstatSync(resolved).isSymbolicLink(), 'Cleanup must not follow a fixture-root link');
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runCase(name, populationCount, argumentIndexes, check) {
  const root = fs.mkdtempSync(path.join(TEMP_PARENT, TEMP_PREFIX));
  try {
    for (const dir of ['scripts', 'data-health', 'reports']) {
      fs.mkdirSync(path.join(root, dir));
    }
    for (const filename of ['t-kdrift-signatur.js', 'watch-annual-spikes.js']) {
      const source = path.join(ROOT, 'scripts', filename);
      const copy = path.join(root, 'scripts', filename);
      fs.copyFileSync(source, copy);
      assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(source), `${filename}: byte-identical copy`);
    }

    const baseline = path.join(root, 'data-health', 'annual-spikes-baseline.json');
    const baselineBefore = Buffer.from(JSON.stringify({ hinweis: 'test', faelle: [] }));
    fs.writeFileSync(baseline, baselineBefore);
    const baselineHashBefore = sha256(fs.readFileSync(baseline));
    const populations = Array.from({ length: populationCount }, (_, i) => {
      const dir = path.join(root, `lauf${i + 1}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'AAA.json'), JSON.stringify({
        meta: { ticker: 'AAA' },
        annual: { annualRev: [{ value: 1000000 }, { value: 100000000 }, { value: 2000000 }] },
      }));
      return dir;
    });
    const report = path.join(root, 'reports', REPORT);
    assert(!fs.existsSync(report), `${name}: starts without a report`);

    try {
      const result = spawnSync(process.execPath, [
        path.join(root, 'scripts', 't-kdrift-signatur.js'),
        ...argumentIndexes.map(i => populations[i]),
      ], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true });
      assert.ifError(result.error);
      assert.equal(result.signal, null, `${name}: CLI terminated by a signal`);
      check(result, report);
    } finally {
      // Independent of the script's own baseline check, including rejected inputs.
      const baselineAfter = fs.readFileSync(baseline);
      assert.deepEqual(baselineAfter, baselineBefore, `${name}: baseline bytes changed`);
      assert.equal(sha256(baselineAfter), baselineHashBefore, `${name}: baseline hash changed`);
    }
    console.log(`PASS ${name}; baseline bytes and SHA256 unchanged`);
  } finally {
    removeFixture(root);
  }
}

function checkConclusion(result, report, count, expected, forbidden) {
  assert.equal(result.status, 0, `${count} states: CLI failed\n${result.stderr}`);
  assert(fs.existsSync(report), `${count} states: temporary report was not written`);
  const reportText = fs.readFileSync(report, 'utf8');
  for (const [label, text] of [['stdout', result.stdout], ['report', reportText]]) {
    assert(text.includes(expected), `${count} states ${label}: missing conclusion "${expected}"`);
    for (const phrase of forbidden) {
      assert(!text.includes(phrase), `${count} states ${label}: unexpected conclusion "${phrase}"`);
    }
  }
  assert.match(reportText, /^\| AAA \| annualRev \| 1 \| /m, 'Synthetic spike must reach the comparison table');
}

try {
  runCase('2 states', 2, [0, 1], (result, report) => {
    checkConclusion(result, report, 2, '2 Stände können eine Drift-Richtung nicht belegen',
      ['Zwei Stände', 'Stände verglichen']);
  });

  runCase('3 states', 3, [0, 1, 2], (result, report) => {
    checkConclusion(result, report, 3, '3 Stände verglichen; drift verlangt zusätzlich in JEDEM Schritt',
      ['können eine Drift-Richtung nicht belegen']);
  });

  runCase('1 state rejected', 1, [0], (result, report) => {
    assert.equal(result.status, 1, 'One state must fail the usage assertion');
    assert.match(result.stderr, /Usage: node scripts\/t-kdrift-signatur\.js/);
    assert(!fs.existsSync(report), 'Rejected one-state invocation must not write a report');
  });

  runCase('repeated directory rejected', 1, [0, 0], (result, report) => {
    assert.equal(result.status, 1, 'Repeated run directory must fail');
    assert.match(result.stderr, /Repeated run directory/);
    assert(!fs.existsSync(report), 'Rejected repeated directory must not write a report');
  });
} finally {
  assert.equal(sha256(fs.readFileSync(realReport)), realReportBefore, 'Real repository report changed');
}

const elapsed = performance.now() - started;
assert(elapsed < 30000, `Runner exceeded 30 seconds: ${elapsed.toFixed(0)} ms`);
console.log(`PASS 4/4 cases in ${elapsed.toFixed(0)} ms; real repository report SHA256 unchanged`);
