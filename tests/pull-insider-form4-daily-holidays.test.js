'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadDaily, CALENDAR } = require('./helpers/form4-daily-harness');

test('calendar records the complete official 2026 EDGAR list and provenance', () => {
  const calendar = JSON.parse(fs.readFileSync(CALENDAR, 'utf8'));
  assert.equal(calendar.source, 'https://www.sec.gov/submit-filings/filer-support-resources/edgar-calendar');
  assert.equal(calendar.asOf, '2026-09-27');
  assert.deepEqual(calendar.years['2026'], [
    '20260101', '20260119', '20260216', '20260525', '20260619', '20260703',
    '20260907', '20261012', '20261111', '20261126', '20261225',
  ]);
  for (const [year, dates] of Object.entries(calendar.years)) {
    assert.match(year, /^\d{4}$/);
    assert.ok(Array.isArray(dates));
    assert.equal(new Set(dates).size, dates.length);
    for (const date of dates) {
      assert.match(date, new RegExp('^' + year + '\\d{4}$'));
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      assert.equal(new Date(iso).toISOString().slice(0, 10), iso);
    }
  }
});

test('holiday-only run advances and persists the cursor without requesting its 403 index', async () => {
  const result = await loadDaily({ now: '2026-09-08T07:00:00Z', responses: { '20260907': 403 } }).run();
  assert.equal(result.exit, 0);
  assert.equal(result.cursor, '20260907', 'known holiday must advance the cursor');
  assert.deepEqual(result.requests, [], 'the known holiday index must never be fetched');
  assert.match(result.logs.join('\n'), /holiday/i);
});

test('catch-up crosses the holiday and persists subsequent successful filing days', async () => {
  const result = await loadDaily({ now: '2026-09-10T07:00:00Z', responses: { '20260907': 403 } }).run();
  assert.equal(result.exit, 0);
  assert.equal(result.cursor, '20260909');
  assert.deepEqual(result.indexDates, ['20260908', '20260909']);
  assert.equal(result.filingFetches, 2);
  assert.equal(result.writes[0].lastIndexedDate, '20260907', 'holiday progress must be saved immediately');
});

test('non-holiday 403 keeps the gap despite later successes and emits a diagnostic', async () => {
  const result = await loadDaily({ now: '2026-09-10T07:00:00Z', responses: { '20260908': 403 } }).run();
  assert.equal(result.cursor, '20260907');
  assert.deepEqual(result.indexDates, ['20260908', '20260909']);
  assert.match(result.logs.join('\n'), /index fetch ERROR: HTTP 403/);
  assert.match(result.logs.join('\n'), /Cursor bleibt auf 20260907/);
  // Existing partial-success behavior is unchanged; a total failure stays nonzero.
  const total = await loadDaily({ now: '2026-09-09T07:00:00Z', cursor: '20260907',
    responses: { '20260908': 403 } }).run();
  assert.equal(total.exit, 1);
  assert.equal(total.cursor, '20260907');
});

test('a later holiday cannot bridge an earlier non-holiday 403 gap', async () => {
  const result = await loadDaily({ now: '2026-09-08T07:00:00Z', cursor: '20260903',
    responses: { '20260904': 403, '20260907': 403 } }).run();
  assert.equal(result.cursor, '20260903');
  assert.equal(result.exit, 1);
  assert.deepEqual(result.indexDates, ['20260904']);
});

test('non-calendar 404 handling retains both sides of the existing age threshold', async () => {
  const recent = await loadDaily({ now: '2026-09-10T07:00:00Z', cursor: '20260908',
    responses: { '20260909': 404 } }).run();
  assert.equal(recent.cursor, '20260908');
  assert.equal(recent.exit, 0);
  const old = await loadDaily({ now: '2026-09-13T07:00:00Z', cursor: '20260908',
    env: { DATE: '20260909' }, responses: { '20260909': 404 } }).run();
  assert.equal(old.cursor, '20260909');
  assert.equal(old.exit, 0);
});

test('unlisted future year retains weekday planning, 403 errors and 404 handling', async () => {
  const scenario = { now: '2027-09-08T07:00:00Z', cursor: '20270903' };
  const loader = loadDaily(scenario);
  assert.deepEqual(Array.from(loader.api.targetDates(scenario.cursor)), ['20270907', '20270906']);
  const error = await loadDaily({ ...scenario, responses: { '20270906': 403 } }).run();
  assert.equal(error.cursor, '20270903');
  assert.deepEqual(error.indexDates, ['20270906', '20270907']);
  assert.match(error.logs.join('\n'), /HTTP 403/);
  const recent = await loadDaily({ ...scenario, responses: { '20270906': 404 } }).run();
  assert.equal(recent.cursor, '20270903');
  const old = await loadDaily({ ...scenario, now: '2027-09-10T07:00:00Z',
    env: { DATE: '20270906' }, responses: { '20270906': 404 } }).run();
  assert.equal(old.cursor, '20270906');
});

test('explicit holiday backfill never regresses a newer persisted cursor', async () => {
  const result = await loadDaily({ cursor: '20260925', env: { DATE: '20260907' },
    responses: { '20260907': 403 } }).run();
  assert.equal(result.cursor, '20260925');
  assert.deepEqual(result.requests, []);
});
