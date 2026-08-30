'use strict';
// tests/d2-submissions-bulk.test.js — Waechter des D2-Delisting-Strangs
// (ENTSCHIED 23). Synthetische Fixtures, kein Zip, kein Netz.
//
// Gepinnt wird die SACHE, nicht ein Textmuster:
//  (1) Fenster-/Formularschnitt: nur 25 und 25-NSE, nur 2019-01-01..2024-12-31.
//  (2) exchanges[]-Leck-Wache: der Ausgabesatz darf NIE Boersen-Identitaet
//      tragen (bindende Sperr-Auflage). Beide Richtungen: echte Ausgabe passiert,
//      ein absichtlich vergifteter Satz MUSS die Wache ausloesen.
//  (3) Ursachen-Split (b)/(c)/unknown aus <ruleProvision>.
//  (4) Vorfilter-Obermenge: der billige Rohtext-Vorfilter '"25' darf einen
//      echten Treffer NIE ueberspringen.
//  (5) Roh-Dokumentpfad: der XSL-Viewer liefert HTML ohne <ruleProvision> —
//      wer ihn abruft, bekaeme stillschweigend 100 % „unbekannt".
//  (6) Doppelanhang-Trennregel: Einreicher-Kopie vs. Emittenten-Seite, rein
//      arithmetisch ueber das Accession-Praefix (keine Boersen-Identitaet).
//  (7) Ueberlauf-Bezifferung: Shards, die das Fenster schneiden, werden gezaehlt.
//  (8) Abbruchschwelle vorab fixiert, Verdikt haengt am Boden nicht an der Decke.
const assert = require('assert');
const { extractForm25, classifyRuleProvision, rawDocName, istSelbstEinreichung, windowMass, ABORT_THRESHOLD_PCT, WINDOW_FROM, WINDOW_TO } = require('../scripts/d2-submissions-bulk.js');

function fixtureSubmissions() {
  return {
    cik: '0000886158',
    name: 'Testcorp',
    // Genau die Felder, die NIE in die Ausgabe duerfen:
    exchanges: ['NASDAQ', 'NYSE'],
    tickers: ['TSTC'],
    filings: {
      recent: {
        form: ['10-K', '25-NSE', '25', '8-K', '25-NSE', '253G2'],
        filingDate: ['2020-03-01', '2023-07-10', '2021-05-04', '2022-01-01', '2018-06-30', '2021-02-02'],
        acceptanceDateTime: ['2020-03-01T16:00:00.000Z', '2023-07-10T17:12:00.000Z', '2021-05-04T09:00:00.000Z', '2022-01-01T12:00:00.000Z', '2018-06-30T10:00:00.000Z', '2021-02-02T08:00:00.000Z'],
        accessionNumber: ['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5'],
        primaryDocument: ['x.htm', 'primary_doc.xml', 'primary_doc.xml', 'y.htm', 'primary_doc.xml', 'z.htm'],
      },
      files: [
        { name: 'CIK0000886158-submissions-001.json', filingFrom: '2015-01-02', filingTo: '2019-04-04', filingCount: 1000 },
        { name: 'CIK0000886158-submissions-002.json', filingFrom: '2001-01-02', filingTo: '2014-12-31', filingCount: 1000 },
      ],
    },
  };
}

// Die Wache selbst: kein Ausgabesatz darf Boersen-Identitaet tragen — weder als
// Schluessel noch als Wert. Sie prueft das OBJEKT, nicht einen Feldnamen-String.
const EXCHANGE_TOKENS = ['NASDAQ', 'NYSE', 'NYSEAMER', 'CBOE', 'OTC'];
function assertNoExchangeLeak(rows) {
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      assert.ok(!/exchange/i.test(k), 'Exchange-Leck im Schluessel: ' + k);
      if (typeof v === 'string' && EXCHANGE_TOKENS.includes(v.toUpperCase())) {
        throw new assert.AssertionError({ message: 'Exchange-Leck im Wert: ' + k + '=' + v });
      }
      if (Array.isArray(v)) {
        for (const e of v) {
          if (typeof e === 'string' && EXCHANGE_TOKENS.includes(e.toUpperCase())) {
            throw new assert.AssertionError({ message: 'Exchange-Leck im Array: ' + k });
          }
        }
      }
    }
  }
}

