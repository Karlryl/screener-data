'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'cadence-marker.js');
const { writeMarker } = require(SCRIPT);
const NOW = '2026-09-01T08:15:30.000Z';

function fixture(t, raw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-marker-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cadence-heartbeat.json');
  if (raw !== undefined) fs.writeFileSync(file, raw, 'utf8');
  return { dir, file };
}

function backups(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.startsWith('cadence-heartbeat.json.corrupt-'))
    .sort();
}

function expectedRecovery(field) {
  return {
    last_weekly_run: field === 'weekly' ? NOW : 'unknown',
    last_monthly_run: field === 'monthly' ? NOW : 'unknown',
    state: 'partially-unknown',
    schema: 'cadence-heartbeat/v1',
  };
}

const invalidExistingRoots = [
  ['syntax error', '{"last_monthly_run":', 'weekly'],
  ['null', 'null\n', 'weekly'],
  ['array', '[{"last_monthly_run":"2026-08-03T10:26:41.445Z"}]\n', 'monthly'],
  ['number', '42\n', 'weekly'],
  ['string', '"state"\n', 'monthly'],
  ['boolean', 'false\n', 'weekly'],
];

for (const [name, raw, field] of invalidExistingRoots) {
  test(`existing ${name} state is backed up and recovered as partially unknown`, (t) => {
    const { dir, file } = fixture(t, raw);
    const updated = writeMarker(file, field, NOW);

    assert.deepEqual(updated, expectedRecovery(field));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), updated,
      'the persisted state must exactly match the returned recovery state');

    const copies = backups(dir);
    assert.equal(copies.length, 1, 'the invalid existing evidence must have exactly one backup');
    assert.equal(fs.readFileSync(path.join(dir, copies[0]), 'utf8'), raw,
      'the backup must preserve the original bytes, not a normalized reconstruction');
  });
}

test('a missing file remains a valid bootstrap and is not classified as corruption', (t) => {
  const { dir, file } = fixture(t);
  const updated = writeMarker(file, 'weekly', NOW);

  assert.deepEqual(updated, {
    schema: 'cadence-heartbeat/v1',
    last_weekly_run: NOW,
  });
  assert.deepEqual(backups(dir), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), updated);
});

test('a valid legacy plain object preserves its sibling and unknown fields', (t) => {
  const before = {
    last_monthly_run: null,
    retained: { source: 'legacy' },
  };
  const { dir, file } = fixture(t, JSON.stringify(before));
  const updated = writeMarker(file, 'weekly', NOW);

  assert.deepEqual(updated, {
    last_monthly_run: null,
    retained: { source: 'legacy' },
    schema: 'cadence-heartbeat/v1',
    last_weekly_run: NOW,
  });
  assert.deepEqual(backups(dir), []);
});

test('a valid current plain object remains a read-modify-write operation', (t) => {
  const before = {
    schema: 'cadence-heartbeat/v1',
    comment: 'preserve me',
    last_weekly_run: '2026-08-31T11:41:57.629Z',
    last_monthly_run: '2026-08-03T10:26:41.445Z',
  };
  const { dir, file } = fixture(t, JSON.stringify(before));
  const updated = writeMarker(file, 'monthly', NOW);

  assert.deepEqual(updated, { ...before, last_monthly_run: NOW });
  assert.deepEqual(backups(dir), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), updated);
});

test('the CLI warns once, preserves invalid bytes, stamps the target, and exits successfully', (t) => {
  const raw = '[]\n';
  const { dir, file } = fixture(t, raw);
  const run = spawnSync(process.execPath,
    [SCRIPT, '--field', 'monthly', '--file', file],
    { cwd: ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = String(run.stdout || '') + String(run.stderr || '');
  const warnings = output.split(/\r?\n/)
    .filter(line => line.startsWith('::warning::cadence-marker'));
  assert.equal(warnings.length, 1, output);
  assert.match(output, /cadence-marker: last_monthly_run=.*cadence-heartbeat\.json/);

  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.last_weekly_run, 'unknown');
  assert.equal(persisted.state, 'partially-unknown');
  assert.ok(Number.isFinite(Date.parse(persisted.last_monthly_run)));
  const copies = backups(dir);
  assert.equal(copies.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, copies[0]), 'utf8'), raw);
});

test('the CLI does not warn for a valid plain object', (t) => {
  const raw = JSON.stringify({
    schema: 'cadence-heartbeat/v1',
    comment: 'keep',
    last_weekly_run: null,
    last_monthly_run: '2026-08-03T10:26:41.445Z',
  });
  const { dir, file } = fixture(t, raw);
  const run = spawnSync(process.execPath,
    [SCRIPT, '--field', 'weekly', '--file', file],
    { cwd: ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = String(run.stdout || '') + String(run.stderr || '');
  assert.ok(!output.includes('::warning::cadence-marker'), output);
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.comment, 'keep');
  assert.equal(persisted.last_monthly_run, '2026-08-03T10:26:41.445Z');
  assert.ok(Number.isFinite(Date.parse(persisted.last_weekly_run)));
  assert.deepEqual(backups(dir), []);
});
