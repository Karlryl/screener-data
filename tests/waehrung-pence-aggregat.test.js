'use strict';
// Waechter zur Pence-Trennung (02.09.2026).
//
// BEFUND: Yahoo liefert fuer LSE-Titel in EINER Antwort zwei verschiedene Einheiten
// derselben Waehrung — regularMarketPrice in GBp (Pence), marketCap in GBP (Pfund).
// Bis hierher bekamen beide denselben Faktor (GBP-Kurs / 100), also war zwangslaeufig
// eines von beiden um genau 100 falsch: die Groesse. Gemessen am eigenen Bestand:
//   RIO.L  mcap 1.69 Mrd USD  gegen das XETRA-Bein RIO1.DE 169.29 Mrd  -> Faktor 100.2
//   RIO.L  Kurs 103.89 USD    gegen RIO1.DE 104.09 USD                 -> Faktor 1.002
// Der Kurs BRAUCHT den Pence-Teiler, die Groesse darf ihn nicht bekommen.
//
// Dieser Waechter FUEHRT beide Umrechnungswege aus (Voll-Pull und Kurs-Schnellweg) statt
// den Quelltext nach Schreibmustern abzusuchen, und prueft beide Richtungen:
// Pence-Beine muessen sich aendern, alles andere (ADR-Klasse) darf sich NICHT aendern.
const assert = require('assert');
const py = require('../pull-yahoo.js');

