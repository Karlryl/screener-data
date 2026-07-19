'use strict';
/**
 * BH-001/002/049/050/051/052/054 regression (batch b01-prices,
 * pull-historical-prices.js + scripts/backfill-prices.js).
 *
 * BH-002: naive toISOString().slice(0,10) on a Yahoo quote timestamp silently
 *   rolled a trading day back one for exchanges ahead of UTC (.AX bug: whole
 *   weeks stored Sun-Thu instead of Mon-Fri). exchangeLocalDate() must shift
 *   by meta.gmtoffset before slicing.
 * BH-050: a Sat/Sun bar must never reach the merged series.
 * BH-049: a per-bar `adjclose ?? close` fallback let a raw close slip into an
 *   adjusted series. A bar missing adjclose, when the series has adjclose
 *   elsewhere, must be rejected — not downgraded to raw close.
 * BH-001: the fetch-covered window must be rebuilt authoritatively — a stored
 *   date inside that window that Yahoo no longer delivers must be dropped,
 *   not survive forever via a pure union merge.
 * BH-051: the carried-over tail (dates before the fetch window) must be
 *   validated (finite, >0) exactly like fresh bars — an old negative/zero
 *   close must not survive just because it predates this fetch.
 * BH-054: PRICE_CONCURRENCY='0' must not zero out CONCURRENCY (infinite loop
 *   — batchStart += 0 never advances).
 *
 * Standalone runner (node <datei>, exit 0/1) — no network, no fs; chartFn is
 * injected into fetchAndMergeSeries so the fetch itself is a hermetic fixture.
 *
 * Run standalone: node tests/scoring/bh-b01-prices.test.js
 */
const assert = require('node:assert/strict');
const { exchangeLocalDate, isWeekendDate, fetchAndMergeSeries, parseConcurrency } =
  require('../../pull-historical-prices.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }
function testAsync(name, fn) {
  return fn().then(() => { pass++; console.log('  ok   ' + name); })
    .catch(e => { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); });
}

// ── BH-002: exchange-local date, not naive UTC slice ───────────────────────
test('BH-002: naive UTC slice reproduces the .AX bug (Sunday instead of Monday)', () => {
  // Store-Beleg reproduction: a bar instant at 2026-03-15T20:00Z (Sunday UTC)
  // is actually Monday 2026-03-16 local at an exchange 10h ahead of UTC.
  const naive = new Date('2026-03-15T20:00:00Z').toISOString().slice(0, 10);
  assert.equal(naive, '2026-03-15'); // pins the bug this fix replaces
});

test('BH-002: exchangeLocalDate shifts by gmtoffset -> correct local trading day', () => {
  const d = exchangeLocalDate(new Date('2026-03-15T20:00:00Z'), 36000); // UTC+10 (.AX)
  assert.equal(d, '2026-03-16');
});

test('BH-002: exchangeLocalDate with no/invalid gmtoffset falls back to UTC (no crash)', () => {
  assert.equal(exchangeLocalDate('2026-01-05T00:00:00Z', undefined), '2026-01-05');
  assert.equal(exchangeLocalDate('2026-01-05T00:00:00Z', NaN), '2026-01-05');
});

// ── BH-050: weekend rejection ───────────────────────────────────────────────
test('BH-050: isWeekendDate flags Sat/Sun, not weekdays', () => {
  assert.equal(isWeekendDate('2026-01-10'), true);  // Saturday
  assert.equal(isWeekendDate('2026-01-12'), false); // Monday
});

// ── BH-054: concurrency guard ───────────────────────────────────────────────
test('BH-054: PRICE_CONCURRENCY=0 no longer zeroes CONCURRENCY (would infinite-loop)', () => {
  assert.equal(parseConcurrency('0'), 10);   // the actual bug: '0' is truthy, old code kept it
  assert.equal(parseConcurrency('-5'), 10);
  assert.equal(parseConcurrency(''), 10);
  assert.equal(parseConcurrency(undefined), 10);
  assert.equal(parseConcurrency('4'), 4);    // valid override still respected
});

// ── BH-001/049/050/051 combined: fetchAndMergeSeries merge/basis contract ──
async function run() {
  await testAsync('BH-001/049/050/051: fetchAndMergeSeries applies all four guards together', async () => {
    const existingArr = [
      { date: '2025-12-01', close: -3 },  // BEFORE fetch window, negative -> BH-051: dropped
      { date: '2025-12-15', close: 42 },  // BEFORE fetch window, valid -> BH-001: tail preserved
      { date: '2026-01-08', close: 999 }, // INSIDE fetch window, not re-delivered -> BH-001: dropped (phantom row)
    ];
    const fakeChart = async () => ({
      meta: { gmtoffset: 0, currency: 'USD' },
      quotes: [
        { date: new Date('2026-01-06T00:00:00Z'), close: 10, adjclose: 10 },   // kept
        { date: new Date('2026-01-07T00:00:00Z'), close: 999, adjclose: null }, // BH-049: series has adjclose elsewhere -> reject, don't fall back to raw 999
        { date: new Date('2026-01-10T00:00:00Z'), close: 12, adjclose: 12 },   // BH-050: Saturday -> reject
        { date: new Date('2026-01-12T00:00:00Z'), close: -1, adjclose: -1 },   // Bug 11: non-positive -> reject
        { date: new Date('2026-01-13T00:00:00Z'), close: 15, adjclose: 15 },   // kept, latest
      ],
    });

    const merged = await fetchAndMergeSeries('FAKE', existingArr, fakeChart);
    assert.ok(merged, 'must return a merged result');
    assert.deepEqual(merged.arr, [
      { date: '2025-12-15', close: 42 },
      { date: '2026-01-06', close: 10 },
      { date: '2026-01-13', close: 15 },
    ]);
    assert.equal(merged.latestClose, 15);
    assert.equal(merged.latestDate, '2026-01-13');
    assert.equal(merged.currency, 'USD');
  });

  await testAsync('fetchAndMergeSeries: series with NO adjclose at all uses raw close throughout (not rejected)', async () => {
    const fakeChart = async () => ({
      meta: { gmtoffset: 0, currency: 'EUR' },
      quotes: [
        { date: new Date('2026-01-06T00:00:00Z'), close: 20 }, // no adjclose field anywhere in series
        { date: new Date('2026-01-07T00:00:00Z'), close: 21 },
      ],
    });
    const merged = await fetchAndMergeSeries('FAKE2', [], fakeChart);
    assert.deepEqual(merged.arr, [
      { date: '2026-01-06', close: 20 },
      { date: '2026-01-07', close: 21 },
    ]);
  });

  await testAsync('fetchAndMergeSeries: no usable quotes -> returns null (caller counts it as failed)', async () => {
    const fakeChart = async () => ({ meta: {}, quotes: [
      { date: new Date('2026-01-10T00:00:00Z'), close: 5, adjclose: 5 }, // Saturday only -> all rejected
    ] });
    const merged = await fetchAndMergeSeries('FAKE3', [], fakeChart);
    assert.equal(merged, null);
  });

  console.log(`\nbh-b01-prices.test.js: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run();
