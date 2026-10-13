'use strict';
/**
 * A1 — normalizeCountry-Test (Weltweit-Pivot: Voraussetzung fuer den Laenderfilter).
 * Aufloesungs-Kette (Domizil-Vorrang, konsistent mit router.isUS):
 *   meta.country  ->  Boerse (exchangeName/region)  ->  Ticker-Suffix  ->  null
 * Plus grober Kontinent-Bucket je Land. Reine Funktion; die Erwartungswerte sind
 * die REALEN Yahoo-Felder (country/region/exchangeName) aus snapshots/ (Plan 2026-06-27 §1c:
 * 61% tragen meta.country, der Rest die Boerse zuverlaessig in meta.region).
 *
 * Usage:  node tests/scoring/country.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { normalizeCountry } = require('../../src/scoring/country.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- Domizil-Vorrang: meta.country gewinnt (wie router.isUS country-first) ---
test('country present (US) gewinnt, Region North America', () => {
  assert.deepEqual(normalizeCountry({ country: 'United States', region: 'NYSE' }),
    { country: 'United States', region: 'North America' });
});
test('auslaendisches Domizil (Japan) -> Asia', () => {
  assert.deepEqual(normalizeCountry({ country: 'Japan' }),
    { country: 'Japan', region: 'Asia' });
});
test('ADR: country schlaegt irrefuehrendes region=US (0853.HK-Muster)', () => {
  // Yahoo traegt bei auslaendisch-gelisteten ADRs teils faelschlich region='US'
  assert.deepEqual(normalizeCountry({ country: 'China', region: 'US', exchangeName: 'HKSE' }),
    { country: 'China', region: 'Asia' });
});
test('Alias: USA -> United States', () => {
  assert.equal(normalizeCountry({ country: 'USA' }).country, 'United States');
});

// --- ohne country: die Boerse traegt das Land (39% der Snapshots) ------------
test('keine country, region=Boersenname Tokyo -> Japan/Asia', () => {
  assert.deepEqual(normalizeCountry({ region: 'Tokyo' }),
    { country: 'Japan', region: 'Asia' });
});
test('keine country, region=US-Boerse NasdaqGS -> United States', () => {
  assert.equal(normalizeCountry({ region: 'NasdaqGS' }).country, 'United States');
});
test('keine country, region=LSE -> United Kingdom/Europe', () => {
  assert.deepEqual(normalizeCountry({ region: 'LSE' }),
    { country: 'United Kingdom', region: 'Europe' });
});
test('keine country, region=XETRA -> Germany', () => {
  assert.equal(normalizeCountry({ region: 'XETRA' }).country, 'Germany');
});
test('keine country, exchangeName=HKSE (region fehlt) -> Hong Kong', () => {
  assert.equal(normalizeCountry({ exchangeName: 'HKSE' }).country, 'Hong Kong');
});
test('keine country, region 2-Letter-Code CN -> China/Asia', () => {
  assert.deepEqual(normalizeCountry({ region: 'CN' }),
    { country: 'China', region: 'Asia' });
});

// --- Foreign-Signal schlaegt US-Signal (ADR/Mislabel-Robustheit, wie router) -
test('ADR ohne country: foreign region (CN) schlaegt US-Listing-Boerse NYSE (BABA-Muster)', () => {
  // meta.country fehlt; NYSE = US-Listing ABER region=CN = Domizil-Wahrheit. US-Boerse ist
  // bei ADRs unzuverlaessig, ein Auslands-Signal nicht -> China. (A3 oeffnet genau diese Namen.)
  assert.deepEqual(normalizeCountry({ exchangeName: 'NYSE', region: 'CN' }),
    { country: 'China', region: 'Asia' });
});
test('foreign-gelistet ohne country: foreign Boerse (HKSE) schlaegt region=US-Fehler', () => {
  // Gegenrichtung: region faelschlich 'US', aber exchangeName=HKSE (foreign) -> Hong Kong.
  assert.deepEqual(normalizeCountry({ region: 'US', exchangeName: 'HKSE' }),
    { country: 'Hong Kong', region: 'Asia' });
});

// --- Ticker-Suffix als letzte Instanz (Yahoo-Listing-Suffix) ----------------
test('nur Ticker-Suffix .PA -> France/Europe', () => {
  assert.deepEqual(normalizeCountry({ ticker: 'LVMH.PA' }),
    { country: 'France', region: 'Europe' });
});
test('Brussels-Suffix .BR -> Belgium (NICHT Brazil-.SA)', () => {
  assert.equal(normalizeCountry({ ticker: 'KBC.BR' }).country, 'Belgium');
});

// --- ehrliches Unknown (kein falsches Raten) ---------------------------------
test('region=YHD (stale Snapshot, kein Signal) -> country null, region null', () => {
  assert.deepEqual(normalizeCountry({ region: 'YHD' }),
    { country: null, region: null });
});
test('leeres / null / undefined meta -> {country:null, region:null}', () => {
  assert.deepEqual(normalizeCountry({}), { country: null, region: null });
  assert.deepEqual(normalizeCountry(null), { country: null, region: null });
  assert.deepEqual(normalizeCountry(undefined), { country: null, region: null });
});
test('US-Class-Share Dash-Ticker (BRK-A) kollidiert nicht mit Suffix-Tier', () => {
  // R3-Fix speichert US-Class-Shares als BRK-A (Dash), kein .X-Suffix -> Suffix darf nicht greifen
  assert.equal(normalizeCountry({ ticker: 'BRK-A', country: 'United States' }).country, 'United States');
});

console.log(`\ncountry.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
