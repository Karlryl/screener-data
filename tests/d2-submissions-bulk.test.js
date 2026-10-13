'use strict';
// tests/d2-submissions-bulk.test.js — Waechter des D2-Delisting-Strangs
// (ENTSCHIED 23). Synthetische Fixtures, kein Netz. Bloecke 1-8 fassen kein ZIP an;
// Block 9 (T186) braucht eines und baut es sich per tests/helpers/zip-fixture.js
// selbst — ein echtes Archiv, weil der Parse-Verlust genau beim Lesen entsteht.
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
//  (9) T186 — Parse-Verlust-Zaehler: ein unlesbarer Eintrag MUSS gezaehlt werden
//      (Anwesenheit) und ein lesbarer Bestand darf den Zaehler NICHT heben
//      (Abwesenheit). Gepinnt am Objekt: scanZip laeuft ueber ein echtes ZIP.
// (10) T187 — Persistenz-Regel: status 0 (nicht erreicht) darf NIE in den
//      Ergebnis-Store, jeder echte HTTP-Status schon.
// (11) Vier Klassen: ein fehlgeschlagener Abruf ist fehlende Abdeckung, nie eine
//      Rechtsgrundlage (Review-Fund 30.08.).
// (12) Der Parse-Verlust-Satz: "nicht gemessen" nie als gemessene 0.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractForm25, classifyRuleProvision, rawDocName, istSelbstEinreichung, windowMass, scanZip, istPersistierbar, provisionKlasse, parseVerlustSatz, ABORT_THRESHOLD_PCT, WINDOW_FROM, WINDOW_TO } = require('../scripts/d2-submissions-bulk.js');
const { baueZip } = require('./helpers/zip-fixture.js');

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

// (9) T186 — der Parse-Verlust-Zaehler, am Objekt gepinnt.
// Vorher stand in scanZip ein zaehlerloses `catch (_) { continue; }`: ein unlesbarer
// Eintrag fiel still aus jeder Zaehlung, und §6 des publizierten Berichts konnte die
// dritte Ursache der Zaehl-Diskrepanz weder ein- noch ausschliessen. Der Test faehrt
// deshalb ein echtes Archiv — ein Mock, der Zahlen zurueckgibt, koennte den Fehler
// nicht machen, um den es geht.
const CIK_NAME = (n) => 'CIK' + String(n).padStart(10, '0') + '.json';
const TREFFER_EINTRAG = JSON.stringify({
  cik: '0000000001',
  filings: { recent: {
    form: ['25-NSE'], filingDate: ['2021-05-04'],
    acceptanceDateTime: ['2021-05-04T09:00:00.000Z'],
    accessionNumber: ['0000000001-21-000001'], primaryDocument: ['primary_doc.xml'],
  } },
});
// Kaputt, aber MIT dem Vorfilter-Praefix '"25 — sonst wuerde der Eintrag gar nicht
// erst geparst und der Zaehler bliebe zu Recht auf 0. Genau diese Kombination ist
// der Pruefstein: vorgefiltert, also gezaehlt, aber unlesbar.
const KAPUTTER_EINTRAG = '{"cik":"0000000002","filings":{"recent":{"form":["25-NSE"';
const OHNE_25 = JSON.stringify({ cik: '0000000003', filings: { recent: { form: ['10-K'], filingDate: ['2021-01-01'] } } });

