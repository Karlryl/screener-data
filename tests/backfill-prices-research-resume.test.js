'use strict';
/**
 * The research price backfill documents file existence as its resume source of
 * truth. A stale manifest entry must therefore never hide a missing snapshot.
 *
 * This test runs the real CLI in a disposable repo. A process-wide network
 * guard blocks every standard Node network API, and the local Yahoo stub
 * throws if chart() is reached.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL   ' + name + '\n       ' + (error.stack || error.message));
  }
}

function makeHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-resume-'));
  const scriptsDir = path.join(root, 'scripts');
  const libDir = path.join(root, 'lib');
  const yahooDir = path.join(root, 'node_modules', 'yahoo-finance2');
  const pricesDir = path.join(root, 'prices-max');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(yahooDir, { recursive: true });
  fs.mkdirSync(pricesDir, { recursive: true });

  const script = path.join(scriptsDir, 'backfill-prices-research.js');
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'backfill-prices-research.js'), script);
  fs.copyFileSync(path.join(__dirname, '..', 'lib', 'atomic-write.js'), path.join(libDir, 'atomic-write.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'lib', 'snapshot-fs.js'), path.join(libDir, 'snapshot-fs.js'));
  fs.writeFileSync(path.join(yahooDir, 'index.js'), [
    "'use strict';",
    'class NoNetworkYahoo {',
    "  chart() { throw new Error('network path reached during dry-run'); }",
    '}',
    'module.exports = { default: NoNetworkYahoo };',
    '',
  ].join('\n'));

  const tickers = ['DONE-MISSING', 'DONE-PRESENT', 'OPEN-MISSING', 'OPEN-PRESENT'];
  const listFile = path.join(root, 'tickers.txt');
  const presentListFile = path.join(root, 'present-tickers.txt');
  fs.writeFileSync(listFile, tickers.join('\n') + '\n');
  fs.writeFileSync(presentListFile, 'DONE-PRESENT\nOPEN-PRESENT\n');
  fs.writeFileSync(path.join(pricesDir, '_manifest-research.json'), JSON.stringify({
    done: {
      'DONE-MISSING': { at: '2026-08-31', bars: 10 },
      'DONE-PRESENT': { at: '2026-08-31', bars: 10 },
    },
  }));
  fs.writeFileSync(path.join(pricesDir, safeSnapshotFilename('DONE-PRESENT')), '');
  fs.writeFileSync(path.join(pricesDir, safeSnapshotFilename('OPEN-PRESENT')), '');

  return { root, script, listFile, presentListFile, tickers };
}

function runDry(harness, extraArgs = [], listFile = harness.listFile) {
  const offlineGuard = path.join(__dirname, 'helpers', 'offline-network-guard.js');
  const result = spawnSync(process.execPath, [
    '--require', offlineGuard,
    harness.script,
    '--tickers-file', listFile,
    '--dry-run',
    ...extraArgs,
  ], {
    cwd: harness.root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
  assert.equal(result.status, 0,
    `CLI failed (${result.error || 'no spawn error'})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const normalized = result.stdout.replace(/\r\n/g, '\n');
  assert.ok(normalized.endsWith('\n'), 'CLI output must end with a newline');
  const lines = normalized.slice(0, -1).split('\n');
  assert.equal(lines.length, 2, `dry-run must emit exactly one log line and one todo line: ${normalized}`);
  assert.match(lines[0], /^\[[^\]]+\] Forschungs-Backfill: \d+ gewünscht · zu ziehen: \d+$/);
  return lines[1];
}

const harness = makeHarness();

test('resume retries every missing file even when the research manifest says done', () => {
  assert.equal(runDry(harness), 'DONE-MISSING,OPEN-MISSING');
});

test('--force still includes all requested tickers regardless of files or manifest', () => {
  assert.equal(runDry(harness, ['--force']), harness.tickers.join(','));
});

test('--limit applies after missing-file eligibility is determined', () => {
  assert.equal(runDry(harness, ['--limit', '2']), 'DONE-MISSING,OPEN-MISSING');
});

test('--force and --limit retain requested order and cap the forced set', () => {
  assert.equal(runDry(harness, ['--force', '--limit', '2']), 'DONE-MISSING,DONE-PRESENT');
});

test('an all-present request emits an explicit empty todo line', () => {
  assert.equal(runDry(harness, [], harness.presentListFile), '');
});

console.log(`\nbackfill-prices-research-resume: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
