'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadDaily, CALENDAR } = require('./helpers/form4-daily-harness');
const { assertEdgarCalendarReady } = require('./helpers/edgar-calendar-readiness');

test('calendar maintenance: current year is covered and next year is ready by December 1 UTC', () => {
  // The sole wall-clock check is intentional: make the real maintenance deadline visible in CI.
  assertEdgarCalendarReady(JSON.parse(fs.readFileSync(CALENDAR, 'utf8')), new Date());
});

test('calendar readiness enforces December and January boundaries with a fixed clock', () => {
  // Reuse sourced historical dates so this fixture never invents future SEC holidays.
  const dates2026 = JSON.parse(fs.readFileSync(CALENDAR, 'utf8')).years['2026'];
  const fixture = { years: { '2026': dates2026 } };
  assert.doesNotThrow(() => assertEdgarCalendarReady(fixture, new Date('2026-11-30T23:59:59.999Z')));
  assert.throws(() => assertEdgarCalendarReady(fixture, new Date('2026-12-01T00:00:00.000Z')),
    /missing year 2027/);
  assert.throws(() => assertEdgarCalendarReady(fixture, new Date('2027-01-01T00:00:00.000Z')),
    /missing year 2027/, 'January must not clear the overdue deadline');
  assert.throws(() => assertEdgarCalendarReady({ years: {} }, new Date('2026-11-30T00:00:00Z')),
    /missing year 2026/);
  // A complete next-year fixture succeeds at the deadline, using published 2026 data.
  assert.doesNotThrow(() => assertEdgarCalendarReady(
    { years: { '2025': ['20250101'], '2026': dates2026 } }, new Date('2025-12-01T00:00:00Z')));
  assert.throws(() => assertEdgarCalendarReady(
    { years: { '2026': dates2026, '2027': [] } }, new Date('2026-12-01T00:00:00Z')),
    /missing year 2027/, 'an empty placeholder cannot satisfy the maintenance gate');
});

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
      const weekday = new Date(iso).getUTCDay();
      assert.ok(weekday >= 1 && weekday <= 5, 'EDGAR holiday must be Mon-Fri: ' + date);
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

test('missing target year warns once while keeping the existing fetch and cursor behavior', async () => {
  const result = await loadDaily({ now: '2027-01-06T07:00:00Z', cursor: '20261231',
    responses: { '20270101': 403 } }).run();
  const warnings = result.logs.filter(line => /^::warning::.*EDGAR.*2027/.test(line));
  assert.equal(warnings.length, 1, 'missing calendar year must be visible without daily warning spam');
  assert.match(warnings[0], /configs\/edgar-holidays\.json/);
  assert.deepEqual(result.indexDates, ['20270101', '20270104', '20270105']);
  assert.equal(result.cursor, '20261231');
  assert.equal(result.exit, 0);
  const known = await loadDaily({ now: '2026-09-08T07:00:00Z' }).run();
  assert.ok(!known.logs.some(line => /^::warning::.*EDGAR/.test(line)));
});

test('manual holiday DATE advances only after midnight UTC following that holiday', async () => {
  for (const [now, expected] of [
    ['2026-12-24T23:59:59.999Z', '20261223'],
    ['2026-12-25T00:00:00.000Z', '20261223'],
    ['2026-12-25T23:59:59.999Z', '20261223'],
    ['2026-12-26T00:00:00.000Z', '20261225'],
  ]) {
    const result = await loadDaily({ now, cursor: '20261223', env: { DATE: '20261225' } }).run();
    assert.equal(result.cursor, expected, now);
    assert.equal(result.exit, 0);
    assert.deepEqual(result.requests, []);
  }
});

test('403 older than three days annotates the gap without changing partial/total exit semantics', async () => {
  for (const [now, annotated] of [
    ['2026-09-10T23:59:59.999Z', false],
    ['2026-09-11T00:00:00.000Z', false],
    ['2026-09-11T00:00:00.001Z', true],
  ]) {
    const result = await loadDaily({ now, cursor: '20260907', responses: { '20260908': 403 } }).run();
    const errors = result.logs.filter(line => /^::error::/.test(line));
    assert.equal(errors.length, annotated ? 1 : 0, now);
    if (annotated) assert.match(errors[0], /20260908.*403.*cursor/i);
    assert.equal(result.cursor, '20260907');
    assert.equal(result.exit, 0, 'later successful filings preserve partial-success exit');
  }
  const total = await loadDaily({ now: '2026-09-12T00:00:00Z', cursor: '20260907',
    env: { DATE: '20260908' }, responses: { '20260908': 403 } }).run();
  assert.equal(total.exit, 1);
  assert.equal(total.cursor, '20260907');
  assert.equal(total.logs.filter(line => /^::error::/.test(line)).length, 1);
});

test('stale 403 also annotates after backoff, but other HTTP failures and holidays do not', async () => {
  for (const status of [429, 503]) {
    const result = await loadDaily({ now: '2026-09-12T00:00:00Z', cursor: '20260907',
      env: { DATE: '20260908' }, responses: { '20260908': [status, 403] } }).run();
    assert.deepEqual(result.indexDates, ['20260908', '20260908']);
    assert.equal(result.logs.filter(line => /^::error::/.test(line)).length, 1);
    assert.equal(result.exit, 1);
    assert.equal(result.cursor, '20260907');
  }
  for (const status of [404, 500]) {
    const result = await loadDaily({ now: '2026-09-12T00:00:00Z', cursor: '20260907',
      env: { DATE: '20260908' }, responses: { '20260908': status } }).run();
    assert.ok(!result.logs.some(line => /^::error::/.test(line)));
  }
  const holiday = await loadDaily({ now: '2026-09-12T00:00:00Z', env: { DATE: '20260907' },
    responses: { '20260907': 403 } }).run();
  assert.ok(!holiday.logs.some(line => /^::error::/.test(line)));
  assert.equal(holiday.cursor, '20260907');
});
