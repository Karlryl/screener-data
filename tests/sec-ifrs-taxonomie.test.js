'use strict';
/**
 * sec-ifrs-taxonomie.test.js — merge-sec-xbrl.js liest BEIDE Bilanzierungsstandards.
 *
 * BEFUND (19.08.2026): extractSecSeries() las nur facts['us-gaap'] und annualConcept() nur
 * form '10-K'. Auslaendische Emittenten mit US-Notierung reichen 20-F (kanadisch: 40-F) ein
 * und bilanzieren meist nach IFRS — ihre Zahlen liegen bei der SEC, kamen aber nie an.
 * Sichtbar an external-data/sec-secannual.json: 45 der 214 Namen standen als HOHLE
 * Datensaetze ohne eine einzige Zahl im Store.
 *
 * FIXTURES = ECHTE, getrimmte companyfacts (nur Jahresbericht-Formen + fp=FY), live geholt
 * am 19.08.2026 — geprueft: die getrimmten Dateien liefern bitgleich dasselbe Ergebnis wie
 * die Volldateien. Kein Netzwerk.
 *   sec-argx.json  argenx SE          (NL, 20-F, IFRS) — Umsatz-Bestandteil-Falle
 *   sec-gfi.json   Gold Fields Ltd    (ZA, 20-F, IFRS + us-gaap-Altbestand) — Taxonomie-Wahl
 *   sec-dlo.json   DLocal Ltd         (UY, 20-F, IFRS, gar keine us-gaap-Sektion)
 *   sec-micron.json Micron            (US, 10-K, us-gaap) — Regressionsanker
 *
 * Usage: node tests/sec-ifrs-taxonomie.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractSecSeries, ANNUAL_FORMS } = require('../merge-sec-xbrl.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const FIX = path.join(__dirname, 'scoring', 'fixtures');
const lade = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const werte = (arr) => arr.map((x) => x.value);
const argx = extractSecSeries(lade('sec-argx.json'), 'ARGX');
const gfi = extractSecSeries(lade('sec-gfi.json'), 'GFI');
const dlo = extractSecSeries(lade('sec-dlo.json'), 'DLO');
const mu = extractSecSeries(lade('sec-micron.json'), 'MU');

// --- 1) Die drei belegten Testfaelle liefern ueberhaupt Zahlen -----------------
// Werte = die live abgelesenen Abschlusszahlen (USD), neuestes Geschaeftsjahr zuerst.
test('ARGX/GFI/DLO liefern ifrs-full-Jahresreihen mit den belegten Werten', () => {
  assert.equal(argx.taxonomie, 'ifrs-full');
  assert.deepEqual(argx.annual._fys, [2025, 2024, 2023, 2022, 2021, 2018]);
  assert.equal(werte(argx.annual.annualOpInc)[0], 1053806000);      // FY2025 Betriebsergebnis
  assert.equal(werte(argx.annual.annualNetIncome)[0], 1292035000);  // FY2025 Jahresergebnis

  assert.equal(gfi.taxonomie, 'ifrs-full');
  assert.deepEqual(gfi.annual._fys, [2024, 2023, 2022, 2021, 2020, 2019, 2018]);
  assert.equal(werte(gfi.annual.annualRev)[0], 5201600000);         // FY2024 Umsatz
  assert.equal(werte(gfi.annual.annualNetIncome)[0], 1290500000);

  assert.equal(dlo.taxonomie, 'ifrs-full');
  assert.deepEqual(dlo.annual._fys, [2025, 2024, 2023, 2022, 2021]);
  assert.equal(werte(dlo.annual.annualRev)[0], 1093587000);         // FY2025 Umsatz
  assert.equal(werte(dlo.annual.annualOpInc)[0], 219915000);
  assert.equal(werte(dlo.annual.annualGP)[0], 402756000);
});

// --- 1b) Die vier bisher UNGESCHUETZTEN Rollen: OCF, Capex/FCF, Assets, CurrLiab ---
// Review-Fund 19.08.2026: der Taxonomie-Kommentar in merge-sec-xbrl.js belegt ALLE ACHT
// Feldzuordnungen mit gemessenen Zahlen, festgenagelt waren aber nur vier (OpInc, NetInc,
// Rev, GP). OCF/Capex/Assets/CurrLiab konnten sich lautlos verschieben: kein Test wurde rot,
// kein Log feuerte — und Assets/CurrLiab speisen eine Scoring-Achse (roicStability).
// Jeweils NEUESTES Jahr = die im Kommentar belegte Ablesung, die aelteren Jahre = die
// eingefrorene Fixture. Bricht eine der vier Reihen, ist die CI rot.
test('OCF/FCF/Assets/CurrLiab stehen mit den abgelesenen Werten fest (ARGX/GFI/DLO)', () => {
  // ARGX: 6 fy, aber Cashflow und Bilanz erst ab FY2021 -> FY2018 bleibt null.
  // Belegt: OCF FY2025 = 685 Mio.
  assert.deepEqual(werte(argx.annual.annualOCF),
    [685192000, -82747000, -420327000, -862807000, -606812000, null]);
  assert.deepEqual(werte(argx.annual.annualFCF),
    [679027000, -84548000, -421139000, -863644000, -610435000, null]);
  assert.deepEqual(werte(argx.annual.annualAssets),
    [8682698000, 6202522000, 4542458000, 3134261000, 2850274000, null]);
  assert.deepEqual(werte(argx.annual.annualCurrentLiabilities),
    [1320186000, 669916000, 422993000, 302277000, 301239000, null]);

  // GFI: belegt OCF FY2024 = 1607 Mio.
  assert.deepEqual(werte(gfi.annual.annualOCF),
    [1607000000, 1192800000, 1379200000, 1230200000, 1111400000, 845000000, 557800000]);
  assert.deepEqual(werte(gfi.annual.annualFCF),
    [423600000, 138100000, 309900000, 141500000, 527700000, 232500000, -256400000]);
  assert.deepEqual(werte(gfi.annual.annualAssets),
    [10142900000, 8226300000, 7338100000, 7348800000, 7472800000, 6561300000, 6104300000]);
  assert.deepEqual(werte(gfi.annual.annualCurrentLiabilities),
    [1710400000, 1505800000, 785400000, 822400000, 916500000, 1367800000, 615500000]);

  // DLO: belegt OCF FY2025 = 416 Mio. FY2024 ist NEGATIV — wer irgendwo einen Betrag nimmt,
  // faellt hier auf.
  assert.deepEqual(werte(dlo.annual.annualOCF),
    [415457000, -32784000, 293453000, 154451000, 108486000]);
  assert.deepEqual(werte(dlo.annual.annualFCF),
    [413175000, -34489000, 292488000, 153464000, 106537000]);
  assert.deepEqual(werte(dlo.annual.annualAssets),
    [1540964000, 1171329000, 1084453000, 826301000, 583008000]);
  assert.deepEqual(werte(dlo.annual.annualCurrentLiabilities),
    [965910000, 677621000, 625229000, 422272000, 298398000]);

  // Kein zusaetzlicher Laengen-Check: die deepEqual-Reihen oben plus die _fys-Zusage aus
  // Pruefung 1 nageln Laenge, Reihenfolge und Werte schon fest. Ein Laengen-assert daneben
  // koennte nie allein rot werden — ein Pruefer, der nicht scheitern kann, schuetzt nichts.
});

// --- 1c) Das Capex-VORZEICHEN, ausdruecklich ---------------------------------
// merge-sec-xbrl.js rechnet FCF = OCF - Capex und nimmt dabei FEST AN, dass
// PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities den Abfluss POSITIV
// meldet. Kaeme der Wert je negativ (andere IFRS-Konvention, SEC-Aenderung, Refactoring),
// wuerde der freie Cashflow um den doppelten Investitionsbetrag ZU HOCH herauskommen —
// lautlos. Capex ist keine eigene Ausgabereihe, also wird er hier zurueckgerechnet.
const capexAus = (s, i) => werte(s.annual.annualOCF)[i] - werte(s.annual.annualFCF)[i];
test('Capex ist ein POSITIVER Abfluss — FCF liegt nie ueber OCF', () => {
  // Belegte Ablesungen: ARGX FY2025 = 6,2 Mio. · GFI FY2024 = 1183 Mio. · DLO FY2025 = 2,3 Mio.
  assert.equal(capexAus(argx, 0), 6165000);
  assert.equal(capexAus(gfi, 0), 1183400000);
  assert.equal(capexAus(dlo, 0), 2282000);
  // und ueber ALLE Jahre der drei Fixtures: strikt positiv. Ein gedrehtes Vorzeichen macht
  // diesen Test rot, statt den freien Cashflow ins Gegenteil zu drehen.
  for (const [name, s] of [['ARGX', argx], ['GFI', gfi], ['DLO', dlo]]) {
    s.annual._fys.forEach((fy, i) => {
      // Jahr ohne OCF oder ohne Capex -> FCF ist null, es gibt nichts zurueckzurechnen.
      // Abfrage MUSS auf FCF===null gehen: null - null ergibt in JS 0, und 0 haette die
      // Pruefung als "Capex nicht positiv" faelschlich rot gemacht (ARGX FY2018).
      if (werte(s.annual.annualFCF)[i] === null) return;
      const c = capexAus(s, i);
      assert.ok(c > 0, name + ' FY' + fy + ': Capex muss positiv sein (Abfluss), war ' + c);
    });
  }
});

// --- 2) 20-F/40-F sind Jahresberichte ----------------------------------------
// Der Kern des Befunds: ohne diese Formen liefert annualConcept() fuer die drei NICHTS,
// egal welche Taxonomie gelesen wird. Beleg: keiner der drei hat einen 10-K-Eintrag.
test('ANNUAL_FORMS akzeptiert 10-K, 20-F und 40-F — und die drei Ticker haben KEIN 10-K', () => {
  for (const f of ['10-K', '20-F', '40-F']) {
    assert.ok(ANNUAL_FORMS.includes(f), f + ' muss als Jahresbericht gelten');
  }
  // Berichtigungsformen bleiben bewusst draussen (eigener, offener Befund fuer alle Filer).
  assert.ok(!ANNUAL_FORMS.includes('20-F/A'), '20-F/A darf NICHT mitzaehlen');
  assert.ok(!ANNUAL_FORMS.includes('10-K/A'), '10-K/A darf NICHT mitzaehlen');
  const formen = new Set();
  for (const datei of ['sec-argx.json', 'sec-gfi.json', 'sec-dlo.json']) {
    const cf = lade(datei);
    for (const tax of Object.keys(cf.facts)) {
      for (const c of Object.keys(cf.facts[tax])) {
        for (const u of Object.keys(cf.facts[tax][c].units)) {
          for (const x of cf.facts[tax][c].units[u]) formen.add(x.form);
        }
      }
    }
  }
  assert.ok(formen.has('20-F'), 'Fixtures muessen 20-F enthalten, tatsaechlich: ' + [...formen]);
  assert.ok(!formen.has('10-K'), 'kein 10-K bei Auslandsemittenten — genau darum griff der alte Filter nicht');
});

// --- 3) Taxonomie-Wahl: juengstes Jahr, kein blinder us-gaap-Vorrang ----------
test('GFI waehlt ifrs-full, obwohl eine us-gaap-Sektion vorhanden ist (Altbestand bis FY2015, ohne Umsatz)', () => {
  const cf = lade('sec-gfi.json');
  assert.ok(cf.facts['us-gaap'] && Object.keys(cf.facts['us-gaap']).length > 0,
    'Fixture muss eine us-gaap-Sektion tragen, sonst prueft dieser Test nichts');
  // Der us-gaap-Altbestand endet FY2015 und fuehrt gar keinen Umsatz -> blosser us-gaap-Vorrang
  // haette GFI eine neun Jahre alte, umsatzlose Reihe angehaengt und das als Abdeckung gezaehlt.
  assert.equal(gfi.taxonomie, 'ifrs-full');
  assert.ok(gfi.annual._fys[0] >= 2024, 'juengstes Jahr muss aus der aktuellen Taxonomie kommen');
});

// --- 4) Keine Mischung zweier Standards in EINER Reihe ------------------------
test('GFI-Reihen enthalten keinen Wert aus dem us-gaap-Altbestand (kein Standard-Mix)', () => {
  // us-gaap-Altwerte von GFI (aus dem Fixture abgelesen): NetIncomeLoss FY2015 = -345.000.000,
  // Assets FY2015 = 5.513.800.000. Beide duerfen in der ifrs-full-Reihe NICHT auftauchen.
  const ni = werte(gfi.annual.annualNetIncome);
  const as = werte(gfi.annual.annualAssets);
  assert.ok(!ni.includes(-345000000), 'us-gaap-Jahresergebnis FY2015 darf nicht in der IFRS-Reihe stehen');
  assert.ok(!as.includes(5513800000), 'us-gaap-Bilanzsumme FY2015 darf nicht in der IFRS-Reihe stehen');
  assert.ok(Math.min(...gfi.annual._fys) >= 2018,
    'die fy-Achse darf nicht bis in die us-gaap-Jahre reichen, tatsaechlich: ' + gfi.annual._fys.join(','));
});

// --- 5) Herkunft steht am Ergebnis -------------------------------------------
test('taxonomie benennt die Herkunft je Firma (us-gaap fuer den US-Filer)', () => {
  assert.equal(mu.taxonomie, 'us-gaap');
  assert.equal(argx.taxonomie, 'ifrs-full');
  assert.equal(dlo.taxonomie, 'ifrs-full');
});

// --- 6) Kein stiller Fallback: nicht in USD = nicht verfuegbar ----------------
test('reiner Fremdwaehrungs-Melder ergibt taxonomie null und KEINE Nullen', () => {
  // Nachbau des live gemessenen Falls BNTX/STLA: 20-F, fp=FY, aber alle Betraege in EUR.
  const nurEuro = { facts: { 'ifrs-full': {
    Revenue: { units: { EUR: [{ end: '2024-12-31', val: 2750000000, fy: 2024, fp: 'FY', form: '20-F' }] } },
    ProfitLoss: { units: { EUR: [{ end: '2024-12-31', val: 850000000, fy: 2024, fp: 'FY', form: '20-F' }] } },
  } } };
  const s = extractSecSeries(nurEuro, 'EUROCO');
  assert.equal(s.taxonomie, null, 'nicht in USD = nicht verfuegbar, nicht "us-gaap mit leeren Reihen"');
  assert.deepEqual(s.annual._fys, [], 'keine fy-Achse erfinden');
  assert.deepEqual(werte(s.annual.annualRev), [], 'kein einziger Wert — insbesondere keine 0');
});

test('ARGX-Umsatz bleibt leer, weil sein Revenue-Tag nur in EUR steht (Waehrungs-Mix ausgeschlossen)', () => {
  const cf = lade('sec-argx.json');
  assert.ok(Object.keys(cf.facts['ifrs-full'].Revenue.units).join(',') === 'EUR',
    'Fixture-Annahme: ARGX fuehrt Revenue nur in EUR');
  assert.deepEqual(werte(argx.annual.annualRev), [null, null, null, null, null, null],
    'EUR-Umsatz darf nicht neben USD-Zahlen in dieselbe Reihe laufen');
});

// --- 7) Bestandteil NIE in der Rolle der Gesamtgroesse ------------------------
test('ARGX: weder Umsatz-Bestandteil noch Umsatz-plus-sonstige-Ertraege wird als Umsatz ausgegeben', () => {
  const rev = werte(argx.annual.annualRev);
  // FY2023, exakt aus dem Fixture: RevenueFromContractsWithCustomers 35.533.000 (nur der
  // Kollaborations-Teil), RevenueFromSaleOfGoods 1.190.783.000, Gesamtzeile des Abschlusses
  // (RevenueAndOperatingIncome) 1.268.594.000.
  assert.ok(!rev.includes(35533000), 'Bestandteil (35,5 Mio.) darf nie als Gesamtumsatz erscheinen');
  assert.ok(!rev.includes(1190783000), 'Warenumsatz-Bestandteil darf nie als Gesamtumsatz erscheinen');
  assert.ok(!rev.includes(1268594000), 'Umsatz+sonstige betriebliche Ertraege ist eine ANDERE Groesse');
});

// --- 8) US-Regression: der bekannte Anker bleibt unveraendert -----------------
test('Micron (us-gaap, 10-K) unveraendert: 15 Jahre, FY2025-Umsatz 37,378 Mrd., FY2023 OpInc negativ', () => {
  assert.equal(mu.annual._fys.length, 15);
  assert.deepEqual(mu.annual._fys, [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011]);
  assert.equal(werte(mu.annual.annualRev)[0], 37378000000);
  assert.equal(werte(mu.annual.annualOpInc)[2], -5745000000);
});

console.log(`\nsec-ifrs-taxonomie.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