function testFensterUndFormular() {
  const r = extractForm25(fixtureSubmissions(), WINDOW_FROM, WINDOW_TO);
  const got = r.hits.map((h) => h.form + '@' + h.filingDate).sort();
  assert.deepStrictEqual(got, ['25-NSE@2023-07-10', '25@2021-05-04'],
    'Erwartet genau die zwei Treffer im Fenster (2018er 25-NSE raus, 253G2 raus, 10-K/8-K raus). Bekommen: ' + JSON.stringify(got));
  assert.strictEqual(r.hits[0].acceptanceDateTime, '2023-07-10T17:12:00.000Z', 'Annahmezeitstempel muss mitgefuehrt werden (R6-Disziplin)');
  assert.strictEqual(r.hits[0].cik, 886158, 'CIK muss numerisch aus dem Objekt kommen');
  console.log('  ok  Fenster-/Formularschnitt');
}

function testKeinExchangeLeck() {
  const r = extractForm25(fixtureSubmissions(), WINDOW_FROM, WINDOW_TO);
  // Richtung 1: die echte Ausgabe MUSS sauber sein.
  assertNoExchangeLeak(r.hits);
  // Richtung 2 — absichtlicher Bruch: die Wache MUSS feuern, sonst ist sie tot.
  const vergiftet = r.hits.map((h) => Object.assign({}, h, { exchanges: ['NASDAQ'] }));
  assert.throws(() => assertNoExchangeLeak(vergiftet), /Exchange-Leck/,
    'Die Exchange-Wache hat einen vergifteten Satz durchgelassen — sie ist wirkungslos.');
  const vergiftet2 = r.hits.map((h) => Object.assign({}, h, { boerse: 'NASDAQ' }));
  assert.throws(() => assertNoExchangeLeak(vergiftet2), /Exchange-Leck/,
    'Die Wache prueft nur Feldnamen, nicht Werte — Umbenennen wuerde sie umgehen.');
  console.log('  ok  exchanges[]-Leck-Wache (beide Richtungen, einmal absichtlich gebrochen)');
}

function testUrsachenSplit() {
  assert.strictEqual(classifyRuleProvision('<ruleProvision>17 CFR 240.12d2-2(b)</ruleProvision>').klasse, 'b');
  assert.strictEqual(classifyRuleProvision('<ruleProvision>17 CFR 240.12d2-2(c)</ruleProvision>').klasse, 'c');
  // Zeilenumbrueche/Whitespace im XML duerfen den Split nicht kippen:
  assert.strictEqual(classifyRuleProvision('<ruleProvision>\n  17 CFR 240.12d2-2 ( c )\n</ruleProvision>').klasse, 'c');
  // Dritte Rechtsgrundlage und fehlendes Feld sind BEIDE unknown, aber der
  // Rohtext bleibt erhalten — „unknown" darf nichts stillschweigend schlucken.
  const a = classifyRuleProvision('<ruleProvision>17 CFR 240.12d2-2(a)(3)</ruleProvision>');
  assert.strictEqual(a.klasse, 'unknown');
  assert.match(a.roh, /12d2-2\(a\)/);
  assert.strictEqual(classifyRuleProvision('<foo/>').klasse, 'unknown');
  assert.strictEqual(classifyRuleProvision('<foo/>').roh, null);
  console.log('  ok  ruleProvision-Ursachen-Split (b)/(c)/unknown');
}

function testVorfilterObermenge() {
  // Der Scan ueberspringt jede Datei ohne '"25' im Rohtext. Wenn ein echter
  // Treffer diesen Vorfilter nicht ausloest, verschwindet er lautlos.
  const buf = Buffer.from(JSON.stringify(fixtureSubmissions()), 'utf8');
  assert.ok(buf.indexOf('"25') !== -1, 'Vorfilter wuerde einen echten Treffer ueberspringen');
  const ohne = JSON.parse(JSON.stringify(fixtureSubmissions()));
  ohne.filings.recent.form = ['10-K', '8-K', '10-Q', '4', '3'];
  ohne.filings.recent.accessionNumber = ['b-1', 'b-2', 'b-3', 'b-4', 'b-5'];
  assert.strictEqual(extractForm25(ohne, WINDOW_FROM, WINDOW_TO).hits.length, 0);
  console.log('  ok  Vorfilter-Obermenge');
}

