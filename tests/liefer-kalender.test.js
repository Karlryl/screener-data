'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { alterTage, MS_PRO_TAG } = require('../lib/alter.js');
const K = require('../lib/liefer-kalender.js');

const ms = Date.parse;
const monday = ms('2026-10-05T20:42:16.469Z');
const priceStamp = ms('2026-10-03T09:24:34.702Z');

test('Monday price stamp exceeds the flat limit but covers the due Saturday run', () => {
  assert.equal(alterTage(priceStamp, monday) > 2, true);
  assert.equal(K.istUeberfaellig({ stempelMs: priceStamp, jetztMs: monday, maxTage: 2 }), false);
});

test('Monday Saturday vintage and export remain current', () => {
  const jetztMs = ms('2026-10-05T20:42Z');
  assert.equal(alterTage(ms('2026-10-03T00:00:00Z'), jetztMs) > 2, true);
  assert.equal(K.istVintageUeberfaellig({ datum: '2026-10-03', jetztMs, maxTage: 2 }), false);
  assert.equal(K.istUeberfaellig({ stempelMs: ms('2026-10-03T09:31:17.258Z'), jetztMs, maxTage: 2 }), false);
});

test('missed Wednesday leaves Tuesday stamp and vintage overdue on Thursday', () => {
  const jetztMs = ms('2026-10-08T20:40Z');
  const stempelMs = ms('2026-10-06T09:30Z');
  assert.equal(alterTage(stempelMs, jetztMs) > 2, true);
  assert.equal(K.istUeberfaellig({ stempelMs, jetztMs, maxTage: 2 }), true);
  assert.equal(K.istVintageUeberfaellig({ datum: '2026-10-06', jetztMs, maxTage: 2 }), true);
});

test('missed Saturday leaves Friday stamp and vintage overdue on Monday', () => {
  const jetztMs = ms('2026-10-05T20:40Z');
  assert.equal(K.istUeberfaellig({ stempelMs: ms('2026-10-02T09:30Z'), jetztMs, maxTage: 2 }), true);
  assert.equal(K.istVintageUeberfaellig({ datum: '2026-10-02', jetztMs, maxTage: 2 }), true);
});

test('manual Sunday writes remain current on the two observed Mondays', () => {
  for (const [now, stamp] of [
    ['2026-09-21T18:18Z', '2026-09-20T09:52:58Z'],
    ['2026-08-17T13:22Z', '2026-08-16T13:27Z'],
  ]) {
    assert.equal(K.istUeberfaellig({ stempelMs: ms(stamp), jetztMs: ms(now), maxTage: 2 }), false);
    assert.equal(K.istVintageUeberfaellig({ datum: stamp.slice(0, 10), jetztMs: ms(now), maxTage: 2 }), false);
  }
});

test('missed Tuesday makes the Saturday stamp overdue after the deadline', () => {
  assert.equal(K.istUeberfaellig({
    stempelMs: ms('2026-10-03T09:24Z'), jetztMs: ms('2026-10-06T20:00Z'), maxTage: 2,
  }), true);
});

test('the original August Thursday outage stays overdue', () => {
  assert.equal(K.istUeberfaellig({
    stempelMs: ms('2026-08-25T04:25:53.728Z'), jetztMs: ms('2026-08-27T22:32:04.421Z'), maxTage: 2,
  }), true);
});

test('UTC schedule constants and inclusive Tuesday deadline', () => {
  assert.deepEqual([K.RUN_HOUR, K.RUN_MINUTE, K.DEADLINE_HOUR, K.DEADLINE_MINUTE], [2, 17, 12, 30]);
  assert.deepEqual(K.RUN_WEEKDAYS, [2, 3, 4, 5, 6]);
  for (const [now, day, overdue] of [
    ['2026-10-05T20:42Z', '2026-10-03', false],
    ['2026-10-06T12:29Z', '2026-10-03', false],
    ['2026-10-06T12:29:59.999Z', '2026-10-03', false],
    ['2026-10-06T12:30Z', '2026-10-06', true],
  ]) {
    const jetztMs = ms(now);
    assert.equal(K.faelligerLaufStart(jetztMs), ms(day + 'T02:17:00Z'));
    assert.equal(K.faelligerLaufTag(jetztMs), day);
    assert.equal(K.istUeberfaellig({ stempelMs: priceStamp, jetztMs, maxTage: 2 }), overdue);
    assert.equal(K.istVintageUeberfaellig({ datum: '2026-10-03', jetztMs, maxTage: 2 }), overdue);
  }
});

