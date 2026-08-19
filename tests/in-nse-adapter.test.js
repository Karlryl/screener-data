'use strict';
/**
 * in-nse-adapter — Waechter fuer scripts/build-inannual.js (Indien / NSE).
 *
 * Alle Fixtures sind ECHTE Rohantworten vom 19.08.2026, Zahlen unveraendert:
 *   in-nse-OFSS-fy2025-cons.xml        Integrated Filing, Taxonomie in-capmkt, Konzern
 *   in-nse-OFSS-fy2025-stand.xml       dieselbe Firma, dasselbe Jahr, EINZELABSCHLUSS
 *                                      (auf die vier Kernkontexte OneD/FourD/OneI/PY_I
 *                                      gekuerzt — das Original traegt 1.836 Kontexte und
 *                                      2,2 MB Anhangstexte; Zahlen unveraendert)
 *   in-nse-OFSS-fy2024-cons.xml        Jahresergebnis, ALTE Taxonomie in-bse-fin
 *   in-nse-OFSS-fy2021-cons.xml        alte Taxonomie MIT undeklarierten Kontexten
 *   in-nse-KALYANKJIL-fy2025-cons.xml  Haendler: alle drei Wareneinsatz-Posten belegt
 *   in-nse-KALYANKJIL-fy2024-cons.xml  dasselbe GJ2024, das spaeter restated wurde
 *   in-nse-CHENNPETRO-fy2026-cons.xml  Rundungsstufe "Crores" statt "Millions"
 *   in-nse-{OFSS,KALYANKJIL}-listen.json   die beiden Listen-Antworten, unveraendert
 *
 * Die Testfaelle sind bewusst so gewaehlt, dass sich die verglichenen Werte NACHWEISLICH
 * unterscheiden — an einer Firma, bei der Konzern und Einzelabschluss betragsgleich waeren,
 * bliebe jede Sabotage gruen und wuerde nichts beweisen.
 *
 * Run: node tests/in-nse-adapter.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../scripts/build-inannual.js');

let pass = 0, fail = 0;
// Synchroner Laeufer. Ein async-Test darf hier NICHT durchrutschen: der try/catch wuerde
// jede Ablehnung verschlucken und den Test gruen zaehlen, ohne dass er gelaufen ist.
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('async-Test gehoert in testAsync()');
    pass += 1; console.log(`  ok   ${name}`);
  } catch (e) { fail += 1; console.error(`FAIL   ${name}\n       ${e.message}`); }
}
const ASYNC = [];
function testAsync(name, fn) { ASYNC.push([name, fn]); }
const FIX = path.join(__dirname, 'fixtures');
const lies = (n) => fs.readFileSync(path.join(FIX, `in-nse-${n}`), 'utf8');
const listen = (s) => JSON.parse(lies(`${s}-listen.json`));

// Amtlich nachrechenbare Werte aus den echten Antworten (INR, volle Rupien).
const OFSS_KONZERN_REV = 68468000000;
const OFSS_EINZEL_REV = 50991000000;
const OFSS_Q4_REV = 17163000000;          // Vierteljahr — Faktor 4 unter dem Jahr
const OFSS_FY2024_REV = 63729610000;
const OFSS_FY2024_Q4_REV = 16424360000;
const KALYAN_FY2025_REV = 250450660000;
const KALYAN_FY2024_REV_ASFILED = 185482860000;
const KALYAN_FY2024_REV_RESTATED = 185155510000;   // aus dem Jahresbericht-XBRL 30.09.2025
const KALYAN_PURCHASES = 2542710000;
const CHENN_FY2026_REV = 786107900000;

// ══════════════════════════════════════════════════════════════════════════════════════
//  0. Parser — die Regression, die beim Bau zugeschlagen hat
// ══════════════════════════════════════════════════════════════════════════════════════
test('der Parser laesst sich vom Wurzelelement nicht das ganze Dokument wegfressen', () => {
  // <xbrli:xbrl …> … </xbrli:xbrl> passt auf ein naives Element-Muster und verschluckt beim
  // ersten Treffer die komplette Datei — danach findet matchAll null Fakten und der Adapter
  // liefert STILL leere Firmen. Genau das ist beim Bau passiert.
  const p = M.parseXbrl(lies('OFSS-fy2025-cons.xml'));
  assert.ok(p.fakten.size > 200, `nur ${p.fakten.size} Faktennamen gefunden`);
  assert.ok(p.kontexte.size > 20, `nur ${p.kontexte.size} Kontexte gefunden`);
  assert.equal(p.taxonomie, 'in-capmkt');
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  1. KONZERN GEGEN EINZELABSCHLUSS
// ══════════════════════════════════════════════════════════════════════════════════════
test('OFSS: der Konzernabschluss kommt an, nicht der Einzelabschluss', () => {
  const j = M.bauJahr(lies('OFSS-fy2025-cons.xml'), 'OFSS.NS', 'Consolidated');
  assert.equal(j.fy, 2025);
  assert.equal(j.fiscalYearEnd, '2025-03-31');
  assert.equal(j.werte.annualRev, OFSS_KONZERN_REV);
  assert.notEqual(j.werte.annualRev, OFSS_EINZEL_REV);
});

test('Fixture-Kontrolle: der Einzelwert steht wirklich da und ist deutlich verschieden', () => {
  // Ohne diesen Nachweis koennte der Test an einer Firma haengen, die den Unterschied gar
  // nicht zeigt — dann bliebe jede Sabotage gruen.
  const p = M.parseXbrl(lies('OFSS-fy2025-stand.xml'));
  assert.equal(M.zahl(M.fakt(p, 'RevenueFromOperations', 'FourD', 'OFSS.NS')), OFSS_EINZEL_REV);
  const abweichung = OFSS_KONZERN_REV / OFSS_EINZEL_REV - 1;
  assert.ok(abweichung > 0.3, `nur ${(abweichung * 100).toFixed(1)} % Unterschied — zu schwach`);
});

test('SABOTAGE: eine Einzelabschluss-Datei wird verworfen, nicht verrechnet', () => {
  assert.throws(() => M.bauJahr(lies('OFSS-fy2025-stand.xml'), 'OFSS.NS', 'Standalone'),
    /Konsolidierungskreis "Standalone"/);
});

test('SABOTAGE: Datei sagt Konzern, Liste sagt Einzel -> kein Wert statt geratenem Wert', () => {
  assert.throws(() => M.bauJahr(lies('OFSS-fy2025-cons.xml'), 'OFSS.NS', 'Standalone'),
    /die Datei sagt "Consolidated", der Listen-Eintrag aber/);
});

test('SABOTAGE: fehlt die Konsolidierungs-Angabe in der Datei, wird nichts geschrieben', () => {
  const kaputt = lies('OFSS-fy2025-cons.xml')
    .replace(/<in-capmkt:NatureOfReportStandaloneConsolidated[\s\S]*?<\/in-capmkt:NatureOfReportStandaloneConsolidated>/g, '');
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'), /Konsolidierungskreis null/);
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  2. YTD / DEKUMULIERUNG — Jahr gegen Quartal
// ══════════════════════════════════════════════════════════════════════════════════════
test('der Jahreswert kommt an, nicht der Q4-Wert (OFSS GJ2025, Faktor 4 auseinander)', () => {
  const p = M.parseXbrl(lies('OFSS-fy2025-cons.xml'));
  assert.equal(M.zahl(M.fakt(p, 'RevenueFromOperations', 'OneD', 'OFSS.NS')), OFSS_Q4_REV);
  const j = M.bauJahr(lies('OFSS-fy2025-cons.xml'), 'OFSS.NS', 'Consolidated');
  assert.equal(j.werte.annualRev, OFSS_KONZERN_REV);
  assert.notEqual(j.werte.annualRev, OFSS_Q4_REV);
  assert.ok(j.kontexte.jahrTage >= M.JAHR_MIN_TAGE && j.kontexte.jahrTage <= M.JAHR_MAX_TAGE);
});

test('ALTE TAXONOMIE: der Jahres-Kontext luegt ueber seine eigenen xbrli-Daten', () => {
  // In in-bse-fin traegt <xbrli:context id="FourD"> DIESELBEN Daten wie OneD (das Quartal).
  // Wer den Jahreswert an den Kontextdaten festmacht, findet hier gar kein Jahr — dieser
  // Test wird rot, sobald jemand den Waechter auf die Kontextdaten zurueckdreht.
  const xml = lies('OFSS-fy2024-cons.xml');
  const p = M.parseXbrl(xml);
  assert.deepEqual(
    [p.kontexte.get('OneD').start, p.kontexte.get('OneD').ende],
    [p.kontexte.get('FourD').start, p.kontexte.get('FourD').ende],
    'Fixture-Kontrolle: die beiden Kontexte muessen identische (falsche) Daten tragen',
  );
  assert.equal(M.zahl(M.fakt(p, 'RevenueFromOperations', 'OneD', 'x')), OFSS_FY2024_Q4_REV);
  const j = M.bauJahr(xml, 'OFSS.NS', 'Consolidated');
  assert.equal(j.werte.annualRev, OFSS_FY2024_REV);
  assert.equal(j.taxonomie, 'in-bse-fin');
});

test('ALTE TAXONOMIE: undeklarierte Kontexte fallen nicht unter den Tisch (OFSS GJ2021)', () => {
  const xml = lies('OFSS-fy2021-cons.xml');
  const p = M.parseXbrl(xml);
  assert.equal(p.kontexte.get('FourD'), undefined,
    'Fixture-Kontrolle: FourD ist in dieser Datei gar nicht deklariert');
  const j = M.bauJahr(xml, 'OFSS.NS', 'Consolidated');
  assert.equal(j.werte.annualRev, 49839370000);
  assert.equal(j.werte.annualAssets, null, 'diese Meldung hat keine Bilanz — null, nicht 0');
  assert.notEqual(j.werte.annualAssets, 0);
});

test('SABOTAGE: schiebt man dem Jahres-Kontext die Quartals-Periode unter, gibt es kein Jahr', () => {
  const kaputt = lies('OFSS-fy2025-cons.xml')
    .replace('<in-capmkt:DateOfStartOfReportingPeriod contextRef="FourD">2024-04-01<',
      '<in-capmkt:DateOfStartOfReportingPeriod contextRef="FourD">2025-01-01<');
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'), /kein Jahres-Kontext/);
});

test('SABOTAGE: zwei Kontexte mit verschiedenen Jahreswerten sind nicht entscheidbar', () => {
  // Genau das passiert, wenn jemand die Perioden-Pruefung aufweicht: dann behaupten
  // Quartals- und Jahres-Kontext dieselbe Periode und tragen Werte im Verhaeltnis 1:4.
  const kaputt = lies('OFSS-fy2025-cons.xml')
    .replace('<in-capmkt:DateOfStartOfReportingPeriod contextRef="OneD">2025-01-01<',
      '<in-capmkt:DateOfStartOfReportingPeriod contextRef="OneD">2024-04-01<');
  // Scharf auf DIESEN Wurf: "verschiedene Werte" steht auch in der Konflikt-Meldung
  // INNERHALB eines Kontexts — die Regex muss die beiden Faelle unterscheiden koennen.
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'),
    /in zwei Kontexten derselben Periode verschiedene Werte/);
});

test('CHENNPETRO: die Sammelposten-Kontexte sind TYPED-Dimensionen und fallen raus', () => {
  // Die 24 Kontexte I_OtherCurrentAssets1… gliedern die Sammelposten auf. Sie benutzen
  // xbrldi:typedMember statt xbrldi:explicitMember — wer nur die explizite Form als
  // Dimension zaehlt, haelt sie faelschlich fuer Gesamtwert-Kontexte und hat 24 Kandidaten
  // fuer dieselbe Bilanz.
  const xml = lies('CHENNPETRO-fy2026-cons.xml');
  assert.equal((xml.match(/xbrldi:typedMember/g) || []).length, 56,
    'Fixture-Kontrolle: die Datei benutzt wirklich typed-Dimensionen');
  const p = M.parseXbrl(xml);
  const stichtageOhneDim = [...p.kontexte.values()]
    .filter((k) => !k.dims && k.instant === '2026-03-31').length;
  assert.equal(stichtageOhneDim, 1, 'nach Abzug der Aufgliederungen bleibt genau OneI uebrig');
  const j = M.bauJahr(xml, 'CHENNPETRO.NS', 'Consolidated');
  assert.equal(j.kontexte.stichtagKandidaten, 1);
  assert.equal(j.werte.annualAssets, 200346200000);
  assert.equal(j.werte.annualEquity, 111092100000);
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  3. RUNDUNGSSTUFE — steht als Text da, wird NIE gerechnet
// ══════════════════════════════════════════════════════════════════════════════════════
test('zwei verschiedene Rundungsstufen, beide Werte in vollen Rupien', () => {
  const ofss = M.bauJahr(lies('OFSS-fy2025-cons.xml'), 'OFSS.NS', 'Consolidated');
  const chenn = M.bauJahr(lies('CHENNPETRO-fy2026-cons.xml'), 'CHENNPETRO.NS', 'Consolidated');
  // Der Testfall taugt nur, WEIL die Stufen verschieden sind — sonst zeigt er nichts.
  assert.equal(ofss.rundung, 'Millions');
  assert.equal(chenn.rundung, 'Crores');
  assert.equal(ofss.werte.annualRev, OFSS_KONZERN_REV);
  assert.equal(chenn.werte.annualRev, CHENN_FY2026_REV);
  // Das Verhaeltnis stimmt nur, wenn KEINE Stufe als Faktor angewandt wurde. Mit "Crores"
  // als Faktor 10^7 laege CHENNPETRO um zehn Millionen daneben.
  const verhaeltnis = chenn.werte.annualRev / ofss.werte.annualRev;
  assert.ok(verhaeltnis > 11 && verhaeltnis < 12, `Verhaeltnis ${verhaeltnis} — Skala verrutscht`);
});

test('SABOTAGE: wird die Rundungsstufe doch als Faktor angewandt, feuert der Skalen-Waechter', () => {
  // 10^7 auf das eingezahlte Kapital = genau der Fehler "Crores als Faktor".
  const kaputt = lies('CHENNPETRO-fy2026-cons.xml')
    .replace(/(<in-capmkt:PaidUpValueOfEquityShareCapital[^>]*>)1489100000(<)/g, '$114891000000000000$2');
  assert.throws(() => M.bauJahr(kaputt, 'CHENNPETRO.NS', 'Consolidated'),
    /hergeleitete Aktienzahl .* ausserhalb/);
});

test('SABOTAGE: eine unbekannte Rundungsstufe faerbt rot statt still weiterzurechnen', () => {
  const kaputt = lies('CHENNPETRO-fy2026-cons.xml').replace(/>Crores</g, '>Furlongs<');
  assert.throws(() => M.bauJahr(kaputt, 'CHENNPETRO.NS', 'Consolidated'), /unbekannte Rundungsstufe/);
});

test('SABOTAGE: eine andere Berichtswaehrung wird nie mit INR gemischt', () => {
  const kaputt = lies('OFSS-fy2025-cons.xml')
    .replace(/(<in-capmkt:DescriptionOfPresentationCurrency[^>]*>)INR(<)/g, '$1USD$2');
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'), /Berichtswaehrung "USD"/);
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  4. GESCHAEFTSJAHRES-ACHSE (31.03.)
// ══════════════════════════════════════════════════════════════════════════════════════
test('das Geschaeftsjahr wird nach dem ENDJAHR beschriftet (01.04.2024-31.03.2025 = GJ2025)', () => {
  const j = M.bauJahr(lies('OFSS-fy2025-cons.xml'), 'OFSS.NS', 'Consolidated');
  assert.equal(j.fiscalYearEnd, '2025-03-31');
  assert.equal(j.fy, 2025);
  assert.equal(M.spanneTage('2024-04-01', '2025-03-31'), 365);
});

test('SABOTAGE: ein Rumpfjahr (Geschaeftsjahr-Wechsel) geht nicht als Jahr durch', () => {
  // 9 Monate statt 12 — genau das entsteht, wenn eine Firma ihren Stichtag verlegt.
  const kaputt = lies('OFSS-fy2025-cons.xml')
    .replace('<in-capmkt:DateOfStartOfReportingPeriod contextRef="FourD">2024-04-01<',
      '<in-capmkt:DateOfStartOfReportingPeriod contextRef="FourD">2024-07-01<');
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'), /kein Jahres-Kontext/);
});

test('SABOTAGE: wechselt der Stichtag innerhalb einer Firma, bricht die Achse ab', () => {
  const gemischt = [
    { fy: 2025, fiscalYearEnd: '2025-03-31' },
    { fy: 2024, fiscalYearEnd: '2024-12-31' },
  ];
  assert.throws(() => M.pruefeJahresachse('X.NS', gemischt), /Stichtag wechselt/);
  // Gegenprobe: die gueltige Form muss DURCHGEHEN.
  const sauber = [
    { fy: 2025, fiscalYearEnd: '2025-03-31' },
    { fy: 2024, fiscalYearEnd: '2024-03-31' },
  ];
  assert.equal(M.pruefeJahresachse('X.NS', sauber).stichtag, '03-31');
});

test('SABOTAGE: dasselbe Geschaeftsjahr zweimal ist nicht entscheidbar', () => {
  const doppelt = [
    { fy: 2025, fiscalYearEnd: '2025-03-31' },
    { fy: 2025, fiscalYearEnd: '2025-03-31' },
  ];
  assert.throws(() => M.pruefeJahresachse('X.NS', doppelt), /mehrfach vor/);
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  5. ROHERTRAG — Herleitung, Dienstleister-Fall, Formel-Nagel
// ══════════════════════════════════════════════════════════════════════════════════════
test('Haendler: der Rohertrag wird aus allen DREI Wareneinsatz-Posten hergeleitet', () => {
  const p = M.parseXbrl(lies('KALYANKJIL-fy2025-cons.xml'));
  const w = (n) => M.zahl(M.fakt(p, n, 'FourD', 'KALYANKJIL.NS'));
  const material = w('CostOfMaterialsConsumed');
  const zukauf = w('PurchasesOfStockInTrade');
  const bestand = w('ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade');
  assert.equal(zukauf, KALYAN_PURCHASES, 'Fixture-Kontrolle: der dritte Posten ist belegt');

  const j = M.bauJahr(lies('KALYANKJIL-fy2025-cons.xml'), 'KALYANKJIL.NS', 'Consolidated');
  assert.equal(j.werte.annualRev, KALYAN_FY2025_REV);
  assert.equal(j.werte.annualGrossProfit, KALYAN_FY2025_REV - (material + zukauf + bestand));
  assert.equal(j.werte.annualGrossProfit, 32842550000);

  // DER NAGEL: der Auftrags-Anker nennt 35.385 Mio. Das ist dieselbe Zahl OHNE den dritten
  // Posten. Die Differenz ist exakt der Zukauf — damit ist die Abweichung erklaert und die
  // Formel kann nicht still von drei auf zwei Posten kippen, ohne dass das hier rot wird.
  assert.equal(j.werte.annualGrossProfit + zukauf, 35385260000);
});

test('Dienstleister: kein Rohertrag statt 100 % Marge (OFSS, alle Posten 0)', () => {
  const p = M.parseXbrl(lies('OFSS-fy2025-cons.xml'));
  for (const n of M.WARENEINSATZ) {
    const v = M.zahl(M.fakt(p, n, 'FourD', 'OFSS.NS'));
    assert.ok(v === 0 || v === null, `Fixture-Kontrolle: ${n} muesste 0/leer sein, ist ${v}`);
  }
  const j = M.bauJahr(lies('OFSS-fy2025-cons.xml'), 'OFSS.NS', 'Consolidated');
  assert.equal(j.werte.annualGrossProfit, null);
  assert.notEqual(j.werte.annualGrossProfit, j.werte.annualRev, 'das waere eine 100-%-Marge');
  assert.notEqual(j.werte.annualGrossProfit, 0);
});

test('SABOTAGE: ein einziger Posten ungleich 0 schaltet die Herleitung wieder scharf', () => {
  // Gegenprobe zum Dienstleister-Riegel: die gueltige Form muss DURCHGEHEN, nicht nur die
  // kaputte auffliegen. Sonst koennte der Riegel schlicht "immer null" bedeuten.
  const mitWareneinsatz = lies('OFSS-fy2025-cons.xml')
    .replace('<in-capmkt:CostOfMaterialsConsumed contextRef="FourD" decimals="-6" unitRef="INR">0<',
      '<in-capmkt:CostOfMaterialsConsumed contextRef="FourD" decimals="-6" unitRef="INR">1000000000<');
  const j = M.bauJahr(mitWareneinsatz, 'OFSS.NS', 'Consolidated');
  assert.equal(j.werte.annualGrossProfit, OFSS_KONZERN_REV - 1000000000);
});

test('Betriebsergebnis: Umsatz - (Aufwand - Finanzaufwand), intern nachgerechnet', () => {
  const p = M.parseXbrl(lies('CHENNPETRO-fy2026-cons.xml'));
  const w = (n) => M.zahl(M.fakt(p, n, 'FourD', 'CHENNPETRO.NS'));
  // Kontrolle der Ind-AS-Identitaet: Income - Expenses = ProfitBeforeExceptionalItemsAndTax
  assert.equal(w('Income') - w('Expenses'), w('ProfitBeforeExceptionalItemsAndTax'));
  const j = M.bauJahr(lies('CHENNPETRO-fy2026-cons.xml'), 'CHENNPETRO.NS', 'Consolidated');
  assert.equal(j.werte.annualOpInc, w('RevenueFromOperations') - (w('Expenses') - w('FinanceCosts')));
  assert.equal(j.werte.annualOpInc, 41471700000);
  // Und es ist NICHT das ordentliche Ergebnis — sonst waere die Herleitung sinnlos.
  assert.notEqual(j.werte.annualOpInc, w('ProfitBeforeTax'));
});

test('Aktienzahl: Herleitung aus eingezahltem Kapital und Nennwert', () => {
  const j = M.bauJahr(lies('KALYANKJIL-fy2025-cons.xml'), 'KALYANKJIL.NS', 'Consolidated');
  assert.equal(j.werte.annualShares, 1031435000);
  // Amtlich sind 1.031.435.375 Stueck (Jahresbericht-XBRL). Die Herleitung ist auf die
  // Rundungsstufe des eingezahlten Kapitals genau — 3,6e-7 Abweichung, dokumentiert.
  assert.ok(Math.abs(j.werte.annualShares / 1031435375 - 1) < 1e-6);
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  6. RESTATEMENT / VORRANGREGEL
// ══════════════════════════════════════════════════════════════════════════════════════
test('GJ2024 kommt aus SEINER EIGENEN Meldung, nicht aus der spaeteren Vergleichszahl', () => {
  const j = M.bauJahr(lies('KALYANKJIL-fy2024-cons.xml'), 'KALYANKJIL.NS', 'Consolidated');
  assert.equal(j.fy, 2024);
  assert.equal(j.werte.annualRev, KALYAN_FY2024_REV_ASFILED);
  assert.notEqual(j.werte.annualRev, KALYAN_FY2024_REV_RESTATED);
  // Die 0,18 % sind kein Rauschen: sie verschieben die Wachstumsrate GJ2024->GJ2025 sichtbar.
  const wachstumAsFiled = KALYAN_FY2025_REV / KALYAN_FY2024_REV_ASFILED - 1;
  const wachstumRestated = KALYAN_FY2025_REV / KALYAN_FY2024_REV_RESTATED - 1;
  assert.ok(Math.abs(wachstumAsFiled - wachstumRestated) > 0.001);
});

test('bei mehreren Meldungen desselben Jahres gewinnt die zuletzt verbreitete', () => {
  const l = listen('OFSS');
  const gewaehlt = M.waehleMeldungen(l.integrated, l.jahres);
  const fy2026 = gewaehlt.get('2026-03-31');
  assert.ok(fy2026, 'GJ2026 muss ausgewaehlt sein');
  // Fixture-Kontrolle: es gibt fuer GJ2026 wirklich zwei Konzern-Meldungen.
  const kandidaten = l.integrated.filter((r) => r.qe_Date === '31-MAR-2026'
    && r.consolidated === 'Consolidated' && r.type === 'Integrated Filing- Financials');
  assert.equal(kandidaten.length, 2, 'Fixture-Kontrolle: Original + Revision');
  // ⚠ Der Testfall taugt nur, WEIL die Revision kein broadcast_Date traegt — genau daran ist
  // die Vorrangregel beim Bau gescheitert (die ueberholte Original-Meldung gewann).
  const revision = kandidaten.find((r) => r.type_Sub === 'Revision');
  const original = kandidaten.find((r) => r.type_Sub === 'Original');
  assert.equal(revision.broadcast_Date, null, 'Fixture-Kontrolle: Revision ohne broadcast_Date');
  assert.ok(M.nseZeit(revision.creation_Date) > M.nseZeit(original.creation_Date));
  assert.equal(fy2026.url, revision.xbrl, 'die Revision muss die Original-Meldung schlagen');
});

test('nur Konzern-Meldungen mit echtem XBRL kommen in die Auswahl', () => {
  const l = listen('OFSS');
  const gewaehlt = M.waehleMeldungen(l.integrated, l.jahres);
  assert.ok(gewaehlt.size >= 8, `nur ${gewaehlt.size} Jahre ausgewaehlt`);
  for (const [fyEnde, m] of gewaehlt) {
    assert.equal(fyEnde.slice(5), '03-31', `${fyEnde} ist kein 31.03.-Stichtag`);
    assert.equal(m.listeSagt, 'Consolidated');
    assert.ok(!/\/-$/.test(m.url), `${fyEnde}: toter XBRL-Verweis ausgewaehlt`);
  }
  // Vor GJ2018 tragen die Eintraege "xbrl/-" — die duerfen nicht mitgezaehlt werden.
  const tote = l.jahres.filter((r) => /\/-$/.test(r.xbrl || '')).length;
  assert.ok(tote > 0, 'Fixture-Kontrolle: es gibt tote Verweise, die uebersprungen werden muessen');
});

test('KALYANKJIL: der Q4-Stichtag wird aus der Jahresliste gelernt, nicht auf Maerz geraten', () => {
  const l = listen('KALYANKJIL');
  const gewaehlt = M.waehleMeldungen(l.integrated, l.jahres);
  for (const fyEnde of gewaehlt.keys()) assert.equal(fyEnde.slice(5), '03-31');
  assert.ok(gewaehlt.has('2025-03-31') && gewaehlt.has('2024-03-31'));
});

test('nseDatum/nseZeit lesen das NSE-Format und nicht irgendetwas', () => {
  assert.equal(M.nseDatum('31-MAR-2025'), '2025-03-31');
  assert.equal(M.nseDatum('9-Sep-2024'), '2024-09-09');
  assert.equal(M.nseDatum('kaputt'), null);
  assert.ok(M.nseZeit('10-May-2024 20:57:50') > M.nseZeit('10-May-2024 20:53:50'));
  assert.equal(M.nseZeit(''), 0);
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  6b. REVIEW-BEFUNDE 19.08.2026 — jeder Fix mit dem Test, der ohne ihn rot waere
// ══════════════════════════════════════════════════════════════════════════════════════
test('ein unlesbares Startdatum darf die Tage-Spanne nicht umgehen (NaN-Falle)', () => {
  // NaN < 330 ist false UND NaN > 400 ist false — ohne Number.isFinite faellt die ganze
  // Spannenpruefung lautlos aus und ein beliebiger Kontext geht als Jahres-Kontext durch.
  assert.ok(!Number.isFinite(M.spanneTage('kein-datum', '2025-03-31')),
    'Kontrolle: die Spanne ist wirklich NaN');
  const kaputt = lies('OFSS-fy2025-cons.xml')
    .replace('<in-capmkt:DateOfStartOfReportingPeriod contextRef="FourD">2024-04-01<',
      '<in-capmkt:DateOfStartOfReportingPeriod contextRef="FourD">kein-datum<');
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'), /kein Jahres-Kontext/);
});

test('widersprechen sich zwei Jahres-Kontexte im Konsolidierungskreis, gibt es keinen Wert', () => {
  // OneD wird durch die gefaelschte Periode zum zweiten Jahres-Kandidaten und behauptet
  // gleichzeitig den anderen Kreis. "Erster Treffer gewinnt" haette hier still entschieden.
  const kaputt = lies('OFSS-fy2025-cons.xml')
    .replace('<in-capmkt:DateOfStartOfReportingPeriod contextRef="OneD">2025-01-01<',
      '<in-capmkt:DateOfStartOfReportingPeriod contextRef="OneD">2024-04-01<')
    .replace('<in-capmkt:NatureOfReportStandaloneConsolidated contextRef="OneD">Consolidated<',
      '<in-capmkt:NatureOfReportStandaloneConsolidated contextRef="OneD">Standalone<');
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'),
    /verschiedene Konsolidierungskreise/);
});

test('eine dokumentweite Pflichtangabe darf nicht zweierlei sagen', () => {
  const kaputt = lies('OFSS-fy2025-cons.xml').replace(
    '<in-capmkt:DateOfEndOfFinancialYear contextRef="OneD">2025-03-31<',
    '<in-capmkt:DateOfEndOfFinancialYear contextRef="FourD">2024-03-31</in-capmkt:DateOfEndOfFinancialYear>'
    + '<in-capmkt:DateOfEndOfFinancialYear contextRef="OneD">2025-03-31<');
  assert.throws(() => M.bauJahr(kaputt, 'OFSS.NS', 'Consolidated'),
    /sagt an zwei Stellen der Datei Verschiedenes/);
});

test('fehlt ein Wareneinsatz-Posten ganz, gibt es keinen Rohertrag (nicht "als 0 gerechnet")', () => {
  // Ein fehlendes Tag wie 0 zu behandeln unterzeichnet den Wareneinsatz. Bei KALYANKJIL
  // waere der Rohertrag dann um 2.542,71 Mio. zu hoch — genau die Zahl, die der
  // Auftrags-Anker nennt. Lieber kein Wert.
  const ohneZukauf = lies('KALYANKJIL-fy2025-cons.xml')
    .replace(/<in-capmkt:PurchasesOfStockInTrade[\s\S]*?<\/in-capmkt:PurchasesOfStockInTrade>/g, '');
  const j = M.bauJahr(ohneZukauf, 'KALYANKJIL.NS', 'Consolidated');
  assert.equal(j.werte.annualGrossProfit, null);
  assert.notEqual(j.werte.annualGrossProfit, 35385260000);
  // Gegenprobe: mit allen drei Posten kommt der Wert wie gehabt an.
  assert.equal(M.bauJahr(lies('KALYANKJIL-fy2025-cons.xml'), 'KALYANKJIL.NS', 'Consolidated')
    .werte.annualGrossProfit, 32842550000);
});

test('die laufenden Nummern der beiden Listen werden nicht quer verglichen', () => {
  // seqNumber der alten Liste laeuft siebenstellig, seq_Id der Integrated Filings
  // fuenf-/sechsstellig. Quer verglichen gewinnt bei Zeitgleichstand strukturell IMMER die
  // alte Liste — und der eigentlich vorgesehene Stich zugunsten der neueren waere tot.
  const zeit = '25-Apr-2025 08:39:47';
  const gewaehlt = M.waehleMeldungen(
    [{ type: 'Integrated Filing- Financials', consolidated: 'Consolidated', qe_Date: '31-MAR-2025',
      xbrl: 'https://x/corporate/xbrl/NEU.xml', creation_Date: zeit, broadcast_Date: zeit, seq_Id: '87033' }],
    [{ consolidated: 'Consolidated', cumulative: 'Cumulative', financialYear: '01-Apr-2024 To 31-Mar-2025',
      xbrl: 'https://x/corporate/xbrl/ALT.xml', exchdisstime: zeit, broadCastDate: zeit, seqNumber: '9999999' }],
  );
  assert.equal(gewaehlt.get('2025-03-31').url, 'https://x/corporate/xbrl/NEU.xml');
});

test('ein Feld, das in einem aelteren Jahr aus einem ANDEREN Begriff kaeme, wird geleert', () => {
  // EquityAttributableToOwnersOfParent (Mutter) gegen Equity (inkl. Minderheiten) sind zwei
  // Begriffe. Ein Wechsel mitten in der Reihe erzeugt einen Sprung, den der Zyklus-Daempfer
  // als echte Bewegung liest — deshalb Luecke statt Sprung.
  const bau = (fyEnde, wert, name) => {
    const j = { fiscalYearEnd: fyEnde, werte: {}, feldwahl: {} };
    for (const f of M.FELD_NAMEN) { j.werte[f] = null; j.feldwahl[f] = null; }
    j.werte.annualEquity = wert;
    j.feldwahl.annualEquity = name + ' [OneI]';
    return j;
  };
  const jahre = [
    bau('2025-03-31', 48035780000, 'EquityAttributableToOwnersOfParent'),
    bau('2024-03-31', 41877670000, 'Equity'),
  ];
  const meldungen = M.vereinheitlicheBegriffe(jahre);
  assert.equal(jahre[1].werte.annualEquity, null);
  assert.equal(jahre[0].werte.annualEquity, 48035780000, 'das fuehrende Jahr bleibt unberuehrt');
  assert.equal(meldungen.length, 1);
  assert.match(meldungen[0], /annualEquity kaeme aus "Equity"/);
  // Gegenprobe: derselbe Begriff in beiden Jahren muss DURCHGEHEN.
  const gleich = [
    bau('2025-03-31', 48035780000, 'EquityAttributableToOwnersOfParent'),
    bau('2024-03-31', 41890570000, 'EquityAttributableToOwnersOfParent'),
  ];
  assert.equal(M.vereinheitlicheBegriffe(gleich).length, 0);
  assert.equal(gleich[1].werte.annualEquity, 41890570000);
});

// ══════════════════════════════════════════════════════════════════════════════════════
//  7. SCHEMA-WAECHTER — Ende-zu-Ende ohne Netz
// ══════════════════════════════════════════════════════════════════════════════════════
// Die Fixture-Dateien decken drei OFSS-Jahre ab; alle uebrigen Abrufe scheitern absichtlich,
// damit auch der Luecken-Pfad mitlaeuft.
const XBRL_FIXTURES = {
  '1425360': 'OFSS-fy2025-cons.xml',      // Integrated Filing GJ2025
  '104685': 'OFSS-fy2024-cons.xml',       // Jahresergebnis GJ2024 (alte Taxonomie)
  '69689': 'OFSS-fy2021-cons.xml',        // Jahresergebnis GJ2021 (undeklarierte Kontexte)
};
function fakeFetch(url) {
  if (/^https:\/\/www\.nseindia\.com\/(?:$|companies-listing)/.test(url)) {
    return Promise.resolve({ code: 200, body: Buffer.from('<html/>'), headers: { 'set-cookie': ['bm_sz=abc; Path=/'] } });
  }
  const sym = (/symbol=([^&]+)/.exec(url) || [])[1];
  if (/integrated-filing-results/.test(url)) {
    return Promise.resolve({ code: 200, body: Buffer.from(JSON.stringify({ data: listen(decodeURIComponent(sym)).integrated })), headers: {} });
  }
  if (/corporates-financial-results/.test(url)) {
    return Promise.resolve({ code: 200, body: Buffer.from(JSON.stringify({ data: listen(decodeURIComponent(sym)).jahres })), headers: {} });
  }
  for (const [id, datei] of Object.entries(XBRL_FIXTURES)) {
    if (url.includes(`_${id}_`)) return Promise.resolve({ code: 200, body: Buffer.from(lies(datei)), headers: {} });
  }
  return Promise.reject(new Error(`${url} -> HTTP 404 (nicht wiederholbar)`));
}

const PFLICHTFELDER = ['source', 'accountingStandard', 'consolidation', 'reportingCurrencyOriginal',
  'fiscalYearEnd', 'levelOfRounding', 'derived', 'feldwahl', 'nfy', 'generatedAt', 'fys'];

testAsync('main() schreibt eine Datei im Schema der Geschwisterdateien', async () => {
  const tmp = path.join(os.tmpdir(), `in-secannual-test-${process.pid}.json`);
  try { fs.unlinkSync(tmp); } catch (_) { /* gab es noch nicht */ }
  // Ein Ticker ueber der Mindesttiefe ist ein GRUENER Lauf, auch wenn einzelne Jahre fehlen —
  // ein fehlendes Jahr steht schlicht nicht in `fys` und kann mit keinem Wert verwechselt
  // werden. Waere das rot, waere der Lauf dauerhaft rot und damit als Alarm wertlos.
  await M.main({ fetchBuffer: fakeFetch, out: tmp, tickers: ['OFSS.NS'] });
  const j = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);

  const e = j['OFSS.NS'];
  assert.ok(e, 'OFSS.NS fehlt in der Ausgabe');
  for (const f of PFLICHTFELDER) assert.ok(f in e, `Pflichtfeld ${f} fehlt`);
  assert.equal(e.accountingStandard, 'IND-AS');
  assert.equal(e.consolidation, 'CFS');
  assert.equal(e.reportingCurrencyOriginal, 'INR');
  assert.deepEqual(e.fys, [2025, 2024, 2021]);
  assert.equal(e.nfy, 2025);
  assert.equal(e.fiscalYearEnd, '2025-03-31');
  for (const feld of M.FELD_NAMEN) {
    assert.ok(Array.isArray(e[feld]), `${feld} ist kein Array`);
    assert.equal(e[feld].length, e.fys.length, `${feld} passt nicht zur Jahresachse`);
    for (const p of e[feld]) {
      assert.ok(p && typeof p === 'object' && 'value' in p, `${feld}: {value:…}-Form verletzt`);
      assert.ok(p.value === null || Number.isFinite(p.value), `${feld}: weder null noch Zahl`);
    }
  }
  assert.equal(e.annualRev[0].value, OFSS_KONZERN_REV);
  assert.equal(e.annualRev[1].value, OFSS_FY2024_REV);
  // GJ2021 hat keine Bilanz — null, niemals 0 und niemals aus dem Nachbarjahr.
  assert.equal(e.annualAssets[2].value, null);
  assert.equal(e.annualAssets[1].value, 99357410000);
  // Die verworfenen Jahre stehen MIT Grund in der Datei, nicht nur im Log.
  assert.ok(Array.isArray(e.luecken) && e.luecken.length === 6, `luecken=${JSON.stringify(e.luecken)}`);
  assert.ok(e.luecken.every((l) => /^\d{4}-\d{2}-\d{2}: /.test(l)));
});

