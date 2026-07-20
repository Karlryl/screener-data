'use strict';
/**
 * Bug 25 + Bug 11 regression (G6-forward-returns):
 *   Bug 25 — a p0<=0 entry close (0-close data glitch) must classify as
 *            'no_entry_price', NOT 'delisted'/'series_ended', even when the exit
 *            is unresolvable. Only delisted may map to -100% downstream.
 *   Bug 11 — a p1<=0 exit close must be treated like a missing close, never
 *            booked as status 'ok' with ret -1. Court E-20260720-5: mit dem
 *            usable-basierten newest ist das Ergebnis 'series_ended' (letzter
 *            realer Kurs), nicht mehr 'delisted'/-100 %.
 * Run standalone: node --test lib/forward-returns.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('./forward-returns.js');

// priceIndex[ticker] is a Map<'YYYY-MM-DD', close> (see walk-forward-perf.js).
function mapOf(entries) {
  return new Map(entries);
}

test('Bug 25: entry close 0 + missing exit -> no_entry_price (not delisted)', () => {
  // Entry has a 0-close glitch; exit region has coverage (would otherwise be
  // classified 'delisted' -> -100%). Guard must fire on p0<=0 first.
  const idx = {
    XYZ: mapOf([
      ['2026-01-05', 0],       // entry: 0-close glitch
      ['2026-02-10', 42],      // later coverage exists (delisted region)
    ]),
  };
  const r = classify(idx, 'XYZ', '2026-01-05', '2026-01-20');
  assert.equal(r.status, 'no_entry_price');
  assert.equal(r.ret, null);
});

test('Bug 11: exit close 0 -> not status ok, ret != -1', () => {
  // Valid entry, exit close is a 0-glitch. Must NOT be booked as {ok, -1}.
  // Geaendert per Court E-20260720-5 (ersetzt BH-101-0-Handling, Grund
  // Preprocessing-Invarianz): ein terminaler 0-Bar ist KEIN Preis und damit
  // keine Coverage am Ziel — die Serie endet real am letzten usable Close
  // (2026-01-05) -> 'series_ended' (letzter realer Kurs), NICHT mehr
  // 'delisted'/-100 %. Delisting braucht ein unabhaengiges Event-Label.
  const idx = {
    XYZ: mapOf([
      ['2026-01-05', 100],     // valid entry, zugleich letzter usable Close
      ['2026-01-20', 0],       // exit: 0-close glitch (wird ignoriert)
    ]),
  };
  const r = classify(idx, 'XYZ', '2026-01-05', '2026-01-20');
  assert.notEqual(r.status, 'ok');
  assert.notEqual(r.ret, -1);
  assert.equal(r.status, 'series_ended');
  assert.equal(r.newestDate, '2026-01-05');
  assert.equal(r.ignoredTerminalBars, 1);
});

test('control: valid entry + valid exit still returns ok with fractional ret', () => {
  const idx = {
    XYZ: mapOf([
      ['2026-01-05', 100],
      ['2026-01-20', 110],
    ]),
  };
  const r = classify(idx, 'XYZ', '2026-01-05', '2026-01-20');
  assert.equal(r.status, 'ok');
  assert.ok(Math.abs(r.ret - 0.1) < 1e-9);
});
