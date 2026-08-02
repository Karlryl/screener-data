// V-SK-001 (Hard Review 2026-07-31, section screener-daten, HOCH): FX-Wertvalidierung-latent.
// pull-yahoo.js trusted FX rates off disk without checking they were finite,
// strictly-positive numbers. 0 zeroed marketCap/financials; negative flipped their
// sign; a bad string produced NaN — all persisted with meta.fxConverted:true, i.e.
// as if the conversion had succeeded honestly.
//
// Fix: _isValidFxRate() is now the single predicate used both when loadFx() decides
// whether a fx-rates.json entry may enter FX_TO_USD, and at every _convertSnapshotToUSD
// consumption site (reporting-currency rate + all three trading-currency rate reads).
// refresh-fx.js also validates rates carried forward from a previous run before
// merging them, so a corrupt on-disk value can't perpetuate itself forever across
// fetch failures.
//
// Standalone-Runner, keine Frameworks, kein Netz.
// Run: node tests/v-sk-001-fx-rate-validation.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _isValidFxRate, _convertSnapshotToUSD } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

// ── _isValidFxRate: the core predicate ──────────────────────────────────────
test('_isValidFxRate: 0 ist ungueltig', () => {
  assert.equal(_isValidFxRate(0), false);
});
test('_isValidFxRate: negative Rate ist ungueltig', () => {
  assert.equal(_isValidFxRate(-2), false);
  assert.equal(_isValidFxRate(-0.0001), false);
});
test('_isValidFxRate: NaN/Infinity sind ungueltig', () => {
  assert.equal(_isValidFxRate(NaN), false);
  assert.equal(_isValidFxRate(Infinity), false);
  assert.equal(_isValidFxRate(-Infinity), false);
});
test('_isValidFxRate: Nicht-Zahl (String/null/undefined/Objekt) ist ungueltig', () => {
  assert.equal(_isValidFxRate('bad'), false);
  assert.equal(_isValidFxRate('1.08'), false); // numeric string still rejected — must be typeof number
  assert.equal(_isValidFxRate(null), false);
  assert.equal(_isValidFxRate(undefined), false);
  assert.equal(_isValidFxRate({}), false);
});
test('_isValidFxRate: echte positive endliche Rate ist gueltig', () => {
  assert.equal(_isValidFxRate(1.08), true);
  assert.equal(_isValidFxRate(0.0067), true);
  assert.equal(_isValidFxRate(1), true);
});

// ── _convertSnapshotToUSD: consumption-side wiring (reporting-currency path) ─
// Repro from the finding: a currency the process has no valid rate for must
// fail closed (fxConverted:false, fxConversionFailed:true) — values untouched —
// never silently pass through as converted.
test('_convertSnapshotToUSD: unbekannte/nicht geladene Waehrung -> fail-closed, nicht converted', () => {
  const snap = {
    meta: { reportingCurrency: 'ZZZ_NONEXISTENT_CCY' }, // never in FX_TO_USD or FX_FALLBACK
    marketCap: { value: 1000 },
  };
  const out = _convertSnapshotToUSD(snap);
  assert.equal(out.meta.fxConverted, false, 'darf NICHT als converted markiert werden');
  assert.equal(out.meta.fxConversionFailed, true);
  assert.equal(out.marketCap.value, 1000, 'Wert bleibt unangetastet statt mit 0/NaN skaliert');
});

// ── Source-text pins: proves every FX_TO_USD read site in pull-yahoo.js routes
// through _isValidFxRate — not a bespoke `!= null` / `Number.isFinite` check that
// would let 0/negative slip back in on the next edit. One pin per call site named
// in the finding (loadFx + the two _convertSnapshotToUSD rate reads) plus the two
// sibling trading-rate sites sharing the same defect pattern.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
test('Wiring: loadFx() prueft raw.rates[k] mit _isValidFxRate, nicht nur Staleness', () => {
  assert.match(SRC, /const rateIsValid = _isValidFxRate\(rawRate\);/,
    'loadFx muss den geladenen Rohwert vor Uebernahme validieren');
});
test('Wiring: reporting-Rate-Check nutzt _isValidFxRate statt "rate == null"', () => {
  assert.match(SRC, /if \(!_isValidFxRate\(rate\)\) \{/,
    'die alte Pruefung liess 0\\/negativ\\/NaN durch');
  assert.doesNotMatch(SRC, /if \(rate == null\) \{\s*\n\s*\/\/ unknown currency/,
    'die alte laxe Pruefung darf nicht wieder auftauchen');
});
test('Wiring: alle drei tradingRate-Lesestellen nutzen _isValidFxRate', () => {
  const hits = SRC.match(/_isValidFxRate\(tradingRate\)/g) || [];
  assert.equal(hits.length, 3,
    '_applyTradingScale, _convertSnapshotToUSD und der price-only-Pfad muessen alle drei validieren; gefunden: ' + hits.length);
  assert.doesNotMatch(SRC, /tradingRate != null && Number\.isFinite\(tradingRate\)/,
    'die alte Finite-only-Pruefung (ohne >0) darf nicht wieder auftauchen');
});

// ── refresh-fx.js: darf ungueltige Altwerte nicht ueber Fetch-Fehler hinweg tragen ──
const REFRESH_SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'refresh-fx.js'), 'utf8');
test('Wiring: refresh-fx.js validiert existing-Rates vor dem Merge (validExisting)', () => {
  assert.match(REFRESH_SRC, /Number\.isFinite\(r\) && r > 0/,
    'geladene Altwerte muessen vor Weitergabe geprueft werden');
  assert.match(REFRESH_SRC, /Object\.assign\(\{ USD: 1\.0 \}, validExisting\)/,
    'rates muss aus validExisting gebaut werden, nicht aus dem rohen existing');
});

console.log(`\nv-sk-001-fx-rate-validation.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
