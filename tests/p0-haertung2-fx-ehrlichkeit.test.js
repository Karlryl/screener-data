// P0-Haertung 2 (09.08.2026) — FX-/Waehrungs-Ehrlichkeit im Pull.
// Waechter zu drei Befunden des harten Pruef-Sweeps (harter-pruef-sweep-8433206-verifikation.md):
//
//   F-CGPT-001  Faellt der FX-Abruf aus, rechnet die hartkodierte Tabelle weiter und der
//               Snapshot behauptet trotzdem eine vollwertige Umrechnung. Der Marker
//               meta.fxRateSource='hardcoded-fallback' — den scripts/watch-fx-sanity.js
//               liest und ab dem ERSTEN Treffer rot wird — wurde nur im Reporting-Zweig
//               gesetzt. Handelswaehrungs-Umrechnungen (ADR-Klasse, USD-Bilanzierer mit
//               Auslandsnotiz) und der price-only-Schnellweg blieben fuer ihn unsichtbar.
//   F-CGPT-002  Quote ohne Handelswaehrung -> Rohpreis wird als USD gebucht (Yen als Dollar).
//   F-CGPT-003  Quote ohne Preis UND ohne Marktkapitalisierung erreicht Erfolgsstatus
//               'price-only' und ueberschreibt den Snapshot mit Leergut.
//
// Kein Netz, keine Frameworks, keine manipulierte fx-rates.json: die Tests spielen ueber
// die exportierten LEBENDEN Tabellen (_FX_TO_USD/_FX_PROVENANCE) eine Kunst-Waehrung ein.
// Run: node tests/p0-haertung2-fx-ehrlichkeit.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const {
  _convertSnapshotToUSD, _fxFactorFor, _stampFxSource,
  _quoteHasSubstance, _resolveTradingFx,
  _FX_TO_USD, _FX_PROVENANCE,
} = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}

// Kunst-Waehrungen: XHC steht auf der hartkodierten Tabelle, XLV kommt live aus dem Feed.
// Beide Kurse absichtlich krumm, damit ein falsch angewandter Faktor sofort auffaellt.
_FX_TO_USD.XHC = 0.5;  _FX_PROVENANCE.XHC = 'fallback-hardcoded';
_FX_TO_USD.XLV = 0.25; _FX_PROVENANCE.XLV = 'live';

// ── F-CGPT-001: Herkunft des Kurses ist an JEDEM Umrechnungs-Bein ablesbar ──────────

test('F-001 _fxFactorFor: hartkodierte Waehrung meldet ihre Herkunft', () => {
  assert.deepEqual(_fxFactorFor('XHC'), { factor: 0.5, provenance: 'fallback-hardcoded', key: 'XHC' });
});

test('F-001 _fxFactorFor: USD ist Identitaet, NIE "hartkodiert" (sonst Falsch-Rot ueber das halbe US-Universum)', () => {
  assert.equal(_fxFactorFor('USD').provenance, 'identity');
  assert.equal(_fxFactorFor('USD').factor, 1);
});

test('F-001 _fxFactorFor: Pence bleibt Pence, Pfund bleibt Pfund', () => {
  const pence = _fxFactorFor('GBp'), pfund = _fxFactorFor('GBP');
  assert.ok(pence && pfund, 'GBP/GBp muessen einen Kurs haben');
  assert.ok(Math.abs(pence.factor * 100 - pfund.factor) < 1e-12, 'GBp = GBP/100');
});

test('F-001 _fxFactorFor: ohne brauchbaren Kurs null (fail-closed), nicht 1', () => {
  assert.equal(_fxFactorFor('XKEINKURS'), null);
  assert.equal(_fxFactorFor(''), null);
  assert.equal(_fxFactorFor(null), null);
});

test('F-001 _stampFxSource: stempelt nur abwaerts — live macht hartkodiert nicht wieder sauber', () => {
  const s = { meta: { fxRateSource: 'hardcoded-fallback' } };
  _stampFxSource(s, 'live');
  assert.equal(s.meta.fxRateSource, 'hardcoded-fallback');
});

