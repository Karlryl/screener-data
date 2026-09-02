'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'pull-insider-form4-daily.js');
const OFFLINE_GUARD = path.join(__dirname, 'helpers', 'offline-network-guard.js');
const OMIT = Symbol('omit');

const PROBE = [
  "'use strict';",
  "const guard = require(process.env.H62_OFFLINE_GUARD);",
  "let cursor;",
  "if (process.env.H62_CURSOR_KIND === 'json') {",
  "  cursor = JSON.parse(process.env.H62_CURSOR_JSON);",
  "}",
  "try {",
  "  const result = require(process.env.H62_SCRIPT).targetDates(cursor);",
  "  if (guard.state.attempts.length) {",
  "    throw new Error('unexpected network attempt: ' + guard.state.attempts.join(', '));",
  "  }",
  "  process.stdout.write(JSON.stringify(result));",
  "} catch (error) {",
  "  process.stderr.write(String(error && error.message ? error.message : error));",
  "  process.exitCode = 23;",
  "}"
].join('\n');

function runProbe({ date = OMIT, cursor = OMIT } = {}) {
  const env = {
    ...process.env,
    H62_OFFLINE_GUARD: OFFLINE_GUARD,
    H62_SCRIPT: SCRIPT,
  };
  delete env.DATE;
  delete env.DAYS;
  delete env.H62_CURSOR_KIND;
  delete env.H62_CURSOR_JSON;
  delete env.NODE_OPTIONS;
  delete env.SCREENER_OFFLINE_NETWORK_MARKER;
  if (date !== OMIT) env.DATE = String(date);
  if (cursor !== OMIT) {
    env.H62_CURSOR_KIND = 'json';
    env.H62_CURSOR_JSON = JSON.stringify(cursor);
  }

  return spawnSync(process.execPath, ['--require', OFFLINE_GUARD, '--eval', PROBE], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

function diagnostic(result) {
  return 'status=' + result.status + '\nstdout=' + result.stdout + '\nstderr=' + result.stderr;
}

function expectRejected(name, options, label, rawValue) {
  test(name, () => {
    const result = runProbe(options);
    assert.notEqual(result.status, 0, diagnostic(result));
    assert.match(result.stderr, new RegExp(label), diagnostic(result));
    assert.match(result.stderr, /YYYYMMDD/, diagnostic(result));
    const renderedValue = JSON.stringify(rawValue) ?? String(rawValue);
    assert.ok(result.stderr.includes(renderedValue), diagnostic(result));
    assert.doesNotMatch(result.stderr, /offline-network-guard|unexpected network attempt/, diagnostic(result));
  });
}

function expectAccepted(name, options, expectedExact) {
  test(name, () => {
    const result = runProbe(options);
    assert.equal(result.status, 0, diagnostic(result));
    assert.doesNotMatch(result.stderr, /offline-network-guard|unexpected network attempt/, diagnostic(result));
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed));
    if (expectedExact) assert.deepEqual(parsed, expectedExact);
  });
}

for (const value of ['20260230', '20230229', '20261301', '20260100']) {
  expectRejected('DATE rejects impossible calendar value ' + value, { date: value, cursor: null }, 'DATE', value);
}
expectRejected('DATE rejects a present empty value', { date: '', cursor: null }, 'DATE', '');
expectRejected('DATE keeps rejecting non-YYYYMMDD syntax', { date: '2026-02-28', cursor: null }, 'DATE', '2026-02-28');
expectAccepted('DATE accepts a real leap day', { date: '20240229', cursor: null }, ['20240229']);
expectAccepted('DATE accepts a real weekend date', { date: '20260530', cursor: null }, ['20260530']);
expectRejected(
  'valid DATE does not bypass an invalid persisted cursor',
  { date: '20260530', cursor: '20260230' },
  'lastIndexedDate',
  '20260230'
);

for (const value of ['20260230', '20230229', '20261301', '20260100', '2026-02-28', '', 0]) {
  expectRejected(
    'lastIndexedDate rejects invalid persisted value ' + JSON.stringify(value),
    { cursor: value },
    'lastIndexedDate',
    value
  );
}
expectAccepted('lastIndexedDate accepts a real leap day', { cursor: '20240229' });
expectAccepted('lastIndexedDate accepts a real weekend date', { cursor: '20260530' });
expectAccepted('lastIndexedDate accepts null as bootstrap', { cursor: null });
expectAccepted('lastIndexedDate accepts an omitted value as bootstrap');

test('main validates DATE before I/O and forwards the cursor without truthiness masking', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const mainStart = source.indexOf('async function main()');
  const dateGuard = source.indexOf("assertCanonicalYmd(SINGLE_DATE, 'DATE');", mainStart);
  const firstIo = source.indexOf('ensureDir(EXTERNAL_DIR);', mainStart);
  assert.ok(mainStart >= 0 && dateGuard > mainStart && dateGuard < firstIo,
    'main must reject an invalid explicit DATE before its first filesystem operation');
  assert.match(source, /const dates = targetDates\(existing\.lastIndexedDate\);/);
  assert.doesNotMatch(source, /targetDates\(existing\.lastIndexedDate\s*\|\|/);
});
