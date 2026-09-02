#!/usr/bin/env node
'use strict';

// H57: the main watchlist is a required measurement input. A missing or
// malformed input must not be reported as a measured overlap of zero before a
// destructive reconciliation. The harness virtualizes every reconciliation
// read, blocks reconciliation writes, and inherits the offline-network guard.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const offlineGuard = require('./helpers/offline-network-guard.js');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'reconcile-smallcap.js');
const VIRTUAL_ROOT = path.join(REPO_ROOT, '__h57_virtual__');
const PRIMARY_PATH = path.join(VIRTUAL_ROOT, 'watchlist-smallcap.json');
const MAIN_PATH = path.join(VIRTUAL_ROOT, 'watchlist.json');
const SNAPSHOT_DIR = path.join(VIRTUAL_ROOT, 'snapshots-smallcap');
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'ACME.json');
const REPORT_PATH = path.join(VIRTUAL_ROOT, 'reconcile-report.json');

function runMainWatchlist(mainFixture) {
  const source = [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const reconcile = require(${JSON.stringify(SCRIPT)});`,
    "const guard = globalThis[Symbol.for('screener.offlineNetworkGuard')];",
    "if (!guard) throw new Error('__OFFLINE_GUARD_MISSING__');",
    `const primaryPath = ${JSON.stringify(PRIMARY_PATH)};`,
    `const mainPath = ${JSON.stringify(MAIN_PATH)};`,
    `const snapshotPath = ${JSON.stringify(SNAPSHOT_PATH)};`,
    `const reportPath = ${JSON.stringify(REPORT_PATH)};`,
    `const mainMode = ${JSON.stringify(mainFixture.mode)};`,
    `const mainText = ${JSON.stringify(mainFixture.text || '')};`,
    `const forbidSnapshot = ${JSON.stringify(Boolean(mainFixture.forbidSnapshot))};`,
    `const snapshotMode = ${JSON.stringify(mainFixture.snapshotMode || 'missing')};`,
    `const useDryRun = ${JSON.stringify(mainFixture.dryRun !== false)};`,
    `const useForce = ${JSON.stringify(Boolean(mainFixture.force))};`,
    `const useReport = ${JSON.stringify(Boolean(mainFixture.report))};`,
    "const primaryText = JSON.stringify({ stocks: [{ ticker: 'ACME' }] });",
    "const delistedSnapshotText = JSON.stringify({ meta: { ticker: 'ACME', delisted: true } });",
    "function missing(file) {",
    "  const error = new Error('ENOENT: no such file or directory, open ' + file);",
    "  error.code = 'ENOENT';",
    "  error.path = file;",
    "  return error;",
    "}",
    "fs.readFileSync = (inputPath, encoding) => {",
    "  const file = path.resolve(String(inputPath));",
    "  if (encoding !== 'utf8') throw new Error('__UNEXPECTED_ENCODING__:' + encoding);",
    "  if (file === primaryPath) return primaryText;",
    "  if (file === mainPath) {",
    "    if (mainMode === 'missing') throw missing(file);",
    "    return mainText;",
    "  }",
    "  if (file === snapshotPath) {",
    "    if (forbidSnapshot) process.stderr.write('__SNAPSHOT_READ_BEFORE_MAIN_VALIDATION__\\n');",
    "    if (snapshotMode === 'delisted') return delistedSnapshotText;",
    "    throw missing(file);",
    "  }",
    "  throw new Error('__UNEXPECTED_READ__:' + file);",
    "};",
    "for (const name of ['appendFileSync', 'copyFileSync', 'mkdirSync', 'openSync', 'renameSync', 'rmSync', 'unlinkSync', 'writeFileSync']) {",
    "  fs[name] = () => { throw new Error('__WRITE_TRIPWIRE__:' + name); };",
    "}",
    `const argv = [process.execPath, ${JSON.stringify(SCRIPT)}, '--watchlist', primaryPath, '--snapshots', ${JSON.stringify(SNAPSHOT_DIR)}, '--main-watchlist', mainPath];`,
    "if (useForce) argv.push('--force');",
    "if (useReport) argv.push('--report', reportPath);",
    "if (useDryRun) argv.push('--dry-run');",
    "process.argv = argv;",
    "reconcile.main();",
    "if (guard.attempts.length) throw new Error('__NETWORK_ATTEMPT__:' + guard.attempts.join(','));",
  ].join('\n');

  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  return result;
}

function assertControlledFailure(result, label) {
  const diagnostic = `::error::Haupt-Watchlist nicht lesbar oder unbekanntes Format: ${MAIN_PATH}\n`;
  assert.equal(result.error, undefined, `${label}: child launch failed: ${result.error}`);
  assert.equal(result.status, 1, `${label}: expected exit 1\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.equal(result.signal, null, `${label}: child ended via signal ${result.signal}`);
  assert.equal(result.stdout, '', `${label}: reconciliation ran before rejecting the input`);
  assert.equal(result.stderr, diagnostic, `${label}: diagnostic is not controlled and exact`);
}

const INVALID_CASES = [
  ['missing file under --force', {
    mode: 'missing',
    forbidSnapshot: true,
    snapshotMode: 'delisted',
    dryRun: false,
    force: true,
    report: true,
  }],
  ['malformed JSON', { mode: 'text', text: '{"stocks":', forbidSnapshot: true }],
  ['unknown object root', { mode: 'text', text: '{}', forbidSnapshot: true }],
  ['non-array stocks field', { mode: 'text', text: '{"stocks":{}}', forbidSnapshot: true }],
];

for (const [name, fixture] of INVALID_CASES) {
  test(`rejects ${name} before snapshot work, reporting, or mutation`, () => {
    assertControlledFailure(runMainWatchlist(fixture), name);
  });
}

const VALID_CASES = [
  ['wrapped empty list', '{"stocks":[]}', 0],
  ['wrapped populated list', '{"stocks":[{"ticker":"ACME"}]}', 1],
  ['legacy bare array', '["ACME"]', 1],
];

for (const [name, text, overlap] of VALID_CASES) {
  test(`accepts ${name} as a measurable input`, () => {
    const result = runMainWatchlist({ mode: 'text', text });
    assert.equal(result.error, undefined, `${name}: child launch failed: ${result.error}`);
    assert.equal(result.status, 0, `${name}: expected success\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.equal(result.signal, null, `${name}: child ended via signal ${result.signal}`);
    assert.equal(result.stderr, '', `${name}: unexpected diagnostic\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Auflage 6 \\(nur gemessen\\): ${overlap} von 1`));
    assert.match(result.stdout, /dry-run/i);
  });
}

test.after(() => {
  assert.deepEqual(offlineGuard.state.attempts, []);
});