test('F-001 USD-Bilanzierer mit hartkodiert umgerechneter Handelswaehrung traegt den Marker', () => {
  // 1299.HK-Klasse: financialCurrency USD, Notiz in Auslandswaehrung. Die Umrechnung von
  // marketCap/Kurszielen laeuft ueber den Handelskurs — kam der aus der 2026-Q1-Tabelle,
  // MUSS der Snapshot das sagen, sonst zaehlt watch-fx-sanity.js ihn als sauber.
  const snap = {
    meta: { ticker: 'T1', reportingCurrency: 'USD', tradingCurrency: 'XHC' },
    marketCap: { value: 10e9 },
  };
  _convertSnapshotToUSD(snap);
  assert.equal(snap.meta.fxConverted, true, 'Umrechnung soll stattfinden');
  assert.equal(snap.marketCap.value, 5e9, 'mcap mit Handelskurs skaliert');
  assert.equal(snap.meta.fxRateSource, 'hardcoded-fallback');
});

test('F-001 live umgerechneter USD-Bilanzierer traegt den Marker NICHT (kein Falsch-Rot)', () => {
  const snap = {
    meta: { ticker: 'T2', reportingCurrency: 'USD', tradingCurrency: 'XLV' },
    marketCap: { value: 10e9 },
  };
  _convertSnapshotToUSD(snap);
  assert.equal(snap.marketCap.value, 2.5e9);
  assert.notEqual(snap.meta.fxRateSource, 'hardcoded-fallback');
});

test('F-001 reiner USD-Titel traegt den Marker NICHT', () => {
  const snap = { meta: { ticker: 'T3', reportingCurrency: 'USD', tradingCurrency: 'USD' }, marketCap: { value: 10e9 } };
  _convertSnapshotToUSD(snap);
  assert.equal(snap.marketCap.value, 10e9);
  assert.notEqual(snap.meta.fxRateSource, 'hardcoded-fallback');
});

test('F-001 live Reporting-Kurs + hartkodierter Handelskurs = hartkodierter Snapshot', () => {
  // Gemischtes Bein: annual/metrics live umgerechnet, mcap/Kursziele hartkodiert.
  // Der Snapshot als Ganzes ist damit nicht mehr live-umgerechnet.
  const snap = {
    meta: { ticker: 'T4', reportingCurrency: 'XLV', tradingCurrency: 'XHC' },
    marketCap: { value: 10e9 },
    metrics: { revenueTTM: { value: 100 } },
  };
  _convertSnapshotToUSD(snap);
  assert.equal(snap.meta.fxConverted, true);
  assert.equal(snap.metrics.revenueTTM.value, 25, 'Reporting-Bein mit XLV');
  assert.equal(snap.marketCap.value, 5e9, 'Handels-Bein mit XHC');
  assert.equal(snap.meta.fxRateSource, 'hardcoded-fallback');
});

test('F-001 Regression: hartkodierter Reporting-Kurs traegt den Marker weiterhin', () => {
  const snap = { meta: { ticker: 'T5', reportingCurrency: 'XHC' }, metrics: { revenueTTM: { value: 100 } } };
  _convertSnapshotToUSD(snap);
  assert.equal(snap.meta.fxRateSource, 'hardcoded-fallback');
});

// ── F-CGPT-002: kein Preis ohne Waehrung ───────────────────────────────────────────

test('F-002 Handelswaehrung aus der Quote wird benutzt', () => {
  const r = _resolveTradingFx({ currency: 'XHC', regularMarketPrice: 100 }, { meta: {} });
  assert.equal(r.ok, true);
  assert.equal(r.factor, 0.5);
  assert.equal(r.provenance, 'fallback-hardcoded');
});

test('F-002 fehlt die Quote-Waehrung, zaehlt die im Snapshot festgehaltene Handelswaehrung', () => {
  // meta.tradingCurrency setzt der Mapper (Tag 204) auf JEDEM Voll-Pull — eine still
  // als USD gebuchte Auslandsnotiz ist also nie noetig.
  const r = _resolveTradingFx({ regularMarketPrice: 100 }, { meta: { tradingCurrency: 'XHC', reportingCurrencyOriginal: 'USD' } });
  assert.equal(r.ok, true);
  assert.equal(r.factor, 0.5, 'Rohpreis 100 XHC muss zu 50 USD werden, nicht zu 100 USD');
});

