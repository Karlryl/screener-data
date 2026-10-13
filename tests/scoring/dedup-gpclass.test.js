'use strict';
/**
 * Regressionstest fuer Bug 7 (Issuer-Dedup: US-Primaerlisting-first statt Domizil-first)
 * und Bug 31 (gpClass aus aligned GP/Rev-Ratio statt zwei unabhaengiger firstPresent).
 *
 * Bug 7: Der erste Dedup-Sortierschluessel MUSS isUsPrimaryListing (Listing-Check) sein,
 *   nicht das domizil-basierte isUS. Sonst bekommt ein Toronto-Bein mit country='United
 *   States' denselben isUS=1-Rang wie das NYSE-Bein, und fxSuspect deprioritisiert danach
 *   ausgerechnet das echte US-Primaerbein -> GFL verliert gegen GFL.TO. Gate: GFL schlaegt GFL.TO.
 *
 * Bug 31: Bei null-Luecke in genau einer der Serien darf die GP/Rev-Ratio NICHT ueber
 *   verschiedene Fiskaljahre gezogen werden. annualGP=[null,500]/annualRev=[1000,505] -> aligned
 *   500/505=0.99 'degenerate', NICHT 500/1000=0.5 'real'.
 *
 * Usage:  node tests/scoring/dedup-gpclass.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const { issuerDedupComparator } = require('../../src/scoring/score.js');
const { gpClass } = require('../../src/scoring/router.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- Bug 7: Dedup-Sort bevorzugt das US-PRIMAER-gelistete Bein --------------
// GFL-Archetyp: beide Beine tragen country='United States' (US-Domizil), aber nur das NYSE-Bein
// ist US-primaer gelistet. Das .TO-Bein ist an Toronto (Auslands-Suffix) gelistet. Das NYSE-Bein
// hat KEINE tradingFxRate (USD-Reporter, tradingFxRateApplied=null) -> fxSuspect greift NICHT, weil
// reportingCurrencyOriginal fehlt; das .TO-Bein ist CAD-gehandelt. Erwartung: NYSE-Bein sortiert zuerst.
const gflUS = { ticker: 'GFL', snapshot: { meta: {
  name: 'GFL Environmental Inc.', ticker: 'GFL', exchangeName: 'NYSE', country: 'United States',
}, marketCap: { value: 20e9 } } };
const gflTO = { ticker: 'GFL.TO', snapshot: { meta: {
  name: 'GFL Environmental Inc.', ticker: 'GFL.TO', exchangeName: 'Toronto', country: 'United States',
}, marketCap: { value: 27e9 } } }; // sogar hoehere (CAD) mcap -> darf NICHT gewinnen

test('Bug 7: GFL (NYSE, US-primaer) schlaegt GFL.TO (Toronto) trotz hoeherer .TO-mcap', () => {
  const group = [gflTO, gflUS];
  group.sort(issuerDedupComparator);
  assert.equal(group[0].ticker, 'GFL', 'US-Primaerlisting muss Gewinner sein');
  assert.equal(group[1].ticker, 'GFL.TO');
});

test('Bug 7: Sortierung stabil unabhaengig von der Eingangsreihenfolge', () => {
  const group = [gflUS, gflTO];
  group.sort(issuerDedupComparator);
  assert.equal(group[0].ticker, 'GFL');
});

// --- Bug 31: gpClass aus aligned Ratio --------------------------------------
test('Bug 31: null-Luecke in GP -> Ratio aligned (500/505=0.99 degenerate, nicht 500/1000=0.5 real)', () => {
  const s = { annual: { annualGP: [{ value: null }, { value: 500 }], annualRev: [{ value: 1000 }, { value: 505 }] } };
  assert.equal(gpClass(s), 'degenerate');
});
test('Bug 31: saubere aligned Serien -> real (0.6)', () => {
  const s = { annual: { annualGP: [{ value: 600 }, { value: 500 }], annualRev: [{ value: 1000 }, { value: 900 }] } };
  assert.equal(gpClass(s), 'real');
});

console.log(`\ndedup-gpclass.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
