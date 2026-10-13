'use strict';
/**
 * Waechter gegen Firmen, die als Neuemission gelten, weil sie irgendwo ein zweites Mal
 * notiert sind (Tag 473).
 *
 * DER FEHLER, DEN ES GAB: Zealand Pharma stand am 27.07.2026 auf Rang 1 der Uebersicht —
 * eingestuft als IPO des Jahres 2026 (ipoRecency 'recent'). Die Firma notiert seit dem
 * 23.11.2010 in Kopenhagen. Genommen wurde die WIENER Zweitnotiz, deren erster Handelstag
 * der 31.03.2026 ist.
 *
 * WARUM DER DEDUP DAS NICHT FING: bei zwei Notierungen DERSELBEN Firma sind die ersten drei
 * Sortierschluessel (US-Primaerlisting, Domizil, FX-Verdacht) gleich, und dann entscheidet
 * die marketCap — die sich zwischen zwei Beinen nur um Rundung und Abrufzeitpunkt
 * unterscheidet. Bei Zealand: 3.072,0 gegen 3.083,2 Mio. USD, also 0,36 %. Ein Muenzwurf
 * entschied ueber 16 Jahre Firmenhistorie.
 *
 * AM CI-BESTAND DES LAUFS VOM 27.07. GEMESSEN: 12.490 Snapshots, 475 Emittenten-Gruppen mit
 * mindestens zwei Jahren Abstand im ersten Handelstag, davon SECHS in der Uebersicht — und
 * alle sechs mit der juengeren Notierung: ZEAL.VI (2026 statt 2010), UMI.VI (2018/2000),
 * SBMO.VI (2017/1998), LUG.ST (2014/1996), CEPU (2018/2000), SVM (2017/1996).
 *
 * DIE HEILUNG betrifft NUR das Datum, nicht die Auswahl des Siegers: welches Bein gewinnt,
 * entscheidet sich weiter an Liquiditaet und Datenqualitaet (Bug 7, GFL vs GFL.TO) — ein
 * Eingriff dort traefe alle 2.646 mehrbeinigen Gruppen statt der gemessenen sechs. Das
 * Boersendebuet der FIRMA ist dagegen das frueheste ihrer Notierungen.
 *
 * GEGENPROBE (durchgefuehrt): die Datumsuebernahme im Dedup entfernt -> der Integrationsteil
 * wird rot; ipoYearEffektiv auf das eigene Datum zurueckgesetzt -> die Einheitenfaelle rot.
 *
 * Usage:  node tests/scoring/doppelnotiz-erstnotiz.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, produceRankings, ipoYearEffektiv, ipoRecencyVonJahr } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- Einheitenfaelle: die reine Datumslogik ---

test('das frueheste Datum der Gruppe gewinnt gegen das eigene, spaetere', () => {
  // Der Zealand-Fall in Zahlen.
  assert.equal(ipoYearEffektiv({ firstTradeDate: '2026-03-31T06:55:00.000Z' }, '2010-11-23'), 2010);
});

test('ein eigenes FRUEHERES Datum bleibt gueltig - die Regel ist konservativ', () => {
  // Nie das Alter einer Firma verjuengen, auch nicht durch eine merkwuerdige Gruppe.
  assert.equal(ipoYearEffektiv({ firstTradeDate: '1998-01-05' }, '2017-10-04'), 1998);
});

test('ohne Gruppe aendert sich nichts - Einzelnotierungen bleiben unberuehrt', () => {
  assert.equal(ipoYearEffektiv({ firstTradeDate: '2021-06-01' }, undefined), 2021);
  assert.equal(ipoYearEffektiv({ firstTradeDate: '2021-06-01' }, null), 2021);
  assert.equal(ipoYearEffektiv({ ipoYear: 2015 }, undefined), 2015);
});

test('ein unbrauchbares Gruppendatum kippt nichts um', () => {
  // Der haeufigste Weg, wie eine Datumsregel still Unsinn erzeugt.
  assert.equal(ipoYearEffektiv({ firstTradeDate: '2021-06-01' }, 'kaputt'), 2021);
  assert.equal(ipoYearEffektiv({ firstTradeDate: '2021-06-01' }, ''), 2021);
  assert.equal(ipoYearEffektiv({ firstTradeDate: '2021-06-01' }, 42), 2021);
});

test('ohne eigenes Datum traegt die Gruppe allein', () => {
  assert.equal(ipoYearEffektiv({}, '2003-04-04'), 2003);
  assert.equal(ipoYearEffektiv(null, '2003-04-04'), 2003);
  assert.equal(ipoYearEffektiv({}, undefined), null);
});

test('die Einstufung folgt dem korrigierten Jahr, nicht dem alten', () => {
  // Sonst stuende in der Zeile ein Jahr 2010 neben der Einstufung "recent" — zwei Aussagen
  // ueber dieselbe Firma, die sich widersprechen.
  const bounds = [1995, 2005, 2015, 2021];
  assert.equal(ipoRecencyVonJahr(2026, bounds), 'recent');
  assert.equal(ipoRecencyVonJahr(2010, bounds), 'seasoned');
  assert.equal(ipoRecencyVonJahr(1990, bounds), 'veteran');
  assert.equal(ipoRecencyVonJahr(null, bounds), null);
  assert.equal(ipoRecencyVonJahr(2010, null), null);
});

// --- Integration: greift es wirklich im Dedup? ---

function fixture(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8'));
}

test('der Dedup traegt das frueheste Gruppendatum an den Sieger', () => {
  // Zwei Beine DERSELBEN Firma, exakt nach dem Zealand-Muster: gleicher Name, gleiche
  // Zahlen, nur Ticker und Erstnotiz unterscheiden sich — und das JUENGERE Bein traegt die
  // minimal groessere marketCap und gewinnt deshalb den Dedup, wie im echten Fall.
  const basis = fixture('CRDO');
  const heimat = JSON.parse(JSON.stringify(basis));
  const zweitnotiz = JSON.parse(JSON.stringify(basis));

  heimat.meta = { ...heimat.meta, ticker: 'TEST.CO', name: 'Testfirma A/S', firstTradeDate: '2010-11-23T08:00:00.000Z' };
  heimat.marketCap = { value: 3072033124, source: 'test', confidence: 0.9 };

  zweitnotiz.meta = { ...zweitnotiz.meta, ticker: 'TEST.VI', name: 'Testfirma A/S', firstTradeDate: '2026-03-31T06:55:00.000Z' };
  zweitnotiz.marketCap = { value: 3083231905, source: 'test', confidence: 0.9 };

  const results = scoreUniverse([heimat, zweitnotiz], formulas);
  const ueberlebende = results.filter((e) => e.action === 'route');
  assert.equal(ueberlebende.length, 1, 'genau ein Bein darf ueberleben (Dedup)');

  const sieger = ueberlebende[0];
  assert.equal(sieger.ticker, 'TEST.VI', 'Vorbedingung: das juengere Bein gewinnt weiterhin den Dedup');
  assert.equal(sieger.ipoYear, 2010, 'der Sieger muss das Boersendebuet der FIRMA tragen, nicht das seines Papiers');

  const verlierer = results.find((e) => e.ticker === 'TEST.CO');
  assert.equal(verlierer.reason, 'dup-issuer', 'das andere Bein bleibt regulaer ausgeschlossen');
});

test('das Hilfsfeld bleibt nicht in der Ausgabe stehen', () => {
  // Ein internes Feld, das in den Export durchrutscht, waere ein stiller Vertragsbruch.
  const basis = fixture('CRDO');
  const a = JSON.parse(JSON.stringify(basis));
  const b = JSON.parse(JSON.stringify(basis));
  a.meta = { ...a.meta, ticker: 'TEST2.CO', name: 'Zweite Testfirma', firstTradeDate: '2001-01-05T08:00:00.000Z' };
  b.meta = { ...b.meta, ticker: 'TEST2.VI', name: 'Zweite Testfirma', firstTradeDate: '2024-01-05T08:00:00.000Z' };
  a.marketCap = { value: 1e9, source: 'test', confidence: 0.9 };
  b.marketCap = { value: 1.01e9, source: 'test', confidence: 0.9 };

  const results = scoreUniverse([a, b], formulas);
  for (const e of results) {
    assert.ok(!('_gruppeErstnotiz' in e), `internes Feld an ${e.ticker} durchgereicht`);
  }
});

test('eine Einzelnotierung behaelt ihr eigenes Datum unveraendert', () => {
  // Die Gegenrichtung: die Regel darf nur bei Gruppen greifen.
  const s = fixture('CRDO');
  const einzel = JSON.parse(JSON.stringify(s));
  einzel.meta = { ...einzel.meta, ticker: 'EINZEL', name: 'Einzelfirma Inc.', firstTradeDate: '2022-05-10T08:00:00.000Z' };
  delete einzel.meta.ipoYear;

  const results = scoreUniverse([einzel], formulas);
  const r = results.find((e) => e.ticker === 'EINZEL');
  assert.ok(r, 'Einzelfirma fehlt im Ergebnis');
  assert.equal(r.ipoYear, 2022);
});

console.log(`\ndoppelnotiz-erstnotiz: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