test('F-002 gar keine Waehrung ableitbar -> price-only faellt aus, statt USD zu raten', () => {
  const r = _resolveTradingFx({ regularMarketPrice: 100 }, { meta: { reportingCurrencyOriginal: 'USD' } });
  assert.equal(r.ok, false, 'ohne Waehrung darf es keinen Faktor geben');
  assert.ok(/waehrung|currency/i.test(r.reason || ''), 'Grund muss die Waehrung benennen: ' + r.reason);
});

test('F-002 bekannte Waehrung ohne brauchbaren Kurs -> ebenfalls Ausfall, kein Faktor 1', () => {
  const r = _resolveTradingFx({ currency: 'XKEINKURS', regularMarketPrice: 100 }, { meta: { reportingCurrencyOriginal: 'USD' } });
  assert.equal(r.ok, false);
});

// ── F-CGPT-003: kein Erfolg ohne Nutzwert ──────────────────────────────────────────

test('F-003 Quote ohne Preis UND ohne Marktkapitalisierung ist kein Erfolg', () => {
  assert.equal(_quoteHasSubstance({ currency: 'USD' }), false);
  assert.equal(_quoteHasSubstance({ currency: 'USD', regularMarketPrice: null, marketCap: undefined }), false);
  assert.equal(_quoteHasSubstance({ regularMarketPrice: NaN }), false);
  assert.equal(_quoteHasSubstance(null), false);
});

test('F-003 ein einziger Nutzwert genuegt (Preis ODER Marktkapitalisierung)', () => {
  assert.equal(_quoteHasSubstance({ regularMarketPrice: 12.5 }), true);
  assert.equal(_quoteHasSubstance({ marketCap: 3e9 }), true);
  assert.equal(_quoteHasSubstance({ regularMarketPrice: 0 }), true, '0 ist ein Wert, kein Loch');
});

// ── Zwilling im Voll-Pull: gar keine Waehrung von Yahoo = geraten, nicht gesichert ──

test('F-002-Zwilling: ohne jede Waehrungsangabe ist die Reporting-Waehrung als geraten markiert', () => {
  const { mapYahooToCanonical } = require('../pull-yahoo.js');
  const yahoo = { price: { regularMarketPrice: 100, longName: 'Ohne Waehrung', exchangeName: 'Other OTC' } };
  const snap = mapYahooToCanonical(yahoo, { ticker: 'NOCCY', name: 'Ohne Waehrung' }, new Date().toISOString());
  assert.equal(snap.meta.reportingCurrency, 'USD', 'die Konstante bleibt — aber sie ist geraten');
  assert.equal(snap.meta.ccyAmbiguous, true, 'geraten MUSS als geraten im Snapshot stehen');
  // Folgewirkung: fuer OTC/Pink-Sheets greift die vorhandene F-NY-004-Regel und der
  // Titel faellt aus dem Lauf, statt mit einer erfundenen USD-Annahme bewertet zu werden.
  _convertSnapshotToUSD(snap);
  assert.equal(snap.meta.fxConversionFailed, true);
  assert.equal(snap.meta.fxConverted, false);
});

test('F-002-Zwilling: mit Handelswaehrung bleibt es beim alten Verhalten (kein Falsch-Rot)', () => {
  const { mapYahooToCanonical } = require('../pull-yahoo.js');
  const yahoo = { price: { regularMarketPrice: 100, currency: 'USD', exchangeName: 'NasdaqGS' } };
  const snap = mapYahooToCanonical(yahoo, { ticker: 'NORM', name: 'Normal' }, new Date().toISOString());
  _convertSnapshotToUSD(snap);
  assert.notEqual(snap.meta.fxConversionFailed, true);
  assert.equal(snap.meta.fxConverted, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
