'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'vintage-commit-text.js');
const { isCanonicalIsoDate, subject, done } = require(SCRIPT);

test('exports the pure canonical date predicate', () => {
  assert.equal(typeof isCanonicalIsoDate, 'function');
});

test('validates the vintage date before either CLI success output', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const cliStart = source.indexOf('if (require.main === module)');
  const guard = source.indexOf('if (!isCanonicalIsoDate(datum))', cliStart);
  const subjectWrite = source.indexOf('process.stdout.write(subject', cliStart);
  const doneWrite = source.indexOf('process.stdout.write(done', cliStart);
  assert.ok(cliStart >= 0, 'CLI block must be locatable');
  assert.ok(guard > cliStart, 'calendar guard must be inside the CLI block');
  assert.ok(subjectWrite > guard, 'subject output must remain after calendar validation');
  assert.ok(doneWrite > guard, 'done output must remain after calendar validation');
});

test('accepts ordinary real calendar dates', () => {
  for (const value of ['2026-01-01', '2026-07-30', '2026-12-31']) {
    assert.equal(isCanonicalIsoDate(value), true, value);
  }
});

test('accepts real leap days including a divisible-by-400 century', () => {
  for (const value of ['2000-02-29', '2024-02-29', '2400-02-29']) {
    assert.equal(isCanonicalIsoDate(value), true, value);
  }
});

test('accepts real dates at the four-digit year boundaries', () => {
  assert.equal(isCanonicalIsoDate('0000-01-01'), true);
  assert.equal(isCanonicalIsoDate('9999-12-31'), true);
});

test('continues to reject non-canonical shapes and non-string values', () => {
  for (const value of [null, undefined, 20260730, '', '2026-1-01', '2026-01-1', ' 2026-01-01', '2026-01-01Z']) {
    assert.equal(isCanonicalIsoDate(value), false, String(value));
  }
});

test('leaves subject and done text behavior unchanged for a valid date', () => {
  const date = '2026-07-30';
  assert.equal(subject('0', date), 'chore: board-history vintage ' + date);
  assert.match(subject('2', date), /SUSPECT, NICHT committet/);
  assert.match(done('0', date), /vintage 2026-07-30 committet/);
  assert.match(done('2', date), /blieb wegen SUSPECT ausgeschlossen/);
});

test('rejects month zero and month thirteen', () => {
  assert.equal(isCanonicalIsoDate('2026-00-01'), false);
  assert.equal(isCanonicalIsoDate('2026-13-01'), false);
});

test('rejects day zero and an impossible day thirty-two', () => {
  assert.equal(isCanonicalIsoDate('2026-01-00'), false);
  assert.equal(isCanonicalIsoDate('2026-01-32'), false);
});

test('rejects February 29 in non-leap years and non-leap centuries', () => {
  for (const value of ['2025-02-29', '1900-02-29', '2100-02-29']) {
    assert.equal(isCanonicalIsoDate(value), false, value);
  }
});

test('rejects dates beyond February even in a leap year', () => {
  assert.equal(isCanonicalIsoDate('2024-02-30'), false);
  assert.equal(isCanonicalIsoDate('2026-02-30'), false);
});

test('rejects day thirty-one in every thirty-day month', () => {
  for (const value of ['2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31']) {
    assert.equal(isCanonicalIsoDate(value), false, value);
  }
});
