'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { state: offlineState } = require('./helpers/offline-network-guard.js');
const newcomer = require('../scripts/write-newcomer-log.js');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'write-newcomer-log.js');
const OFFLINE_GUARD = path.join(ROOT, 'tests', 'helpers', 'offline-network-guard.js');
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'newcomer-date-contract-'));
const CLI_NETWORK_MARKER = path.join(TEST_ROOT, 'cli-network-attempts.txt');

function snapshotTree(root) {
  const entries = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const absolute = path.join(dir, name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      const stat = fs.statSync(absolute);
      if (stat.isDirectory()) {
        entries.push('D ' + relative);
        walk(absolute);
      } else {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
        entries.push('F ' + relative + ' ' + digest);
      }
    }
  }
  walk(root);
  return entries;
}

function fixture(name, rows = [{ ticker: 'AAA' }]) {
  const dir = path.join(TEST_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  const overview = path.join(dir, 'overview.json');
  const logDir = path.join(dir, 'logs');
  fs.writeFileSync(overview, JSON.stringify({ rows }), 'utf8');
  return { dir, overview, logDir };
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SCREENER_OFFLINE_NETWORK_MARKER: CLI_NETWORK_MARKER,
    },
    shell: false,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

const invalidRunDates = [
  ['traversal', '../evil'],
  ['garbage', 'undefined'],
  ['noncanonical', '2026-2-03'],
  ['impossible-day', '2026-02-30'],
  ['non-leap-day', '2025-02-29'],
  ['empty-string', ''],
];

for (const [name, date] of invalidRunDates) {
  test('run rejects ' + name + ' date before any filesystem effect', () => {
    const f = fixture('run-invalid-' + name);
    const before = snapshotTree(f.dir);
    const result = newcomer.run({ date, overview: f.overview, logDir: f.logDir });
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'datum-ungueltig');
    assert.match(result.error, /YYYY-MM-DD/);
    assert.deepEqual(snapshotTree(f.dir), before);
  });
}

for (const [name, dateArgs] of [
  ['traversal', ['--date', '../escape']],
  ['impossible-day', ['--date', '2026-02-30']],
  ['empty-value', ['--date', '']],
  ['missing-value', ['--date']],
]) {
  test('CLI rejects ' + name + ' date with exit 1 and no write', () => {
    const f = fixture('cli-invalid-' + name);
    const before = snapshotTree(f.dir);
    const result = runCli([
      '--overview', f.overview,
      '--log-dir', f.logDir,
      ...dateArgs,
    ]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /^::error::newcomer-log: invalid date/m);
    assert.deepEqual(snapshotTree(f.dir), before);
    assert.equal(fs.existsSync(CLI_NETWORK_MARKER), false, 'CLI attempted network access');
  });
}

test('invalid date wins even when the overview is missing', () => {
  const f = fixture('invalid-before-missing-overview');
  const missingOverview = path.join(f.dir, 'missing-overview.json');
  const before = snapshotTree(f.dir);
  const result = newcomer.run({
    date: '../escape',
    overview: missingOverview,
    logDir: f.logDir,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.status, 'datum-ungueltig');
  assert.deepEqual(snapshotTree(f.dir), before);
});

test('ordinary canonical date keeps the existing write contract', () => {
  const f = fixture('valid-ordinary');
  const result = newcomer.run({ date: '2026-08-10', overview: f.overview, logDir: f.logDir });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'geschrieben');
  assert.equal(result.date, '2026-08-10');
  const rows = fs.readFileSync(path.join(f.logDir, '2026-08.jsonl'), 'utf8')
    .trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-08-10');
  assert.deepEqual(rows[0].members, ['AAA']);
});

test('real leap day remains accepted', () => {
  const f = fixture('valid-leap-day');
  const result = newcomer.run({ date: '2024-02-29', overview: f.overview, logDir: f.logDir });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'geschrieben');
  assert.equal(fs.existsSync(path.join(f.logDir, '2024-02.jsonl')), true);
});

for (const [name, dateOption] of [
  ['omitted', {}],
  ['explicit-null', { date: null }],
  ['explicit-undefined', { date: undefined }],
]) {
  test(name + ' date still uses a current UTC day', () => {
    const f = fixture('valid-default-date-' + name);
    const beforeTree = snapshotTree(f.dir);
    const beforeDate = newcomer.isoHeute();
    const result = newcomer.run({
      overview: f.overview,
      logDir: f.logDir,
      dryRun: true,
      ...dateOption,
    });
    const afterDate = newcomer.isoHeute();
    assert.equal(result.exitCode, 0);
    assert.equal(result.status, 'geschrieben');
    assert.equal([beforeDate, afterDate].includes(result.date), true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(snapshotTree(f.dir), beforeTree);
  });
}

test('valid empty overview remains a measured exit-0 status row', () => {
  const f = fixture('valid-empty-overview', []);
  const result = newcomer.run({ date: '2026-08-11', overview: f.overview, logDir: f.logDir });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'uebersicht-leer');
  const row = JSON.parse(fs.readFileSync(path.join(f.logDir, '2026-08.jsonl'), 'utf8').trim());
  assert.equal(row.date, '2026-08-11');
  assert.equal(row.status, 'nicht-messbar');
});

test('valid dry-run remains write-free', () => {
  const f = fixture('valid-dry-run');
  const before = snapshotTree(f.dir);
  const result = newcomer.run({
    date: '2026-08-12',
    overview: f.overview,
    logDir: f.logDir,
    dryRun: true,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.status, 'geschrieben');
  assert.deepEqual(snapshotTree(f.dir), before);
});

test('CLI without --date keeps the current-day default', () => {
  const f = fixture('cli-valid-default-date');
  const beforeTree = snapshotTree(f.dir);
  const beforeDate = newcomer.isoHeute();
  const result = runCli([
    '--overview', f.overview,
    '--log-dir', f.logDir,
    '--dry-run',
  ]);
  const afterDate = newcomer.isoHeute();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(
    [beforeDate, afterDate].some((date) => result.stdout.includes(date)),
    true,
    result.stdout,
  );
  assert.deepEqual(snapshotTree(f.dir), beforeTree);
  assert.equal(fs.existsSync(CLI_NETWORK_MARKER), false, 'CLI attempted network access');
});

test('CLI accepts an explicit canonical date and writes the matching month', () => {
  const f = fixture('cli-valid-canonical');
  const result = runCli([
    '--overview', f.overview,
    '--log-dir', f.logDir,
    '--date', '2026-08-13',
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rows = fs.readFileSync(path.join(f.logDir, '2026-08.jsonl'), 'utf8')
    .trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-08-13');
  assert.deepEqual(rows[0].members, ['AAA']);
  assert.equal(fs.existsSync(CLI_NETWORK_MARKER), false, 'CLI attempted network access');
});

test('offline preload blocks a real network probe', () => {
  assert.deepEqual(offlineState.attempts, []);
  const marker = path.join(TEST_ROOT, 'offline-self-probe.txt');
  const probe = spawnSync(process.execPath, [
    '--require', OFFLINE_GUARD,
    '--eval',
    "fetch('https://example.invalid').catch(() => {}); setImmediate(() => process.exit(0));",
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SCREENER_OFFLINE_NETWORK_MARKER: marker,
    },
    shell: false,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(probe.status, 1, probe.stdout + probe.stderr);
  assert.match(probe.stderr, /offline-network-guard.*fetch/);
  assert.equal(fs.existsSync(marker), true);
  assert.equal(fs.readFileSync(marker, 'utf8').trim().length > 0, true);
});