test('calendar crosses every weekday, month, year and leap day in UTC', () => {
  for (const [now, day] of [
    ['2026-10-04T20:00Z', '2026-10-03'],
    ['2026-10-07T12:29Z', '2026-10-06'],
    ['2026-10-07T12:30Z', '2026-10-07'],
    ['2026-10-08T12:30Z', '2026-10-08'],
    ['2026-10-09T12:30Z', '2026-10-09'],
    ['2026-10-10T12:30Z', '2026-10-10'],
    ['2026-09-01T12:29Z', '2026-08-29'],
    ['2027-01-01T12:29Z', '2026-12-31'],
    ['2024-03-01T12:29Z', '2024-02-29'],
  ]) {
    assert.equal(K.faelligerLaufStart(ms(now)), ms(day + 'T02:17:00Z'));
    assert.equal(K.faelligerLaufTag(ms(now)), day);
  }
});

test('strict age and run-start comparisons preserve both equality boundaries', () => {
  const jetztMs = ms('2026-10-08T20:40Z');
  const boundary = jetztMs - 2 * MS_PRO_TAG;
  assert.equal(K.istUeberfaellig({ stempelMs: boundary, jetztMs, maxTage: 2 }), false);
  assert.equal(K.istUeberfaellig({ stempelMs: boundary - 1, jetztMs, maxTage: 2 }), true);
  const start = ms('2026-10-03T02:17Z');
  assert.equal(K.istUeberfaellig({ stempelMs: start - 1, jetztMs: monday, maxTage: 2 }), true);
  assert.equal(K.istUeberfaellig({ stempelMs: start, jetztMs: monday, maxTage: 2 }), false);
  assert.equal(K.istUeberfaellig({ stempelMs: monday + MS_PRO_TAG, jetztMs: monday, maxTage: 2 }), false);
  const midnight = ms('2026-10-08T00:00Z');
  assert.equal(K.istVintageUeberfaellig({ datum: '2026-10-06', jetztMs: midnight, maxTage: 2 }), false);
  assert.equal(K.istVintageUeberfaellig({ datum: '2026-10-06', jetztMs: midnight + 1, maxTage: 2 }), true);
});

test('invalid stamps and strict calendar dates are overdue, invalid clocks throw', () => {
  for (const stempelMs of [NaN, Infinity, -Infinity, null, undefined, '2026-10-03']) {
    assert.equal(K.istUeberfaellig({ stempelMs, jetztMs: monday, maxTage: 2 }), true);
  }
  for (const datum of [null, undefined, 20261003, '', 'bad', '2026-10-3', '2026-10-03T00:00:00Z',
    '2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00']) {
    assert.equal(K.istVintageUeberfaellig({ datum, jetztMs: monday, maxTage: 2 }), true);
  }
  assert.equal(K.istVintageUeberfaellig({ datum: '2024-02-29', jetztMs: ms('2024-03-01T20:00Z'), maxTage: 2 }), false);
  for (const jetztMs of [NaN, Infinity, -Infinity, null, undefined, '2026-10-05', Number.MAX_VALUE]) {
    assert.throws(() => K.faelligerLaufStart(jetztMs), RangeError);
    assert.throws(() => K.faelligerLaufTag(jetztMs), RangeError);
  }
});

