'use strict';
/** tests/ath-state.test.js — Standalone-Runner (node tests/ath-state.test.js, Exit 0/1).
 * Pinnt die 2.2-Kernlogik: ATH-Fortschrieb, Split-Wächter, Kill+Resume, Seed, Anzeige. */
const assert = require('node:assert/strict');
const upd = require('../scripts/update-ath-state.js');
const bf = require('../scripts/backfill-prices-max.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('seedEntry: ATH + Referenzanker + lastClose aus Max-Serie', () => {
  const bars = [];
  for (let i = 0; i < 300; i++) bars.push({ date: '2020-' + String(1 + (i % 12)).padStart(2, '0') + '-01', close: 10 + i });
  // eindeutige, sortierbare Daten bauen (obiges hat Duplikate) — sauber neu:
  const clean = Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), close: i === 150 ? 500 : 10 + i }));
  const e = bf.seedEntry(clean, '2026-07-14');
  assert.equal(e.ath, 500);
  assert.equal(e.athDate, clean[150].date);
  assert.equal(e.lastClose, clean[299].close);
  assert.equal(e.refDate, clean[299 - bf.REF_LOOKBACK_BARS].date); // Anker ~40 Bars vor newest
  assert.equal(e.needsReseed, false);
});
test('advanceEntry: neues Hoch hebt ATH; Referenz stabil -> kein Reseed', () => {
  const entry = { ath: 100, athDate: '2025-01-02', refDate: '2026-06-01', refClose: 80, lastClose: 80, lastDate: '2026-06-01', needsReseed: false };
  const series = [{ date: '2026-06-01', close: 80 }, { date: '2026-07-10', close: 120 }];
  const out = upd.advanceEntry(entry, series);
  assert.equal(out.ath, 120); assert.equal(out.athDate, '2026-07-10');
  assert.equal(out.lastClose, 120); assert.equal(out.needsReseed, false);
});
test('advanceEntry SPLIT-WÄCHTER: re-basierter Referenzkurs -> needsReseed, ATH friert', () => {
  const entry = { ath: 950, athDate: '2024-06-18', refDate: '2026-06-01', refClose: 800, lastClose: 800, lastDate: '2026-06-01', needsReseed: false };
  // Store nach 10:1-Split re-basiert: refDate-Kurs jetzt 80 statt 800
  const series = [{ date: '2026-06-01', close: 80 }, { date: '2026-07-10', close: 95 }];
  const out = upd.advanceEntry(entry, series);
  assert.equal(out.needsReseed, true);
  assert.equal(out.ath, 950); // NICHT gegen falsche Skala fortgeschrieben
  assert.equal(upd.displayFor(out), null); // Anzeige ehrlich aus
});
test('displayFor: Abstand/Monate korrekt; unter ATH negativ', () => {
  const d = upd.displayFor({ ath: 200, athDate: '2025-07-14', lastClose: 150, lastDate: '2026-07-14', needsReseed: false });
  assert.equal(d.distancePct, -25);
  assert.ok(d.monthsAgo >= 11 && d.monthsAgo <= 13);
});
test('pendingTickers (Kill+Resume): done übersprungen, stale + neue gezogen, --force alles', () => {
  const universe = ['A', 'B', 'C', 'D'];
  const manifest = { done: { A: { at: 'x' }, B: { at: 'x' } } };
  const state = { entries: { B: { needsReseed: true } } };
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, {}), ['B', 'C', 'D']); // B stale, C/D neu
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, { onlyStale: true }), ['B']);
  assert.deepEqual(bf.pendingTickers(universe, manifest, state, { force: true }), universe);
});

console.log(`\nath-state.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
