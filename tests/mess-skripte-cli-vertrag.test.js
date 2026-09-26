'use strict';
/**
 * S07: offline child-process contracts for T135 and the T326 built-in selftest.
 * Run: node tests/mess-skripte-cli-vertrag.test.js
 * Only empty temporary populations and the script's synthetic selftest are used.
 * Own temporary directories are removed at exit; scripts and reports stay unchanged.
 * T326 retains its own built-in selftest fixtures, as its explicit contract requires.
 *
 * Coverage limit: the -RAUCHTEST report path and the "RAUCHTEST, KEIN BELEG"
 * heading need a populated Small-Cap universe/runSmallcapPass. They remain
 * unpinned here; running a real population is outside this test's remit.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');
const T135 = path.join(ROOT, 'scripts', 't135-paritaetsluecke.js');
const T326 = path.join(ROOT, 'scripts', 't-veraltung-zwei-definitionen.js');
const T326_REPORT = path.join(REPORTS, 't-veraltung-zwei-definitionen-2026-09-20.md');
const OFFLINE_GUARD = path.join(__dirname, 'helpers', 'offline-network-guard.js');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mess-skripte-cli-'));
// Register immediately so setup failures and failed assertions also clean up.
process.once('exit', () => {
  try {
    const target = path.resolve(TEMP);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()), 'cleanup stays in OS temp');
    assert.equal(path.basename(target).startsWith('mess-skripte-cli-'), true, 'cleanup owns this fixture');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.error('Fixture cleanup failed:', error);
    process.exitCode = 1;
  }
});
const EMPTY = path.join(TEMP, 'leer');
const STALE_NAME = path.join(TEMP, 'snapshots-smallcap');
const NETWORK_MARKER = path.join(TEMP, 'network-attempts.log');
fs.mkdirSync(EMPTY);
fs.mkdirSync(STALE_NAME);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reportsBefore = fs.readdirSync(REPORTS).sort();
const reportHashBefore = hash(T326_REPORT);
const scriptHashesBefore = [hash(T135), hash(T326)];

let passed = 0;
let failed = 0;
let assertions = 0;
function check(method, ...args) {
  assertions++;
  assert[method](...args);
}
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (error) { failed++; console.error('FAIL   ' + name + '\n' + error.stack); }
}
function run(script, args, expectedStatus) {
  const before = fs.readdirSync(REPORTS).sort();
  const reportBefore = hash(T326_REPORT);
  const result = spawnSync(process.execPath, ['--require', OFFLINE_GUARD, script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, SCREENER_OFFLINE_NETWORK_MARKER: NETWORK_MARKER },
  });
  // Check write boundaries even when the CLI's status is wrong.
  check('deepEqual', fs.readdirSync(REPORTS).sort(), before, 'CLI must not add or remove reports');
  check('equal', hash(T326_REPORT), reportBefore, 'T326 report must remain byte-identical');
  check('equal', result.error, undefined, 'child process must complete within its timeout');
  check('equal', result.signal, null, 'child process must not be terminated by signal');
  check('equal', result.status, expectedStatus, result.stdout + result.stderr);
  check('doesNotMatch', result.stdout + result.stderr, /offline-network-guard|ERR_OFFLINE_NETWORK_BLOCKED/);
  return result;
}
function failsWith(script, args, message) {
  const result = run(script, args, 1);
  check('equal', result.stderr.includes(message), true,
    'stderr must contain ' + JSON.stringify(message) + '\nActual: ' + result.stderr);
  return result;
}

const VINTAGE = ['--vintage', '2026-09-21'];
const SELFTEST_SUMMARY = 'SELFTEST PASS: 3 snapshots; both=1 / only D1=1 / only D2=0 / neither=1; counters=2/1/1/0';

test('(a) T135 rejects missing snapshots argument', () => {
  failsWith(T135, [], '--snapshots <dir> fehlt');
});

test('(b) T135 rejects non-ISO vintage before reading an empty population', () => {
  failsWith(T135, ['--snapshots', EMPTY, '--vintage', '21.09.2026'], '--vintage YYYY-MM-DD fehlt');
});

test('(c) T135 rejects a local-store directory name without explicit opt-out', () => {
  failsWith(T135, ['--snapshots', STALE_NAME, ...VINTAGE], 'lokales snapshots-smallcap/ ist Altbestand');
});

test('(d) T135 opt-out passes the stale-store guard and reaches the empty-population guard', () => {
  const result = failsWith(T135, ['--snapshots', STALE_NAME, ...VINTAGE, '--lokal-kein-beleg'],
    'leere Small-Cap-Population');
  check('doesNotMatch', result.stderr, /Altbestand/);
});

test('(e) T135 rejects a snapshots flag whose value is another flag', () => {
  failsWith(T135, ['--snapshots', ...VINTAGE], '--snapshots ohne Wert');
});

test('(f) T326 selftest pins synthetic population counts and strict age boundaries', () => {
  const result = run(T326, ['--selftest'], 0);
  check('equal', result.stderr, '');
  check('equal', result.stdout.includes(SELFTEST_SUMMARY), true);
  check('equal', result.stdout.includes('PASS: strict 7d/30d boundaries'), true);
  check('match', result.stdout, /Temporary fixtures retained \(no deletion\): /);
});

test('(g) T326 --now without a directory hits the earlier Usage guard (current behavior)', () => {
  // Brief correction: main() first requires directory || test. Without --selftest,
  // --now alone fails that Usage assertion before --now requires population-dir.
  failsWith(T326, ['--now', '2026-09-20T00:00:00Z'],
    'Usage: <population-dir> [--now <ISO>] [--selftest]');
});

test('(g2) T326 selftest plus --now reaches the intended population-directory guard', () => {
  const result = failsWith(T326, ['--selftest', '--now', '2026-09-20T00:00:00Z'],
    '--now requires population-dir');
  check('equal', result.stdout.includes(SELFTEST_SUMMARY), true);
});

test('(h) T326 rejects --now without a value', () => {
  failsWith(T326, ['--now'], 'Missing/repeated --now');
});

test('(i) T326 rejects an unknown flag', () => {
  failsWith(T326, ['--foo'], 'Unexpected argument: --foo');
});

test('reports, source scripts and empty fixture populations remain unchanged', () => {
  check('deepEqual', fs.readdirSync(REPORTS).sort(), reportsBefore);
  check('equal', hash(T326_REPORT), reportHashBefore);
  check('deepEqual', [hash(T135), hash(T326)], scriptHashesBefore);
  check('deepEqual', fs.readdirSync(EMPTY), []);
  check('deepEqual', fs.readdirSync(STALE_NAME), []);
  check('equal', fs.existsSync(NETWORK_MARKER), false);
  check('deepEqual', fs.readdirSync(TEMP).sort(), ['leer', 'snapshots-smallcap']);
});

console.log(`\nmess-skripte-cli-vertrag.test.js: ${passed} ok, ${failed} fail, ${assertions} assertions`);
process.exitCode = failed ? 1 : 0;