test('an unusable limit never turns a stale stamp green (same as the flat rule)', () => {
  const stale = ms('2026-10-02T09:30Z');
  for (const maxTage of [NaN, undefined, null, 'x']) {
    assert.equal(K.istUeberfaellig({ stempelMs: stale, jetztMs: monday, maxTage }), true, String(maxTage));
    assert.equal(K.istVintageUeberfaellig({ datum: '2026-10-02', jetztMs: monday, maxTage }), true, String(maxTage));
  }
});

test('expectation states the due day, UTC cron and deadline in German', () => {
  assert.equal(K.erwartung(monday), 'faelliger Lauf: Sa 03.10. (Di-Sa 02:17 UTC, Frist 12:30 UTC)');
});

test('500 deterministic August-October pairs satisfy the exact rule and are never stricter', () => {
  let seed = 33;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  const start = ms('2026-08-01T00:00Z');
  const span = ms('2026-11-01T00:00Z') - start;
  let overdueCount = 0;
  let currentCount = 0;
  for (let i = 0; i < 500; i++) {
    const stempelMs = start + Math.floor(random() * span);
    const jetztMs = start + Math.floor(random() * span);
    const maxTage = [0, 1, 2, 6][i % 4];
    const flat = alterTage(stempelMs, jetztMs) > maxTage;
    const overdue = K.istUeberfaellig({ stempelMs, jetztMs, maxTage });
    assert.equal(overdue, flat && stempelMs < K.faelligerLaufStart(jetztMs), `pair ${i}`);
    assert.ok(!overdue || flat, `pair ${i} must not be stricter than flat age`);
    if (overdue) overdueCount++; else currentCount++;
  }
  assert.ok(overdueCount > 0 && currentCount > 0, 'exercise both decisions');
});

test('CLI prints one line and returns 0, 1 or 2 using HEARTBEAT_NOW', () => {
  const cli = path.resolve(__dirname, '../lib/liefer-kalender.js');
  const now = '2026-10-05T20:42:16.469Z';
  for (const [args, expected, clock = now] of [
    [['stempel', '2026-10-03T09:24:34.702Z', '2'], 0],
    [['stempel', '2026-10-03T11:24:34.702+02:00', '2'], 0],
    [['vintage', '2026-10-03', '2'], 0],
    [['stempel', '2026-10-02T09:30Z', '2'], 1],
    [['vintage', '2026-10-02', '2'], 1],
    [['stempel', '2026-10-03T09:24Z', '2'], 0, '2026-10-06T12:29Z'],
    [['stempel', '2026-10-03T09:24Z', '2'], 1, '2026-10-06T12:30Z'],
    [['stempel', 'bad', '2'], 1],
    [['stempel', '2026-10-03T09:24:00', '2'], 1],
    [['stempel', '2026-09-31T09:30Z', '2'], 1],
    [['vintage', '2026-02-30', '2'], 1],
    [[], 2],
    [['stempel', '2026-10-03T09:24Z'], 2],
    [['other', '2026-10-03', '2'], 2],
    [['vintage', '2026-10-03', '2', 'extra'], 2],
    [['vintage', '2026-10-03', 'NaN'], 2],
    [['vintage', '2026-10-03', 'Infinity'], 2],
    [['vintage', '2026-10-03', '-1'], 2],
    [['vintage', '2026-10-03', ''], 2],
    [['vintage', '2026-10-03', '2'], 2, 'bad'],
    [['vintage', '2026-10-03', '2'], 2, '2026-02-30T12:30Z'],
    [['vintage', '2026-10-03', '2'], 2, ''],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8', env: { ...process.env, HEARTBEAT_NOW: clock, TZ: 'America/Los_Angeles' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, JSON.stringify(args) + ': ' + result.stderr);
    assert.equal((result.stdout + result.stderr).trim().split(/\r?\n/).length, 1);
    if (expected === 2) {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^Aufruf:/);
    } else {
      assert.equal(result.stderr, '');
      assert.ok(result.stdout.startsWith(expected === 1 ? 'ueberfaellig;' : 'nicht ueberfaellig;'));
      assert.ok(result.stdout.includes(K.erwartung(ms(clock))));
    }
  }
});
