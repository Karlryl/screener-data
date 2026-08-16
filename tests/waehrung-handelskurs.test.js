'use strict';
/**
 * Waechter fuer die Handelswaehrung — Waehrungs-Chunk 1 (16.08.2026).
 *
 * BEFUND-LAGE, an echten Yahoo-Antworten vom 16.08.2026 nachgerechnet:
 *
 *   Yahoo liefert marketCap in der HANDELS-Waehrung (price.currency), die Bilanzzahlen in
 *   der BERICHTS-Waehrung (financialData.financialCurrency). Bei 169 der 269 .HK-Zeilen des
 *   Boards vom 07.08. fallen die beiden auseinander: gehandelt in HKD, bilanziert in CNY.
 *   Kurse an dem Tag: HKD 0,1274421 / CNY 0,14853986 — wer die Marktkapitalisierung mit dem
 *   Berichtskurs skaliert, liefert sie um 16,6 % zu hoch aus.
 *
 *   Der Umrechner selbst macht das RICHTIG, sobald er die Handelswaehrung kennt (erster
 *   Block unten, live gegengerechnet an 0020.HK/1585.HK/9992.HK). Die verbleibende Wurzel
 *   ist der Fallback im Mapper: fehlt Yahoos price.currency, wird die Handelswaehrung
 *   STILL mit der Berichtswaehrung gleichgesetzt — danach sieht der Fall wie eine
 *   Inlandsnotierung aus, die Umrechnung unterbleibt, und niemand kann es dem Snapshot
 *   ansehen. Auch score.js fxSuspect ist dagegen blind (es prueft tradingCurrency !==
 *   reportingCurrency, und die Gleichsetzung macht die Bedingung falsch).
 *
 * Usage:  node tests/waehrung-handelskurs.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const py = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Kunst-Kurse ueber die LEBENDEN Tabellen: der Test darf nicht davon abhaengen, was heute
// zufaellig in fx-rates.json steht (Praezedenz: tests/p0-haertung2-fx-ehrlichkeit.test.js).
const HKD = 0.1274421;   // echter Kurs 16.08.2026
const CNY = 0.14853986;  // echter Kurs 16.08.2026
py._FX_TO_USD.HKD = HKD;
py._FX_TO_USD.CNY = CNY;
py._FX_PROVENANCE.HKD = 'live';
py._FX_PROVENANCE.CNY = 'live';

// ---------------------------------------------------------------------------
// 1) Der Umrechner nimmt fuer marketCap den HANDELS-, fuer die Bilanz den BERICHTS-Kurs.
//    Zahlen aus der echten Yahoo-Antwort fuer 0020.HK (SenseTime) vom 16.08.2026.
// ---------------------------------------------------------------------------
check('HK-Doppelwaehrung: marketCap mit HKD, Umsatz mit CNY (0020.HK, echte Zahlen)', () => {
  const snap = {
    meta: { ticker: '0020.HK', reportingCurrency: 'CNY', tradingCurrency: 'HKD' },
    marketCap: { value: 56925810688 },      // HKD, Yahoo price.marketCap
    metrics: { revenueTTM: { value: 5014640128 } }, // CNY, Yahoo financialData.totalRevenue
  };
  py._convertSnapshotToUSD(snap);
  assert.equal(snap.marketCap.value, 56925810688 * HKD,
    'marketCap muss mit dem HKD-Handelskurs skaliert sein');
  assert.equal(snap.metrics.revenueTTM.value, 5014640128 * CNY,
    'Umsatz muss mit dem CNY-Berichtskurs skaliert sein');
  // Der Schaden, den das verhindert: mit dem CNY-Kurs waere die Groesse um 16,6 % zu hoch.
  const falsch = 56925810688 * CNY;
  assert.ok(falsch / snap.marketCap.value > 1.16,
    'Kontrollrechnung: der Berichtskurs waere >16 % zu hoch (' + (falsch / snap.marketCap.value).toFixed(4) + ')');
});

// ---------------------------------------------------------------------------
// 2) Die Wurzel: fehlt price.currency, ist die Handelswaehrung GERATEN — und das muss im
//    Snapshot stehen. Ohne die Markierung ist der Fall von einer echten Inlandsnotierung
//    nicht zu unterscheiden.
// ---------------------------------------------------------------------------
function mapMit(priceModul) {
  return py.mapYahooToCanonical(
    { price: priceModul, financialData: { financialCurrency: 'CNY' } },
    { ticker: '0020.HK', name: 'SenseTime Group Inc.' },
    '2026-08-16T00:00:00.000Z'
  );
}

check('price.currency vorhanden -> Handelswaehrung belegt (tradingCurrencyAssumed=false)', () => {
  const snap = mapMit({ currency: 'HKD', marketCap: 56925810688, exchangeName: 'HKSE' });
  assert.equal(snap.meta.tradingCurrency, 'HKD');
  assert.equal(snap.meta.reportingCurrency, 'CNY');
  assert.equal(snap.meta.tradingCurrencyAssumed, false);
});

check('price.currency fehlt -> Annahme markiert (tradingCurrencyAssumed=true)', () => {
  const snap = mapMit({ marketCap: 56925810688, exchangeName: 'HKSE' });
  assert.equal(snap.meta.tradingCurrency, 'CNY',
    'Verhalten unveraendert: es wird weiter die Berichtswaehrung angenommen');
  assert.equal(snap.meta.tradingCurrencyAssumed, true,
    'die Annahme MUSS markiert sein — sonst ist sie von einem Beleg nicht zu unterscheiden');
});

check('leerer String zaehlt als fehlend (Yahoo liefert gelegentlich "")', () => {
  const snap = mapMit({ currency: '   ', marketCap: 1, exchangeName: 'HKSE' });
  assert.equal(snap.meta.tradingCurrencyAssumed, true);
});

check('Schadensmechanismus: unter der Annahme unterbleibt die Handelskurs-Umrechnung', () => {
  const snap = mapMit({ marketCap: 56925810688, exchangeName: 'HKSE' });
  py._convertSnapshotToUSD(snap);
  // Genau das ist der Fall, den der Ausliefer-Waechter nullt: die Groesse ist um den
  // Faktor CNY/HKD zu hoch, und OHNE die Markierung saehe sie unauffaellig aus.
  assert.equal(snap.marketCap.value, 56925810688 * CNY);
  assert.equal(snap.meta.tradingFxRateApplied, undefined,
    'kein Handelskurs-Stempel — genau daran erkennt der Ausliefer-Waechter den Fall');
  assert.equal(snap.meta.tradingCurrencyAssumed, true);
});

// ---------------------------------------------------------------------------
// 3) Der price-only-Schnellweg (80 % der taeglichen Laeufe) rechnet mit dem Handelskurs —
//    und muss das jetzt auch stempeln, sonst sieht jede korrekt umgerechnete Zeile aus wie
//    eine unumgerechnete.
// ---------------------------------------------------------------------------
check('_resolveTradingFx meldet die Herkunft der Handelswaehrung', () => {
  const ausQuote = py._resolveTradingFx({ currency: 'HKD' }, { meta: { tradingCurrency: 'CNY' } });
  assert.equal(ausQuote.ok, true);
  assert.equal(ausQuote.quelle, 'quote');
  assert.equal(ausQuote.currency, 'HKD');
  const ausMeta = py._resolveTradingFx({}, { meta: { tradingCurrency: 'HKD' } });
  assert.equal(ausMeta.quelle, 'meta');
  const ausSnapPreis = py._resolveTradingFx({}, { price: { currency: 'HKD' }, meta: {} });
  assert.equal(ausSnapPreis.quelle, 'snapshot-price');
});

check('Stempel: Kurs + Waehrung landen im meta, Annahme faellt NUR bei Quote-Beleg', () => {
  const metaQuote = { tradingCurrency: 'CNY', tradingCurrencyAssumed: true };
  py._stampeHandelskurs(metaQuote, py._resolveTradingFx({ currency: 'HKD' }, { meta: metaQuote }));
  assert.equal(metaQuote.tradingFxRateApplied, HKD, 'der angewandte Kurs muss im Snapshot stehen');
  assert.equal(metaQuote.tradingCurrencyOriginal, 'HKD');
  assert.equal(metaQuote.tradingCurrencyAssumed, false, 'die heutige Quote belegt die Waehrung');

  const metaGeerbt = { tradingCurrency: 'CNY', tradingCurrencyAssumed: true };
  py._stampeHandelskurs(metaGeerbt, py._resolveTradingFx({}, { meta: metaGeerbt }));
  assert.equal(metaGeerbt.tradingFxRateApplied, undefined,
    'eine geratene Waehrung darf ueberhaupt keinen Kurs-STEMPEL bekommen — er ist ein Beweis-Feld');
  assert.equal(metaGeerbt.tradingCurrencyAssumed, true,
    'eine aus dem Snapshot geerbte Waehrung darf die Annahme NICHT in einen Beleg verwandeln');
});

// Review-Fix 16.08. (KRITISCH): der Stempel ist das Beweis-Feld des Ausliefer-Waechters.
// Vorher wurde er UNBEDINGT gesetzt, sobald irgendein Kurs herauskam — auch wenn die
// Handelswaehrung nur aus dem Alt-Snapshot geerbt war. Bei einem Altbestand-Snapshot (Feld
// tradingCurrencyAssumed fehlt, weil es vor Tag 938 nicht existierte) hat der Schnellweg die
// stille CNY/HKD-Gleichsetzung damit als geprueft ZERTIFIZIERT und bis zum naechsten
// Voll-Pull verstetigt.
const wx = require('../scripts/write-findash-export.js');

check('Altbestand ohne Herkunfts-Feld: kein Stempel, und der Waechter nullt die Zeile', () => {
  const meta = { tradingCurrency: 'CNY', reportingCurrencyOriginal: 'CNY', reportingCurrency: 'USD',
    fxConverted: true, fxRateApplied: CNY };
  const fx = py._resolveTradingFx({ regularMarketPrice: 12.3, marketCap: 1e9 }, { meta });
  assert.equal(fx.ok, true); assert.equal(fx.quelle, 'meta');
  py._stampeHandelskurs(meta, fx);
  assert.equal(meta.tradingFxRateApplied, undefined,
    'eine geerbte Waehrung ohne Herkunfts-Beleg darf nicht gestempelt werden');
  const u = wx.beurteileWaehrungsbeleg(meta);
  assert.equal(u.ok, false, 'sonst laeuft die Zeile als "handelskurs-gestempelt" durch');
  assert.equal(u.grund, 'herkunft-unbekannt');
});

check('Gegenprobe: belegte Herkunft wird weiter frisch gestempelt', () => {
  // (a) heutige Quote belegt sie
  const ausQuote = { tradingCurrency: 'CNY' };
  py._stampeHandelskurs(ausQuote, py._resolveTradingFx({ currency: 'HKD' }, { meta: ausQuote }));
  assert.equal(ausQuote.tradingFxRateApplied, HKD);
  // (b) ein frueherer Lauf hat sie belegt
  const vorherBelegt = { tradingCurrency: 'HKD', tradingCurrencyAssumed: false };
  py._stampeHandelskurs(vorherBelegt, py._resolveTradingFx({}, { meta: vorherBelegt }));
  assert.equal(vorherBelegt.tradingFxRateApplied, HKD, 'der Kurs des heutigen Laufs muss nachgefuehrt werden');
  // (c) ein frueherer Voll-Pull hat eine SICHTBARE Divergenz umgerechnet (Altbestand mit Stempel)
  const altMitStempel = { tradingCurrency: 'HKD', reportingCurrencyOriginal: 'CNY', tradingFxRateApplied: 0.1 };
  py._stampeHandelskurs(altMitStempel, py._resolveTradingFx({}, { meta: altMitStempel }));
  assert.equal(altMitStempel.tradingFxRateApplied, HKD, 'ein bestehender Stempel darf nicht veralten');
});

check('Stempel schweigt, wenn kein Kurs ermittelt werden konnte', () => {
  const meta = {};
  py._stampeHandelskurs(meta, { ok: false, reason: 'x' });
  assert.deepEqual(meta, {}, 'fail-closed: kein Kurs -> kein Stempel');
});

// ---------------------------------------------------------------------------
// 4) Waehrungs-Chunk 3: enterpriseValue und priceSales kommen von Yahoo in der HANDELS-
//    Waehrung bzw. als Misch-Verhaeltnis. Alle Zahlen unten sind echte Yahoo-Antworten
//    vom 16.08.2026.
// ---------------------------------------------------------------------------
const IDR = 0.000056082103; // echter Kurs 16.08.2026
py._FX_TO_USD.IDR = IDR;
py._FX_PROVENANCE.IDR = 'live';

check('JK-Fall (Bericht USD / Handel IDR): EV und priceSales werden geheilt (BREN.JK)', () => {
  const snap = {
    meta: { ticker: 'BREN.JK', reportingCurrency: 'USD', tradingCurrency: 'IDR' },
    marketCap: { value: 477592880676864 },                 // IDR
    metrics: {
      revenueTTM: { value: 639550976 },                    // USD (Yahoo financialCurrency=USD)
      enterpriseValue: { value: 477595028160512 },         // IDR
      priceSales: { value: 746762.8 },                     // mcap_IDR / Umsatz_USD
    },
  };
  py._convertSnapshotToUSD(snap);
  const mcap = snap.marketCap.value, rev = snap.metrics.revenueTTM.value;
  assert.equal(rev, 639550976, 'Berichtsfaktor ist 1 — der Umsatz bleibt unveraendert');
  assert.ok(Math.abs(mcap / 1e9 - 26.78) < 0.05, 'marketCap ~26,8 Mrd USD, ist ' + (mcap / 1e9));
  // EV: vorher blieb es unveraendert in IDR stehen (Verhaeltnis EV/mcap = 17 831).
  assert.ok(snap.metrics.enterpriseValue.value / mcap < 1.01,
    'EV/mcap muss ~1 sein, ist ' + (snap.metrics.enterpriseValue.value / mcap).toFixed(1));
  // priceSales: vorher 746 762,8 ausgeliefert, ehrlich sind 41,9.
  assert.ok(Math.abs(snap.metrics.priceSales.value - mcap / rev) < 0.01,
    'priceSales muss mcap/Umsatz treffen: ' + snap.metrics.priceSales.value + ' vs ' + (mcap / rev));
});

check('HK-Fall (Bericht CNY / Handel HKD): EV am Handels-, Umsatz am Berichtskurs (0020.HK)', () => {
  const snap = {
    meta: { ticker: '0020.HK', reportingCurrency: 'CNY', tradingCurrency: 'HKD' },
    marketCap: { value: 56925810688 },                     // HKD
    metrics: {
      revenueTTM: { value: 5014640128 },                   // CNY
      ebitda: { value: 1000000000 },                       // CNY (Ertragsrechnung)
      enterpriseValue: { value: 49358987264 },             // HKD
      priceSales: { value: 11.351923 },                    // mcap_HKD / Umsatz_CNY
    },
  };
  py._convertSnapshotToUSD(snap);
  assert.equal(snap.metrics.enterpriseValue.value, 49358987264 * HKD,
    'EV gehoert an den HKD-Handelskurs, nicht an den CNY-Berichtskurs');
  assert.equal(snap.metrics.ebitda.value, 1000000000 * CNY,
    'EBITDA bleibt am Berichtskurs — es ist eine Ertragsrechnungs-Groesse');
  const ehrlich = snap.marketCap.value / snap.metrics.revenueTTM.value;
  assert.ok(Math.abs(snap.metrics.priceSales.value - ehrlich) < 1e-6,
    'priceSales muss mcap/Umsatz treffen: ' + snap.metrics.priceSales.value + ' vs ' + ehrlich);
  // Kontrolle des Schadens: unkorrigiert waeren es 16,6 % zu viel.
  assert.ok(11.351923 / snap.metrics.priceSales.value > 1.16,
    'unkorrigiert lag priceSales >16 % zu hoch');
});

check('Inlandsnotierung (Handel = Bericht): priceSales bleibt exakt unveraendert', () => {
  const snap = {
    meta: { ticker: 'X.HK', reportingCurrency: 'HKD', tradingCurrency: 'HKD' },
    marketCap: { value: 1e10 },
    metrics: { revenueTTM: { value: 1e9 }, enterpriseValue: { value: 9e9 }, priceSales: { value: 10 } },
  };
  py._convertSnapshotToUSD(snap);
  assert.equal(snap.metrics.priceSales.value, 10,
    'ohne Waehrungs-Divergenz ist der Korrekturfaktor exakt 1 — kein Eingriff');
  assert.equal(snap.metrics.enterpriseValue.value, 9e9 * HKD);
});

check('US-Inland (kein FX): nichts wird angefasst', () => {
  const snap = {
    meta: { ticker: 'AAPL', reportingCurrency: 'USD', tradingCurrency: 'USD' },
    marketCap: { value: 3e12 },
    metrics: { revenueTTM: { value: 4e11 }, enterpriseValue: { value: 3.1e12 }, priceSales: { value: 7.5 } },
  };
  py._convertSnapshotToUSD(snap);
  assert.equal(snap.marketCap.value, 3e12);
  assert.equal(snap.metrics.enterpriseValue.value, 3.1e12);
  assert.equal(snap.metrics.priceSales.value, 7.5);
});

// ---------------------------------------------------------------------------
// 5) Review-Fix 16.08.: enterpriseToRevenue ist dasselbe Misch-Verhaeltnis wie priceSales —
//    und es ist das Feld, das als pit.evSales im Board landet. Chunk 3 hat den Konsumenten
//    genannt, aber das falsche Feld korrigiert.
// ---------------------------------------------------------------------------
check('enterpriseToRevenue wird wie priceSales korrigiert (0020.HK, echte Zahlen)', () => {
  const snap = {
    meta: { ticker: '0020.HK', reportingCurrency: 'CNY', tradingCurrency: 'HKD' },
    marketCap: { value: 56925810688 },                     // HKD
    metrics: {
      revenueTTM: { value: 5014640128 },                   // CNY
      enterpriseValue: { value: 49358987264 },             // HKD
      enterpriseToRevenue: { value: 11.899 },              // EV_HKD / Umsatz_CNY (Yahoo roh)
      priceSales: { value: 11.351923 },
    },
  };
  py._convertSnapshotToUSD(snap);
  // Yahoos 11,899 = EV_HKD/Umsatz_CNY (59,67 Mrd / 5,014 Mrd, am Bestand nachgerechnet).
  // Ehrlich ist derselbe Wert mal Handels-/Berichtsfaktor.
  assert.ok(Math.abs(snap.metrics.enterpriseToRevenue.value - 11.899 * HKD / CNY) < 1e-9,
    'evSales muss um Handels-/Berichtsfaktor korrigiert sein, ist ' + snap.metrics.enterpriseToRevenue.value);
  assert.ok(11.899 / snap.metrics.enterpriseToRevenue.value > 1.16,
    'unkorrigiert lag evSales >16 % zu hoch');
});

function brenSnap() {
  return {
    meta: { ticker: 'BREN.JK', reportingCurrency: 'USD', tradingCurrency: 'IDR' },
    marketCap: { value: 477592880676864 },
    metrics: {
      revenueTTM: { value: 639550976 },
      enterpriseValue: { value: 477595028160512 },
      enterpriseToRevenue: { value: 766149 },
      priceSales: { value: 746762.8 },
    },
  };
}

check('JK-Fall: der gemeldete Symptomwert faellt von 766 149 auf ~43 (BREN.JK)', () => {
  // Bei .JK ist der Berichtsfaktor 1 und der Handelsfaktor winzig — genau dort war der
  // Schaden, den Karl im Board vom 07.08. gesehen hat.
  const snap = brenSnap();
  py._convertSnapshotToUSD(snap);
  const evs = snap.metrics.enterpriseToRevenue.value;
  assert.ok(evs < 100, 'evSales muss in eine plausible Groessenordnung fallen, ist ' + evs);
  // Gegenprobe an einer UNABHAENGIGEN Groesse: EV_USD/Umsatz_USD aus demselben Snapshot.
  // 766 149 ist der gerundete Board-Anzeigewert, deshalb 3 % Toleranz statt Bit-Gleichheit.
  const ehrlich = snap.metrics.enterpriseValue.value / snap.metrics.revenueTTM.value;
  assert.ok(Math.abs(evs - ehrlich) / ehrlich < 0.03,
    'und EV_USD/Umsatz_USD treffen: ' + evs + ' vs ' + ehrlich);
});

check('AUSBAU-PROBE: Liste wirklich ausgebaut -> der Waechter wird rot', () => {
  // Kein Schreibmuster-Test: die Liste wird zur Laufzeit geleert, der Umrechner erneut
  // gefahren. Faellt der Schaden dann NICHT auf, prueft der Waechter oben nichts.
  const gesichert = py.MISCH_VERHAELTNIS_METRIKEN.slice();
  py.MISCH_VERHAELTNIS_METRIKEN.length = 0;
  let ohneListe;
  try {
    const snap = brenSnap();
    py._convertSnapshotToUSD(snap);
    ohneListe = snap.metrics.enterpriseToRevenue.value;
  } finally {
    py.MISCH_VERHAELTNIS_METRIKEN.push(...gesichert);
  }
  assert.equal(ohneListe, 766149, 'ohne die Liste bleibt der verzerrte Rohwert stehen');
  // und mit Liste ist er wieder geheilt (die Wiederherstellung selbst gegengeprueft)
  const wieder = brenSnap();
  py._convertSnapshotToUSD(wieder);
  assert.ok(wieder.metrics.enterpriseToRevenue.value < 100, 'Liste wiederhergestellt');
});

check('Spur der Korrektur: mischVerhaeltnisFaktor steht im Snapshot, auch bei Faktor 1', () => {
  const div = { meta: { reportingCurrency: 'CNY', tradingCurrency: 'HKD' },
    marketCap: { value: 1e10 }, metrics: { priceSales: { value: 10 } } };
  py._convertSnapshotToUSD(div);
  assert.ok(Math.abs(div.meta.mischVerhaeltnisFaktor - HKD / CNY) < 1e-12,
    'der angewandte Korrekturfaktor muss im Snapshot stehen');
  const inland = { meta: { reportingCurrency: 'HKD', tradingCurrency: 'HKD' },
    marketCap: { value: 1e10 }, metrics: { priceSales: { value: 10 } } };
  py._convertSnapshotToUSD(inland);
  assert.equal(inland.meta.mischVerhaeltnisFaktor, 1,
    'Faktor 1 ist ein vollwertiger Beleg — sonst nullt der Board-Writer jede Inlandsnotierung');
});

console.log('\nwaehrung-handelskurs: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