async function testParseVerlustZaehler() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-scan-'));
  try {
    const mitKaputt = [
      { name: CIK_NAME(1), inhalt: TREFFER_EINTRAG },
      { name: CIK_NAME(2), inhalt: KAPUTTER_EINTRAG },
      { name: CIK_NAME(3), inhalt: OHNE_25 },
      { name: 'other.txt', inhalt: 'kein CIK-Eintrag' },
    ];
    const zipA = path.join(tmp, 'mit-kaputt.zip');
    fs.writeFileSync(zipA, baueZip(mitKaputt));
    const a = await scanZip({ zipPath: zipA, hitsPath: path.join(tmp, 'hits-a.jsonl') });
    // ANWESENHEIT: der unlesbare Eintrag wird gezaehlt, nicht verschluckt.
    assert.strictEqual(a.parseFehler, 1, 'ein unlesbarer Eintrag MUSS als parseFehler stehen');
    assert.strictEqual(a.eintraege, 3, 'other.txt ist per entryFilter draussen');
    assert.strictEqual(a.geparst, 2, 'nur die beiden Eintraege mit dem Vorfilter-Praefix werden geparst');
    assert.strictEqual(a.trefferZeilen, 1, 'der intakte Treffer bleibt trotz kaputtem Nachbarn erhalten');

    // ABWESENHEIT: derselbe Bestand ohne den kaputten Eintrag darf den Zaehler NICHT heben.
    const zipB = path.join(tmp, 'ohne-kaputt.zip');
    fs.writeFileSync(zipB, baueZip(mitKaputt.filter((d) => d.name !== CIK_NAME(2))));
    const b = await scanZip({ zipPath: zipB, hitsPath: path.join(tmp, 'hits-b.jsonl') });
    assert.strictEqual(b.parseFehler, 0, 'ohne kaputten Eintrag MUSS der Zaehler 0 bleiben — sonst zaehlt er etwas anderes');
    assert.strictEqual(b.trefferZeilen, 1, 'die Trefferzahl haengt nicht am Zaehler');
    console.log('  ok  T186 Parse-Verlust-Zaehler (1 bei kaputtem Eintrag, 0 ohne)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// (11) Review-Fund 30.08.: ein fehlgeschlagener Abruf ist keine Rechtsgrundlage.
// Bis heute fielen 403/404/429/5xx in denselben Topf wie ein gelesenes Dokument mit
// abweichender Grundlage — eine SEC-Sperre waere im Bericht als dritte Rechtsgrundlage
// erschienen und haette ausgerechnet die Praemissen-Korrektur getragen, um die es geht.
function testVierKlassen() {
  assert.strictEqual(provisionKlasse(undefined), 'nichtGeholt', 'nie versucht = nicht geholt');
  assert.strictEqual(provisionKlasse({ status: 403, klasse: 'unknown', roh: null }), 'nichtAbrufbar',
    'ein geblockter Abruf ist FEHLENDE ABDECKUNG, keine Rechtsgrundlage');
  assert.strictEqual(provisionKlasse({ status: 500, klasse: 'unknown', roh: null }), 'nichtAbrufbar');
  assert.strictEqual(provisionKlasse({ status: 200, klasse: 'b', roh: '12d2-2(b)' }), 'b');
  assert.strictEqual(provisionKlasse({ status: 200, klasse: 'c', roh: '12d2-2(c)' }), 'c');
  assert.strictEqual(provisionKlasse({ status: 200, klasse: 'unknown', roh: '12d2-2(a)(1)' }), 'andereRechtsgrundlage',
    'GELESEN mit anderer Grundlage bleibt der eigene Topf — sonst misst die Spalte nichts mehr');
  console.log('  ok  vier Klassen: nicht geholt / nicht abrufbar / b / c / andere');
}

// (12) Der Parse-Verlust-Satz: "nicht gemessen" darf nie wie eine gemessene 0 aussehen.
function testParseVerlustSatz() {
  assert.match(parseVerlustSatz(null), /NICHT GEMESSEN/, 'ohne Kennzahlen ist die Zahl unbekannt');
  assert.match(parseVerlustSatz({ geparst: 9 }), /NICHT GEMESSEN/, 'Kennzahlen ohne Zaehler = nicht gemessen');
  assert.doesNotMatch(parseVerlustSatz({ geparst: 9 }), /AUSGESCHLOSSEN/, 'nicht gemessen schliesst nichts aus');
  const null_gemessen = parseVerlustSatz({ geparst: 9, parseFehler: 0 });
  assert.match(null_gemessen, /AUSGESCHLOSSEN/, 'eine gemessene 0 schliesst die Ursache aus');
  assert.doesNotMatch(null_gemessen, /NICHT GEMESSEN/);
  assert.match(parseVerlustSatz({ geparst: 9, parseFehler: 2 }), /Untergrenzen/, 'Verluste machen die Zahlen zu Untergrenzen');
  assert.match(parseVerlustSatz({ geparst: 9, parseFehler: 0, leseFehler: 3 }), /entpacken/,
    'nicht entpackbare Eintraege sind eine eigene Klasse und muessen im Satz stehen');
  console.log('  ok  Parse-Verlust-Satz (gemessen 0 / gemessen N / nicht gemessen / Lesefehler)');
}

// (10) T187 — status 0 ist fehlende Abdeckung, kein Befund.
function testPersistenzRegel() {
  assert.strictEqual(istPersistierbar(0), false, 'status 0 = nicht erreicht — darf NIE in den Store');
  assert.strictEqual(istPersistierbar(200), true, 'ein geholtes Dokument wird persistiert');
  assert.strictEqual(istPersistierbar(404), true, 'ein echter HTTP-Status ist ein Befund, kein Netzfehler');
  console.log('  ok  T187 Persistenz-Regel (0 nein, 200/404 ja)');
}

async function main() {
  console.log('tests/d2-submissions-bulk.test.js');
  testFensterUndFormular();
  testKeinExchangeLeck();
  testUrsachenSplit();
  testVorfilterObermenge();
  testRohDokumentPfad();
  testUeberlaufBezifferung();
  testDoppelanhang();
  testSchwelleVorabFixiert();
  await testParseVerlustZaehler();
  testPersistenzRegel();
  testVierKlassen();
  testParseVerlustSatz();
  console.log('ALLE D2-WAECHTER GRUEN');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { main };
