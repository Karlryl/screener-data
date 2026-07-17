// F1 (Codex-Fund, T2): n_skipped_mcap zaehlte fx-unknown-Ticker MIT, weil es als
// results.length - (ok+price-only) gebildet wurde. Dadurch fiel fx-unknown aus dem
// adressierbaren Coverage-Nenner (n_addressable = n_total - n_skipped_mcap), und
// coverage-gate.js meldete honestPct = n_ok/n_addressable weiterhin ~100%, obwohl bei
// FX-Ausfall Snapshots von Platte geloescht wurden -> das 90%-Gate blieb blind.
//
// WARUM DIESER TEST VOR DEM FIX ROT WAR: countSkippedMcap() zaehlte via
// results.length - okCount und lieferte fuer den Befund-Beleg (80 ok, 20 fx-unknown,
// 0 mcap) 20 statt 0 -> die 'fx-unknown bleibt im Nenner'-Assertion schlug fehl.
//
// Run: node tests/skip-mcap-count.test.js   (Exit 0/1)
const assert = require('node:assert/strict');
const { countSkippedMcap } = require('../pull-yahoo.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// results traegt genau vier Status: ok, price-only, skipped-mcap, fx-unknown
// (pull-yahoo.js: 2785 / 2061+2163 / 2710 / 2672). Nur skipped-mcap darf zaehlen.
const r = (status, n) => Array.from({ length: n }, (_, i) => ({ ticker: `T${status}${i}`, status }));
const mix = (ok, priceOnly, mcap, fx) => [
  ...r('ok', ok), ...r('price-only', priceOnly), ...r('skipped-mcap', mcap), ...r('fx-unknown', fx),
];

check('zaehlt NUR skipped-mcap, nicht fx-unknown', () => {
  assert.equal(countSkippedMcap(mix(80, 0, 5, 20)), 5);
});

check('reine skipped-mcap-Menge (kein Rausch-Status)', () => {
  assert.equal(countSkippedMcap(mix(10, 3, 7, 0)), 7);
});

check('fx-unknown allein -> 0 skipped-mcap', () => {
  assert.equal(countSkippedMcap(mix(80, 0, 0, 20)), 0);
});

check('leere results -> 0', () => {
  assert.equal(countSkippedMcap([]), 0);
});

check('robust gegen null/undefined-Eintraege', () => {
  assert.equal(countSkippedMcap([null, undefined, { status: 'skipped-mcap' }]), 1);
});

// Der eigentliche Sinn des Fixes: fx-unknown MUSS im adressierbaren Nenner bleiben.
// n_addressable = n_total - n_skipped_mcap (pull-yahoo ~2952). Befund-Beleg:
// Universum 100, mcap 0, fx-unknown 20, ok 80 -> addressable = 100 (fx-unknown drin),
// honest = 80/100 = 80% < 90% -> DEGRADIERT (vor dem Fix waere addressable=80,
// honest=80/80=100% -> Banner faelschlich aus).
check('fx-unknown bleibt im adressierbaren Nenner (Befund-Zahlenbeleg)', () => {
  const results = mix(80, 0, 0, 20);
  const nTotal = 100;
  const nSkippedMcap = countSkippedMcap(results);
  const nAddressable = nTotal - nSkippedMcap;
  assert.equal(nSkippedMcap, 0);
  assert.equal(nAddressable, 100);
  const honestPct = 80 / nAddressable;
  assert.ok(honestPct < 0.90, `honestPct ${honestPct} sollte < 0.90 sein (degradiert)`);
});

console.log(fail ? `\nskip-mcap-count: ${fail} FAILED` : '\nskip-mcap-count: all passed');
process.exit(fail ? 1 : 0);