function testRohDokumentPfad() {
  // Der XSL-Viewer-Pfad liefert HTML OHNE <ruleProvision> — wer ihn holt, bekommt
  // stillschweigend 100 % „unknown". An BBBY verifiziert (10.126 B HTML vs. 1.080 B XML).
  assert.strictEqual(rawDocName('xslF25X02/primary_doc.xml'), 'primary_doc.xml');
  assert.strictEqual(rawDocName('xslF25X01/primary_doc.xml'), 'primary_doc.xml');
  assert.strictEqual(rawDocName('primary_doc.xml'), 'primary_doc.xml');
  assert.strictEqual(rawDocName(null), 'primary_doc.xml');
  // Absichtlicher Bruch: das HTML des Viewers DARF nicht als (b)/(c) klassifiziert werden.
  assert.strictEqual(classifyRuleProvision('<html><title>NOTIFICATION OF REMOVAL 12d2-2(b)</title></html>').klasse, 'unknown',
    'Ohne <ruleProvision>-Tag darf nichts klassifiziert werden — sonst zaehlt Viewer-HTML als Ursache');
  console.log('  ok  Roh-Dokumentpfad (XSL-Viewer-Falle)');
}

function testUeberlaufBezifferung() {
  const r = extractForm25(fixtureSubmissions(), WINDOW_FROM, WINDOW_TO);
  assert.strictEqual(r.hatUeberlauf, true);
  // Shard 001 (bis 2019-04-04) schneidet das Fenster, Shard 002 (bis 2014) nicht.
  assert.strictEqual(r.ueberlaufImFenster, 1, 'Der blinde Fleck muss exakt beziffert werden, nicht geschaetzt');
  console.log('  ok  Ueberlauf-Bezifferung');
}

function testDoppelanhang() {
  // Echte Faelle aus dem Lauf: BBBY (Nasdaq reichte ein) ist Subjekt-Seite,
  // die Nasdaq-eigene Kopie desselben Vorgangs ist Selbst-Einreichung.
  assert.strictEqual(istSelbstEinreichung({ cik: 886158, accessionNumber: '0001354457-23-000478' }), false);
  assert.strictEqual(istSelbstEinreichung({ cik: 1354457, accessionNumber: '0001354457-23-000478' }), true);
  assert.strictEqual(istSelbstEinreichung({ cik: 1418091, accessionNumber: '0000876661-22-000890' }), false);
  // Fuehrende Nullen duerfen die Arithmetik nicht kippen.
  assert.strictEqual(istSelbstEinreichung({ cik: 1750, accessionNumber: '0000001750-20-000001' }), true);
  console.log('  ok  Doppelanhang-Trennregel (Einreicher vs. Subjekt)');
}

function testSchwelleVorabFixiert() {
  const m = windowMass();
  assert.strictEqual(ABORT_THRESHOLD_PCT, 2.5, 'Die Abbruchschwelle ist vorab eingefroren (ENTSCHIED 23.4) — nie nachjustieren');
  // Das Verdikt haengt am BODEN, nicht an der Decke.
  assert.strictEqual(m.verdict, m.floorPct >= ABORT_THRESHOLD_PCT ? 'WEITER' : 'STRANG ABBLASEN');
  assert.ok(m.floorPct < m.ceilingPct, 'Boden muss unter der Decke liegen');
  console.log('  ok  vorab fixierte Abbruchschwelle (Boden-Verdikt ' + m.floorPct + ' % vs. ' + ABORT_THRESHOLD_PCT + ' %)');
}

function main() {
  console.log('tests/d2-submissions-bulk.test.js');
  testFensterUndFormular();
  testKeinExchangeLeck();
  testUrsachenSplit();
  testVorfilterObermenge();
  testRohDokumentPfad();
  testUeberlaufBezifferung();
  testDoppelanhang();
  testSchwelleVorabFixiert();
  console.log('ALLE D2-WAECHTER GRUEN');
}

if (require.main === module) main();
module.exports = { main };