let ok = 0, fail = 0;
function pruefe(name, fn) {
  try { fn(); ok++; }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

const GBP = py._FX_TO_USD.GBP;
const EUR = py._FX_TO_USD.EUR;
const TWD = py._FX_TO_USD.TWD;
assert.ok(GBP > 0 && EUR > 0 && TWD > 0, 'Vorbedingung: FX-Tabelle traegt GBP/EUR/TWD');

// Rohwerte einer echten .L-Antwort: Groesse in GBP, Kurs in Pence.
const ROH_MCAP_GBP = 1.2481e11;   // ~124.8 Mrd GBP
const ROH_KURS_PENCE = 7674.4;    // 76.744 GBP
const ERWARTET_MCAP_USD = ROH_MCAP_GBP * GBP;
const ERWARTET_KURS_USD = ROH_KURS_PENCE * (GBP / 100);

const nah = (a, b, tol = 1e-6) => Math.abs(a - b) <= Math.abs(b) * tol;
const wert = (x) => (x && typeof x === 'object' && 'value' in x) ? x.value : x;

function bein({ rc, tc, mcap = ROH_MCAP_GBP, ev = null, ziel = null, pSales = null }) {
  const metrics = {};
  if (ev != null) metrics.enterpriseValue = { value: ev };
  if (ziel != null) metrics.targetMeanPrice = { value: ziel };
  if (pSales != null) metrics.priceSales = { value: pSales };
  return { meta: { reportingCurrency: rc, tradingCurrency: tc, exchangeName: 'LSE' },
    marketCap: { value: mcap }, metrics, annual: {} };
}

// ---------------------------------------------------------------- Voll-Pull, GBp
// (a) USD-Melder an der LSE (RIO/BP/SHEL/HSBA/AZN/BHP/GLEN-Klasse): die Groesse darf
//     den Pence-Teiler NICHT bekommen, das Kursziel schon.
pruefe('Voll-Pull GBp/USD-Melder: marketCap ohne Pence-Teiler', () => {
  const s = bein({ rc: 'USD', tc: 'GBp', ev: 1.4e11, ziel: ROH_KURS_PENCE });
  py._convertSnapshotToUSD(s);
  assert.ok(nah(wert(s.marketCap), ERWARTET_MCAP_USD),
    'marketCap ' + wert(s.marketCap) + ' != ' + ERWARTET_MCAP_USD);
  assert.ok(nah(wert(s.metrics.enterpriseValue), 1.4e11 * GBP),
    'enterpriseValue ist eine Groesse und gehoert an denselben Faktor wie marketCap');
  assert.ok(nah(wert(s.metrics.targetMeanPrice), ROH_KURS_PENCE * (GBP / 100)),
    'das Kursziel ist ein STUECK-Kurs und behaelt den Pence-Teiler');
});

// (b) GBP-Melder an der LSE (ABF/ADM/AJB-Klasse): war vor dem Fix korrekt und muss
//     es bleiben — hier greift die Divergenz-Erkennung gar nicht erst.
pruefe('Voll-Pull GBp/GBP-Melder: unveraendert korrekt', () => {
  const s = bein({ rc: 'GBP', tc: 'GBp', mcap: 1.4345e10, ev: 1.4e10 });
  py._convertSnapshotToUSD(s);
  assert.ok(nah(wert(s.marketCap), 1.4345e10 * GBP), 'marketCap = GBP-Kurs, kein Teiler');
  assert.ok(nah(wert(s.metrics.enterpriseValue), 1.4e10 * GBP), 'EV ebenso');
});

// (c) EUR-Melder an der LSE (BNC.L, ULVR.L): laeuft durch den NICHT-USD-Zweig, also
//     die dritte Stelle, an der marketCap skaliert wird.
pruefe('Voll-Pull GBp/EUR-Melder (Nicht-USD-Zweig): marketCap ohne Pence-Teiler', () => {
  const s = bein({ rc: 'EUR', tc: 'GBp', ev: 1.4e11, ziel: ROH_KURS_PENCE });
  py._convertSnapshotToUSD(s);
  assert.ok(nah(wert(s.marketCap), ERWARTET_MCAP_USD),
    'marketCap ' + wert(s.marketCap) + ' != ' + ERWARTET_MCAP_USD);
  assert.ok(nah(wert(s.metrics.enterpriseValue), 1.4e11 * GBP), 'EV an den Aggregat-Faktor');
  assert.ok(nah(wert(s.metrics.targetMeanPrice), ROH_KURS_PENCE * (GBP / 100)),
    'Kursziel behaelt den Pence-Teiler');
});

// (d) EV/mcap-Verhaeltnis je Bein-Klasse: die sechs Beine, deren EV heute konsistent zur
//     marketCap steht (BNC/GLEN/AZN/ITRK/RIO/GFTU), duerfen durch den Fix NICHT in eine
//     frische 100x-Inkonsistenz kippen. Das ist die Regression, die ein reiner
//     marketCap-Fix erzeugt haette.
pruefe('EV/mcap bleibt in jeder Melder-Klasse verhaeltnistreu', () => {
  for (const rc of ['USD', 'GBP', 'EUR']) {
    const s = bein({ rc, tc: 'GBp', mcap: 1.0e11, ev: 1.15e11 });
    py._convertSnapshotToUSD(s);
    const r = wert(s.metrics.enterpriseValue) / wert(s.marketCap);
    assert.ok(nah(r, 1.15, 1e-9), 'EV/mcap fuer ' + rc + '-Melder = ' + r + ', erwartet 1.15');
  }
});

// (e) Misch-Verhaeltnis (priceSales): Zaehler ist eine GROESSE, Nenner eine
//     Berichtsgroesse — der Korrekturfaktor gehoert an den Aggregat-Kurs.
//     Belegt am Bestand: RIO.L pSales 0.0273 gegen RIO1.DE 2.783 (Faktor ~100).
pruefe('priceSales wird mit dem Aggregat-Verhaeltnis korrigiert', () => {
  const s = bein({ rc: 'USD', tc: 'GBp', pSales: 0.02 });
  py._convertSnapshotToUSD(s);
  assert.ok(nah(wert(s.metrics.priceSales), 0.02 * GBP),
    'priceSales ' + wert(s.metrics.priceSales) + ' != ' + (0.02 * GBP));
});

// ---------------------------------------------------------------- Kurs-Schnellweg
// _priceOnlyUpdate steckt im Closure von pullAll; die Entscheidung selbst liegt in
// _resolveTradingFx und ist exportiert. Der Schnellweg rechnet
//   marketCap = q.marketCap * factorMajorUnit   und   preis = q.regularMarketPrice * factor.
pruefe('Schnellweg GBp: zwei Faktoren, Groesse ohne Teiler, Kurs mit', () => {
  for (const rc of ['USD', 'GBP', 'EUR']) {
    const vorhanden = { meta: { reportingCurrencyOriginal: rc, fxRateApplied: rc === 'USD' ? 1 : GBP,
      tradingCurrency: 'GBp', tradingCurrencyAssumed: false } };
    const fx = py._resolveTradingFx({ currency: 'GBp' }, vorhanden);
    assert.ok(fx.ok, 'Handelskurs muss ableitbar sein');
    assert.ok(nah(ROH_MCAP_GBP * fx.factorMajorUnit, ERWARTET_MCAP_USD),
      'Schnellweg-marketCap fuer ' + rc + '-Melder falsch');
    assert.ok(nah(ROH_KURS_PENCE * fx.factor, ERWARTET_KURS_USD),
      'Schnellweg-Kurs fuer ' + rc + '-Melder falsch');
    assert.ok(fx.factorMajorUnit / fx.factor === 100,
      'genau der Pence-Teiler trennt die beiden Faktoren');
  }
});

// ---------------------------------------------------------------- Gegenprobe ADR
// Die Trennung darf AUSSCHLIESSLICH Pence beruehren. Fuer jede andere Waehrung muessen
// beide Faktoren identisch sein, sonst verschiebt der Fix still die ADR-Klasse
// (TSM/BABA/NU) — die dokumentierte Regressionsgefahr an dieser FX-Strecke.
pruefe('ADR-Klasse: beide Faktoren identisch fuer jede Nicht-Pence-Waehrung', () => {
  for (const c of Object.keys(py._FX_TO_USD)) {
    const fx = py._fxFactorFor(c);
    if (!fx) continue;
    assert.equal(fx.factor, fx.factorMajorUnit,
      c + ': Nicht-Pence-Waehrung darf keine zwei Faktoren haben');
  }
  const usd = py._fxFactorFor('USD');
  assert.equal(usd.factor, 1); assert.equal(usd.factorMajorUnit, 1);
});

pruefe('ADR-Voll-Pull TSM/BABA/NU-Form: marketCap unveraendert', () => {
  // TSM-Form: Bericht TWD, Handel USD (NYSE). Die Groesse ist in USD, der
  // Berichtsfaktor gilt nur fuer annual/metrics.
  const tsm = { meta: { reportingCurrency: 'TWD', tradingCurrency: 'USD', exchangeName: 'NYSE' },
    marketCap: { value: 8.0e11 }, metrics: { enterpriseValue: { value: 7.5e11 },
      targetMeanPrice: { value: 210 }, revenueTTM: { value: 2.9e12 } }, annual: {} };
  py._convertSnapshotToUSD(tsm);
  assert.equal(wert(tsm.marketCap), 8.0e11, 'USD-gehandelte ADR-marketCap bleibt unskaliert');
  assert.equal(wert(tsm.metrics.enterpriseValue), 7.5e11, 'EV ebenso');
  assert.equal(wert(tsm.metrics.targetMeanPrice), 210, 'Kursziel ebenso');
  assert.ok(nah(wert(tsm.metrics.revenueTTM), 2.9e12 * TWD), 'Umsatz laeuft am BERICHTS-Kurs');
});

pruefe('ADR-Voll-Pull 1299.HK-Form (USD-Melder, Fremdhandel): unveraendert', () => {
  const s = { meta: { reportingCurrency: 'USD', tradingCurrency: 'HKD', exchangeName: 'HKSE' },
    marketCap: { value: 1.0e12 }, metrics: { enterpriseValue: { value: 9.0e11 } }, annual: {} };
  const HKD = py._FX_TO_USD.HKD;
  py._convertSnapshotToUSD(s);
  assert.ok(nah(wert(s.marketCap), 1.0e12 * HKD), 'HKD-Handelskurs unveraendert angewandt');
  assert.ok(nah(wert(s.metrics.enterpriseValue), 9.0e11 * HKD), 'EV ebenso');
});

pruefe('ADR-Schnellweg: Faktoren identisch, also bitgleiches Ergebnis', () => {
  for (const c of ['USD', 'HKD', 'TWD', 'EUR']) {
    const fx = py._resolveTradingFx({ currency: c },
      { meta: { reportingCurrencyOriginal: 'USD', fxRateApplied: 1, tradingCurrencyAssumed: false } });
    assert.ok(fx.ok, c + ': Kurs muss ableitbar sein');
    assert.equal(fx.factor, fx.factorMajorUnit, c + ': keine Trennung ausserhalb Pence');
  }
});

// ---------------------------------------------------------------- Listen-Wache
// Der Fix lebt davon, dass die beiden Einheiten-Klassen getrennt BLEIBEN. Waendert
// enterpriseValue zurueck zu den Kurszielen, ist der Defekt lautlos wieder da.
pruefe('die zwei Einheiten-Klassen bleiben getrennt', () => {
  assert.ok(py.HANDELS_AGGREGAT_METRIKEN.includes('enterpriseValue'),
    'enterpriseValue gehoert zu den Groessen');
  assert.ok(!py.HANDELS_METRIKEN.includes('enterpriseValue'),
    'enterpriseValue darf NICHT bei den Stueck-Kursen stehen');
  for (const k of ['targetMeanPrice', 'targetMedianPrice']) {
    assert.ok(py.HANDELS_METRIKEN.includes(k), k + ' ist ein Stueck-Kurs');
    assert.ok(!py.HANDELS_AGGREGAT_METRIKEN.includes(k), k + ' darf nicht bei den Groessen stehen');
  }
});

// ---------------------------------------------------------------- Gegenrichtung
// Der Waechter muss auch ROT werden koennen: mit dem alten Verhalten (ein Faktor fuer
// alles) laege die Groesse um exakt 100 daneben. Ohne diese Probe koennte die ganze
// Datei gruen bleiben, weil sie versehentlich nichts misst.
pruefe('Gegenprobe: der alte Ein-Faktor-Weg waere um genau 100 daneben', () => {
  const fx = py._fxFactorFor('GBp');
  const altersWert = ROH_MCAP_GBP * fx.factor;      // so lief es bis 02.09.2026
  assert.ok(nah(ERWARTET_MCAP_USD / altersWert, 100, 1e-9),
    'die Probe misst nichts, wenn hier nicht exakt 100 steht');
});

console.log('waehrung-pence-aggregat: ' + ok + ' ok, ' + fail + ' fail');
if (fail) process.exit(1);
