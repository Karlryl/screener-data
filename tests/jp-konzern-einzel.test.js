'use strict';
/**
 * jp-konzern-einzel — Waechter fuer scripts/build-jpannual.js.
 *
 * DER BEFUND (19.08.2026, an echten EDINET-type=5-Antworten gemessen): jede Datei enthaelt
 * den Konzern- UND den Einzelabschluss, und die Spalte 連結・個別 unterscheidet sie im
 * Fuenf-Jahres-Block NICHT (sie meldet fuer beide その他). Nur die KONTEXT-ID tut es:
 *
 *   7685.T  Umsatz Konzern 100.614.584.000  gegen  Einzel  41.094.087.000  -> 145 %
 *   6834.T  Umsatz Konzern  30.087.881.000  gegen  Einzel  11.103.324.000  -> 171 %
 *   4373.T  Umsatz Konzern  58.682.000.000  gegen  Einzel  12.513.000.000  -> 369 %
 *
 * Wer die Unterscheidung wegnimmt, holt sich eine plausibel aussehende Zahl, die um den
 * Faktor 2,4 bis 4,7 falsch ist. Das ist die teuerste Fehlerklasse dieses Projekts —
 * deshalb ein Waechter statt eines Kommentars.
 *
 * Er prueft die SACHE (die Zahl) und BEIDE Richtungen: die gueltige Form muss durchgehen,
 * die verdrehte muss auffliegen. Die drei Testfirmen sind bewusst so gewaehlt, dass sich
 * Konzern- und Einzelwert NACHWEISLICH unterscheiden — an einer Firma, bei der beide
 * Begriffe betragsgleich sind, wuerde eine Sabotage gruen bleiben und nichts beweisen.
 *
 * Fixtures: tests/fixtures/jp-edinet-{7685,4373,6834}.csv — echte type=5-Antworten,
 * auf die verwendeten Elemente plus je 30 Belegzeilen gekuerzt, UTF-16LE wie im Original,
 * Werte unveraendert. Kein Netz.
 *
 * Run: node tests/jp-konzern-einzel.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  bauJahre, leseZeilen, istKonzern, istEinzel, werteJeVersatz, pruefeKonsolidierung,
  FELD_NAMEN, SP, MIN_BELEGE,
} = require('../scripts/build-jpannual.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok   ${name}`); }
  catch (e) { fail += 1; console.error(`FAIL   ${name}\n       ${e.message}`); }
}

// EDINET liefert UTF-16LE — genau so wird die Fixture gelesen, wie holeCsv() es tut.
const laden = (sec) => leseZeilen(
  fs.readFileSync(path.join(__dirname, 'fixtures', `jp-edinet-${sec}.csv`)).toString('utf16le').replace(/^﻿/, ''),
);

// Amtlich nachrechenbare Werte aus den echten Antworten (JPY).
const FALL = {
  7685: {
    zeilen: laden(7685), periodEnd: '2025-12-31', fy: 2025, standard: 'JGAAP',
    konzern: 100614584000, einzel: 41094087000,
    einzelElement: 'jpcrp_cor:NetSalesSummaryOfBusinessResults',
  },
  6834: {
    zeilen: laden(6834), periodEnd: '2026-03-31', fy: 2026, standard: 'JGAAP',
    konzern: 30087881000, einzel: 11103324000,
    einzelElement: 'jpcrp_cor:NetSalesSummaryOfBusinessResults',
  },
  4373: {
    zeilen: laden(4373), periodEnd: '2026-03-31', fy: 2026, standard: 'IFRS',
    konzern: 58682000000, einzel: 12513000000,
    // Bei einem IFRS-Melder traegt der JGAAP-Umsatzname NUR den Einzelabschluss.
    einzelElement: 'jpcrp_cor:NetSalesSummaryOfBusinessResults',
  },
};
const bau = (sec) => bauJahre(FALL[sec].zeilen, FALL[sec].periodEnd, `${sec}.T`);

// ── Anwesenheit: die richtige Zahl kommt an ───────────────────────────────────────────
for (const sec of Object.keys(FALL)) {
  const f = FALL[sec];
  test(`${sec}.T nimmt den KONZERN-Umsatz, nicht den Einzelabschluss`, () => {
    const j = bau(sec);
    assert.equal(j.fys[0], f.fy);
    assert.equal(j.standard, f.standard);
    assert.equal(j.annualRev[0].value, f.konzern);
    assert.notEqual(j.annualRev[0].value, f.einzel,
      `Einzel waeren ${f.einzel} — Faktor ${(f.konzern / f.einzel).toFixed(2)} daneben, genau die Falle`);
  });

  test(`${sec}.T: Fixture-Kontrolle — der Einzelwert steht wirklich in der Datei und ist verschieden`, () => {
    // Ohne diesen Nachweis koennte der Test an einer Firma haengen, die den Unterschied
    // gar nicht zeigt — dann wuerde jede Sabotage gruen bleiben.
    const einzel = werteJeVersatz(f.zeilen, f.einzelElement, 'EMITTENT', `${sec}.T`).get(0);
    assert.equal(einzel, f.einzel);
    assert.notEqual(f.konzern, f.einzel);
  });
}

test('alle acht Kennzahlen kommen fuer das neueste Jahr an (7685.T)', () => {
  const j = bau(7685);
  assert.equal(FELD_NAMEN.length, 8);
  for (const feld of FELD_NAMEN) {
    assert.ok(Number.isFinite(j[feld][0] && j[feld][0].value), `${feld} fehlt im neuesten Jahr`);
  }
});

// BEIDE Standards einzeln pruefen. Die Elementtabelle hat je einen Eintrag fuer IFRS und
// fuer JGAAP — ein Test an nur einer Firma laesst den anderen Zweig ungeschuetzt. Genau das
// ist beim Sabotage-Durchlauf aufgefallen: der IFRS-Eintrag liess sich auf KONZERN umstellen,
// ohne dass ein Test rot wurde (7685.T ist JGAAP und konnte den Bruch gar nicht zeigen).
for (const [sec, erwartet] of [[7685, 30877880], [4373, 237045100]]) {
  test(`die Aktienzahl kommt aus dem EMITTENTEN-Kontext (${sec}.T, ${FALL[sec].standard})`, () => {
    const j = bau(sec);
    // Eine Aktienzahl ist eine Eigenschaft des Emittenten; im Konzern-Kontext gibt es sie nicht.
    assert.equal(j.annualShares[0].value, erwartet);
    assert.equal(j._feldwahl.annualShares,
      'jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults [EMITTENT]');
    const imKonzern = werteJeVersatz(FALL[sec].zeilen,
      'jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults', 'KONZERN', `${sec}.T`);
    assert.equal(imKonzern.size, 0, 'im Konzern-Kontext duerfte es die Aktienzahl gar nicht geben');
  });
}

test('fehlende Jahre bleiben null — nie 0, nie aus einem Nachbarjahr (7685.T Rohertrag)', () => {
  const j = bau(7685);
  // Rohertrag/Betriebsergebnis stehen nur im Rechenwerk mit zwei Jahren.
  assert.equal(j.annualGrossProfit[0].value, 53290650000);
  assert.equal(j.annualGrossProfit[2].value, null);
  assert.notEqual(j.annualGrossProfit[2].value, 0);
});

test('Zweitquelle: Yahoo-Quartale rekonstruieren 6834.T auf 0,01 % genau', () => {
  // UNABHAENGIGER Gegenbeleg aus board-history/2026-08-19 (Yahoo, USD-konvertiert).
  // Die vier Quartale enden 2026-03-31/2025-12-31/2025-09-30/2025-06-30 und decken damit
  // exakt das EDINET-Geschaeftsjahr zum 31.03.2026 ab.
  const revQ = [62930275.326000005, 50988878.052, 41858341.029, 35126235.552];
  const fx = 0.006345057;
  const yahooJPY = revQ.reduce((a, c) => a + c, 0) / fx;
  const konzern = bau(6834).annualRev[0].value;
  const abw = Math.abs(yahooJPY / konzern - 1);
  assert.ok(abw < 0.0001, `Abweichung ${(abw * 100).toFixed(4)} % zur Zweitquelle`);
  // Und die Einzelzahl waere unmissverstaendlich daneben.
  const abwEinzel = Math.abs(yahooJPY / FALL[6834].einzel - 1);
  assert.ok(abwEinzel > 1, `Einzel laege nur ${(abwEinzel * 100).toFixed(0)} % daneben — zu schwach als Gegenprobe`);
});

// ── Abwesenheit: die verdrehte Form MUSS auffliegen ───────────────────────────────────
test('istKonzern gilt NUR ohne jeden Member-Zusatz — Aufgliederungen sind kein Gesamtwert', () => {
  assert.equal(istKonzern('CurrentYearDuration'), true);
  assert.equal(istKonzern('Prior4YearInstant'), true);
  // Einzelabschluss
  assert.equal(istKonzern('CurrentYearDuration_NonConsolidatedMember'), false);
  // Aufgliederungen: Eigenkapital-BESTANDTEIL, einzelner Aktionaer, Zeilennummer …
  assert.equal(istKonzern('CurrentYearDuration_ShareholdersEquityMember'), false);
  assert.equal(istKonzern('CurrentYearInstant_No1MajorShareholdersMember'), false);
  assert.equal(istKonzern('CurrentYearInstant_OrdinaryShareMember'), false);
  // Kombination aus Einzel UND Bestandteil
  assert.equal(istKonzern('CurrentYearDuration_NonConsolidatedMember_CapitalStockMember'), false);
  // gar kein Jahres-Kontext
  assert.equal(istKonzern('FilingDateInstant'), false);
});

test('istEinzel gilt NUR fuer genau diesen einen Zusatz', () => {
  assert.equal(istEinzel('CurrentYearInstant_NonConsolidatedMember'), true);
  assert.equal(istEinzel('CurrentYearDuration'), false);
  // Einzel PLUS Aufgliederung ist kein Gesamtwert der Einzelgesellschaft
  assert.equal(istEinzel('CurrentYearDuration_NonConsolidatedMember_CapitalStockMember'), false);
});

test('der Waechter wird ROT, wenn ein suffixloser Kontext 個別 meldet', () => {
  const kaputt = FALL[7685].zeilen.map((z) => z.slice());
  const treffer = kaputt.find((z) => z[SP.kontext] === 'CurrentYearDuration');
  assert.ok(treffer, 'Fixture-Kontrolle: suffixlose Zeile vorhanden');
  treffer[SP.kreis] = '個別';
  assert.throws(() => pruefeKonsolidierung('7685.T', kaputt), /Konsolidierungs-Schluessel verletzt/);
});

test('der Waechter wird ROT, wenn _NonConsolidatedMember 連結 meldet', () => {
  const kaputt = FALL[7685].zeilen.map((z) => z.slice());
  const treffer = kaputt.find((z) => z[SP.kontext] === 'CurrentYearDuration_NonConsolidatedMember');
  assert.ok(treffer, 'Fixture-Kontrolle: Einzel-Zeile vorhanden');
  treffer[SP.kreis] = '連結';
  assert.throws(() => pruefeKonsolidierung('7685.T', kaputt), /Konsolidierungs-Schluessel verletzt/);
});

test('der Waechter wird ROT, wenn die Datei die Trennung gar nicht belegt', () => {
  // Eine Datei ohne 個別-Zeilen kann die Regel nicht bestaetigen -> keine stille Annahme.
  const ohneBeleg = FALL[7685].zeilen.filter((z) => z[SP.kreis] !== '個別');
  assert.throws(() => pruefeKonsolidierung('7685.T', ohneBeleg), /NICHT belegbar/);
  // Gegenprobe: mit den Belegen geht dieselbe Datei durch.
  const w = pruefeKonsolidierung('7685.T', FALL[7685].zeilen);
  assert.ok(w.einzelBelegt >= MIN_BELEGE);
});

test('ohne Konzernabschluss-Flag wird die Firma verworfen statt geraten', () => {
  const kaputt = FALL[7685].zeilen.map((z) => z.slice());
  const flag = kaputt.find((z) => z[SP.element] === 'jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI');
  assert.ok(flag, 'Fixture-Kontrolle: DEI-Flag vorhanden');
  flag[SP.wert] = 'false';
  assert.throws(() => bauJahre(kaputt, '2025-12-31', '7685.T'), /kein Konzernabschluss/);
});

test('ein unbekannter Bilanzierungsstandard faerbt rot statt still falsch zu rechnen', () => {
  const kaputt = FALL[7685].zeilen.map((z) => z.slice());
  const std = kaputt.find((z) => z[SP.element] === 'jpdei_cor:AccountingStandardsDEI');
  assert.ok(std, 'Fixture-Kontrolle: Standard-Angabe vorhanden');
  std[SP.wert] = 'US GAAP';
  assert.throws(() => bauJahre(kaputt, '2025-12-31', '7685.T'), /unbekannter Bilanzierungsstandard/);
});

test('zwei verschiedene Werte im selben Kontext sind nicht entscheidbar -> Wurf', () => {
  // Genau das passiert, wenn jemand die Konzern/Einzel-Trennung aufhebt: derselbe
  // Jahres-Versatz traegt dann zwei Zahlen, die um Faktor 2,45 auseinanderliegen.
  const kaputt = FALL[7685].zeilen.map((z) => z.slice());
  const einzelZeile = kaputt.find((z) => z[SP.element] === 'jpcrp_cor:NetSalesSummaryOfBusinessResults'
    && z[SP.kontext] === 'CurrentYearDuration_NonConsolidatedMember');
  assert.ok(einzelZeile);
  einzelZeile[SP.kontext] = 'CurrentYearDuration';       // Einzelwert in den Konzern-Kontext schieben
  assert.throws(() => bauJahre(kaputt, '2025-12-31', '7685.T'), /zwei verschiedene Werte/);
});

test('der TSV-Parser haelt Anfuehrungszeichen und Tabs zusammen', () => {
  const { parseTsv } = require('../scripts/build-jpannual.js');
  const z = parseTsv('"a"\t"b""c"\t"d\te"\r\n"f"\t"g"\t"h"\r\n');
  assert.deepEqual(z[0], ['a', 'b"c', 'd\te']);
  assert.deepEqual(z[1], ['f', 'g', 'h']);
});

console.log(`\n${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
