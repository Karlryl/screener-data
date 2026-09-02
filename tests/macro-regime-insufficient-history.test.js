// Regression guard for the BH-138 last-known-good contract.
//
// macro-regime needs 200 prior closes plus the date being classified. Exactly
// 200 valid rows are therefore present-but-insufficient, not a healthy empty
// result. The CLI must preserve an existing output and expose the degraded
// state in its sibling error sidecar.
//
// Standalone runner: node tests/macro-regime-insufficient-history.test.js
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { state: offlineState } = require('./helpers/offline-network-guard.js');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'macro-regime.js');
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-regime-h58-'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (error) {
    failures += 1;
    console.log('  FAIL ' + name + ': ' + (error && error.message || error));
  }
}

function seriesOfLength(length) {
  return Array.from({ length }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    close: 100,
  }));
}

function makeCase(label, length, existingOutput) {
  const dir = path.join(TEMP_ROOT, label);
  fs.mkdirSync(dir);
  const history = path.join(dir, 'h58-history.json');
  const out = path.join(dir, 'macro-regime.json');
  const sidecar = path.join(dir, 'macro-regime-error.json');
  fs.writeFileSync(history, JSON.stringify({ SPY: seriesOfLength(length) }));
  if (existingOutput !== undefined) fs.writeFileSync(out, existingOutput);
  return { dir, history, out, sidecar };
}

function runCli(fixture) {
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--history', fixture.history,
    '--out', fixture.out,
    '--ticker', 'SPY',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    code: result.status,
    output: String(result.stdout || '') + String(result.stderr || ''),
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

console.log('macro-regime: insufficient-history last-good preservation');

check('200 rows preserve an existing output byte-for-byte and write a truthful sidecar', () => {
  const sentinel = '{\n  "sentinel": "last-known-good",\n  "regimes": {"2025-01-01": {"regime": "BULL"}}\n}\n';
  const fixture = makeCase('preserve', 200, sentinel);
  const result = runCli(fixture);

  assert.strictEqual(result.code, 0, 'degraded production path keeps exit 0:\n' + result.output);
  assert.strictEqual(
    fs.readFileSync(fixture.out, 'utf8'),
    sentinel,
    'present-but-insufficient history must not clobber the last-known-good bytes',
  );
  assert.ok(fs.existsSync(fixture.sidecar), 'insufficient-history sidecar was not written');
  const sidecar = readJson(fixture.sidecar);
  assert.strictEqual(sidecar.ticker, 'SPY');
  assert.strictEqual(sidecar.error, 'insufficient_price_history');
  assert.ok(!/Written:/.test(result.output), 'degraded path must not report a healthy publication');
});

check('a first-ever 200-row run writes an honest empty placeholder', () => {
  const fixture = makeCase('bootstrap', 200);
  const result = runCli(fixture);

  assert.strictEqual(result.code, 0, 'first bootstrap remains non-blocking:\n' + result.output);
  const output = readJson(fixture.out);
  const sidecar = readJson(fixture.sidecar);
  assert.strictEqual(output.error, 'insufficient_price_history');
  assert.deepStrictEqual(output.regimes, {});
  assert.deepStrictEqual(output.summary, {
    total: 0,
    BULL: 0,
    BEAR: 0,
    SIDEWAYS: 0,
  });
  assert.strictEqual(output.current, null);
  assert.strictEqual(sidecar.error, 'insufficient_price_history');
});

check('201 rows publish the first regime and create no error sidecar on a clean run', () => {
  const sentinel = '{"sentinel":"replace-me"}\n';
  const fixture = makeCase('healthy', 201, sentinel);
  const result = runCli(fixture);

  assert.strictEqual(result.code, 0, 'healthy path failed:\n' + result.output);
  assert.ok(!fs.existsSync(fixture.sidecar), 'a clean healthy run must not create an error sidecar');
  const output = readJson(fixture.out);
  assert.strictEqual(output.ticker, 'SPY');
  assert.strictEqual(output.maPeriod, 200);
  assert.deepStrictEqual(output.regimeCounts, { BULL: 0, BEAR: 0, SIDEWAYS: 1 });
  const dates = Object.keys(output.regimes);
  assert.deepStrictEqual(dates, [seriesOfLength(201)[200].date]);
  assert.deepStrictEqual(output.regimes[dates[0]], {
    regime: 'SIDEWAYS',
    price: 100,
    sma200: 100,
    _convention: 'sma=t-200..t-1, price=t-1',
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(output, 'error'));
});

check('truly empty data keeps the established no_price_data fallback contract', () => {
  const fixture = makeCase('empty', 0);
  const result = runCli(fixture);

  assert.strictEqual(result.code, 0, 'empty-data fallback failed:\n' + result.output);
  const output = readJson(fixture.out);
  const sidecar = readJson(fixture.sidecar);
  assert.strictEqual(output.error, 'no_price_data');
  assert.deepStrictEqual(output.regimes, {});
  assert.strictEqual(output.current, null);
  assert.strictEqual(sidecar.error, 'no_price_data');
});

check('the test and every spawned CLI remain offline', () => {
  assert.deepStrictEqual(offlineState.attempts, []);
});

console.log(failures ? '\nFAILED: ' + failures : '\nall green');
process.exit(failures ? 1 : 0);
