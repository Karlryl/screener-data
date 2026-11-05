'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { reportCycleRampDeadline } = require('../../scripts/cycle-ramp-deadline.js');
const ROOT = path.resolve(__dirname, '../..');
const TRANSITION = path.join(ROOT, 'protocol/gqs-00/1.2.0-pending/transition.json');

// This writing fixture test is never a mutation target. Broken inputs are detached scratch files only.
test('Berlin deadline reports only after endsOn while either actual legacy field remains', () => {
  const sha = () => crypto.createHash('sha256').update(fs.readFileSync(TRANSITION)).digest('hex');
  const before = sha();
  const relative = path.relative(ROOT, os.tmpdir());
  assert.ok(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'scratch must be outside the repository');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-deadline-'));
  const exportRoot = path.join(dir, 'export');
  const transitionFile = path.join(dir, 'transition.json');
  assert.notEqual(path.resolve(transitionFile), TRANSITION);
  fs.mkdirSync(path.join(exportRoot, 'quality'), { recursive: true });
  const boardFile = path.join(exportRoot, 'quality', 'energy.json');
  const original = JSON.parse(fs.readFileSync(TRANSITION, 'utf8'));
  const comparison = original.cycleRamp.comparison;
  assert.equal(comparison.endsOn, '2026-12-02');
  assert.equal((Date.parse(comparison.endsOn) - Date.parse(comparison.startsOn)) / 86400000, comparison.maximumDays);
  fs.writeFileSync(transitionFile, JSON.stringify(original));
  fs.writeFileSync(boardFile, JSON.stringify({ profitable: [{ scoreCycleLegacy: null, factors: { cycleLegacy: 1 } }] }));
  const warnings = [];
  const run = iso => { warnings.length = 0; return reportCycleRampDeadline(exportRoot,
    { now: new Date(iso), transitionFile, warn: text => warnings.push(text) }); };

  for (const iso of ['2026-11-04T12:00:00Z', '2026-12-01T23:00:00Z', '2026-12-02T22:59:59Z']) {
    assert.equal(run(iso).overdue, false);
    assert.deepEqual(warnings, []);
  }
  const late = run('2026-12-02T23:00:00Z');
  assert.equal(late.today, '2026-12-03');
  assert.equal(late.legacyExported, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^::warning::.*2026-12-02/);
  for (const row of [{ scoreCycleLegacy: null }, { factors: { cycleLegacy: 1 } }]) {
    fs.writeFileSync(boardFile, JSON.stringify({ rows: [row] }));
    assert.equal(run('2027-01-01T00:00:00Z').legacyExported, true);
    assert.equal(warnings.length, 1);
  }
  fs.writeFileSync(boardFile, JSON.stringify({ rows: [{ score: 50, factors: { cycle: 1 } }] }));
  assert.equal(run('2027-01-01T00:00:00Z').legacyExported, false);
  assert.deepEqual(warnings, []);

  // Move only the scratch deadline: proves endsOn is read, not hard-coded in the reporter.
  original.cycleRamp.comparison.endsOn = '2027-02-02';
  fs.writeFileSync(transitionFile, JSON.stringify(original));
  fs.writeFileSync(boardFile, JSON.stringify({ rows: [{ scoreCycleLegacy: 50 }] }));
  assert.equal(run('2027-01-01T00:00:00Z').overdue, false);
  assert.deepEqual(warnings, []);
  assert.equal(run('2027-02-02T23:00:00Z').legacyExported, true);

  // The real --check path reports but returns exactly the same validation errors across the deadline.
  const { validateExport } = require('../../scripts/write-findash-export.js');
  warnings.length = 0;
  const earlyErrors = validateExport(exportRoot, { now: new Date('2026-12-02T22:59:59Z'), warn: text => warnings.push(text) });
  assert.deepEqual(warnings, []);
  const lateErrors = validateExport(exportRoot, { now: new Date('2026-12-02T23:00:00Z'), warn: text => warnings.push(text) });
  assert.deepEqual(lateErrors, earlyErrors);
  assert.equal(warnings.length, 1);

  for (const broken of ['{', JSON.stringify({ cycleRamp: { comparison: { endsOn: '2026-02-30' } } }), '{}']) {
    fs.writeFileSync(transitionFile, broken);
    assert.ok(run('2027-01-01T00:00:00Z').error);
    assert.equal(warnings.length, 1);
  }
  fs.writeFileSync(transitionFile, JSON.stringify(original));
  fs.writeFileSync(boardFile, '{');
  assert.ok(run('2027-03-01T00:00:00Z').error);
  assert.equal(warnings.length, 1);
  assert.equal(sha(), before, 'live transition remains byte-identical');
});
