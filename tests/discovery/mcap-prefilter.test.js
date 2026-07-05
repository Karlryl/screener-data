'use strict';
/**
 * mcap-prefilter reine-Logik-Tests (offline, kein Netzwerk).
 *
 * Deckt die testbaren Kerne der Discovery-Fixes G2 ab:
 *  - toUsd (Bug 4): Listing-Waehrung -> USD, GBp/100-Subunit, fail-closed bei
 *    unbekannter Waehrung / nicht-positivem/nicht-finitem Wert.
 *  - kosdaqTarget (Bug 5): .KS-Symbol -> .KQ nur wenn Yahoo KOSDAQ meldet; sonst null.
 *
 * Usage:  node tests/discovery/mcap-prefilter.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { toUsd, kosdaqTarget } = require('../../discovery/mcap-prefilter.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const RATES = { USD: 1, JPY: 1 / 150, KRW: 1 / 1300, GBP: 1.27, EUR: 1.08 };

// --- Bug 4: toUsd Gate-Konvertierung ---
test('toUsd: USD passt unveraendert durch', () => {
  assert.equal(toUsd(3e9, 'USD', RATES), 3e9);
});

test('toUsd: JPY marketCap wird nach USD skaliert (Toyota faellt NICHT als zu-gross raus)', () => {
  // 3.35e13 JPY / 150 ~= $2.23e11 -> liegt im $1B-$500B-Fenster (vorher als "3.35e13 > 500e9" verworfen)
  const usd = toUsd(3.35e13, 'JPY', RATES);
  assert.ok(usd > 1e9 && usd < 500e9, 'erwartet im Fenster, war ' + usd);
});

test('toUsd: KRW Sub-$2B-Klitsche bleibt klein statt faelschlich als USD gross', () => {
  // 1e11 KRW / 1300 ~= $7.7e7 -> unter $1B (vorher: 1e11 > 1e9 -> faelschlich aufgenommen)
  const usd = toUsd(1e11, 'KRW', RATES);
  assert.ok(usd < 1e9, 'erwartet < $1B, war ' + usd);
});

test('toUsd: GBp (Pence) wird /100 auf GBP normalisiert', () => {
  // 1000 Pence = 10 GBP; 10 * 1.27 = 12.7 USD
  assert.ok(Math.abs(toUsd(1000, 'GBp', RATES) - 12.7) < 1e-9);
});

test('toUsd: unbekannte Waehrung -> null (fail-closed)', () => {
  assert.equal(toUsd(5e9, 'XYZ', RATES), null);
});

test('toUsd: nicht-positiver/nicht-finiter mcap -> null', () => {
  assert.equal(toUsd(0, 'USD', RATES), null);
  assert.equal(toUsd(-1, 'USD', RATES), null);
  assert.equal(toUsd(NaN, 'USD', RATES), null);
  assert.equal(toUsd(1e9, null, RATES), null);
});

// --- Bug 5: kosdaqTarget Suffix-Requote-Entscheidung ---
test('kosdaqTarget: .KS + Yahoo meldet KOSDAQ -> .KQ', () => {
  assert.equal(kosdaqTarget('293490.KS', { fullExchangeName: 'KOSDAQ' }), '293490.KQ');
  assert.equal(kosdaqTarget('293490.KS', { exchange: 'KOE' }), '293490.KQ');
});

test('kosdaqTarget: .KS + Yahoo meldet KOSPI -> kein Requote (null)', () => {
  assert.equal(kosdaqTarget('005930.KS', { fullExchangeName: 'KSE' }), null);
  assert.equal(kosdaqTarget('005930.KS', { exchange: 'KSC' }), null);
});

test('kosdaqTarget: nicht-.KS-Symbol wird nie umgeschrieben', () => {
  assert.equal(kosdaqTarget('7203.T', { fullExchangeName: 'KOSDAQ' }), null);
  assert.equal(kosdaqTarget('293490.KQ', { fullExchangeName: 'KOSDAQ' }), null);
});

test('kosdaqTarget: fehlende Quote / kein Venue -> null (fail-safe, kein Requote)', () => {
  assert.equal(kosdaqTarget('293490.KS', null), null);
  assert.equal(kosdaqTarget('293490.KS', {}), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
