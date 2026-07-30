'use strict';
/** tests/refresh-universe.test.js — Standalone-Runner (node tests/refresh-universe.test.js, Exit 0/1).
 * Pinnt FIX 1 (Karl-Audit univ-cap, 2026-07-18): Dead-Registry-Austrag muss VOR dem
 * MAX_UNIVERSE-Cap laufen, sonst kann ein toter Ticker einen Cap-Slot belegen und das
 * Universum endet unter dem Cap, obwohl lebende Kandidaten verfuegbar waeren. */
const assert = require('node:assert/strict');
const ru = require('../refresh-universe.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('FIX 1 univ-cap: toter Ticker verdraengt keinen lebenden Cap-Slot (Dead-Austrag VOR dem Cap)', () => {
  // DEAD hat die hoechste marketCap und wuerde bei ungepatchter Reihenfolge (Cap zuerst)
  // einen der beiden Cap-Slots belegen, obwohl er tot registriert ist -> erst danach
  // geloescht -> Universum endet mit nur 1 statt 2 lebenden Tickern (unter dem Cap).
  const allTickers = new Map([
    ['DEAD',  { ticker: 'DEAD',  marketCap: 500e9, source: 'test' }],
    ['LIVE1', { ticker: 'LIVE1', marketCap: 400e9, source: 'test' }],
    ['LIVE2', { ticker: 'LIVE2', marketCap: 300e9, source: 'test' }],
  ]);
  const deadRegistry = { DEAD: { class: 'delisted' } };
  ru.applyDeadRegistryAndCap(allTickers, deadRegistry, 2); // Cap=2, 2 lebende Kandidaten verfuegbar

  assert.ok(!allTickers.has('DEAD'), 'toter Ticker darf nie im finalen Universum landen');
  assert.ok(allTickers.has('LIVE1'), 'LIVE1 darf nicht durch den toten Ticker verdraengt werden');
  assert.ok(allTickers.has('LIVE2'), 'LIVE2 darf nicht durch den toten Ticker verdraengt werden');
  assert.equal(allTickers.size, 2, 'Universum muss den vollen Cap ausschoepfen (beide Lebenden), nicht darunter enden');
});

// ── Tag 510: Doppelausfall-Waechter der beiden Yahoo-Entdeckungskanaele ──────────
// WARUM ES DEN GIBT: BH-100 (Predefined-Kanal) begruendete seinen Nicht-Abbruch mit
// "redundant coverage (EXCHANGE_CODES ...)", BH-038 (Exchange-Kanal) begruendete seinen
// mit "see BH-100 above". Jede Begruendung nannte die andere als Auffangnetz. Am
// 2026-07-30 (Lauf 30516194703) lieferten BEIDE 0 — Predefined 0/325 Buckets, Exchange
// fatal am v3.14-Schema (bekannt seit Tag 248, 05.07.). Keiner der beiden Kanaele kann
// das fuer sich sehen, weil jeder nur sich selbst prueft.
//
// Die vier Faelle sind so gewaehlt, dass JEDE Bedingung EINZELN rot wird, wenn man sie
// ausbaut (die Falle aus dem Persistenz-Waechter: dort verletzten beide Testfaelle beide
// Bedingungen gleichzeitig, also blieb alles gruen, wenn man eine entfernte):
//   - "predefined leer + Exchange still 0" faellt, wenn der customAdded===0-Zweig weg ist
//   - "predefined leer + Exchange liefert"  faellt, wenn die Exchange-Bedingung ganz weg ist
//   - "predefined liefert + Exchange fatal" faellt, wenn die predefined-Bedingung weg ist
// GEGENPROBE durchgefuehrt: jede der drei Bedingungen einzeln entfernt -> jeweils genau
// der zugehoerige Fall rot, die anderen gruen.

test('Tag 510: beide Kanaele leer (Exchange FATAL) -> Waechter feuert', () => {
  assert.equal(ru.beideYahooKanaeleLeer(0, true, 0), true);
});

test('Tag 510: beide Kanaele leer (Exchange STILL 0, kein Fehler) -> Waechter feuert', () => {
  // Der stille Fall: kein Schema-Fehler, aber auch kein einziger neuer Ticker.
  // Wer nur auf exchangeScreenerFatal prueft, uebersieht genau das.
  assert.equal(ru.beideYahooKanaeleLeer(0, false, 0), true);
});

test('Tag 510: predefined leer, Exchange LIEFERT -> Waechter schweigt', () => {
  // Ein Einzelausfall ist durch MIN_DISCOVERY_CANDIDATES gedeckt und keine Doppellage.
  assert.equal(ru.beideYahooKanaeleLeer(0, false, 500), false);
});

test('Tag 510: predefined LIEFERT, Exchange fatal -> Waechter schweigt', () => {
  assert.equal(ru.beideYahooKanaeleLeer(12, true, 0), false);
});

test('Tag 510: beide gesund -> Waechter schweigt', () => {
  assert.equal(ru.beideYahooKanaeleLeer(12, false, 500), false);
});

console.log(`\nrefresh-universe.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
