'use strict';

const offlineGuard = require('./helpers/offline-network-guard');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');

const CLI_PATH = path.resolve(__dirname, '..', 'earnings-cli.js');
const EXPECTED_ERROR = '✗ earnings-calendar.json must contain a JSON object keyed by ticker.\n';
const CHILD_SOURCE = [
  "'use strict';",
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const offlineState = globalThis[Symbol.for('screener.offlineNetworkGuard')];",
  "if (!offlineState) throw new Error('__OFFLINE_GUARD_NOT_PRELOADED__');",
  "const fixturePath = './earnings-calendar.json';",
  "const realExistsSync = fs.existsSync;",
  "const realReadFileSync = fs.readFileSync;",
  "function isOtherCalendarPath(file) {",
  "  return file !== fixturePath",
  "    && path.basename(String(file)).toLowerCase() === 'earnings-calendar.json';",
  "}",
  "fs.existsSync = function fixtureExists(file) {",
  "  if (file === fixturePath) return true;",
  "  if (isOtherCalendarPath(file)) throw new Error('__UNEXPECTED_EARNINGS_CALENDAR_PATH__:' + file);",
  "  return realExistsSync.apply(this, arguments);",
  "};",
  "fs.readFileSync = function readFixture(file, encoding) {",
  "  if (file === fixturePath) {",
  "    if (encoding !== 'utf8') throw new Error('__UNEXPECTED_EARNINGS_CALENDAR_ENCODING__');",
  "    return process.env.SCREENER_EARNINGS_CLI_ROOT_FIXTURE;",
  "  }",
  "  if (isOtherCalendarPath(file)) throw new Error('__UNEXPECTED_EARNINGS_CALENDAR_PATH__:' + file);",
  "  return realReadFileSync.apply(this, arguments);",
  "};",
  "process.argv = [process.execPath, process.env.SCREENER_EARNINGS_CLI_SCRIPT, '--days', '5'];",
  "require(process.env.SCREENER_EARNINGS_CLI_SCRIPT);",
  "if (offlineState.attempts.length !== 0) {",
  "  throw new Error('__OFFLINE_NETWORK_ATTEMPTS__:' + offlineState.attempts.join(','));",
  "}",
].join('\n');

function runCli(jsonText) {
  return spawnSync(process.execPath, ['-e', CHILD_SOURCE], {
    cwd: __dirname,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 10000,
    env: {
      ...process.env,
      SCREENER_EARNINGS_CLI_ROOT_FIXTURE: jsonText,
      SCREENER_EARNINGS_CLI_SCRIPT: CLI_PATH,
    },
  });
}

function assertControlledRejection(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, EXPECTED_ERROR);
}

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const invalidRoots = new Map([
  ['array', JSON.stringify([{ date: tomorrow }])],
  ['null', 'null'],
  ['number', '42'],
  ['boolean', 'true'],
  ['string', '"ticker"'],
]);

for (const [name, fixture] of invalidRoots) {
  test(`rejects a JSON ${name} root with one controlled diagnostic`, () => {
    assertControlledRejection(runCli(fixture));
  });
}

test('keeps an empty object root valid without inventing a completeness floor', () => {
  const result = runCli('{}');

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /\(0 stocks\):/);
});

test('keeps a populated ticker object on the existing healthy CLI path', () => {
  const result = runCli(JSON.stringify({ ACME: { date: tomorrow } }));

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /\(1 stocks\):/);
  assert.match(result.stdout, new RegExp(`\\b${tomorrow}\\s+ACME\\s+in \\d+ Tagen\\b`));
});

after(() => {
  assert.deepEqual(offlineGuard.state.attempts, [], 'all fixtures must remain offline');
});