testAsync('main() wird laut, wenn ein Ticker unter die Mindesttiefe faellt', async () => {
  // Kein einziges Jahr abrufbar -> der Ticker faellt aus, und DAS muss der Lauf melden.
  const nurListen = (url) => (/xbrl/.test(url) && !/api\//.test(url)
    ? Promise.reject(new Error('HTTP 404 (nicht wiederholbar)')) : fakeFetch(url));
  const tmp = path.join(os.tmpdir(), `in-secannual-leer-${process.pid}.json`);
  await assert.rejects(() => M.main({ fetchBuffer: nurListen, out: tmp, tickers: ['OFSS.NS'] }),
    /unvollstaendig[\s\S]*Jahre verwertbar/);
  fs.unlinkSync(tmp);
});

testAsync('eine Antwort ohne data-Liste wird laut, nicht zu einer leeren Firma', async () => {
  // Eine Drosselungs-/Fehlerantwort saehe sonst aus wie "diese Firma hat keine Meldungen".
  const kaputt = (url) => (/\/api\//.test(url)
    ? Promise.resolve({ code: 200, body: Buffer.from('{"status":"error"}'), headers: {} })
    : fakeFetch(url));
  const tmp = path.join(os.tmpdir(), `in-secannual-nodata-${process.pid}.json`);
  await assert.rejects(() => M.main({ fetchBuffer: kaputt, out: tmp, tickers: ['OFSS.NS'] }),
    /Antwort ohne verwertbare data-Liste/);
  fs.unlinkSync(tmp);
});

