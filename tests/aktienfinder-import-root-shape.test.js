'use strict';

const offlineGuard = require('./helpers/offline-network-guard');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', 'aktienfinder-import.js');

function makeFixture(rootText) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aktienfinder-root-'));
  const externalData = path.join(cwd, 'external-data');
  const output = path.join(externalData, 'aktienfinder.json');
  const csv = path.join(cwd, 'aktienfinder.csv');
  const networkMarker = path.join(cwd, 'network-attempts.log');

  fs.mkdirSync(externalData, { recursive: true });
  fs.writeFileSync(output, rootText, 'utf8');
  fs.writeFileSync(csv, 'ticker,score\nCRDO,8.5\n', 'utf8');
  return { cwd, externalData, output, csv, networkMarker };
}

function runImport(rootText, reset = false) {
  const fixture = makeFixture(rootText);
  const env = {
    ...process.env,
    SCREENER_OFFLINE_NETWORK_MARKER: fixture.networkMarker,
  };
  if (reset) env.RESET_AKTIENFINDER = '1';
  else delete env.RESET_AKTIENFINDER;

  const result = spawnSync(process.execPath, [SCRIPT, fixture.csv], {
    cwd: fixture.cwd,
    encoding: 'utf8',
    env,
  });
  return { ...fixture, result };
}

function corruptBackups(externalData) {
  return fs.readdirSync(externalData)
    .filter(name => name.startsWith('aktienfinder.json.corrupt.'));
}

function assertNoNetworkAttempt(run) {
  assert.equal(fs.existsSync(run.networkMarker), false, 'import must stay offline');
}

test('offline guard is active and inherited by import subprocesses', () => {
  assert.ok(globalThis[offlineGuard.STATE_KEY]);
  assert.match(String(process.env.NODE_OPTIONS), /offline-network-guard/);
  const child = spawnSync(process.execPath, ['-e', [
    "const key = Symbol.for('screener.offlineNetworkGuard');",
    'process.stdout.write(String(Boolean(globalThis[key])));',
  ].join(' ')], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'true', 'import subprocess environment must preload the guard');
});

test('array root is backed up and refused without explicit reset', () => {
  const run = runImport('[]');

  assert.notEqual(run.result.status, 0, run.result.stdout);
  assert.match(run.result.stderr, /root must be a JSON object/);
  assert.match(run.result.stderr, /Refusing to overwrite/);
  assert.equal(fs.readFileSync(run.output, 'utf8'), '[]', 'original bytes must survive');
  const backups = corruptBackups(run.externalData);
  assert.equal(backups.length, 1, 'invalid root must receive one recoverable backup');
  assert.equal(fs.readFileSync(path.join(run.externalData, backups[0]), 'utf8'), '[]');
  assertNoNetworkAttempt(run);
});

test('object root preserves prior scores while adding the imported ticker', () => {
  const original = JSON.stringify({
    OLD: { score: 7, importedAt: '2026-01-01' },
  }, null, 2);
  const run = runImport(original);

  assert.equal(run.result.status, 0, run.result.stderr);
  const output = JSON.parse(fs.readFileSync(run.output, 'utf8'));
  assert.equal(Array.isArray(output), false);
  assert.deepEqual(output.OLD, { score: 7, importedAt: '2026-01-01' });
  assert.equal(output.CRDO.score, 8.5);
  assert.equal(corruptBackups(run.externalData).length, 0);
  assertNoNetworkAttempt(run);
});

for (const [label, rootText] of [
  ['array', '[]'],
  ['null', 'null'],
  ['number', '5'],
  ['string', '"x"'],
]) {
  test(`explicit reset replaces an invalid ${label} root with a proper object`, () => {
    const run = runImport(rootText, true);

    assert.equal(run.result.status, 0, run.result.stderr);
    const output = JSON.parse(fs.readFileSync(run.output, 'utf8'));
    assert.equal(output && typeof output, 'object');
    assert.equal(Array.isArray(output), false);
    assert.deepEqual(Object.keys(output), ['CRDO']);
    assert.equal(output.CRDO.score, 8.5);
    const backups = corruptBackups(run.externalData);
    assert.equal(backups.length, 1, 'reset must retain a backup of the invalid root');
    assert.equal(fs.readFileSync(path.join(run.externalData, backups[0]), 'utf8'), rootText);
    assertNoNetworkAttempt(run);
  });
}

after(() => {
  assert.deepEqual(offlineGuard.state.attempts, [], 'test process must stay offline');
});
