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
// P0-Haertung 2 (09.08.2026): Dieser Waechter zaehlte frueher, wie oft das
// Schreibmuster `_isValidFxRate(tradingRate)` im Quelltext vorkommt (erwartet: 3).
// Die drei Lesestellen sind seither zu EINER zusammengelegt (_fxFactorFor) — der
// Schutz ist strenger geworden, der Zaehl-Waechter wurde davon rot. Jetzt wird die
// SACHE geprueft und AUSGEFUEHRT: an allen drei Wegen (Reporting-Kurs, Handelskurs,
// price-only) darf ein 0/negativer/nicht-numerischer Kurs keinen Faktor erzeugen.
test('Wiring: ungueltiger Kurs faellt an ALLEN drei Wegen closed (ausgefuehrt, nicht gegrept)', () => {
  const PY = require('../pull-yahoo.js');
  const { _fxFactorFor, _resolveTradingFx, _FX_TO_USD, _FX_PROVENANCE } = PY;
  for (const bad of [0, -1, NaN, Infinity, '0.5', null]) {
    _FX_TO_USD.XBAD = bad;
    _FX_PROVENANCE.XBAD = 'live';
    const wie = ' (Kurs=' + String(bad) + ')';
    assert.equal(_fxFactorFor('XBAD'), null, 'kein Faktor aus ungueltigem Kurs' + wie);
    // (1) Reporting-Kurs
    const rep = _convertSnapshotToUSD({ meta: { reportingCurrency: 'XBAD' }, marketCap: { value: 1000 } });
    assert.equal(rep.meta.fxConverted, false, 'Reporting-Weg muss fail-closed sein' + wie);
    assert.equal(rep.meta.fxConversionFailed, true, 'Reporting-Weg muss den Fehler melden' + wie);
    assert.equal(rep.marketCap.value, 1000, 'Werte unangetastet' + wie);
    // (2) Handelskurs (USD-Bilanzierer mit Auslandsnotiz)
    const trd = _convertSnapshotToUSD({ meta: { reportingCurrency: 'USD', tradingCurrency: 'XBAD' }, marketCap: { value: 1000 } });
    assert.equal(trd.meta.fxConverted, false, 'Handels-Weg muss fail-closed sein' + wie);
    assert.equal(trd.meta.fxConversionFailed, true, 'Handels-Weg muss den Fehler melden' + wie);
    assert.equal(trd.marketCap.value, 1000, 'Werte unangetastet' + wie);
    // (3) price-only-Schnellweg
    assert.equal(_resolveTradingFx({ currency: 'XBAD', regularMarketPrice: 10 }, { meta: {} }).ok, false,
      'price-only muss den Lauf verweigern' + wie);
  }
  delete _FX_TO_USD.XBAD;
  delete _FX_PROVENANCE.XBAD;
  assert.doesNotMatch(SRC, /tradingRate != null && Number\.isFinite\(tradingRate\)/,
    'die alte Finite-only-Pruefung (ohne >0) darf nicht wieder auftauchen');
});

// ── refresh-fx.js: darf ungueltige Altwerte nicht ueber Fetch-Fehler hinweg tragen ──
const {
  isValidRefreshRate,
  partitionExistingRates,
  mergeExistingRates,
} = require('../scripts/refresh-fx.js');
const REFRESH_SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'refresh-fx.js'), 'utf8');
test('refresh-fx.js filtert bestehende Raten ausgefuehrt statt per Quelltext-RegEx', () => {
  const existing = {
    USD: 1,
    EUR: 1.08,
    JPY: 0.0067,
    ZERO: 0,
    NEGATIVE: -0.5,
    NAN: NaN,
    POSITIVE_INFINITY: Infinity,
    NEGATIVE_INFINITY: -Infinity,
    NUMERIC_STRING: '1.08',
    NULL: null,
    BOOLEAN: true,
    OBJECT: { value: 1 },
    ARRAY: [1],
  };

  const result = partitionExistingRates(existing);
  assert.deepEqual(result.valid, { USD: 1, EUR: 1.08, JPY: 0.0067 });
  assert.deepEqual(result.invalid, [
    ['ZERO', 0],
    ['NEGATIVE', -0.5],
    ['NAN', NaN],
    ['POSITIVE_INFINITY', Infinity],
    ['NEGATIVE_INFINITY', -Infinity],
    ['NUMERIC_STRING', '1.08'],
    ['NULL', null],
    ['BOOLEAN', true],
    ['OBJECT', { value: 1 }],
    ['ARRAY', [1]],
  ]);
  assert.deepEqual(existing.OBJECT, { value: 1 }, 'die reine Partition mutiert keine Objektwerte');
  assert.deepEqual(existing.ARRAY, [1], 'die reine Partition mutiert keine Arraywerte');
});

test('refresh-fx.js nimmt auch FRISCHE Kurse nur als positive endliche Zahlen an', () => {
  for (const good of [1, 1.08, 0.0067]) assert.equal(isValidRefreshRate(good), true);
  for (const bad of [0, -0.5, NaN, Infinity, -Infinity, '1.08', null, undefined, true, {}]) {
    assert.equal(isValidRefreshRate(bad), false, 'ungueltiger frischer Kurs: ' + String(bad));
  }
});

test('refresh-fx.js laesst einen Altwert nie die USD-Identitaet ueberschreiben', () => {
  const validExisting = { USD: 999, EUR: 1.08, JPY: 0.0067 };
  assert.deepEqual(mergeExistingRates(validExisting), { USD: 1, EUR: 1.08, JPY: 0.0067 });
  assert.deepEqual(Object.keys(mergeExistingRates({ EUR: 1.08 })), ['USD', 'EUR'],
    'USD bleibt wie im bisherigen Ausgabeformat der erste Schluessel');
  assert.deepEqual(validExisting, { USD: 999, EUR: 1.08, JPY: 0.0067 }, 'der Merge mutiert den Altbestand nicht');
});

test('Wiring: main() nutzt die getesteten Helfer fuer Altbestand und frische Kurse', () => {
  assert.match(REFRESH_SRC,
    /const \{ valid: validExisting, invalid: invalidExisting \} = partitionExistingRates\(existing\);/,
    'main muss die getestete Partition auf die geladenen Altwerte anwenden');
  assert.match(REFRESH_SRC, /const rates = mergeExistingRates\(validExisting\);/,
    'main muss den getesteten Identitaets-Merge statt raw existing verwenden');
  assert.match(REFRESH_SRC, /if \(isValidRefreshRate\(rate\)\) \{/,
    'frisch geholte Kurse muessen dasselbe getestete Praedikat passieren');
});

console.log(`\nv-sk-001-fx-rate-validation.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
