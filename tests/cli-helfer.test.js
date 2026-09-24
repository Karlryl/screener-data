'use strict';
/**
 * S05: offline CLI contract coverage. Run: node tests/cli-helfer.test.js
 * Current limitations are named explicitly: earnings has no help handler and
 * both CLIs accept unknown options. This task documents behavior without fixes.
 * All data fixtures stay in OS temp and are removed when this test exits.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OFFLINE_GUARD = path.join(__dirname, 'helpers', 'offline-network-guard.js');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'screener-cli-helfer-'));
// Register immediately so setup failures and failed assertions also clean up.
process.once('exit', () => {
  try {
    const target = path.resolve(fixtureRoot);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()), 'cleanup stays in OS temp');
    assert.equal(path.basename(target).startsWith('screener-cli-helfer-'), true, 'cleanup owns this fixture');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.error('Fixture cleanup failed:', error);
    process.exitCode = 1;
  }
});
const emptyDirectory = path.join(fixtureRoot, 'empty');
const calendarDirectory = path.join(fixtureRoot, 'calendar');
fs.mkdirSync(emptyDirectory);
fs.mkdirSync(calendarDirectory);
const calendarPath = path.join(calendarDirectory, 'earnings-calendar.json');
const calendarFixture = '{}\n';
fs.writeFileSync(calendarPath, calendarFixture, 'utf8');
const networkMarker = path.join(fixtureRoot, 'network-attempts.log');

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
function run(cliName, args, cwd) {
  return spawnSync(process.execPath, [
    '--require', OFFLINE_GUARD, path.join(ROOT, cliName), ...args,
  ], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, SCREENER_OFFLINE_NETWORK_MARKER: networkMarker },
  });
}
function exited(result, expectedCode) {
  check('equal', result.error, undefined, 'subprocess must launch and finish within timeout');
  check('equal', result.signal, null, 'subprocess must not be terminated by a signal');
  check('equal', result.status, expectedCode, result.stdout + result.stderr);
  check('doesNotMatch', result.stdout + result.stderr,
    /\b(?:TypeError|SyntaxError|ReferenceError|RangeError|ERR_OFFLINE_NETWORK_BLOCKED)\b|\n\s+at\s/,
    'CLI must exit through its controlled path, without an exception or network access');
}
function watchlistHelp(result) {
  exited(result, 0);
  check('equal', result.stderr, '');
  check('match', result.stdout, /^Watchlist-CLI\r?\nCommands:/);
  for (const command of ['list', 'add', 'remove', 'info', 'import', 'export']) {
    check('match', result.stdout, new RegExp('^\\s+' + command + '(?:\\s|$)', 'm'),
      'help must document command ' + command);
  }
  for (const option of ['--name', '--track', '--isin', '--yahoo']) {
    check('match', result.stdout, new RegExp(option + '(?:\\s|$)'),
      'help must document option ' + option);
  }
}
function earningsListing(result, days) {
  exited(result, 0);
  check('equal', result.stderr, '');
  check('match', result.stdout, new RegExp('^Earnings .* ' + days + ' Tagen \\(0 stocks\\):'));
}

let watchlistDefaultOutput;
let earningsDefaultOutput;
test('watchlist no arguments shows every documented command and option', () => {
  const result = run('watchlist-cli.js', [], emptyDirectory);
  watchlistHelp(result);
  watchlistDefaultOutput = result.stdout;
});

test('watchlist --help is equivalent to no arguments', () => {
  const result = run('watchlist-cli.js', ['--help'], emptyDirectory);
  watchlistHelp(result);
  check('equal', result.stdout, watchlistDefaultOutput);
});

test('IST: watchlist unknown option currently succeeds with help, not an error', () => {
  const result = run('watchlist-cli.js', ['--unknown-option'], emptyDirectory);
  watchlistHelp(result);
  check('equal', result.stdout, watchlistDefaultOutput);
});

test('earnings no arguments uses the documented default of 30 days', () => {
  const result = run('earnings-cli.js', [], calendarDirectory);
  earningsListing(result, 30);
  earningsDefaultOutput = result.stdout;
});

test('IST: earnings --help currently lists data and omits the documented --days option', () => {
  const result = run('earnings-cli.js', ['--help'], calendarDirectory);
  earningsListing(result, 30);
  check('equal', result.stdout, earningsDefaultOutput);
  check('doesNotMatch', result.stdout, /--days|Usage:/,
    'document the missing earnings help handler rather than inventing help support');
});

test('IST: earnings unknown option currently succeeds without a diagnostic', () => {
  const result = run('earnings-cli.js', ['--unknown-option'], calendarDirectory);
  earningsListing(result, 30);
  check('equal', result.stdout, earningsDefaultOutput);
});

test('earnings documented --days option controls its listing window', () => {
  const result = run('earnings-cli.js', ['--days', '7'], calendarDirectory);
  earningsListing(result, 7);
});

test('earnings invalid --days values fail with an actionable stderr diagnostic', () => {
  for (const value of ['0', '-1', 'foo']) {
    const result = run('earnings-cli.js', ['--days', value], calendarDirectory);
    exited(result, 1);
    check('equal', result.stdout, '');
    check('match', result.stderr, /--days requires a positive integer/);
    check('match', result.stderr, new RegExp('got "' + value + '"'));
  }
});

test('earnings missing calendar is controlled, including its unsupported --help path', () => {
  for (const args of [[], ['--help']]) {
    const result = run('earnings-cli.js', args, emptyDirectory);
    exited(result, 1);
    check('equal', result.stdout, '');
    check('match', result.stderr, /^No earnings-calendar\.json .*pull-earnings-dates\.js first\./);
  }
});

test('CLIs leave fixtures unchanged and make no network attempts', () => {
  check('deepEqual', fs.readdirSync(emptyDirectory), []);
  check('deepEqual', fs.readdirSync(calendarDirectory), ['earnings-calendar.json']);
  check('equal', fs.readFileSync(calendarPath, 'utf8'), calendarFixture);
  check('equal', fs.existsSync(networkMarker), false);
  check('deepEqual', fs.readdirSync(fixtureRoot).sort(), ['calendar', 'empty']);
});

console.log(`\ncli-helfer.test.js: ${passed} ok, ${failed} fail, ${assertions} assertions`);
process.exitCode = failed ? 1 : 0;