testAsync('ein abgelaufener Cookie wird einmal aufgefrischt statt den Ticker zu verlieren', async () => {
  // LIVE GEMESSEN am Probelauf 19.08.2026: nach rund 35 Minuten beantwortete NSE jeden Abruf
  // mit ECONNRESET — 16 von 53 Namen fielen aus. Ohne Auffrischung ist der Adapter nur fuer
  // kurze Laeufe brauchbar.
  let bootstraps = 0, abgelaufen = true;
  const mitAblauf = (url) => {
    if (/^https:\/\/www\.nseindia\.com\/(?:$|companies-listing)/.test(url)) {
      bootstraps += 1;
      if (bootstraps >= 3) abgelaufen = false;   // der zweite Bootstrap (2 Seiten) heilt sie
      return fakeFetch(url);
    }
    if (abgelaufen && /\/api\//.test(url)) return Promise.reject(new Error('read ECONNRESET'));
    return fakeFetch(url);
  };
  const tmp = path.join(os.tmpdir(), `in-secannual-cookie-${process.pid}.json`);
  await M.main({ fetchBuffer: mitAblauf, out: tmp, tickers: ['OFSS.NS'] });
  const j = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  assert.equal(bootstraps, 4, 'genau eine Auffrischung (je zwei Aufwaerm-Seiten)');
  assert.ok(j['OFSS.NS'], 'der Ticker muss nach der Auffrischung ankommen');
  assert.equal(j['OFSS.NS'].annualRev[0].value, OFSS_KONZERN_REV);
});

testAsync('main() bricht laut ab, wenn der Cookie-Bootstrap nichts liefert', async () => {
  const ohneCookie = (url) => (/^https:\/\/www\.nseindia\.com\/(?:$|companies-listing)/.test(url)
    ? Promise.resolve({ code: 200, body: Buffer.from('<html/>'), headers: {} })
    : Promise.reject(new Error('haette nie aufgerufen werden duerfen')));
  const tmp = path.join(os.tmpdir(), `in-secannual-boot-${process.pid}.json`);
  await assert.rejects(() => M.main({ fetchBuffer: ohneCookie, out: tmp, tickers: ['OFSS.NS'] }),
    /Bootstrap ohne Cookie/);
});

// Die beiden async-Tests laufen ueber eine Warteschlange, damit der Zaehler stimmt.
(async () => {
  for (const [name, fn] of ASYNC) {
    try { await fn(); pass += 1; console.log(`  ok   ${name}`); }
    catch (e) { fail += 1; console.error(`FAIL   ${name}\n       ${e.message}`); }
  }
  console.log(`\n${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
